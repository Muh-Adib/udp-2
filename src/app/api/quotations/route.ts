import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull, isUniqueViolation, clampNum } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { nextDocumentNumber, revisionDocumentNumber } from "@/lib/crm/numbering";
import { stripRevisionSuffix } from "@/lib/crm/numbering-core";

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

/** Ronde 50 — teks pendek surat penawaran (trim + batasi panjang). */
function shortText(v: unknown, max: number): string | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Ronde 50 — field surat penawaran (gaya Unicam) dari body. */
function letterFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("attachment" in body) {
    const n = Number(body.attachment);
    out.attachment = Number.isFinite(n) ? Math.min(99, Math.max(0, Math.floor(n))) : 1;
  }
  if ("regarding" in body) out.regarding = shortText(body.regarding, 160);
  if ("attn" in body) out.attn = shortText(body.attn, 120);
  if ("clientAddress" in body) out.clientAddress = shortText(body.clientAddress, 400);
  if ("letterBody" in body) out.letterBody = shortText(body.letterBody, 4000);
  if ("letterClosing" in body) out.letterClosing = shortText(body.letterClosing, 2000);
  if ("timeline" in body) out.timeline = shortText(body.timeline, 400);
  if ("revisionNotes" in body) out.revisionNotes = shortText(body.revisionNotes, 1200);
  if ("termOfPayment" in body) out.termOfPayment = shortText(body.termOfPayment, 1200);
  return out;
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

  // Ronde 50 — penomoran via rule brand (builder) dgn fallback pola legacy;
  // tabrakan nomor (double-click paralel) → coba lagi (maks 3x).
  let number = "";
  let baseNumber = "";
  let seqNo = 0;
  for (let attempt = 0; attempt < 3 && !number; attempt++) {
    try {
      const res = await nextDocumentNumber(opp.brandId, "quotation");
      number = res.number;
      baseNumber = res.baseNumber;
      seqNo = res.seq;
    } catch {
      number = "";
    }
  }
  if (!number) return fail("Gagal menyusun nomor quotation unik — coba sekali lagi", 409);

  // Ronde 39/50 — revisi quotation: quotation baru menunjuk quotation yang direvisi,
  // nomor memakai DASAR nomor sumber + sufiks: 012/QT-UDP/I/26 → 012-1/QT-UDP/I/26.
  let revisionOfId: string | null = null;
  let revisionNo = 0;
  if (body.revisionOfId) {
    const src = await db.quotation.findUnique({ where: { id: String(body.revisionOfId) } });
    if (!src) return fail("Quotation sumber revisi tidak ditemukan", 404);
    if (src.opportunityId !== opp.id) return fail("Quotation sumber revisi bukan milik opportunity ini", 400);
    revisionOfId = src.id;
    revisionNo = src.revisionNo + 1;
    const rev = await revisionDocumentNumber(opp.brandId, "quotation", src.number, src.revisionNo, src.seqNo, src.createdAt);
    number = rev.number;
    baseNumber = rev.baseNumber ?? stripRevisionSuffix(src.number);
    seqNo = rev.seq ?? src.seqNo;
  }

  // Ronde 50 — nomor revisi deterministik: dua klik paralel → P2002 → 409 ramah.
  let quotation;
  try {
    quotation = await db.quotation.create({
      data: {
        number,
        baseNumber,
        seqNo,
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
        ...letterFields(body),
        // Ronde 36 (audit): dateOrNull — tanggal "garbage" kini fallback 14 hari (sebelumnya 500)
        validUntil: dateOrNull(body.validUntil) ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        notes: body.notes ? String(body.notes) : null,
      },
      include: { brand: true, company: true, opportunity: { select: { id: true, title: true, stage: true } } },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(`Nomor ${number} baru saja dipakai proses lain — muat ulang lalu coba lagi`, 409);
    }
    throw err;
  }

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
