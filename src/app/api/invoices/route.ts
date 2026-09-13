import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, logAudit, numOrNull, pageLimit, fail, dateOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { assertModuleLevel } from "@/lib/crm/permissions";
import { sendPushToRoles } from "@/lib/crm/push";
import { nextDocumentNumber, revisionDocumentNumber } from "@/lib/crm/numbering";
// Ronde 56 — pengiriman nyata: PDF faktur + email brand terhubung
import { buildInvoicePdf, pdfFileName } from "@/lib/crm/doc-pdf";
import { sendDocumentEmail, pdfAttachment, isDelivered } from "@/lib/crm/doc-send";

// ============ Ronde 50 — helper faktur gaya Unicam (item baris, DP, pajak potong) ============

export interface InvoiceItemRow {
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
}

/** Parse item faktur dari body: [{description, qty, unit, unitPrice}] → total per baris. */
export function parseInvoiceItems(raw: unknown): InvoiceItemRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it) => it && String((it as InvoiceItemRow).description ?? "").trim())
    .map((it) => {
      const qty = Math.max(0, Number((it as InvoiceItemRow).qty ?? 1) || 1);
      const unitPrice = Math.max(0, Number((it as InvoiceItemRow).unitPrice ?? 0) || 0);
      return {
        description: String((it as InvoiceItemRow).description).trim().slice(0, 300),
        qty,
        unit: String((it as InvoiceItemRow).unit ?? "").trim().slice(0, 30),
        unitPrice,
        total: Math.round(qty * unitPrice),
      };
    });
}

/**
 * Kalkulasi total faktur Ronde 50 + Ronde 56 (diskon nominal + mode gross-up):
 * - discountAmount (R56): potongan nominal dari contoh faktur Unicam
 *   (item 11.250.000 − discount 1.250.000 = Sub Total 10.000.000).
 * - downPaymentPct > 0 → dasar tagihan = amount × DP% (invoice DP/termin dari kontrak),
 *   pajak dihitung dari dasar tagihan (contoh Unicam: PPh 23 2% × DP 15.750.000 = 315.000).
 * - taxMode "withhold" → pajak MENGURANGI (PPh 23/21 dipotong penyelenggara);
 *   taxMode "grossup" (R56, contoh faktur Unicam) → pajak ditambahkan lalu
 *   dikurangi lagi ("Gross-Up … Total … Less … Total Payment") → Total Payment = dasar;
 *   taxMode "add" (default) → pajak menambah (PPN).
 * - total (payable) = dasar tagihan ± pajak (grossup: dasar).
 */
function computeInvoiceTotals(input: {
  amount: number;
  taxName: string | null;
  taxRate: number;
  taxMode: string;
  downPaymentPct: number;
  discountAmount?: number;
}) {
  const discount = Math.min(Math.max(0, input.amount), Math.max(0, Math.round(input.discountAmount || 0)));
  const afterDiscount = Math.max(0, input.amount - discount);
  const dpPct = Math.min(100, Math.max(0, input.downPaymentPct || 0));
  const dpAmount = dpPct > 0 ? Math.round((afterDiscount * dpPct) / 100) : afterDiscount;
  const taxAmount = input.taxName ? Math.round((dpAmount * Math.min(100, Math.max(0, input.taxRate))) / 100) : 0;
  const total = input.taxMode === "withhold"
    ? dpAmount - taxAmount
    : input.taxMode === "grossup"
      ? dpAmount
      : dpAmount + taxAmount;
  return { discount, afterDiscount, dpAmount, taxAmount, total };
}

function shortText(v: unknown, max: number): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Nomor invoice via rule brand (fallback legacy) — retry 3x utk tabrakan paralel. */
async function nextInvoiceNumber(brandId: string): Promise<{ number: string; baseNumber: string; seq: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await nextDocumentNumber(brandId, "invoice");
    } catch {
      // coba lagi
    }
  }
  return null;
}

