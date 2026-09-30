import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES, BRAND_SELECT } from "../../_shared";

/**
 * Task 2-d — Work Engine: edit WorkflowTemplate.
 * PATCH /api/erp/work/templates/[id] { name?, description?, active? } (manager+).
 * Catatan: edit ini TIDAK menyentuh versi — versi published tidak boleh diubah
 * (aturan #1: perubahan alur = versi baru dgn copy steps + increment).
 */

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const template = await db.workflowTemplate.findUnique({ where: { id } });
  if (!template) return fail("Template tidak ditemukan", 404);

  const data: Record<string, unknown> = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return fail("Nama template tidak boleh kosong", 400);
    data.name = name.slice(0, 160);
  }
  if ("description" in body) data.description = body.description ? String(body.description).trim().slice(0, 500) : null;
  if ("active" in body) data.active = body.active === true;

  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan yang dikirim", 400);

  const updated = await db.workflowTemplate.update({
    where: { id },
    data,
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
    action: "update",
    entity: "workflow_template",
    entityId: id,
    entityLabel: updated.name,
    newValue: JSON.stringify(data),
    req,
  });
  return ok({ template: updated });
}
