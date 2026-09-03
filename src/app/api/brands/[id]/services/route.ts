import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Ronde 29-b — Katalog layanan & workflow produksi PER BRAND.
 *
 * GET    /api/brands/:id/services          → kategori + layanan + workflow (tree)
 * POST   { kind:"category"|"service"|"stage", … }
 * PATCH  { kind, id, …fields }
 * DELETE ?kind=category|service|stage&id=…
 *
 * Contoh workflow Unimasi (seed): layanan "Pembuatan Video Pembelajaran Anak
 * Anak 3D" → Pra Production(Creative Concept & Story Board) →
 * Production(milestone) → Post Production(milestone).
 */

type Kind = "category" | "service" | "stage";

function parseKind(raw: unknown): Kind | null {
  return raw === "category" || raw === "service" || raw === "stage" ? raw : null;
}

/** Ronde 29-b — validasi rincian biaya template harga layanan. */
interface CostItemIn { name: string; amount: number; note?: string | null }

function parseCostItems(raw: unknown): { err?: string; items?: CostItemIn[] | null } {
  if (raw === undefined) return {};
  if (raw === null || raw === "") return { items: null };
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return { err: "Rincian biaya bukan JSON yang valid" }; }
  }
  if (!Array.isArray(arr)) return { err: "Rincian biaya harus berupa array" };
  const items: CostItemIn[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") return { err: "Butir rincian biaya tidak valid" };
    const obj = it as Record<string, unknown>;
    const name = String(obj.name ?? "").trim();
    const amount = Number(obj.amount);
    if (!name) return { err: "Nama butir biaya wajib diisi" };
    if (!Number.isFinite(amount) || amount < 0) return { err: `Nominal biaya "${name}" tidak valid` };
    items.push({ name, amount, note: obj.note ? String(obj.note).trim() : null });
  }
  return { items };
}

function parseMargin(raw: unknown): { err?: string; pct?: number | null } {
  if (raw === undefined) return {};
  if (raw === null || raw === "") return { pct: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 95) return { err: "Margin target harus 0–95" };
  return { pct: n };
}

/** Saran harga = total biaya × (1 + margin) dibulatkan ke 100 ribu terdekat. */
function computePricing(costItemsJson: string | null, targetMarginPct: number | null, _basePrice: number | null) {
  let costTotal: number | null = null;
  if (costItemsJson) {
    try {
      const arr = JSON.parse(costItemsJson) as CostItemIn[];
      if (Array.isArray(arr) && arr.length) costTotal = arr.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    } catch { /* biarkan null */ }
  }
  if (costTotal === null) return { costTotal: null, suggestedPrice: null };
  const margin = targetMarginPct ?? 30;
  return { costTotal, suggestedPrice: Math.round((costTotal * (1 + margin / 100)) / 100_000) * 100_000 };
}

function parseCostItemsForOutput(json: string | null): CostItemIn[] | null {
  if (!json) return null;
  try { return JSON.parse(json) as CostItemIn[]; } catch { return null; }
}

