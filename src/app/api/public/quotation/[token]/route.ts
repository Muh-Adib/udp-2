import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { sha256, randomToken, baseUrlFromReq, sendDocumentEmail } from "@/lib/crm/doc-send";
import { buildQuotationPdf, pdfFileName } from "@/lib/crm/doc-pdf";

/**
 * Ronde 56 — API PUBLIK link aman quotation (tanpa login CRM).
 *
 * Alur sesuai permintaan user:
 * - Klien menerima magic link via email brand → klik langsung terbuka
 *   (tanpa isi password), namun keterangan password tetap ditampilkan.
 * - Link hanya bisa dibuka MAKS 3 kali; habis → klien klik "request new
 *   code" → kode/magic link BARU dibuat dan otomatis dikirim via email brand.
 * - Klien bisa menandatangani (e-sign) → quotation accepted + deal WON.
 *
 * Keamanan: key/password disimpan sebagai SHA-256; dibuka berapa kali
 * dihitung server-side; tanda tangan divalidasi ulang per aksi.
 */

// Rate limit sederhana request-new-code per quotation (maks 3/jam).
const newCodeLog = new Map<string, number[]>();
const NEW_CODE_LIMIT = 3;
const NEW_CODE_WINDOW = 60 * 60 * 1000;

function tooManyNewCodes(quotationId: string): boolean {
  const now = Date.now();
  const hits = (newCodeLog.get(quotationId) ?? []).filter((t) => now - t < NEW_CODE_WINDOW);
  if (hits.length >= NEW_CODE_LIMIT) return true;
  hits.push(now);
  newCodeLog.set(quotationId, hits);
  return false;
}

async function loadToken(token: string) {
  return db.quotationShareToken.findUnique({
    where: { token },
    include: {
      quotation: {
        include: {
          brand: true,
          company: { select: { name: true, address: true } },
          opportunity: { select: { id: true, title: true, contactId: true } },
        },
      },
    },
  });
}

