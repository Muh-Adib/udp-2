import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull, isUniqueViolation, clampNum } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

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
  const companyId = sp.get("companyId");

  const quotations = await db.quotation.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
      ...(companyId ? { companyId } : {}),
    },
    include: {
      brand: true,
      company: true,
      opportunity: { select: { id: true, title: true, stage: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300, // Ronde 36 (audit): guardrail payload (data demo jauh di bawah batas)
  });
  return ok({ quotations });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const opportunityId = String(body.opportunityId ?? "");
  const actorName = actor.name;
  const actorRole = actor.role;

  const opp = await db.opportunity.findUnique({
    where: { id: opportunityId },
    include: { brand: true, contact: true },
  });
  if (!opp) return fail("Opportunity tidak ditemukan", 404);
  if (!opp.companyId) return fail("Opportunity belum memiliki perusahaan terkait");

  const items = parseItems(body.items);
  if (items.length === 0) return fail("Minimal satu item quotation wajib diisi");

  // Ronde 36 (audit): persen dipatok 0–100 di server juga (POST belum pernah clamp —
  // diskon -10 dulu MENAMBAH total; 150% pajak juga lolos).
  const discountPct = clampNum(body.discountPct ?? 0, 0, 100, 0);
  // Ronde 40 — pajak bebas: taxName dari master Tax; null/kosong → tanpa pajak (taxPct 0)
  const taxNameRaw = body.taxName === null || body.taxName === undefined ? null : String(body.taxName).trim().slice(0, 80);
  const taxName = taxNameRaw ? taxNameRaw : null;
  const taxPct = taxName === null ? 0 : clampNum(body.taxPct ?? 11, 0, 100, 11);
  const totals = computeTotals(items, discountPct, taxPct);

  // Ronde 36 (audit): nomor unik dicek loop 5x + P2002 → 409 ramah.
  const year = new Date().getFullYear();
  let number = "";
  for (let attempt = 0; attempt < 5 && !number; attempt++) {
    const count = await db.quotation.count();
    const candidate = `${opp.brand.quotePrefix}-${year}-${String(count + attempt + 1).padStart(4, "0")}`;
    const exists = await db.quotation.findUnique({ where: { number: candidate } });
    if (!exists) number = candidate;
  }
  if (!number) return fail("Gagal menyusun nomor quotation unik — coba sekali lagi", 409);

  // Ronde 39 — revisi quotation: quotation baru menunjuk quotation yang direvisi
  // (riwayat versi tersambung — dulu quotation ditolak = jalan buntu).
  let revisionOfId: string | null = null;
  let revisionNo = 0;
  if (body.revisionOfId) {
    const src = await db.quotation.findUnique({ where: { id: String(body.revisionOfId) } });
    if (!src) return fail("Quotation sumber revisi tidak ditemukan", 404);
    if (src.opportunityId !== opp.id) return fail("Quotation sumber revisi bukan milik opportunity ini", 400);
    revisionOfId = src.id;
    revisionNo = src.revisionNo + 1;
  }

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
      taxName,
      currency: opp.currency,
      status: "draft",
      revisionOfId,
      revisionNo,
      // Ronde 36 (audit): dateOrNull — tanggal "garbage" kini fallback 14 hari (sebelumnya 500)
      validUntil: dateOrNull(body.validUntil) ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      notes: body.notes ? String(body.notes) : null,
    },
    include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
  });

  await logAudit({
    actorName, actorRole, action: "create", entity: "quotation", entityId: quotation.id,
    entityLabel: quotation.number,
    metadata: revisionOfId
      ? `Revisi ke-${revisionNo} dari quotation sebelumnya — ${opp.title} (total ${totals.total})`
      : `Quotation ${number} — ${opp.title} (total ${totals.total})`,
    req,
  });

  return ok({ quotation }, 201);
}
