import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, logAudit } from "@/lib/crm/server";

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
  // Tambah pembayaran
  if (body.action === "add_payment") {
    const invoiceId = String(body.invoiceId ?? "");
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) return ok({ error: "Invoice tidak ditemukan" }, 404);
    const amount = Number(body.amount ?? 0);
    await db.payment.create({
      data: {
        invoiceId, amount,
        method: body.method ? String(body.method) : "transfer",
        reference: body.reference ? String(body.reference) : null,
      },
    });
    const paid = invoice.payments.reduce((s, p) => s + p.amount, 0) + amount;
    let status = invoice.status;
    if (paid >= invoice.total) status = "paid";
    else if (paid > 0) status = "partial";
    const updated = await db.invoice.update({ where: { id: invoiceId }, data: { status }, include: { payments: true } });
    await logAudit({
      actorName: String(body.actorName ?? "System"), actorRole: String(body.actorRole ?? "finance"),
      action: "update", entity: "invoice", entityId: invoiceId, entityLabel: invoice.number,
      field: "payment", newValue: `Pembayaran ${amount} via ${body.method ?? "transfer"}`, req,
    });
    return ok({ invoice: updated });
  }
  return ok({ error: "Unknown action" }, 400);
}