/** Autentikasi akses: magic key ATAU password. */
function checkAccess(
  row: { keySha: string | null; passwordSha: string | null },
  key: string | null,
  password: string | null,
): { ok: boolean; needs?: "password" | "key_or_password" } {
  const keyOk = Boolean(key && row.keySha && sha256(key) === row.keySha);
  const passOk = Boolean(password && row.passwordSha && sha256(password) === row.passwordSha);
  if (keyOk || passOk) return { ok: true };
  if (row.passwordSha && row.keySha) return { ok: false, needs: "key_or_password" };
  if (row.passwordSha) return { ok: false, needs: "password" };
  return { ok: false, needs: "key_or_password" };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sp = req.nextUrl.searchParams;
  const key = sp.get("key");
  const password = sp.get("password");
  const wantPdf = sp.get("pdf") === "1";

  const row = await loadToken(token);
  if (!row || row.revoked) return fail("Link tidak ditemukan atau sudah dicabut", 404);
  const q = row.quotation;

  const access = checkAccess(row, key, password);
  if (!access.ok) {
    return ok({ needs: access.needs ?? "key_or_password", opensLeft: Math.max(0, row.maxOpens - row.opens) }, 401);
  }
  if (row.opens >= row.maxOpens) {
    // Kuota buka habis → klien diminta minta kode baru (otomatis via email brand).
    return ok(
      {
        needsNewCode: true,
        maxOpens: row.maxOpens,
        message: `Secure link ini sudah dibuka ${row.opens} kali (batas ${row.maxOpens}). Klik "Request New Code" dan kode akses baru akan dikirim otomatis ke email Anda.`,
      },
      403,
    );
  }

  // PDF unduh/preview tidak menambah penghitung buka.
  if (wantPdf) {
    const pdf = buildQuotationPdf({ ...q, issueDate: q.createdAt }, q.brand, { name: q.company?.name ?? null, address: q.clientAddress ?? null });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${key || password ? "attachment" : "inline"}; filename="${pdfFileName("Quotation", q.number)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  await db.quotationShareToken.update({
    where: { id: row.id },
    data: { opens: { increment: 1 }, lastOpenedAt: new Date() },
  });

  const items = (() => {
    try {
      const parsed: unknown = JSON.parse(q.items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return ok({
    quotation: {
      number: q.number,
      status: q.status,
      issueDate: q.createdAt.toISOString(),
      validUntil: q.validUntil?.toISOString() ?? null,
      regarding: q.regarding,
      attn: q.attn,
      clientAddress: q.clientAddress,
      timeline: q.timeline,
      revisionNotes: q.revisionNotes,
      termOfPayment: q.termOfPayment,
      letterBody: q.letterBody,
      letterClosing: q.letterClosing,
      currency: q.currency,
      subtotal: q.subtotal,
      discountAmount: q.discountAmount,
      taxName: q.taxName,
      taxPct: q.taxPct,
      taxAmount: q.taxAmount,
      total: q.total,
      items,
      signedAt: q.signedAt?.toISOString() ?? null,
      signedByName: q.signedByName,
    },
    company: { name: q.company?.name ?? null },
    brand: {
      name: q.brand.name,
      color: q.brand.color,
      logoUrl: q.brand.logoUrl,
      logoBg: q.brand.logoBg, // Ronde 62 — latar logo utk logo putih
      letterheadHeader: q.brand.letterheadHeader,
      letterheadFooter: q.brand.letterheadFooter,
      signerName: q.brand.signerName,
    },
    opportunity: { title: q.opportunity.title },
    auth: key ? "magic" : password ? "password" : "none",
    opensLeft: Math.max(0, row.maxOpens - (row.opens + 1)),
    maxOpens: row.maxOpens,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");

  const row = await loadToken(token);
  if (!row || row.revoked) return fail("Link tidak ditemukan atau sudah dicabut", 404);
  const q = row.quotation;
  const key = typeof body.key === "string" ? body.key : null;
  const password = typeof body.password === "string" ? body.password : null;
  const access = checkAccess(row, key, password);
  if (!access.ok) return ok({ error: "Akses tidak valid — buka link dari email terbaru atau isi password" }, 401);

  // ==== Tanda tangan elektronik ====
  if (action === "sign") {
    if (q.signedAt) return ok({ error: `Quotation ini sudah ditandatangani oleh ${q.signedByName ?? "klien"} pada ${q.signedAt.toLocaleDateString("id-ID")}` }, 409);
    const name = String(body.name ?? "").trim().slice(0, 120);
    const title = String(body.title ?? "").trim().slice(0, 120) || null;
    const signature = String(body.signature ?? "");
    if (!name) return ok({ error: "Nama penanda tangan wajib diisi" }, 400);
    if (!signature.startsWith("data:image/png;base64,") || signature.length > 900_000) {
      return ok({ error: "Tanda tangan tidak valid (gambar PNG maks ±650KB)" }, 422);
    }
    if (row.opens >= row.maxOpens) {
      return ok({ error: "Kuota buka link habis — minta kode baru untuk melanjutkan", needsNewCode: true }, 403);
    }

    const updated = await db.quotation.update({
      where: { id: q.id },
      data: {
        signedAt: new Date(),
        signedByName: name,
        signedByTitle: title,
        signatureImage: signature,
        status: "accepted",
        respondedAt: new Date(),
      },
    });
    // WON otomatis — ketentuan user: dokumen ditandatangani ⇒ deal won.
    if (q.opportunityId) {
      const opp = await db.opportunity.findUnique({ where: { id: q.opportunityId }, select: { stage: true, title: true } });
      if (opp && opp.stage !== "won") {
        await db.opportunity.update({ where: { id: q.opportunityId }, data: { stage: "won" } });
      }
    }
    // Interaksi tercatat (timeline + inbox thread — sinkron).
    const baseUrl = baseUrlFromReq(req);
    await db.interaction.create({
      data: {
        channel: "email",
        direction: "inbound",
        brandId: q.brandId,
        opportunityId: q.opportunityId,
        contactId: q.opportunity.contactId,
        companyId: q.companyId,
        senderName: `${name}${title ? ` (${title})` : ""}`.slice(0, 250),
        subject: `Quotation ${q.number} — signed electronically`,
        content: `Client SIGNED the quotation ${q.number} electronically via secure link (${baseUrl}/?quote=${row.token}).\nSignatory: ${name}${title ? ` — ${title}` : ""}\nCompany: ${q.company?.name ?? "-"}\nTotal: ${q.currency} ${q.total.toLocaleString("en-US")}\n\nThe deal is automatically marked WON and ready for invoice conversion.`,
        deliveryStatus: null,
        externalId: `quote-sign:${row.token}`.slice(0, 250),
      },
    });
    const { logAudit } = await import("@/lib/crm/server");
    await logAudit({
      actorName: name,
      actorRole: "client",
      action: "quotation_sign",
      entity: "quotation",
      entityId: q.id,
      entityLabel: q.number,
      field: "status",
      oldValue: q.status,
      newValue: "accepted (signed)",
      metadata: `E-sign oleh ${name}${title ? ` (${title})` : ""} via secure link — deal WON`,
    });
    return ok({ signed: true, number: updated.number, signedAt: updated.signedAt?.toISOString() });
  }

  // ==== Minta kode baru (kuota buka habis / magic link hilang) ====
  if (action === "request_new_code") {
    if (tooManyNewCodes(q.id)) {
      return ok({ error: "Terlalu banyak permintaan kode baru — coba lagi dalam 1 jam" }, 429);
    }
    // Email tujuan: kontak opportunity (divalidasi — kode tidak dikirim ke sembarangan alamat).
    const contact = await db.contact.findUnique({ where: { id: q.opportunity.contactId }, select: { email: true, fullName: true } });
    const recipient = (contact?.email ?? "").trim();
    if (!recipient || !recipient.includes("@")) {
      return ok({ error: "Klien belum memiliki email terdaftar — hubungi tim kami untuk bantuan" }, 422);
    }
    // Cabut token lama (satu link aktif per quotation), buat token+key baru.
    await db.quotationShareToken.updateMany({ where: { quotationId: q.id }, data: { revoked: true } });
    const newToken = randomToken(20);
    const newKey = randomToken(20);
    await db.quotationShareToken.create({
      data: { quotationId: q.id, token: newToken, keySha: sha256(newKey), maxOpens: 3, createdBy: "self-service" },
    });
    const magicUrl = `${baseUrlFromReq(req)}/?quote=${newToken}&key=${newKey}`;
    const send = await sendDocumentEmail({
      req,
      actorName: "Sistem (Request New Code)",
      brandId: q.brandId,
      recipientEmail: recipient,
      recipientName: contact?.fullName ?? q.company?.name ?? null,
      subject: `New access code — Quotation ${q.number}`,
      content: [
        `Dear ${contact?.fullName ?? q.company?.name ?? "Valued Client"},`,
        "",
        `You requested a new access code for quotation ${q.number}. Open your secure quotation link below (valid for 3 opens):`,
        magicUrl,
        "",
        "No password needed when opening from this email — the link itself is your key. If you prefer manual access, the password can be provided by our team on request.",
        "",
        "Best regards,",
        q.brand.name ?? "Sales Team",
      ].join("\n"),
      interaction: {
        opportunityId: q.opportunityId,
        contactId: q.opportunity.contactId,
        companyId: q.companyId,
      },
      entityLabel: `Kirim kode baru quotation ${q.number} → ${recipient}`,
    });
    return ok({ sent: send.status === "sent" || send.status === "simulated", status: send.status, to: recipient });
  }

  return ok({ error: "Unknown action" }, 400);
}
