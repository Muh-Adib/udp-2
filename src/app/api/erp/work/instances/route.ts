import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import {
  authWork, requireRole, MANAGER_ROLES, CONTEXT_TYPES, normalizeAssigneeIds, BRAND_SELECT,
} from "../_shared";

/**
 * Task 2-d — Work Engine: WorkflowInstance (pelaksanaan nyata satu pekerjaan).
 * GET  /api/erp/work/instances?status=&projectId=&workPeriodId=&contextType=
 *      → instances + version.steps (sorted) + template(+brand) + project + workPeriod.
 * POST /api/erp/work/instances { versionId, title, projectId?, workPeriodId?,
 *      contextType?, assigneeIds? } (manager+) — HANYA dari versi published (aturan #1).
 */

const INSTANCE_INCLUDE = {
  version: {
    include: {
      steps: { orderBy: { position: "asc" } },
      template: { include: { brand: BRAND_SELECT } },
    },
  },
  project: { include: { brand: BRAND_SELECT } },
  workPeriod: { include: { brand: BRAND_SELECT } },
} as const;

export async function GET(req: NextRequest) {
  const g = await authWork(req);
  if (!g.ok) return g.err;
  const actor = g.actor;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const projectId = sp.get("projectId");
  const workPeriodId = sp.get("workPeriodId");
  const contextType = sp.get("contextType");

  const instances = await db.workflowInstance.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(projectId ? { projectId } : {}),
      ...(workPeriodId ? { workPeriodId } : {}),
      ...(contextType && contextType !== "all" ? { contextType } : {}),
    },
    include: INSTANCE_INCLUDE,
    orderBy: { startedAt: "desc" },
  });
  return ok({ instances });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const versionId = String(body.versionId ?? "").trim();
  const title = String(body.title ?? "").trim();
  if (!versionId) return fail("Versi workflow wajib dipilih", 400);
  if (!title) return fail("Judul instance wajib diisi", 400);

  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) return fail("Versi workflow tidak ditemukan", 404);
  if (version.status !== "published") {
    return fail("Instance hanya bisa dibuat dari versi workflow yang PUBLISHED (aturan: satu versi aktif per template)", 400);
  }

  const projectId = body.projectId ? String(body.projectId).trim() : null;
  const workPeriodId = body.workPeriodId ? String(body.workPeriodId).trim() : null;
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return fail("Project tidak ditemukan", 404);
  }
  if (workPeriodId) {
    const period = await db.workPeriod.findUnique({ where: { id: workPeriodId }, select: { id: true } });
    if (!period) return fail("Periode kerja tidak ditemukan", 404);
  }

  // contextType: eksplisit → validasi; default: project > retainer > standalone (aturan #2).
  let contextType = body.contextType ? String(body.contextType).trim() : "";
  if (contextType && !(CONTEXT_TYPES as readonly string[]).includes(contextType)) {
    return fail("contextType tidak valid (project/retainer/rnd/standalone)", 400);
  }
  if (!contextType) contextType = projectId ? "project" : workPeriodId ? "retainer" : "standalone";

  // Assignees: daftar userId → validasi ke DB (id tak dikenal dibuang).
  let assigneeIds: string | null = null;
  const rawAssignees = normalizeAssigneeIds(body.assigneeIds);
  if (rawAssignees) {
    const ids = rawAssignees.split(",");
    const users = await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
    const valid = ids.filter((i) => users.some((u) => u.id === i));
    assigneeIds = valid.length > 0 ? valid.join(",") : null;
  }

  const instance = await db.workflowInstance.create({
    data: {
      versionId,
      projectId,
      workPeriodId,
      title: title.slice(0, 200),
      contextType,
      status: "active",
      currentPos: 0,
      assigneeIds,
    },
    include: INSTANCE_INCLUDE,
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "workflow_instance",
    entityId: instance.id,
    entityLabel: title,
    newValue: `v${version.version} · ${contextType}`,
    req,
  });
  return ok({ instance }, 201);
}
