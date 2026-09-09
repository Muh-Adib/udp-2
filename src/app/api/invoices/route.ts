import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, logAudit, numOrNull, pageLimit, fail, dateOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { sendPushToRoles } from "@/lib/crm/push";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const brandId = sp.get("brandId");
  const companyId = sp.get("companyId");

  const invoices = await db.invoice.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
      ...(companyId ? { companyId } : {}),
    },
    include: { brand: true, company: true, payments: true, project: true },
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
  // Kirim invoice (draft → sent)
  if (body.action === "send_invoice") {
    const invoiceId = String(body.invoiceId ?? "");
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) return ok({ error: "Invoice tidak ditemukan" }, 404);
    if (invoice.status !== "draft") {
      return ok({ error: "Hanya invoice draft yang bisa dikirim" }, 400);
    }
    const now = new Date();
    const dueDate =
      invoice.dueDate ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: { status: "sent", issueDate: now, dueDate },
      include: { payments: true },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "invoice", entityId: invoiceId, entityLabel: invoice.number,
      field: "status", oldValue: "draft", newValue: "sent", req,
    });
    // Ronde 46 — push: invoice dikirim ke klien → pimpinan ikut tahu.
    void sendPushToRoles(["director", "super_admin"], {
      title: `Invoice ${updated.number} dikirim`,
      body: `${actor.name} mengirim tagihan ${updated.number} — ${updated.description ?? ""}`.slice(0, 140),
      url: "/?modul=finance",
      tag: `invoice:${updated.id}`,
      type: "activity",
    }, actor.name);
    return ok({ invoice: updated });
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

    // Ronde 36 (audit): nomor invoice dicek keunikan (loop 5x, pola yg sama dgn
    // change-request & projects) — dua klik bersamaan tidak lagi 500 P2002.
    const year = new Date().getFullYear();
    let number = "";
    for (let attempt = 0; attempt < 5 && !number; attempt++) {
      const invCount = await db.invoice.count();
      const candidate = `${project.brand.invoicePrefix}-${year}-INV-${String(invCount + attempt + 1).padStart(3, "0")}`;
      const exists = await db.invoice.findUnique({ where: { number: candidate } });
      if (!exists) number = candidate;
    }
    if (!number) return ok({ error: "Gagal menyusun nomor invoice unik — coba sekali lagi" }, 409);

    let invoice;
    try {
      invoice = await db.invoice.create({
        data: {
          number,
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
    void sendPushToRoles(["director", "super_admin"], {
      title: `Invoice ${invoice.number} diterbitkan`,
      body: `${actor.name} menerbitkan tagihan ${description.slice(0, 80)} · ${amount + taxAmount}`.slice(0, 140),
      url: "/?modul=finance",
      tag: `invoice:${invoice.id}`,
      type: "activity",
    }, actor.name);
    return ok({ invoice }, 201);
  }
  return ok({ error: "Unknown action" }, 400);
}
