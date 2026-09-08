import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

const COST_FIELDS = [
  "laborInternal", "vendorFreelance", "equipment", "transport", "accommodation",
  "talent", "locationFee", "softwareLicense", "hostingDomain",
] as const;

const PCT_FIELDS = [
  "contingencyPct", "managementFeePct", "discountPct", "taxPct", "targetMarginPct",
] as const;

// Ronde 40 — rincian biaya per item: [{name, qty, days?, unitPrice, subtotal}]
interface CostItem {
  name: string;
  qty: number;
  days: number | null;
  unitPrice: number;
  subtotal: number;
}

/** Array | JSON string → item biaya tervalidasi; subtotal dihitung server (IDR bulat). */
function parseCostItems(raw: unknown): CostItem[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      // JSON rusak → dianggap tanpa item
    }
  }
  if (list.length > 50) throw new Error("Maksimal 50 item biaya");
  const items: CostItem[] = [];
  for (const item of list) {
    const it = (item ?? {}) as Record<string, unknown>;
    const name = String(it.name ?? "").trim();
    if (!name) throw new Error("Nama item biaya wajib diisi");
    const qty = Number(it.qty ?? 0);
    if (!Number.isFinite(qty) || qty < 0) throw new Error(`Jumlah (qty) item "${name}" tidak valid`);
    const unitPrice = Number(it.unitPrice ?? 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Harga satuan item "${name}" tidak valid`);
    let days: number | null = null;
    if (it.days !== null && it.days !== undefined && String(it.days).trim() !== "") {
      const d = Number(it.days);
      if (!Number.isFinite(d) || d < 0) throw new Error(`Jumlah hari item "${name}" tidak valid`);
      days = d;
    }
    // Mata uang IDR — subtotal dibulatkan ke rupiah penuh
    items.push({ name, qty, days, unitPrice, subtotal: Math.round(qty * unitPrice) });
  }
  return items;
}

function compute(input: Record<string, number>, itemsTotal = 0, tanpaPajak = false) {
  const categorySum = COST_FIELDS.reduce((s, f) => s + (input[f] ?? 0), 0);
  // Ronde 40 — bila rincian item terisi & totalnya > 0, kategori diabaikan
  const totalCost = itemsTotal > 0 ? itemsTotal : categorySum;
  const contingency = Math.round((totalCost * (input.contingencyPct ?? 0)) / 100);
  const managementFee = Math.round((totalCost * (input.managementFeePct ?? 0)) / 100);
  const costWithFees = totalCost + contingency + managementFee;
  const revenue = input.revenue ?? 0;
  const discountAmount = Math.round((revenue * (input.discountPct ?? 0)) / 100);
  const netRevenue = revenue - discountAmount;
  // Ronde 40 — tanpa pajak (taxName null) → taxPct dipaksa 0
  const taxPct = tanpaPajak ? 0 : (input.taxPct ?? 0);
  const taxAmount = Math.round((netRevenue * taxPct) / 100);
  const grandTotal = netRevenue + taxAmount;
  const margin = netRevenue - costWithFees;
  const marginPct = netRevenue > 0 ? Math.round((margin / netRevenue) * 1000) / 10 : 0;
  return { totalCost, contingency, managementFee, discountAmount, netRevenue, taxAmount, grandTotal, margin, marginPct };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let estimation = await db.estimation.findUnique({ where: { opportunityId: id } });
  if (!estimation) {
    // Auto-create draft kosong agar UI bisa langsung edit
    const opp = await db.opportunity.findUnique({ where: { id }, include: { brand: true } });
    if (!opp) return fail("Opportunity tidak ditemukan", 404);
    estimation = await db.estimation.create({
      data: {
        opportunityId: id,
        revenue: opp.estimatedValue ?? 0,
        createdBy: "System",
      },
    });
  }
  return ok({ estimation });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const actorName = actor.name;
  const actorRole = actor.role;

  const opp = await db.opportunity.findUnique({ where: { id }, include: { brand: true } });
  if (!opp) return fail("Opportunity tidak ditemukan", 404);

  const current = await db.estimation.findUnique({ where: { opportunityId: id } });
  if (current && !["draft", "rejected"].includes(current.status)) {
    return fail(`Estimasi berstatus ${current.status} — tidak dapat diubah.`);
  }

  // Ronde 40 — pajak bebas: null/undefined → tanpa pajak; selain itu nama bebas ≤80 karakter
  const taxName = body.taxName === null || body.taxName === undefined ? null : String(body.taxName).slice(0, 80);
  const tanpaPajak = taxName === null;

  const input: Record<string, number> = {};
  for (const f of COST_FIELDS) input[f] = Number(body[f] ?? current?.[f] ?? 0);
  for (const f of PCT_FIELDS) input[f] = Number(body[f] ?? current?.[f] ?? 0);
  input.revenue = body.revenue !== undefined ? Number(body.revenue) : (current?.revenue ?? opp.estimatedValue ?? 0);
  if (tanpaPajak) input.taxPct = 0;

  // Ronde 40 — costItems (array | JSON string); bila tak dikirim, pertahankan item tersimpan
  let costItems: CostItem[];
  try {
    const rawCostItems =
      body.costItems !== undefined && body.costItems !== null && body.costItems !== ""
        ? body.costItems
        : (current?.costItems ?? "[]");
    costItems = parseCostItems(rawCostItems);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Rincian biaya tidak valid", 400);
  }
  const itemsTotal = costItems.reduce((s, i) => s + i.subtotal, 0);

  const calc = compute(input, itemsTotal, tanpaPajak);

  const data = {
    ...input,
    ...calc,
    costItems: JSON.stringify(costItems),
    taxName,
    notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : (current?.notes ?? null),
    createdBy: current?.createdBy ?? actorName,
    updatedAt: new Date(),
  };

  let estimation;
  if (current) {
    estimation = await db.estimation.update({ where: { id: current.id }, data });
  } else {
    estimation = await db.estimation.create({ data: { ...data, opportunityId: id } });
  }

  // Simpan revenue juga ke opportunity agar kanban/table konsisten
  if (body.syncOppValue !== false && input.revenue > 0) {
    await db.opportunity.update({ where: { id }, data: { estimatedValue: input.revenue } });
  }

  await logAudit({
    actorName, actorRole, action: "update", entity: "estimation", entityId: estimation.id,
    entityLabel: `Estimasi — ${opp.title}`,
    newValue: `Revenue ${input.revenue} · Margin ${calc.marginPct}% (${calc.margin})`,
    req,
  });

  // Submit → buat approval request
  if (body.submit === true) {
    await db.estimation.update({ where: { id: estimation.id }, data: { status: "pending_approval" } });
    const approval = await db.approvalRequest.create({
      data: {
        entityType: "estimation",
        entityId: estimation.id,
        entityLabel: `Estimasi — ${opp.title}`,
        opportunityId: id,
        requestedBy: actorName,
        amount: calc.grandTotal,
        discountPct: input.discountPct,
        note: body.notes ? String(body.notes) : `Margin ${calc.marginPct}% · Cost ${calc.totalCost}`,
      },
    });
    await logAudit({
      actorName, actorRole, action: "create", entity: "approval", entityId: approval.id,
      entityLabel: approval.entityLabel, metadata: "Pengajuan approval estimasi ke Direktur", req,
    });
    estimation = await db.estimation.findUnique({ where: { opportunityId: id } });
    return ok({ estimation, approval });
  }

  return ok({ estimation });
}
