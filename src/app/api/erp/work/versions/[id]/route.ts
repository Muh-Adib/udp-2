import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES, parseSteps, BRAND_SELECT } from "../../_shared";

/**
 * Task 2-d — Work Engine: detail & edit versi workflow.
 * GET   /api/erp/work/versions/[id] → detail + steps sorted by position.
 * PATCH /api/erp/work/versions/[id] { steps?, note? } — HANYA status "draft"
 * (aturan #1: versi published DILARANG diedit; perubahan = versi baru).
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await authWork(req);
  if (!g.ok) return g.err;
  const actor = g.actor;

  const version = await db.workflowVersion.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { position: "asc" } },
      template: { include: { brand: BRAND_SELECT } },
      _count: { select: { instances: true } },
    },
  });
  if (!version) return fail("Versi workflow tidak ditemukan", 404);
  return ok({ version });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const version = await db.workflowVersion.findUnique({ where: { id } });
  if (!version) return fail("Versi workflow tidak ditemukan", 404);
  if (version.status !== "draft") {
    return fail(
      `Versi ${version.status === "published" ? "published" : "archived"} TIDAK boleh diedit — buat versi baru dari template`,
      400,
    );
  }

  const data: Record<string, unknown> = {};
  if ("note" in body) data.note = body.note ? String(body.note).trim().slice(0, 300) : null;

  if (body.steps !== undefined) {
    const parsed = parseSteps(body.steps);
    if ("error" in parsed) return fail(parsed.error, 400);
    await db.$transaction(async (tx) => {
      await tx.workflowStep.deleteMany({ where: { versionId: id } });
      await tx.workflowStep.createMany({
        data: parsed.steps.map((s, i) => ({
          versionId: id,
          position: i + 1,
          name: s.name,
          kind: s.kind,
          roleNeeded: s.roleNeeded,
          slaHours: s.slaHours,
        })),
      });
    });
  }
  if (Object.keys(data).length > 0) {
    await db.workflowVersion.update({ where: { id }, data });
  }

  const full = await db.workflowVersion.findUnique({
    where: { id },
    include: { steps: { orderBy: { position: "asc" } }, template: { include: { brand: BRAND_SELECT } } },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    entity: "workflow_version",
    entityId: id,
    entityLabel: `${version.templateId} — draft v${version.version}`,
    newValue: body.steps !== undefined ? `steps=${parsedCount(body.steps)} tahap` : JSON.stringify(data),
    req,
  });
  return ok({ version: full });
}

function parsedCount(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0;
}
