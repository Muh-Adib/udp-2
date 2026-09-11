import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { sendPushToRoles } from "@/lib/crm/push";

// Ronde 49 — RAB kategori→item hasil parse JSON estimation.costCategories
interface RabCategory {
  name: string;
  items: { name: string; qty: number; unit: string; price: number; subtotal: number }[];
  total: number;
}

function parseRab(raw: string | null | undefined): RabCategory[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => {
        const cat = (c ?? {}) as Record<string, unknown>;
        return {
          name: String(cat.name ?? "").trim(),
          items: Array.isArray(cat.items)
            ? cat.items.map((i) => {
                const it = (i ?? {}) as Record<string, unknown>;
                return {
                  name: String(it.name ?? "").trim(),
                  qty: Number(it.qty ?? 0),
                  unit: String(it.unit ?? "unit"),
                  price: Number(it.price ?? 0),
                  subtotal: Number(it.subtotal ?? 0),
                };
              })
            : [],
          total: Number(cat.total ?? 0),
        };
      })
      .filter((c) => c.name !== "");
  } catch {
    return [];
  }
}

/**
 * Ronde 49 — KONVERSI ESTIMASI → PENAWARAN saat approval disetujui.
 *
 * Tabel penawaran hanya menampilkan HARGA KATEGORI (rincian item disembunyikan).
 * Setiap harga kategori disesuaikan (diskalakan proporsional) agar Σ kategori =
 * harga penawaran (revenue) estimasi, sehingga melalui rantai diskon & pajak
 * yang sama, TOTAL di quotation = GRAND TOTAL di estimasi secara presisi.
 * Sisa pembulatan diserap kategori terakhir agar total persis.
 */
async function autoCreateQuotationFromEstimation(
  estimationId: string,
  actorName: string,
  actorRole: string,
  req: NextRequest,
): Promise<{ number: string } | null> {
  const estimation = await db.estimation.findUnique({ where: { id: estimationId } });
  if (!estimation || !(estimation.revenue !== null && estimation.revenue > 0)) return null;

  const opp = await db.opportunity.findUnique({
    where: { id: estimation.opportunityId },
    include: { brand: true },
  });
  if (!opp || !opp.companyId) return null; // tanpa perusahaan → quotation tidak bisa dibuat

  // Idempoten: jangan dobel buat quotation utk estimasi yang sama
  const marker = `auto-est:${estimation.id}`;
  const existing = await db.quotation.findFirst({
    where: { opportunityId: opp.id, notes: { contains: marker } },
    select: { number: true },
  });
  if (existing) return { number: existing.number };

  const currency = estimation.currency || "IDR";
  const isIdr = currency === "IDR";
  const round = (n: number) => (isIdr ? Math.round(n) : Math.round(n * 100) / 100);

  const cats = parseRab(estimation.costCategories);
  const rawTotal =
    cats.reduce((s, c) => s + c.total, 0) ||
    parseRabLegacy(estimation.costItems) ||
    0;
  if (rawTotal <= 0) return null; // tanpa rincian biaya → tidak ada yang bisa dirinci

  const target = round(estimation.revenue); // target Σ harga kategori (= subtotal quotation)
  const factor = target / rawTotal;

  // Skala tiap kategori; pembulatan rapi (IDR: puluhan terdekat) & kategori terakhir
  // menyerap sisa agar Σ = target PERSIS.
  const niceRound = (n: number) => (isIdr ? Math.round(n / 10) * 10 : Math.round(n * 100) / 100);
  const scaled = cats
    .filter((c) => c.total > 0)
    .map((c, i, arr) => ({ cat: c, scaled: i === arr.length - 1 ? 0 : niceRound(c.total * factor) }));
  const sumExceptLast = scaled.slice(0, -1).reduce((s, x) => s + x.scaled, 0);
  if (scaled.length > 0) scaled[scaled.length - 1].scaled = round(target - sumExceptLast);
  if (scaled.some((x) => x.scaled < 0)) return null; // pengaman: struktur tak masuk akal

  const items = scaled.map((x) => ({
    description: x.cat.name,
    qty: 1,
    unitPrice: x.scaled,
    subtotal: x.scaled,
  }));

  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const discountPct = estimation.discountPct;
  const discountAmount = round((subtotal * discountPct) / 100);
  const netRevenue = subtotal - discountAmount;
  const taxName = estimation.taxName;
  const taxPct = taxName === null ? 0 : estimation.taxPct;
  const taxAmount = round((netRevenue * taxPct) / 100);
  const total = netRevenue + taxAmount;

  // Nomor quotation — pola sama dgn /api/quotations POST
  const year = new Date().getFullYear();
  let number = "";
  for (let attempt = 0; attempt < 5 && !number; attempt++) {
    const count = await db.quotation.count();
    const candidate = `${opp.brand.quotePrefix}-${year}-${String(count + attempt + 1).padStart(4, "0")}`;
    const exists = await db.quotation.findUnique({ where: { number: candidate } });
    if (!exists) number = candidate;
  }
  if (!number) return null;

  const quotation = await db.quotation.create({
    data: {
      number,
      brandId: opp.brandId,
      opportunityId: opp.id,
      companyId: opp.companyId,
      items: JSON.stringify(items),
      subtotal,
      discountPct,
      discountAmount,
      taxPct,
      taxName,
      taxAmount,
      total,
      currency,
      status: "draft",
      validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      notes: `Dibuat otomatis dari estimasi yang disetujui (${marker}) — harga per kategori sudah disesuaikan agar total = grand total estimasi.`,
    },
    select: { id: true, number: true },
  });

  await logAudit({
    actorName, actorRole, action: "create", entity: "quotation", entityId: quotation.id,
    entityLabel: quotation.number,
    metadata: `Konversi otomatis dari estimasi disetujui — ${opp.title} (total ${total} ${currency})`,
    req,
  });

  void sendPushToRoles(
    ["director", "super_admin", "marketing", "finance"],
    {
      title: "Penawaran otomatis dari estimasi",
      body: `${quotation.number} — ${opp.title} (total ${total.toLocaleString("id-ID")} ${currency})`,
      url: "/?modul=quotations",
      tag: `quotation:${quotation.id}`,
      type: "quotation",
    },
    actorName,
  ).catch(() => {});

  return { number: quotation.number };
}