/** Field faktur gaya Unicam dari body (null = tidak dikirim → tidak diubah). */
function unicamFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const items = parseInvoiceItems(body.items);
  if (items.length > 0) out.items = JSON.stringify(items);
  if ("downPaymentPct" in body) {
    const n = Number(body.downPaymentPct);
    out.downPaymentPct = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  // Ronde 56 — taxMode kini juga menerima "grossup" (Gross-Up → Less → Total Payment)
  if ("taxMode" in body) out.taxMode = body.taxMode === "withhold" ? "withhold" : body.taxMode === "grossup" ? "grossup" : "add";
  if ("purchaseNumber" in body) out.purchaseNumber = shortText(body.purchaseNumber, 80);
  if ("projectName" in body) out.projectName = shortText(body.projectName, 160);
  if ("attn" in body) out.attn = shortText(body.attn, 120);
  if ("clientAddress" in body) out.clientAddress = shortText(body.clientAddress, 400);
  // Ronde 56 — jadwal termin (Term of Payment terstruktur)
  if ("terms" in body) {
    const terms = parseInvoiceTerms(body.terms);
    out.terms = terms.length > 0 ? JSON.stringify(terms) : null;
  }
  // Ronde 56 — diskon nominal (gaya contoh faktur Unicam)
  if ("discountAmount" in body) {
    const n = Number(body.discountAmount);
    out.discountAmount = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
  return out;
}

/** Ronde 56 — validasi jadwal termin: [{label, pct, dueDays, dueEvent}] maks 6 baris. */
const TERM_EVENTS = ["invoice", "down_payment", "bastp", "handover", "delivery"] as const;
export function parseInvoiceTerms(raw: unknown): Array<{ label: string; pct: number; dueDays: number; dueEvent: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object")
    .slice(0, 6)
    .map((t) => {
      const term = t as { label?: unknown; pct?: unknown; dueDays?: unknown; dueEvent?: unknown };
      const label = String(term.label ?? "").trim().slice(0, 80) || "Payment";
      const pct = Math.min(100, Math.max(0, Number(term.pct) || 0));
      const dueDays = Math.min(365, Math.max(0, Math.round(Number(term.dueDays) || 0)));
      const dueEvent = TERM_EVENTS.includes(String(term.dueEvent) as (typeof TERM_EVENTS)[number])
        ? String(term.dueEvent)
        : "invoice";
      return { label, pct, dueDays, dueEvent };
    });
}

/**
 * Ronde 56 — otomasi WON via Nomor PO: bila faktur terhubung opportunity
 * diberi purchaseNumber (PO klien masuk), opportunity otomatis won
 * (ketentuan user: project won bila PO diterima ATAU dokumen ditandatangani).
 */
async function maybeWinByPO(opts: {
  opportunityId: string | null;
  purchaseNumber: string | null;
  actorName: string;
  req?: NextRequest;
}): Promise<void> {
  if (!opts.opportunityId || !opts.purchaseNumber) return;
  try {
    const opp = await db.opportunity.findUnique({ where: { id: opts.opportunityId }, select: { id: true, stage: true, title: true } });
    if (!opp || opp.stage === "won") return;
    await db.opportunity.update({ where: { id: opp.id }, data: { stage: "won" } });
    await logAudit({
      actorName: opts.actorName,
      action: "update",
      entity: "opportunity",
      entityId: opp.id,
      entityLabel: opp.title,
      field: "stage",
      oldValue: opp.stage,
      newValue: "won",
      metadata: `Otomatis WON — nomor PO klien diterima: ${opts.purchaseNumber}`,
      req: opts.req,
    });
    void sendPushToRoles(["director", "super_admin"], {
      title: "Deal WON — PO diterima",
      body: `${opp.title} otomatis won karena nomor PO ${opts.purchaseNumber} dicatat pada invoice.`.slice(0, 140),
      url: "/?modul=pipeline",
      tag: `po-win:${opp.id}`,
      type: "activity",
    }, opts.actorName).catch(() => {});
  } catch {
    /* win-otomatis gagal tidak boleh menggagalkan penyimpanan invoice */
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const brandId = sp.get("brandId");
  const companyId = sp.get("companyId");

  // Ronde 47 — sweep status overdue: invoice "sent" yang sudah melewati jatuh tempo
  // otomatis menjadi "overdue" (sebelumnya status tak pernah berubah sehingga filter
  // & aging tidak akurat). Idempoten & murah — satu updateMany tiap load.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  await db.invoice.updateMany({
    where: { status: "sent", dueDate: { lt: startOfToday } },
    data: { status: "overdue" },
  });

  const invoices = await db.invoice.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
      ...(companyId ? { companyId } : {}),
    },
    include: {
      brand: true, payments: true, project: true,
      // Ronde 48 — kontak klien (WA/email) untuk aksi "Hubungi Klien" finance.
      company: {
        include: {
          contacts: {
            where: { deletedAt: null },
            select: { id: true, fullName: true, whatsapp: true, email: true, phone: true, preferredChannel: true },
            take: 3,
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    orderBy: { issueDate: "desc" },
    take: pageLimit(sp.get("limit"), 300, 500), // FIX r26: batasi payload (sebelumnya tanpa batas)
  });

  // Aging receivable
  const now = Date.now();
  const outstanding = invoices.filter((i) => ["sent", "partial", "overdue"].includes(i.status));
  const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  outstanding.forEach((i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = i.total - paid;
    const overdueDays = i.dueDate ? Math.floor((now - i.dueDate.getTime()) / (24 * 60 * 60 * 1000)) : 0;
    if (overdueDays <= 0) aging.current += remaining;
    else if (overdueDays <= 30) aging.d30 += remaining;
    else if (overdueDays <= 60) aging.d60 += remaining;
    else aging.d90 += remaining;
  });

  return ok({ invoices, aging });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director", "finance"]);
  if (!gate.ok) return fail(gate.reason, 403);
  // Ronde 47 — RBAC dinamis: semua mutasi finance butuh level modul "write".
  // (delete_payment di bawah butuh "full" — aksi kritis/koreksi.)
  const moduleGate = await assertModuleLevel(actor, "finance", "write");
  if (!moduleGate.ok) return fail(moduleGate.reason, 403);
  // Tambah pembayaran
  if (body.action === "add_payment") {
    const invoiceId = String(body.invoiceId ?? "");
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) return ok({ error: "Invoice tidak ditemukan" }, 404);
    // FIX r26: amount wajib angka finite > 0 (NaN/negatif dulu lolos → status korup)
    const amount = numOrNull(body.amount);
    if (amount === null || amount <= 0) {
      return ok({ error: "Nominal pembayaran harus angka lebih besar dari 0" }, 400);
    }
    if (invoice.status === "cancelled" || invoice.status === "paid") {
      return ok({ error: `Invoice berstatus ${invoice.status} tidak bisa menerima pembayaran` }, 400);
    }
    // FIX r26: pembayaran + update status dalam SATU transaksi —
    // total terbayar dihitung ulang dari DB di dalam tx (bukan memori basi).
    const updated = await db.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          invoiceId, amount,
          method: body.method ? String(body.method) : "transfer",
          reference: body.reference ? String(body.reference) : null,
        },
      });
      const agg = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
      const paid = agg._sum.amount ?? 0;
      let status = invoice.status;
      if (paid >= invoice.total) status = "paid";
      else if (paid > 0) status = "partial";
      return tx.invoice.update({ where: { id: invoiceId }, data: { status }, include: { payments: true } });
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "invoice", entityId: invoiceId, entityLabel: invoice.number,
      field: "payment", newValue: `Pembayaran ${amount} via ${body.method ?? "transfer"}`, req,
    });
    return ok({ invoice: updated });
  }
  // Kirim invoice (draft → sent) — Ronde 56: KIRIM NYATA via email brand + PDF
  if (body.action === "send_invoice") {
    const invoiceId = String(body.invoiceId ?? "");
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true, brand: true, company: { select: { name: true, address: true } }, project: { select: { name: true } } },
    });
    if (!invoice) return ok({ error: "Invoice tidak ditemukan" }, 404);
    if (invoice.status !== "draft") {
      return ok({ error: "Hanya invoice draft yang bisa dikirim" }, 400);
    }

    // ==== Ronde 56 — dulu hanya menandai "sent" TANPA mengirim apa pun ====
    // (laporan user: "invoice tidak terkirim"). Kini PDF faktur dibangun
    // server-side (English, gaya contoh Unicam: Discount → Sub Total →
    // Gross-Up → Total → Less → Total Payment + Terbilang), dikirim via SMTP
    // kanal email brand, dan interaksi tercatat (sinkron timeline & inbox).
    const recipient = String(body.email ?? "").trim();
    if (!recipient || !recipient.includes("@")) {
      return ok({ error: "Alamat email klien wajib diisi pada dialog kirim" }, 400);
    }
    if (body.confirmLegal !== true) {
      return ok({ error: "Konfirmasi syarat & ketentuan pengiriman wajib dicentang" }, 400);
    }
    // Kontak utama perusahaan → agar interaksi tertaut thread inbox
    const contact = await db.contact.findFirst({
      where: { companyId: invoice.companyId, email: { not: null } },
      select: { id: true, fullName: true, email: true },
      orderBy: { createdAt: "asc" },
    });

    const now = new Date();
    const dueDate = invoice.dueDate ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const pdf = buildInvoicePdf(
      { ...invoice, issueDate: invoice.issueDate ?? now, dueDate },
      invoice.brand,
      { name: invoice.company?.name ?? null, address: invoice.clientAddress ?? invoice.company?.address ?? null },
    );
    const pdfName = pdfFileName("Invoice", invoice.number);
    const totalTxt = `${invoice.currency} ${Number(invoice.total ?? 0).toLocaleString("en-US")}`;
    const subject = `Invoice ${invoice.number} — ${invoice.brand.name ?? "Payment Request"}`;
    const content = [
      `Dear ${invoice.attn || invoice.company?.name || "Valued Client"},`,
      "",
      `Please find attached invoice ${invoice.number} for ${totalTxt}, due on ${dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}.`,
      invoice.purchaseNumber ? `Purchase Order reference: ${invoice.purchaseNumber}.` : "",
      "",
      "Bank transfer details are stated on the invoice. Kindly send the payment confirmation after transfer.",
      "",
      "This invoice is issued subject to the agreed scope and terms of payment in the signed quotation/contract between both parties.",
      "",
      "Best regards,",
      invoice.brand.name ?? "Finance Team",
    ].filter(Boolean).join("\n");

    const send = await sendDocumentEmail({
      req,
      actorName: actor.name,
      actorRole: actor.role,
      brandId: invoice.brandId,
      recipientEmail: recipient,
      recipientName: contact?.fullName ?? invoice.company?.name ?? null,
      subject,
      content,
      attachments: [pdfAttachment(pdfName, pdf)],
      interaction: {
        opportunityId: invoice.opportunityId,
        contactId: contact?.id ?? null,
        companyId: invoice.companyId,
      },
      entityLabel: `Kirim invoice ${invoice.number} → ${recipient}`,
      auditMetadata: `PDF ${pdfName} · total ${totalTxt}`,
    });
    if (!isDelivered(send.status)) {
      return ok({ error: `Gagal mengirim email invoice: ${send.note ?? send.status}. Invoice tetap draft — periksa kanal email di Saluran & Integrasi.` }, 502);
    }

    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: { status: "sent", issueDate: now, dueDate },
      include: { payments: true },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "invoice", entityId: invoiceId, entityLabel: invoice.number,
      field: "status", oldValue: "draft", newValue: "sent",
      metadata: `TERKIRIM via email (${send.status}) → ${recipient}`, req,
    });
    // Ronde 46+48 — push: invoice dikirim ke klien → pimpinan & finance ikut tahu.
    void sendPushToRoles(["director", "super_admin", "finance"], {
      title: `Invoice ${updated.number} dikirim`,
      body: `${actor.name} mengirim tagihan ${updated.number} via email (${send.status}) — ${totalTxt}`.slice(0, 140),
      url: "/?modul=finance",
      tag: `invoice:${updated.id}`,
      type: "activity",
    }, actor.name);
    return ok({ invoice: updated, delivery: { status: send.status, note: send.note, to: recipient } });
  }
  // Batalkan invoice
  if (body.action === "cancel_invoice") {
    const invoiceId = String(body.invoiceId ?? "");
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) return ok({ error: "Invoice tidak ditemukan" }, 404);
    if (invoice.status === "paid" || invoice.status === "partial") {
      return ok({ error: "Invoice yang sudah dibayar tidak bisa dibatalkan" }, 400);
    }
    if (invoice.status === "cancelled") {
      return ok({ error: "Invoice sudah dibatalkan" }, 400);
    }
    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: { status: "cancelled" },
      include: { payments: true },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "invoice", entityId: invoiceId, entityLabel: invoice.number,
      field: "status", oldValue: invoice.status, newValue: "cancelled", req,
    });
    return ok({ invoice: updated });
  }
  // Ronde 47 — edit invoice DRAFT (koreksi sebelum dikirim): deskripsi, nominal,
  // pajak parametrik, jatuh tempo & catatan. Status lain ditolak agar dokumen
  // yang sudah terkirim/lunas tidak berubah diam-diam.
  if (body.action === "update_invoice") {
    const invoiceId = String(body.invoiceId ?? "");
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) return ok({ error: "Invoice tidak ditemukan" }, 404);
    if (invoice.status !== "draft") {
      return ok({ error: "Hanya invoice berstatus Draft yang bisa diedit" }, 400);
    }
    const amount = numOrNull(body.amount) ?? invoice.amount;
    if (amount <= 0) return ok({ error: "Nominal invoice harus lebih besar dari 0" }, 400);
    // Pajak parametrik (Ronde 40): null/"" = tanpa pajak; nama bebas + rate 0-100.
    const taxNameRaw = body.taxName === undefined ? invoice.taxName : body.taxName;
    const taxName = taxNameRaw && String(taxNameRaw).trim() ? String(taxNameRaw).trim().slice(0, 60) : null;
    const taxRate = taxName ? Math.min(100, Math.max(0, numOrNull(body.taxRate) ?? invoice.taxRate)) : 0;
    // Ronde 50 — DP & mode pajak bisa diedit saat draft; total dihitung ulang konsisten.
    const taxMode = body.taxMode === "withhold" ? "withhold" : body.taxMode === "grossup" ? "grossup" : body.taxMode === "add" ? "add" : invoice.taxMode;
    const downPaymentPct = body.downPaymentPct !== undefined
      ? Math.min(100, Math.max(0, numOrNull(body.downPaymentPct) ?? 0))
      : invoice.downPaymentPct;
    const discountAmount = body.discountAmount !== undefined
      ? Math.max(0, Math.round(Number(body.discountAmount) || 0))
      : invoice.discountAmount;
    const totals = computeInvoiceTotals({ amount, taxName, taxRate, taxMode, downPaymentPct, discountAmount });
    const unicam = unicamFields(body);
    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: {
        description: body.description !== undefined
          ? (String(body.description ?? "").trim() || invoice.description)
          : invoice.description,
        amount,
        taxName,
        taxRate,
        taxAmount: totals.taxAmount,
        total: totals.total,
        taxMode,
        downPaymentPct,
        discountAmount: totals.discount,
        ...unicam,
        dueDate: body.dueDate !== undefined ? dateOrNull(body.dueDate) : invoice.dueDate,
        notes: body.notes !== undefined
          ? (String(body.notes ?? "").trim() || null)
          : invoice.notes,
      },
      include: { payments: true, brand: true, company: true, project: true },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "invoice", entityId: invoiceId, entityLabel: invoice.number,
      field: "draft_edit", newValue: `${updated.description ?? ""} · ${amount} · ${taxName ?? "tanpa pajak"}`, req,
    });
    // Ronde 56 — PO klien diisi saat edit draft → opportunity otomatis WON.
    await maybeWinByPO({ opportunityId: updated.opportunityId, purchaseNumber: updated.purchaseNumber, actorName: actor.name, req });
    return ok({ invoice: updated });
  }

  // Ronde 47 — koreksi pembayaran: hapus entri payment yang salah (mis. salah ketik
  // nominal / salah metode) lalu status invoice dihitung ulang dari sisa payment.
  if (body.action === "delete_payment") {
    // Aksi kritis — butuh level "full" pada modul finance (RBAC dinamis).
    const fullGate = await assertModuleLevel(actor, "finance", "full");
    if (!fullGate.ok) return fail(fullGate.reason, 403);
    const paymentId = String(body.paymentId ?? "");
    const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
    if (!payment) return ok({ error: "Pembayaran tidak ditemukan" }, 404);
    if (payment.invoice.status === "cancelled") {
      return ok({ error: "Invoice sudah dibatalkan — pembayaran tidak bisa dikoreksi" }, 400);
    }
    const updated = await db.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: paymentId } });
      const agg = await tx.payment.aggregate({ where: { invoiceId: payment.invoiceId }, _sum: { amount: true } });
      const paid = agg._sum.amount ?? 0;
      let status = "sent";
      if (paid >= payment.invoice.total) status = "paid";
      else if (paid > 0) status = "partial";
      else if (payment.invoice.dueDate && payment.invoice.dueDate.getTime() < Date.now()) status = "overdue";
      return tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { status },
        include: { payments: true, brand: true, company: true, project: true },
      });
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "delete", entity: "invoice", entityId: payment.invoiceId, entityLabel: payment.invoice.number,
      field: "payment", oldValue: `Pembayaran ${payment.amount} via ${payment.method}`, req,
    });
    return ok({ invoice: updated });
  }

  // Ronde 47 — terbitkan invoice MANUAL (tanpa project/quotation): tagihan langsung
  // seperti DP, kerja sama one-off, atau penyesuaian. Sinkron brand: nomor memakai
  // prefix brand, mata uang mengikuti primaryCurrency brand.
  if (body.action === "create_standalone_invoice") {
    const brandId = String(body.brandId ?? "").trim();
    const companyId = String(body.companyId ?? "").trim();
    if (!brandId) return ok({ error: "Brand wajib dipilih" }, 400);
    if (!companyId) return ok({ error: "Perusahaan wajib dipilih" }, 400);
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    if (!brand) return ok({ error: "Brand tidak ditemukan" }, 404);
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) return ok({ error: "Perusahaan tidak ditemukan" }, 404);
    const amount = numOrNull(body.amount);
    if (amount === null || amount <= 0) {
      return ok({ error: "Nominal invoice harus angka lebih besar dari 0" }, 400);
    }
    const description = String(body.description ?? "").trim() || `Invoice ${company.name}`;
    const taxNameRaw = body.taxName;
    const taxName = taxNameRaw && String(taxNameRaw).trim() ? String(taxNameRaw).trim().slice(0, 60) : null;
    const taxRate = taxName ? Math.min(100, Math.max(0, numOrNull(body.taxRate) ?? 11)) : 0;
    // Ronde 50 — mode pajak (add=PPN ditambah, withhold=PPh dipotong, grossup=R56) + DP + item baris.
    const taxMode = body.taxMode === "withhold" ? "withhold" : body.taxMode === "grossup" ? "grossup" : "add";
    const downPaymentPct = Math.min(100, Math.max(0, numOrNull(body.downPaymentPct) ?? 0));
    const discountAmount = Math.max(0, Math.round(Number(body.discountAmount) || 0));
    const totals = computeInvoiceTotals({ amount, taxName, taxRate, taxMode, downPaymentPct, discountAmount });
    const items = parseInvoiceItems(body.items);
    const dueDate = dateOrNull(body.dueDate) ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Ronde 50 — penomoran via rule brand (builder) dgn fallback pola legacy.
    const numbered = await nextInvoiceNumber(brandId);
    if (!numbered) return ok({ error: "Gagal menyusun nomor invoice unik — coba sekali lagi" }, 409);
    const { number, baseNumber, seq: seqNo } = numbered;

    let invoice;
    try {
      invoice = await db.invoice.create({
        data: {
          number,
          baseNumber,
          seqNo,
          brandId,
          companyId,
          description,
          amount,
          taxName,
          taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          taxMode,
          downPaymentPct,
          discountAmount: totals.discount,
          items: JSON.stringify(items),
          ...unicamFields(body),
          // Sinkron brand: mata uang mengikuti konfigurasi brand (bukan hardcode IDR)
          currency: brand.primaryCurrency || "IDR",
          status: "draft",
          dueDate,
          notes: body.notes ? String(body.notes).trim() || null : null,
        },
        include: { payments: true, brand: true, company: true, project: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return ok({ error: "Nomor invoice baru saja dipakai proses lain — coba sekali lagi" }, 409);
      throw err;
    }
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "create", entity: "invoice", entityId: invoice.id, entityLabel: invoice.number,
      newValue: `Invoice manual ${description} · ${amount}${taxName ? ` + ${taxName} ${taxRate}%` : ""} · brand ${brand.name}`, req,
    });
    // Ronde 56 — PO klien pada invoice manual → opportunity otomatis WON.
    await maybeWinByPO({ opportunityId: invoice.opportunityId, purchaseNumber: invoice.purchaseNumber, actorName: actor.name, req });
    // Ronde 48 — finance adalah pemilik proses tagihan → wajib di-notify.
    void sendPushToRoles(["director", "super_admin", "finance"], {
      title: `Invoice ${invoice.number} diterbitkan`,
      body: `${actor.name} menerbitkan tagihan manual ${description.slice(0, 80)} · ${invoice.total}`.slice(0, 140),
      url: "/?modul=finance",
      tag: `invoice:${invoice.id}`,
      type: "activity",
    }, actor.name);
    return ok({ invoice }, 201);
  }

  // Ronde 35 — terbitkan invoice manual dari project (termin/milestone).
  // Menyatukan alur Produksi → Keuangan: tahap milestone selesai → finance menagih.
  if (body.action === "create_invoice") {
    const projectId = String(body.projectId ?? "").trim();
    if (!projectId) return ok({ error: "Project wajib dipilih" }, 400);
    const amount = numOrNull(body.amount);
    if (amount === null || amount <= 0) {
      return ok({ error: "Nominal invoice harus angka lebih besar dari 0" }, 400);
    }
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: { brand: true, opportunity: true },
    });
    if (!project) return ok({ error: "Project tidak ditemukan" }, 404);

    const description = String(body.description ?? "").trim() || `Invoice project ${project.name}`;
    const taxRate = numOrNull(body.taxRate) ?? 11;
    const taxAmount = Math.round((amount * taxRate) / 100);
    const dueDate = dateOrNull(body.dueDate) ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Ronde 50 — penomoran via rule brand (builder) dgn fallback pola legacy;
    // dua klik bersamaan tidak lagi menghasilkan nomor dobel (retry + P2002 → 409).
    const numbered = await nextInvoiceNumber(project.brandId);
    if (!numbered) return ok({ error: "Gagal menyusun nomor invoice unik — coba sekali lagi" }, 409);
    const { number, baseNumber, seq: seqNo } = numbered;

    let invoice;
    try {
      invoice = await db.invoice.create({
        data: {
          number,
          baseNumber,
          seqNo,
          brandId: project.brandId,
          companyId: project.companyId,
          projectId: project.id,
          opportunityId: project.opportunityId,
          description,
          amount,
          taxRate,
          taxAmount,
          total: amount + taxAmount,
          // Ronde 41 — mata uang invoice mengalir dari opportunity (yang berasal dari kontak) → brand → IDR
          currency: project.opportunity?.currency ?? project.brand.primaryCurrency ?? "IDR",
          status: "draft",
          dueDate,
        },
        include: { payments: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return ok({ error: "Nomor invoice baru saja dipakai proses lain — coba sekali lagi" }, 409);
      throw err;
    }
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "create", entity: "invoice", entityId: invoice.id, entityLabel: invoice.number,
      newValue: `Invoice ${description} · ${amount}${taxRate ? ` + PPN ${taxRate}%` : ""} untuk project ${project.code}`,
      req,
    });
    // Ronde 46 — push: invoice diterbitkan → pimpinan menerima notifikasi.
    // Ronde 48 — finance adalah pemilik proses tagihan → wajib di-notify.
    void sendPushToRoles(["director", "super_admin", "finance"], {
      title: `Invoice ${invoice.number} diterbitkan`,
      body: `${actor.name} menerbitkan tagihan ${description.slice(0, 80)} · ${amount + taxAmount}`.slice(0, 140),
      url: "/?modul=finance",
      tag: `invoice:${invoice.id}`,
      type: "activity",
    }, actor.name);
    return ok({ invoice }, 201);
  }
  // Ronde 50 — REVISI FAKTUR: invoice baru menyalin isi invoice sumber dengan nomor
  // berimbuhan: 004/INV-UDP/I/26 → 004-1/INV-UDP/I/26 → 004-2/...
  // Semua field editable boleh dikirim (deskripsi/amount/item/DP/pajak/PO/due date);
  // field yang tidak dikirim disalin dari sumber. Status invoice sumber tidak berubah.
  if (body.action === "revise_invoice") {
    const sourceId = String(body.invoiceId ?? "");
    const source = await db.invoice.findUnique({ where: { id: sourceId }, include: { payments: true } });
    if (!source) return ok({ error: "Invoice sumber revisi tidak ditemukan" }, 404);
    if (source.status === "cancelled") {
      return ok({ error: "Invoice yang dibatalkan tidak bisa direvisi — terbitkan invoice baru saja" }, 400);
    }
    const amount = numOrNull(body.amount) ?? source.amount;
    if (amount <= 0) return ok({ error: "Nominal invoice harus lebih besar dari 0" }, 400);
    const taxNameRaw = body.taxName === undefined ? source.taxName : body.taxName;
    const taxName = taxNameRaw && String(taxNameRaw).trim() ? String(taxNameRaw).trim().slice(0, 60) : null;
    const taxRate = taxName ? Math.min(100, Math.max(0, numOrNull(body.taxRate) ?? source.taxRate)) : 0;
    const taxMode = body.taxMode === "add" ? "add" : body.taxMode === "withhold" ? "withhold" : body.taxMode === "grossup" ? "grossup" : source.taxMode;
    const downPaymentPct = body.downPaymentPct !== undefined
      ? Math.min(100, Math.max(0, numOrNull(body.downPaymentPct) ?? 0))
      : source.downPaymentPct;
    const discountAmount = body.discountAmount !== undefined
      ? Math.max(0, Math.round(Number(body.discountAmount) || 0))
      : source.discountAmount;
    const totals = computeInvoiceTotals({ amount, taxName, taxRate, taxMode, downPaymentPct, discountAmount });
    const description = body.description !== undefined
      ? (String(body.description ?? "").trim() || source.description)
      : source.description;
    const dueDate = body.dueDate !== undefined
      ? (dateOrNull(body.dueDate) ?? source.dueDate)
      : source.dueDate;
    const revisionReason = shortText(body.revisionReason, 400);

    const rev = await revisionDocumentNumber(
      source.brandId,
      "invoice",
      source.number,
      source.revisionNo,
      source.seqNo,
      source.issueDate ?? source.createdAt,
    );
    let invoice;
    try {
      invoice = await db.invoice.create({
        data: {
          number: rev.number,
          baseNumber: rev.baseNumber,
          seqNo: rev.seq,
          brandId: source.brandId,
          companyId: source.companyId,
          projectId: source.projectId,
          opportunityId: source.opportunityId,
          description,
          amount,
          taxName,
          taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          taxMode,
          downPaymentPct,
          discountAmount: totals.discount,
          ...unicamFields({ ...bodyToSourceItems(source), ...body }),
          currency: source.currency,
          status: "draft",
          dueDate,
          notes: body.notes !== undefined ? (String(body.notes ?? "").trim() || null) : source.notes,
          revisionOfId: source.id,
          revisionNo: source.revisionNo + 1,
          revisionReason,
        },
        include: { payments: true, brand: true, company: true, project: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return ok({ error: `Nomor revisi ${rev.number} baru saja dipakai proses lain — muat ulang lalu coba lagi` }, 409);
      }
      throw err;
    }
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "create", entity: "invoice", entityId: invoice.id, entityLabel: invoice.number,
      metadata: `Revisi ke-${invoice.revisionNo} dari ${source.number}${revisionReason ? ` — ${revisionReason}` : ""}`,
      req,
    });
    // Ronde 56 — PO pada invoice revisi juga memicu WON otomatis.
    await maybeWinByPO({ opportunityId: invoice.opportunityId, purchaseNumber: invoice.purchaseNumber, actorName: actor.name, req });
    void sendPushToRoles(["director", "super_admin", "finance"], {
      title: `Invoice ${invoice.number} diterbitkan (revisi)`,
      body: `${actor.name} merevisi ${source.number} → ${invoice.number} · total ${invoice.total}`.slice(0, 140),
      url: "/?modul=finance",
      tag: `invoice:${invoice.id}`,
      type: "invoice",
    }, actor.name);
    return ok({ invoice }, 201);
  }
  return ok({ error: "Unknown action" }, 400);
}

/** Helper: item sumber utk revisi (body tak mengirim items → salin dari sumber). */
function bodyToSourceItems(source: { items: string }): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(source.items);
    return { items: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { items: [] };
  }
}