async function loadTree(brandId: string) {
  const [brand, categories, services] = await Promise.all([
    db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true, slug: true } }),
    db.serviceCategory.findMany({ where: { brandId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    db.service.findMany({
      where: { brandId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: {
        workflowStages: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
    }),
  ]);
  if (!brand) return null;
  return {
    brand,
    categories: categories.map((c) => ({
      id: c.id, name: c.name, description: c.description, order: c.order, active: c.active,
    })),
    services: services.map((s) => {
      const { costTotal, suggestedPrice } = computePricing(s.costItems, s.targetMarginPct, s.basePrice);
      return {
        id: s.id, categoryId: s.categoryId, name: s.name, description: s.description,
        unit: s.unit, basePrice: s.basePrice, order: s.order, active: s.active,
        costItems: parseCostItemsForOutput(s.costItems),
        targetMarginPct: s.targetMarginPct,
        costTotal, suggestedPrice,
        workflow: s.workflowStages.map((w) => ({
          id: w.id, phase: w.phase, name: w.name, description: w.description,
          isMilestone: w.isMilestone, order: w.order,
        })),
      };
    }),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tree = await loadTree(id);
  if (!tree) return fail("Brand tidak ditemukan", 404);
  return ok(tree);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const kind = parseKind(body.kind);
  if (!kind) return fail('kind wajib "category" | "service" | "stage"');
  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama wajib diisi");

  if (kind === "category") {
    const last = await db.serviceCategory.findFirst({ where: { brandId }, orderBy: { order: "desc" } });
    const cat = await db.serviceCategory.create({
      data: {
        brandId,
        name,
        description: body.description ? String(body.description).trim() : null,
        order: typeof body.order === "number" ? body.order : (last?.order ?? -1) + 1,
      },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role, action: "create",
      entity: "service_category", entityId: cat.id, entityLabel: `${brand.name} · ${cat.name}`, req,
    });
    return ok({ category: cat }, 201);
  }

  if (kind === "service") {
    const categoryId = typeof body.categoryId === "string" && body.categoryId ? body.categoryId : null;
    if (categoryId) {
      const cat = await db.serviceCategory.findUnique({ where: { id: categoryId } });
      if (!cat || cat.brandId !== brandId) return fail("Kategori layanan tidak ditemukan di brand ini", 404);
    }
    const last = await db.service.findFirst({ where: { brandId }, orderBy: { order: "desc" } });
    const svc = await db.service.create({
      data: {
        brandId,
        categoryId,
        name,
        description: body.description ? String(body.description).trim() : null,
        unit: body.unit ? String(body.unit).trim() : null,
        basePrice: body.basePrice === null || body.basePrice === undefined || body.basePrice === ""
          ? null
          : Number(body.basePrice),
        order: typeof body.order === "number" ? body.order : (last?.order ?? -1) + 1,
      },
    });
    // Rincian biaya + margin target (opsional, dikirim bersamaan) — Ronde 29-b
    if (body.costItems !== undefined || body.targetMarginPct !== undefined) {
      const ci = parseCostItems(body.costItems);
      if (ci.err) return fail(ci.err);
      const mg = parseMargin(body.targetMarginPct);
      if (mg.err) return fail(mg.err);
      await db.service.update({
        where: { id: svc.id },
        data: {
          costItems: ci.items === undefined ? undefined : ci.items ? JSON.stringify(ci.items) : null,
          targetMarginPct: mg.pct,
        },
      });
    }
    await logAudit({
      actorName: actor.name, actorRole: actor.role, action: "create",
      entity: "service", entityId: svc.id, entityLabel: `${brand.name} · ${svc.name}`, req,
    });
    return ok({ service: svc }, 201);
  }

  // kind === "stage"
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const service = await db.service.findUnique({ where: { id: serviceId } });
  if (!service || service.brandId !== brandId) return fail("Layanan tidak ditemukan di brand ini", 404);
  const last = await db.workflowStage.findFirst({ where: { serviceId }, orderBy: { order: "desc" } });
  const stage = await db.workflowStage.create({
    data: {
      serviceId,
      phase: body.phase ? String(body.phase).trim() : "Production",
      name,
      description: body.description ? String(body.description).trim() : null,
      isMilestone: body.isMilestone === true,
      order: typeof body.order === "number" ? body.order : (last?.order ?? -1) + 1,
    },
  });
  await logAudit({
    actorName: actor.name, actorRole: actor.role, action: "create",
    entity: "workflow_stage", entityId: stage.id,
    entityLabel: `${brand.name} · ${service.name} · ${stage.phase}/${stage.name}${stage.isMilestone ? " (milestone)" : ""}`, req,
  });
  return ok({ stage }, 201);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const kind = parseKind(body.kind);
  if (!kind) return fail('kind wajib "category" | "service" | "stage"');
  const targetId = typeof body.id === "string" ? body.id : "";
  if (!targetId) return fail("id target wajib");

  if (kind === "category") {
    const cat = await db.serviceCategory.findUnique({ where: { id: targetId } });
    if (!cat || cat.brandId !== brandId) return fail("Kategori tidak ditemukan", 404);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) return fail("Nama wajib diisi");
      data.name = n;
    }
    if (body.description !== undefined) data.description = String(body.description).trim() || null;
    if (body.order !== undefined && typeof body.order === "number") data.order = body.order;
    if (body.active !== undefined) data.active = Boolean(body.active);
    const updated = await db.serviceCategory.update({ where: { id: targetId }, data });
    await logAudit({
      actorName: actor.name, actorRole: actor.role, action: "update",
      entity: "service_category", entityId: targetId, entityLabel: `${brand.name} · ${updated.name}`, req,
    });
    return ok({ category: updated });
  }

  if (kind === "service") {
    const svc = await db.service.findUnique({ where: { id: targetId } });
    if (!svc || svc.brandId !== brandId) return fail("Layanan tidak ditemukan", 404);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) return fail("Nama wajib diisi");
      data.name = n;
    }
    if (body.description !== undefined) data.description = String(body.description).trim() || null;
    if (body.unit !== undefined) data.unit = String(body.unit).trim() || null;
    if (body.basePrice !== undefined) {
      data.basePrice = body.basePrice === null || body.basePrice === "" ? null : Number(body.basePrice);
      if (data.basePrice !== null && !Number.isFinite(data.basePrice as number)) {
        return fail("Harga acuan tidak valid");
      }
    }
    if (body.categoryId !== undefined) {
      const cid = typeof body.categoryId === "string" && body.categoryId ? body.categoryId : null;
      if (cid) {
        const cat = await db.serviceCategory.findUnique({ where: { id: cid } });
        if (!cat || cat.brandId !== brandId) return fail("Kategori layanan tidak ditemukan di brand ini", 404);
      }
      data.categoryId = cid;
    }
    if (body.costItems !== undefined) {
      const ci = parseCostItems(body.costItems);
      if (ci.err) return fail(ci.err);
      data.costItems = ci.items === undefined ? undefined : ci.items ? JSON.stringify(ci.items) : null;
    }
    if (body.targetMarginPct !== undefined) {
      const mg = parseMargin(body.targetMarginPct);
      if (mg.err) return fail(mg.err);
      data.targetMarginPct = mg.pct;
    }
    if (body.order !== undefined && typeof body.order === "number") data.order = body.order;
    if (body.active !== undefined) data.active = Boolean(body.active);
    const updated = await db.service.update({ where: { id: targetId }, data });
    await logAudit({
      actorName: actor.name, actorRole: actor.role, action: "update",
      entity: "service", entityId: targetId, entityLabel: `${brand.name} · ${updated.name}`, req,
    });
    return ok({ service: updated });
  }

  // kind === "stage"
  const stage = await db.workflowStage.findUnique({ where: { id: targetId }, include: { service: true } });
  if (!stage || stage.service.brandId !== brandId) return fail("Langkah workflow tidak ditemukan", 404);
  const data: Record<string, unknown> = {};
  if (body.phase !== undefined) data.phase = String(body.phase).trim() || "Production";
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return fail("Nama wajib diisi");
    data.name = n;
  }
  if (body.description !== undefined) data.description = String(body.description).trim() || null;
  if (body.isMilestone !== undefined) data.isMilestone = Boolean(body.isMilestone);
  if (body.order !== undefined && typeof body.order === "number") data.order = body.order;
  const updated = await db.workflowStage.update({ where: { id: targetId }, data });
  await logAudit({
    actorName: actor.name, actorRole: actor.role, action: "update",
    entity: "workflow_stage", entityId: targetId,
    entityLabel: `${brand.name} · ${stage.service.name} · ${updated.phase}/${updated.name}`, req,
  });
  return ok({ stage: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: brandId } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const kind = parseKind(req.nextUrl.searchParams.get("kind") ?? body.kind);
  if (!kind) return fail('kind wajib "category" | "service" | "stage"');
  const targetId = req.nextUrl.searchParams.get("id") ?? (typeof body.id === "string" ? body.id : "");
  if (!targetId) return fail("id target wajib");

  if (kind === "category") {
    const cat = await db.serviceCategory.findUnique({ where: { id: targetId } });
    if (!cat || cat.brandId !== brandId) return fail("Kategori tidak ditemukan", 404);
    await db.serviceCategory.delete({ where: { id: targetId } }); // service ikut lepas (SetNull), stage ikut cascade
    await logAudit({
      actorName: actor.name, actorRole: actor.role, action: "delete",
      entity: "service_category", entityId: targetId, entityLabel: `${brand.name} · ${cat.name}`, req,
    });
    return ok({ deleted: true });
  }

  if (kind === "service") {
    const svc = await db.service.findUnique({ where: { id: targetId } });
    if (!svc || svc.brandId !== brandId) return fail("Layanan tidak ditemukan", 404);
    await db.service.delete({ where: { id: targetId } }); // workflowStages cascade
    await logAudit({
      actorName: actor.name, actorRole: actor.role, action: "delete",
      entity: "service", entityId: targetId, entityLabel: `${brand.name} · ${svc.name}`, req,
    });
    return ok({ deleted: true });
  }

  const stage = await db.workflowStage.findUnique({ where: { id: targetId }, include: { service: true } });
  if (!stage || stage.service.brandId !== brandId) return fail("Langkah workflow tidak ditemukan", 404);
  await db.workflowStage.delete({ where: { id: targetId } });
  await logAudit({
    actorName: actor.name, actorRole: actor.role, action: "delete",
    entity: "workflow_stage", entityId: targetId,
    entityLabel: `${brand.name} · ${stage.service.name} · ${stage.phase}/${stage.name}`, req,
  });
  return ok({ deleted: true });
}
