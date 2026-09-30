import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES, parseSteps } from "../../../_shared";

/**
 * Task 2-d — Work Engine: buat DRAFT versi baru untuk template.
 * POST /api/erp/work/templates/[id]/versions { steps: [...], note? } (manager+).
 * Aturan #1: versi baru = increment version (max+1), status "draft" — publish
 * terpisah via POST /versions/[id]/publish (mengarsipkan published lama otomatis).
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const template = await db.workflowTemplate.findUnique({ where: { id } });
  if (!template) return fail("Template tidak ditemukan", 404);

  const parsed = parseSteps(body.steps);
  if ("error" in parsed) return fail(parsed.error, 400);

  const max = await db.workflowVersion.aggregate({ where: { templateId: id }, _max: { version: true } });
  const nextVersion = (max._max.version ?? 0) + 1;

  const created = await db.$transaction(async (tx) => {
    const version = await tx.workflowVersion.create({
      data: {
        templateId: id,
        version: nextVersion,
        status: "draft",
        note: body.note ? String(body.note).trim().slice(0, 300) : null,
      },
    });
    await tx.workflowStep.createMany({
      data: parsed.steps.map((s, i) => ({
        versionId: version.id,
        position: i + 1,
        name: s.name,
        kind: s.kind,
        roleNeeded: s.roleNeeded,
        slaHours: s.slaHours,
      })),
    });
    return version;
  });

  const full = await db.workflowVersion.findUnique({
    where: { id: created.id },
    include: { steps: { orderBy: { position: "asc" } } },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "workflow_version",
    entityId: created.id,
    entityLabel: `${template.name} — draft v${nextVersion}`,
    newValue: String(nextVersion),
    req,
  });
  return ok({ version: full }, 201);
}
