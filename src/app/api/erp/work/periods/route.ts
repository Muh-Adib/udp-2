import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit, dateOrNull } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES, BRAND_SELECT } from "../_shared";

/**
 * Task 2-d — Work Engine: WorkPeriod (periode kerja berulang utk retainer).
 * GET  /api/erp/work/periods?status=&brandId= → periods + brand + project + jumlah instance.
 * POST /api/erp/work/periods { brandId, name, periodStart, periodEnd, projectId?, contractRef? }
 *      (manager+) → status awal "planned" (aturan #3: planned → active → closed).
 */

const PERIOD_INCLUDE = {
  brand: BRAND_SELECT,
  project: { select: { id: true, code: true, name: true, brandId: true } },
  _count: { select: { instances: true } },
} as const;

export async function GET(req: NextRequest) {
  const g = await authWork(req);
  if (!g.ok) return g.err;
  const actor = g.actor;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const brandId = sp.get("brandId");

  const periods = await db.workPeriod.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
    },
    include: PERIOD_INCLUDE,
    orderBy: { periodStart: "desc" },
  });
  return ok({ periods });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const brandId = String(body.brandId ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!brandId) return fail("Brand wajib dipilih", 400);
  if (!name) return fail("Nama periode wajib diisi", 400);

  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const periodStart = dateOrNull(body.periodStart);
  const periodEnd = dateOrNull(body.periodEnd);
  if (!periodStart) return fail("Tanggal mulai periode tidak valid", 400);
  if (!periodEnd) return fail("Tanggal akhir periode tidak valid", 400);
  if (periodEnd.getTime() < periodStart.getTime()) {
    return fail("Tanggal akhir periode harus setelah tanggal mulai", 400);
  }

  const projectId = body.projectId ? String(body.projectId).trim() : null;
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return fail("Project tidak ditemukan", 404);
  }

  const period = await db.workPeriod.create({
    data: {
      brandId,
      projectId,
      name: name.slice(0, 160),
      periodStart,
      periodEnd,
      status: "planned",
      contractRef: body.contractRef ? String(body.contractRef).trim().slice(0, 120) : null,
    },
    include: PERIOD_INCLUDE,
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "work_period",
    entityId: period.id,
    entityLabel: name,
    newValue: `${brand.name} · ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
    req,
  });
  return ok({ period }, 201);
}
