import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "system");
  const action = String(body.action ?? "update");

  const quotation = await db.quotation.findUnique({
    where: { id },
    include: { brand: true, opportunity: true },
  });
  if (!quotation) return fail("Quotation tidak ditemukan", 404);

  // ---- Aksi khusus ----
  if (action === "send") {
    if (quotation.status !== "draft") return fail("Hanya quotation berstatus draft yang dapat dikirim");
    const updated = await db.quotation.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
      include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
    });
    // Interaksi tercatat di timeline opportunity
    if (quotation.opportunityId) {
      await db.interaction.create({
        data: {
          channel: "email",
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
      entityLabel: quotation.number, field: "status", oldValue: "draft", newValue: "sent", req,
    });
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
    return ok({ quotation: updated });
  }

  if (action === "convert_invoice") {
    if (quotation.status !== "accepted") return fail("Hanya quotation yang diterima (accepted) yang dapat dikonversi ke invoice");
    const existing = await db.invoice.findFirst({ where: { description: { contains: quotation.number } } });
    if (existing) return fail(`Invoice untuk quotation ini sudah ada: ${existing.number}`);
    const invCount = await db.invoice.count();
    const year = new Date().getFullYear();
    const number = `${quotation.brand.invoicePrefix}-${year}-INV-${String(invCount + 1).padStart(3, "0")}`;
    const amount = quotation.total - quotation.taxAmount;
    const invoice = await db.invoice.create({
      data: {
        number,
        brandId: quotation.brandId,
        companyId: quotation.companyId,
        opportunityId: quotation.opportunityId,
        description: `Invoice dari quotation ${quotation.number}`,
        amount,
        taxRate: quotation.taxPct,
        taxAmount: quotation.taxAmount,
        total: quotation.total,
        currency: quotation.currency,
        status: "draft",
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        notes: `Dikonversi dari quotation ${quotation.number} oleh ${actorName}`,
      },
    });
    await logAudit({
      actorName, actorRole, action: "create", entity: "invoice", entityId: invoice.id,
      entityLabel: invoice.number, metadata: `Konversi dari quotation ${quotation.number}`, req,
    });
    return ok({ invoice });
  }

  // ---- Update umum (draft saja) ----
  if (quotation.status !== "draft") return fail("Hanya quotation draft yang dapat diedit");
  const data: Record<string, unknown> = {};
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
    const discountPct = Number(body.discountPct ?? quotation.discountPct);
    const taxPct = Number(body.taxPct ?? quotation.taxPct);
    const discountAmount = Math.round((subtotal * discountPct) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = Math.round((afterDiscount * taxPct) / 100);
    data.subtotal = subtotal;
    data.discountPct = discountPct;
    data.discountAmount = discountAmount;
    data.taxPct = taxPct;
    data.taxAmount = taxAmount;
    data.total = afterDiscount + taxAmount;
  }
  if ("notes" in body) data.notes = body.notes ? String(body.notes) : null;
  if ("validUntil" in body) data.validUntil = body.validUntil ? new Date(String(body.validUntil)) : null;

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
