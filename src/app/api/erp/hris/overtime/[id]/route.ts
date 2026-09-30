import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  MANAGER_PLUS_ROLES, HR_ROLES, DIRECTOR_ROLES, roleIn, strOrNull,
} from "../../_utils";

const EMP_SELECT = {
  select: {
    id: true, preferredName: true, employeeNumber: true,
    department: true, position: true, userId: true, supervisorId: true,
  },
} as const;

// PATCH /api/erp/hris/overtime/[id]
// action approve/reject → supervisor / hr / manager / director / super_admin
//   (no self-approve kecuali director/super_admin — konsisten dgn leave);
// action verify (hr/director/super_admin) → set realizedMinutes + verifiedBy + status verified.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const request = await db.overtimeRequest.findUnique({
    where: { id },
    include: {
      employee: {
        select: { id: true, preferredName: true, employeeNumber: true, userId: true, supervisorId: true },
      },
    },
  });
  if (!request) return fail("Order lembur tidak ditemukan", 404);

  const action = strOrNull(body.action);
  if (action !== "approve" && action !== "reject" && action !== "verify") {
    return fail("action wajib 'approve', 'reject', atau 'verify'");
  }

  // ===== VERIFY (realisasi) =====
  if (action === "verify") {
    const gate = assertRole(actor, HR_ROLES);
    if (!gate.ok) return fail("Hanya HR/Direktur yang bisa memverifikasi realisasi lembur", 403);
    if (request.status !== "approved") {
      return fail("Hanya lembur berstatus approved yang bisa diverifikasi", 400);
    }
    const realizedMinutes = numOrNull(body.realizedMinutes);
    if (realizedMinutes === null || !Number.isInteger(realizedMinutes) || realizedMinutes < 0 || realizedMinutes > 2880) {
      return fail("Realisasi menit wajib diisi (0–2880)");
    }
    const updated = await db.overtimeRequest.update({
      where: { id },
      data: {
        realizedMinutes,
        verifiedBy: actor.name,
        status: "verified",
      },
      include: { employee: EMP_SELECT },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "verify", entity: "hris_overtime", entityId: id,
      entityLabel: `Lembur — ${request.employee.preferredName}`,
      oldValue: request.status, newValue: "verified",
      metadata: `realisasi=${realizedMinutes} menit (rencana ${request.endMinute - request.startMinute})`, req,
    });
    return ok({ request: updated });
  }

  // ===== APPROVE / REJECT =====
  if (request.status !== "pending") {
    return fail(`Order lembur sudah diputuskan (status: ${request.status})`, 400);
  }
  const gate = assertRole(actor, MANAGER_PLUS_ROLES);
  const isSupervisor =
    !!request.employee.supervisorId &&
    (await db.employee.findFirst({
      where: { id: request.employee.supervisorId, userId: actor.id ?? "__none__" },
      select: { id: true },
    })) !== null;
  const isSelf = !!actor.id && request.employee.userId === actor.id;

  if (!gate.ok && !isSupervisor) return fail(gate.reason, 403);
  if (isSelf && !roleIn(actor.role, DIRECTOR_ROLES)) {
    return fail("Tidak bisa menyetujui lembur sendiri — no self-approve", 403);
  }

  const updated = await db.overtimeRequest.update({
    where: { id },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      approvedBy: actor.name,
      decidedAt: new Date(),
    },
    include: { employee: EMP_SELECT },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action, entity: "hris_overtime", entityId: id,
    entityLabel: `Lembur — ${request.employee.preferredName}`,
    oldValue: request.status, newValue: updated.status, req,
  });
  return ok({ request: updated });
}
