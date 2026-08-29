import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

interface QuotationItem {
  description: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
}

function parseItems(raw: unknown): QuotationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it) => it && String((it as QuotationItem).description ?? "").trim())
    .map((it) => {
      const qty = Number((it as QuotationItem).qty ?? 1) || 1;
      const unitPrice = Number((it as QuotationItem).unitPrice ?? 0) || 0;
      return {
        description: String((it as QuotationItem).description).trim(),
        qty,
        unitPrice,
        subtotal: qty * unitPrice,
      };
    });
}

function computeTotals(items: QuotationItem[], discountPct: number, taxPct: number) {
  const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
  const discountAmount = Math.round((subtotal * discountPct) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = Math.round((afterDiscount * taxPct) / 100);
  return { subtotal, discountAmount, taxAmount, total: afterDiscount + taxAmount };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const brandId = sp.get("brandId");
  const opportunityId = sp.get("opportunityId");

  const quotations = await db.quotation.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
    },
    include: {
      brand: true,
      company: true,
      opportunity: { select: { id: true, title: true, stage: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok({ quotations });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const opportunityId = String(body.opportunityId ?? "");
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "system");

  const opp = await db.opportunity.findUnique({
    where: { id: opportunityId },
    include: { brand: true, contact: true },
  });
  if (!opp) return fail("Opportunity tidak ditemukan", 404);
  if (!opp.companyId) return fail("Opportunity belum memiliki perusahaan terkait");

  const items = parseItems(body.items);
  if (items.length === 0) return fail("Minimal satu item quotation wajib diisi");

  const discountPct = Number(body.discountPct ?? 0);
  const taxPct = Number(body.taxPct ?? 11);
  const totals = computeTotals(items, discountPct, taxPct);

  const year = new Date().getFullYear();
  const count = await db.quotation.count();
  const number = `${opp.brand.quotePrefix}-${year}-${String(count + 1).padStart(4, "0")}`;

  const quotation = await db.quotation.create({
    data: {
      number,
      brandId: opp.brandId,
      opportunityId: opp.id,
      companyId: opp.companyId,
      items: JSON.stringify(items),
      ...totals,
      discountPct,
      taxPct,
      currency: opp.currency,
      status: "draft",
      validUntil: body.validUntil ? new Date(String(body.validUntil)) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      notes: body.notes ? String(body.notes) : null,
    },
    include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
  });

  await logAudit({
    actorName, actorRole, action: "create", entity: "quotation", entityId: quotation.id,
    entityLabel: quotation.number, metadata: `Quotation ${number} — ${opp.title} (total ${totals.total})`, req,
  });

  return ok({ quotation }, 201);
}
