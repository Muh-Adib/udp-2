import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  MANAGER_PLUS_ROLES, DIRECTOR_ROLES, HR_ROLES, roleIn, strOrNull,
} from "../../_utils";

// PATCH /api/erp/hris/leave/[id] — body { action: "approve"|"reject"|"cancel", decisionNote? }
// approve/reject: supervisor karyawan tsb ATAU role hr/manager/director/super_admin.
// No self-approve — KECUALI director/super_admin (otoritas akhir; direkam eksplisit
// di audit — keputusan desain utk mengakomodasi alur approve via API direktur).
// cancel: pengaju sendiri (status pending) ATAU hr/director/super_admin.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const request = await db.leaveRequest.findUnique({
    where: { id },
    include: {
      employee: {
        select: {
          id: true, preferredName: true, employeeNumber: true,
          userId: true, supervisorId: true,
        },
      },
    },
  });
  if (!request) return fail("Pengajuan tidak ditemukan", 404);

  const action = strOrNull(body.action);
  const decisionNote = strOrNull(body.decisionNote);

  // ===== CANCEL =====
  if (action === "cancel") {
    const isOwner = !!actor.id && request.employee.userId === actor.id;
    const isAdmin = roleIn(actor.role, HR_ROLES);
    if (!isOwner && !isAdmin) {
      return fail("Hanya pengaju atau HR yang bisa membatalkan pengajuan ini", 403);
    }
    if (request.status !== "pending") {
      return fail("Hanya pengajuan pending yang bisa dibatalkan", 400);
    }
    const updated = await db.leaveRequest.update({
      where: { id },
      data: { status: "cancelled", decidedAt: new Date(), decisionNote: decisionNote ?? "Dibatalkan pengaju" },
      include: {
        employee: {
          select: {
            id: true, preferredName: true, employeeNumber: true,
            department: true, position: true, userId: true, supervisorId: true,
          },
        },
      },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "cancel", entity: "hris_leave", entityId: id,
      entityLabel: `${request.type} — ${request.employee.preferredName}`,
      oldValue: request.status, newValue: "cancelled", req,
    });
    return ok({ request: updated });
  }

  // ===== APPROVE / REJECT =====
  if (action !== "approve" && action !== "reject") {
    return fail("action wajib 'approve', 'reject', atau 'cancel'");
  }
  if (request.status !== "pending") {
    return fail(`Pengajuan sudah diputuskan (status: ${request.status})`, 400);
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
  // No self-approve; director/super_admin dikecualikan (otoritas akhir, terekam audit).
  if (isSelf && !roleIn(actor.role, DIRECTOR_ROLES)) {
    return fail("Tidak bisa menyetujui pengajuan sendiri — no self-approve", 403);
  }

  const updated = await db.leaveRequest.update({
    where: { id },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      approvedBy: actor.name,
      decidedAt: new Date(),
      decisionNote: decisionNote ?? (isSelf ? "Self-approve oleh direktur (otoritas akhir)" : null),
    },
    include: {
      employee: {
        select: {
          id: true, preferredName: true, employeeNumber: true,
          department: true, position: true, userId: true, supervisorId: true,
        },
      },
    },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action, entity: "hris_leave", entityId: id,
    entityLabel: `${request.type} — ${request.employee.preferredName}`,
    oldValue: request.status, newValue: updated.status,
    metadata: decisionNote ?? undefined, req,
  });
  return ok({ request: updated });
}