/** LEGACY: total dari item lama (fallback bila estimasi belum pakai RAB kategori). */
function parseRabLegacy(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    return parsed.reduce((s, it) => s + Number((it as Record<string, unknown>)?.subtotal ?? 0), 0);
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const approvals = await db.approvalRequest.findMany({
    where: status && status !== "all" ? { status } : {},
    include: { opportunity: { include: { brand: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  const pendingCount = await db.approvalRequest.count({ where: { status: "pending" } });
  return ok({ approvals, pendingCount });
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const id = String(body.id ?? "");
  const decision = String(body.decision ?? "");
  const actorName = actor.name;
  const actorRole = actor.role;
  const decisionNote = body.decisionNote ? String(body.decisionNote) : null;

  if (!id || !["approve", "reject"].includes(decision)) {
    return fail("id dan decision (approve/reject) wajib");
  }
  // Hanya direktur & super admin yang boleh memutuskan (sesuai matriks role)
  if (!actorRole || !["director", "super_admin"].includes(actorRole)) {
    return fail("Hanya Direktur atau Super Admin yang dapat memutuskan approval", 403);
  }

  const approval = await db.approvalRequest.findUnique({ where: { id } });
  if (!approval) return fail("Approval tidak ditemukan", 404);
  if (approval.status !== "pending") return fail(`Approval sudah diputuskan (${approval.status})`);

  const newStatus = decision === "approve" ? "approved" : "rejected";
  const updated = await db.approvalRequest.update({
    where: { id },
    data: { status: newStatus, decidedBy: actorName, decidedAt: new Date(), decisionNote },
  });

  // Terapkan ke entitas terkait
  let autoQuotation: { number: string } | null = null;
  if (approval.entityType === "estimation" && decision === "approve") {
    await db.estimation.update({
      where: { id: approval.entityId },
      data: { status: "approved", approvedBy: actorName, approvedAt: new Date() },
    });
    // Ronde 49 — estimasi disetujui → penawaran otomatis (harga per kategori,
    // item disembunyikan, total quotation = grand total estimasi).
    try {
      autoQuotation = await autoCreateQuotationFromEstimation(approval.entityId, actorName, actorRole, req);
    } catch (e) {
      console.error("[approvals] gagal auto-konversi quotation:", e);
    }
  } else if (approval.entityType === "estimation") {
    await db.estimation.update({ where: { id: approval.entityId }, data: { status: "rejected" } });
  }

  // Ronde 40 — auto-move: estimasi disetujui → opportunity maju ke tahap negosiasi
  // (hanya bila masih di tahap awal; proposal_sent ke atas biarkan apa adanya).
  if (decision === "approve" && approval.entityType === "estimation" && approval.opportunityId) {
    const AUTO_MOVE_FROM = ["new", "contact_attempted", "connected", "qualified", "discovery", "estimation"];
    const opp = await db.opportunity.findUnique({ where: { id: approval.opportunityId } });
    if (opp && AUTO_MOVE_FROM.includes(opp.stage)) {
      await db.opportunity.update({ where: { id: opp.id }, data: { stage: "negotiation" } });
      await logAudit({
        actorName, actorRole, action: "update", entity: "opportunity", entityId: opp.id,
        entityLabel: opp.title, field: "stage", oldValue: opp.stage, newValue: "negotiation",
        metadata: "Auto-move: estimasi disetujui", req,
      });
    }
  }

  await logAudit({
    actorName, actorRole, action: decision === "approve" ? "approve" : "reject",
    entity: "approval", entityId: id, entityLabel: approval.entityLabel,
    field: "status", oldValue: "pending", newValue: newStatus,
    metadata: decisionNote ?? undefined, req,
  });

  return ok({ approval: updated, autoQuotation });
}
