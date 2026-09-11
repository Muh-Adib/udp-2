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

// Ronde 40 — rincian biaya per item (LEGACY): [{name, qty, days?, unitPrice, subtotal}]
interface CostItem {
  name: string;
  qty: number;
  days: number | null;
  unitPrice: number;
  subtotal: number;
}

// Ronde 49 — RAB bertingkat kategori → item
interface RabItem {
  name: string;
  qty: number;
  unit: string;
  price: number;
  subtotal: number;
}

interface RabCategory {
  name: string;
  items: RabItem[];
  total: number;
}

/** Mata uang yang diizinkan untuk estimasi (IDR default). */
const CURRENCIES = ["IDR", "USD", "SGD", "EUR", "AUD", "JPY", "MYR", "GBP", "CNY"] as const;

/** Array | JSON string → item biaya LEGACY tervalidasi; subtotal dihitung server. */
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
    items.push({ name, qty, days, unitPrice, subtotal: Math.round(qty * unitPrice) });
  }
  return items;
}

/**
 * Ronde 49 — RAB bertingkat: [{name, items: [{name, qty, unit, price}]}]
 * → tervalidasi + subtotal item & total kategori dihitung server.
 * Pembulatan mengikuti mata uang: IDR bulat penuh; lainnya 2 desimal.
 */
function parseCostCategories(raw: unknown, currency: string): RabCategory[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      throw new Error("Struktur RAB (kategori) tidak valid");
    }
  }
  if (list.length > 30) throw new Error("Maksimal 30 kategori biaya");
  const round = (n: number) => (currency === "IDR" ? Math.round(n) : Math.round(n * 100) / 100);
  const cats: RabCategory[] = [];
  const seenCat = new Set<string>();
  for (const cat of list) {
    const c = (cat ?? {}) as Record<string, unknown>;
    const catName = String(c.name ?? "").trim();
    if (!catName) throw new Error("Nama kategori wajib diisi");
    const key = catName.toLowerCase();
    if (seenCat.has(key)) throw new Error(`Kategori "${catName}" muncul dua kali — gunakan nama unik`);
    seenCat.add(key);
    const rawItems = Array.isArray(c.items) ? c.items : [];
    if (rawItems.length > 50) throw new Error(`Maksimal 50 item pada kategori "${catName}"`);
    const items: RabItem[] = [];
    for (const item of rawItems) {
      const it = (item ?? {}) as Record<string, unknown>;
      const name = String(it.name ?? "").trim();
      if (!name) throw new Error(`Nama item pada kategori "${catName}" wajib diisi`);
      const qty = Number(it.qty ?? 0);
      if (!Number.isFinite(qty) || qty < 0) throw new Error(`Jumlah (qty) item "${name}" tidak valid`);
      const unit = String(it.unit ?? "").trim().slice(0, 40) || "unit";
      const price = Number(it.price ?? 0);
      if (!Number.isFinite(price) || price < 0) throw new Error(`Harga item "${name}" tidak valid`);
      items.push({ name, qty, unit, price, subtotal: round(qty * price) });
    }
    cats.push({ name: catName.slice(0, 120), items, total: items.reduce((s, i) => s + i.subtotal, 0) });
  }
  return cats;
}

