import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import {
  authWork, requireRole, MANAGER_ROLES, ADVANCE_ROLES, normalizeAssigneeIds, BRAND_SELECT,
} from "../../_shared";

/**
 * Task 2-d — Work Engine: aksi instance workflow (aturan #2).
 * PATCH /api/erp/work/instances/[id] { action: "advance"|"cancel", assigneeIds? }
 * - advance (manager/director/super_admin/production/marketing):
 *     currentPos < jumlah steps → currentPos++; mencapai jumlah steps →
 *     status "done" + completedAt (advance terakhir otomatis menuntaskan).
 * - cancel (manager+): hanya instance aktif.
 * - assigneeIds: edit pelaksana (manager+).
 * Optimistic guard: updateMany dgn where currentPos lama → 409 bila sudah diubah pihak lain.
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;

  const instance = await db.workflowInstance.findUnique({
    where: { id },
    include: { version: { include: { steps: { orderBy: { position: "asc" } } } } },
  });
  if (!instance) return fail("Instance workflow tidak ditemukan", 404);

  const action = String(body.action ?? "").trim();

  // ===== Edit pelaksana (manager+) — bisa digabung dgn advance/cancel atau sendiri =====
  let assigneeIdsChanged = false;
  if ("assigneeIds" in body) {
    const roleGate = requireRole(actor, MANAGER_ROLES);
    if (roleGate) return roleGate;
    const rawAssignees = normalizeAssigneeIds(body.assigneeIds);
    let assigneeIds: string | null = null;
    if (rawAssignees) {
      const ids = rawAssignees.split(",");
      const users = await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
      const valid = ids.filter((i) => users.some((u) => u.id === i));
      assigneeIds = valid.length > 0 ? valid.join(",") : null;
    }
    await db.workflowInstance.update({ where: { id }, data: { assigneeIds } });
    assigneeIdsChanged = true;
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "workflow_instance", entityId: id,
      entityLabel: instance.title, field: "assigneeIds",
      oldValue: instance.assigneeIds ?? null, newValue: assigneeIds, req,
    });
  }

  // ===== Aksi tanpa advance/cancel → cukup simpan hasil edit assignee =====
  if (!action) {
    if (!assigneeIdsChanged) return fail("Aksi wajib diisi (advance/cancel)", 400);
    const fresh = await db.workflowInstance.findUnique({ where: { id }, include: INSTANCE_INCLUDE });
    return ok({ instance: fresh });
  }

  const totalSteps = instance.version.steps.length;

  if (action === "advance") {
    const roleGate = requireRole(actor, ADVANCE_ROLES);
    if (roleGate) return roleGate;

    if (instance.status === "done") return fail("Instance sudah selesai — tidak bisa di-advance", 400);
    if (instance.status !== "active") return fail("Hanya instance aktif yang bisa di-advance", 400);
    if (totalSteps === 0) return fail("Versi workflow belum punya tahapan", 400);
    if (instance.currentPos >= totalSteps) return fail("Instance sudah di tahap terakhir", 400);

    const newPos = instance.currentPos + 1;
    const isFinish = newPos >= totalSteps;

    // Optimistic guard (anti double-advance bersamaan).
    const res = await db.workflowInstance.updateMany({
      where: { id, status: "active", currentPos: instance.currentPos },
      data: isFinish
        ? { currentPos: newPos, status: "done", completedAt: new Date() }
        : { currentPos: newPos },
    });
    if (res.count === 0) {
      return fail("Instance sudah diperbarui pengguna lain — muat ulang data", 409);
    }

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "advance", entity: "workflow_instance", entityId: id, entityLabel: instance.title,
      field: "currentPos", oldValue: instance.currentPos, newValue: isFinish ? `${newPos} (selesai)` : newPos,
      req,
    });

    const fresh = await db.workflowInstance.findUnique({ where: { id }, include: INSTANCE_INCLUDE });
    return ok({ instance: fresh, done: isFinish });
  }

  if (action === "cancel") {
    const roleGate = requireRole(actor, MANAGER_ROLES);
    if (roleGate) return roleGate;

    if (instance.status !== "active") {
      return fail("Hanya instance aktif yang bisa dibatalkan", 400);
    }
    const res = await db.workflowInstance.updateMany({
      where: { id, status: "active" },
      data: { status: "cancelled" },
    });
    if (res.count === 0) {
      return fail("Instance sudah diperbarui pengguna lain — muat ulang data", 409);
    }

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "cancel", entity: "workflow_instance", entityId: id, entityLabel: instance.title,
      field: "status", oldValue: "active", newValue: "cancelled", req,
    });

    const fresh = await db.workflowInstance.findUnique({ where: { id }, include: INSTANCE_INCLUDE });
    return ok({ instance: fresh });
  }

  return fail("Aksi tidak dikenal (advance/cancel)", 400);
}
