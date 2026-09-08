import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, clampNum, dateOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { sendPushToRoles } from "@/lib/crm/push";
import { CHANNELS } from "@/lib/crm/constants";

// Ronde 40 — kanal pengiriman quotation: whitelist key CHANNELS (fallback email)
const CHANNEL_KEYS: readonly string[] = CHANNELS.map((c) => c.key);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const actorName = actor.name;
  const actorRole = actor.role;
  const action = String(body.action ?? "update");

  const quotation = await db.quotation.findUnique({
    where: { id },
    include: { brand: true, opportunity: true },
  });
  if (!quotation) return fail("Quotation tidak ditemukan", 404);

  // ---- Aksi khusus ----
  if (action === "send") {
    if (quotation.status !== "draft") return fail("Hanya quotation berstatus draft yang dapat dikirim");
    // Ronde 40 — kanal kirim bebas pilih (whitelist CHANNELS), default email
    const channel = body.channel && CHANNEL_KEYS.includes(String(body.channel)) ? String(body.channel) : "email";
    const updated = await db.quotation.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
      include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
    });
    // Interaksi tercatat di timeline opportunity
    if (quotation.opportunityId) {
      await db.interaction.create({
        data: {
          channel,
          direction: "outbound",
          brandId: quotation.brandId,
          opportunityId: quotation.opportunityId,
          content: `Quotation ${quotation.number} dikirim ke klien. Total: ${quotation.total.toLocaleString("id-ID")} ${quotation.currency}. Berlaku sampai ${quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString("id-ID") : "-"}.`,
          senderName: actorName,
          subject: `Quotation ${quotation.number}`,
          deliveryStatus: "sent",
        },
      });
      await db.opportunity.update({
        where: { id: quotation.opportunityId },
        data: { stage: quotation.opportunity.stage === "estimation" ? "proposal_sent" : undefined },
      });
    }
    await logAudit({
      actorName, actorRole, action: "update", entity: "quotation", entityId: id,
      entityLabel: quotation.number, field: "status", oldValue: "draft", newValue: "sent",
      metadata: `Quotation dikirim via ${channel}`, req,
    });
    // Ronde 39 — push VAPID: quotation terkirim ke klien
    void sendPushToRoles(
      ["director", "super_admin"],
      {
        title: "Quotation terkirim",
        body: `${quotation.number} — ${updated.company?.name ?? "klien"} · total ${updated.total.toLocaleString("id-ID")} ${updated.currency}`,
        url: "/?modul=pipeline",
        tag: `quo-${id}-sent`,
        type: "quotation",
      },
      actor.email
    ).catch(() => {});
    return ok({ quotation: updated });
  }

  if (action === "accept" || action === "reject") {
    const newStatus = action === "accept" ? "accepted" : "rejected";
    const updated = await db.quotation.update({
      where: { id },
      data: { status: newStatus, respondedAt: new Date() },
      include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
    });
    if (quotation.opportunityId && action === "accept") {
      await db.opportunity.update({
        where: { id: quotation.opportunityId },
        data: { stage: "verbal_agreement" },
      });
    }
    await logAudit({
      actorName, actorRole, action: "update", entity: "quotation", entityId: id,
      entityLabel: quotation.number, field: "status", oldValue: quotation.status, newValue: newStatus, req,
    });
    // Ronde 39 — push VAPID: klien menerima/menolak quotation (ditolak = sinyal revisi)
    void sendPushToRoles(
      ["director", "super_admin"],
      {
        title: action === "accept" ? "Quotation diterima klien" : "Quotation ditolak klien",
        body: action === "accept"
          ? `${quotation.number} diterima — siap dikonversi jadi invoice`
          : `${quotation.number} ditolak — pertimbangkan revisi & kirim ulang`,
        url: "/?modul=pipeline",
        tag: `quo-${id}-${newStatus}`,
        type: "quotation",
      },
      actor.email
    ).catch(() => {});
    return ok({ quotation: updated });
  }

  if (action === "convert_invoice") {
    if (quotation.status !== "accepted") return fail("Hanya quotation yang diterima (accepted) yang dapat dikonversi ke invoice");
    const existing = await db.invoice.findFirst({ where: { description: { contains: quotation.number } } });
    if (existing) return fail(`Invoice untuk quotation ini sudah ada: ${existing.number}`);
    const invCount = await db.invoice.count();
    const year = new Date().getFullYear();
    let number = "";
    for (let attempt = 0; attempt < 5 && !number; attempt++) {
      const candidate = `${quotation.brand.invoicePrefix}-${year}-INV-${String(invCount + attempt + 1).padStart(3, "0")}`;
      const exists = await db.invoice.findUnique({ where: { number: candidate } });
      if (!exists) number = candidate;
    }
    if (!number) return fail("Gagal menyusun nomor invoice unik — coba sekali lagi", 409);
    const amount = quotation.total - quotation.taxAmount;
    // Ronde 36 (audit): cek ulang invoice-quotation DI DALAM transaksi + P2002 → 409
    // (dulu double-click bisa membuat dua DP invoice untuk quotation yang sama).
    const invoice = await db
      .$transaction(async (tx) => {
        const dup = await tx.invoice.findFirst({ where: { description: { contains: quotation.number } } });
        if (dup) throw new Error("QUOTE_ALREADY_INVOICED");
        return tx.invoice.create({
          data: {
            number,
            brandId: quotation.brandId,
            companyId: quotation.companyId,
            opportunityId: quotation.opportunityId,
            description: `Invoice dari quotation ${quotation.number}`,
            amount,
            taxRate: quotation.taxPct,
            // Ronde 40 — nama pajak ikut dibawa ke invoice (null = tanpa pajak)
            taxName: quotation.taxName,
            taxAmount: quotation.taxAmount,
            total: quotation.total,
            currency: quotation.currency,
            status: "draft",
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            notes: `Dikonversi dari quotation ${quotation.number} oleh ${actorName}`,
          },
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "QUOTE_ALREADY_INVOICED") return null;
        if (isUniqueViolation(err)) return null;
        throw err;
      });
    if (!invoice) return fail(`Invoice untuk quotation ini sudah ada (mungkin baru saja dibuat)`);
    await logAudit({
      actorName, actorRole, action: "create", entity: "invoice", entityId: invoice.id,
      entityLabel: invoice.number, metadata: `Konversi dari quotation ${quotation.number}`, req,
    });
    return ok({ invoice });
  }

  // ---- Update umum (draft saja) ----
  if (quotation.status !== "draft") return fail("Hanya quotation draft yang dapat diedit");
  const data: Record<string, unknown> = {};
  // Ronde 40 — pajak bebas: taxName passthrough; null/kosong → tanpa pajak (taxPct 0)
  if ("taxName" in body) {
    const taxNameRaw = body.taxName === null || body.taxName === undefined ? null : String(body.taxName).trim().slice(0, 80);
    data.taxName = taxNameRaw ? taxNameRaw : null;
  }
  if (body.items) {
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter((it: { description?: string }) => it && String(it.description ?? "").trim())
      .map((it: { description?: string; qty?: number; unitPrice?: number }) => {
        const qty = Number(it.qty ?? 1) || 1;
        const unitPrice = Number(it.unitPrice ?? 0) || 0;
        return { description: String(it.description).trim(), qty, unitPrice, subtotal: qty * unitPrice };
      });
    if (items.length === 0) return fail("Minimal satu item quotation wajib diisi");
    data.items = JSON.stringify(items);
    const subtotal = items.reduce((s: number, it: { subtotal: number }) => s + it.subtotal, 0);
    // FIX r26: persen dipatok 0–100 (dulu discountPct:1000 → total invoice negatif)
    const discountPct = clampNum(body.discountPct ?? quotation.discountPct, 0, 100, quotation.discountPct);
    // Ronde 40 — tanpa pajak (taxName null/kosong) → taxPct dipaksa 0
    const taxPct = data.taxName === null ? 0 : clampNum(body.taxPct ?? quotation.taxPct, 0, 100, quotation.taxPct);
    const discountAmount = Math.round((subtotal * discountPct) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = Math.round((afterDiscount * taxPct) / 100);
    data.subtotal = subtotal;
    data.discountPct = discountPct;
    data.discountAmount = discountAmount;
    data.taxPct = taxPct;
    data.taxAmount = taxAmount;
    data.total = afterDiscount + taxAmount;
  } else if ("taxName" in body) {
    // Ronde 40 — pajak berubah tanpa perubahan item: hitung ulang pajak & total dari item tersimpan
    const taxPct = data.taxName === null ? 0 : clampNum(body.taxPct ?? quotation.taxPct, 0, 100, quotation.taxPct);
    const afterDiscount = quotation.subtotal - quotation.discountAmount;
    const taxAmount = Math.round((afterDiscount * taxPct) / 100);
    data.taxPct = taxPct;
    data.taxAmount = taxAmount;
    data.total = afterDiscount + taxAmount;
  }
  if ("notes" in body) data.notes = body.notes ? String(body.notes) : null;
  // Ronde 36 (audit): dateOrNull — tanggal "garbage" kini null (sebelumnya 500)
  if ("validUntil" in body) data.validUntil = dateOrNull(body.validUntil);

  const updated = await db.quotation.update({
    where: { id },
    data,
    include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
  });
  await logAudit({
    actorName, actorRole, action: "update", entity: "quotation", entityId: id,
    entityLabel: quotation.number, metadata: "Quotation draft diperbarui", req,
  });
  return ok({ quotation: updated });
}
