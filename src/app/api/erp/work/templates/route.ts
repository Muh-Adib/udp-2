import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES, BRAND_SELECT } from "../_shared";

/**
 * Task 2-d — Work Engine: WorkflowTemplate.
 * GET   /api/erp/work/templates → daftar template + versions (+steps count) + brand.
 * POST  /api/erp/work/templates → buat template (manager+).
 */

export async function GET(req: NextRequest) {
  const g = await authWork(req);
  if (!g.ok) return g.err;
  const actor = g.actor;
  const sp = req.nextUrl.searchParams;
  const brandId = sp.get("brandId");
  const active = sp.get("active");

  const templates = await db.workflowTemplate.findMany({
    where: {
      ...(brandId ? { brandId } : {}),
      ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
    },
    include: {
      brand: BRAND_SELECT,
      versions: {
        orderBy: { version: "desc" },
        include: { _count: { select: { steps: true, instances: true } } },
      },
      _count: { select: { versions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok({ templates });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama template wajib diisi", 400);
  const description = body.description ? String(body.description).trim().slice(0, 500) : null;
  const brandId = body.brandId ? String(body.brandId).trim() : null;

  if (brandId) {
    const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) return fail("Brand tidak ditemukan", 404);
  }

  const template = await db.workflowTemplate.create({
    data: { name: name.slice(0, 160), description, brandId, active: true },
    include: {
      brand: BRAND_SELECT,
      versions: {
        orderBy: { version: "desc" },
        include: { _count: { select: { steps: true, instances: true } } },
      },
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "workflow_template",
    entityId: template.id,
    entityLabel: name,
    newValue: name,
    req,
  });
  return ok({ template }, 201);
}