function compute(
  input: Record<string, number | null>,
  itemsTotal = 0,
  categoriesTotal = 0,
  tanpaPajak = false,
) {
  const legacyCategorySum = COST_FIELDS.reduce((s, f) => s + (input[f] ?? 0), 0);
  // Ronde 49 — prioritas total biaya: RAB kategori → item legacy → kategori legacy
  const totalCost = categoriesTotal > 0 ? categoriesTotal : itemsTotal > 0 ? itemsTotal : legacyCategorySum;
  const contingency = Math.round((totalCost * (input.contingencyPct ?? 0)) / 100);
  const managementFee = Math.round((totalCost * (input.managementFeePct ?? 0)) / 100);
  const costWithFees = totalCost + contingency + managementFee;
  // Ronde 41 — revenue null = "belum diketahui"; kalkulasi memperlakukannya sbg 0
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
        // Ronde 41 — bila opportunity belum punya estimasi nilai, revenue = null ("belum diketahui")
        revenue: opp.estimatedValue ?? null,
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

  // Ronde 49 — mata uang estimasi (default IDR; fallback nilai tersimpan)
  const currencyRaw = body.currency !== undefined ? String(body.currency ?? "IDR").toUpperCase() : (current?.currency ?? "IDR");
  const currency = (CURRENCIES as readonly string[]).includes(currencyRaw) ? currencyRaw : "IDR";

  // Ronde 49 — kurs currency→IDR dari klien (hasil fetch API free; null bila IDR/gagal).
  // Disimpan agar nilai konversi stabil & teraudit; sumber dicatat sebagai teks.
  let fxRate: number | null = null;
  if (body.fxRate !== undefined) {
    const r = Number(body.fxRate);
    fxRate = currency !== "IDR" && Number.isFinite(r) && r > 0 ? r : null;
  } else {
    fxRate = currency !== "IDR" ? (current?.fxRate ?? null) : null;
  }
  let fxSource: string | null = null;
  if (body.fxSource !== undefined) {
    fxSource = body.fxSource ? String(body.fxSource).slice(0, 160) : null;
  } else {
    fxSource = currency !== "IDR" ? (current?.fxSource ?? null) : null;
  }
  if (currency === "IDR") {
    fxRate = null;
    fxSource = null;
  }

  const input: Record<string, number | null> = {};
  for (const f of PCT_FIELDS) input[f] = Number(body[f] ?? current?.[f] ?? 0);
  // Ronde 41 — revenue bisa null ("belum diketahui"): body kosong/""/null → null
  input.revenue = body.revenue !== undefined
    ? (body.revenue === null || body.revenue === "" ? null : Number(body.revenue))
    : (current?.revenue ?? opp.estimatedValue ?? null);
  if (input.revenue !== null && !Number.isFinite(input.revenue)) input.revenue = null;
  if (tanpaPajak) input.taxPct = 0;

  // Ronde 41 — approval hanya masuk akal bila harga penawaran sudah diketahui
  if (body.submit === true && !(input.revenue !== null && input.revenue > 0)) {
    return fail("Harga penawaran (revenue) wajib diisi lebih dari 0 sebelum mengajukan approval.", 400);
  }

  // Ronde 49 — RAB kategori→item (struktur baru). Bila dikirim, legacy 9 kolom & item
  // lama dinolkan agar tidak pernah dobel hitung; subtotal/total dihitung ulang server.
  let costCategories: RabCategory[] | null = null;
  let categoriesTotal = 0;
  if (body.costCategories !== undefined) {
    try {
      costCategories = parseCostCategories(body.costCategories, currency);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "RAB tidak valid", 400);
    }
    categoriesTotal = costCategories.reduce((s, c) => s + c.total, 0);
  }

  // Ronde 40 — costItems LEGACY (array | JSON string); bila tak dikirim, pertahankan item tersimpan.
  // Diabaikan sepenuhnya bila RAB kategori baru dikirim (prioritas struktur baru).
  let costItems: CostItem[];
  try {
    const rawCostItems =
      costCategories !== null
        ? []
        : body.costItems !== undefined && body.costItems !== null && body.costItems !== ""
          ? body.costItems
          : (current?.costItems ?? "[]");
    costItems = parseCostItems(rawCostItems);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Rincian biaya tidak valid", 400);
  }
  const itemsTotal = costItems.reduce((s, i) => s + i.subtotal, 0);

  // Nilai legacy 9 kolom: dari body (klien baru selalu kirim 0) atau nilai tersimpan.
  // Ronde 49 — bila struktur RAB kategori dikirim, legacy DINOLKAN agar tidak dobel hitung.
  for (const f of COST_FIELDS) input[f] = costCategories !== null ? 0 : Number(body[f] ?? current?.[f] ?? 0);

  const calc = compute(input, itemsTotal, categoriesTotal, tanpaPajak);

  const data: Record<string, unknown> = {
    ...input,
    ...calc,
    taxName,
    currency,
    fxRate,
    fxSource,
    notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : (current?.notes ?? null),
    createdBy: current?.createdBy ?? actorName,
    updatedAt: new Date(),
  };
  if (costCategories !== null) {
    data.costCategories = JSON.stringify(costCategories);
    // Ronde 49 — struktur baru aktif: legacy dinolkan agar total tidak dobel
    for (const f of COST_FIELDS) data[f] = 0;
    data.costItems = JSON.stringify([]);
  } else {
    data.costItems = JSON.stringify(costItems);
  }

  let estimation;
  if (current) {
    estimation = await db.estimation.update({ where: { id: current.id }, data });
  } else {
    estimation = await db.estimation.create({ data: { ...data, opportunityId: id } });
  }

  // Simpan revenue juga ke opportunity agar kanban/table konsisten (null → jangan timpa)
  if (body.syncOppValue !== false && input.revenue !== null && input.revenue > 0) {
    await db.opportunity.update({ where: { id }, data: { estimatedValue: input.revenue } });
  }

  await logAudit({
    actorName, actorRole, action: "update", entity: "estimation", entityId: estimation.id,
    entityLabel: `Estimasi — ${opp.title}`,
    newValue: `Revenue ${input.revenue ?? "(belum diketahui)"} ${currency} · Margin ${calc.marginPct}% (${calc.margin})`,
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
