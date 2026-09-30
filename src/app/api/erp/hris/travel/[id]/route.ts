import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  MANAGER_PLUS_ROLES, DIRECTOR_ROLES, FINANCE_CLOSE_ROLES,
  requireSelfEmployee, strOrNull, addBusinessDays,
} from "../../_utils";

const EMP_SELECT = {
  select: {
    id: true, preferredName: true, employeeNumber: true,
    department: true, position: true, userId: true, supervisorId: true,
  },
} as const;

// PATCH /api/erp/hris/travel/[id] — state machine:
//   submit  : draft → draft (penanda diajukan; self/manager+)
//   approve : draft → approved + decidedAt (director/super_admin)
//   start   : approved → ongoing (self/manager+)
//   settle  : ongoing → settlement_pending + actualAmount → settlementStatus
//             (actual<advance → return_due; > → additional_payable; = → balanced)
//             settlementDueAt = returnDate + 3 hari kerja (Sen–Jum)
//   close   : settlement_pending → closed (finance/director/super_admin)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const order = await db.travelOrder.findUnique({
    where: { id },
    include: {
      employee: {
        select: { id: true, preferredName: true, employeeNumber: true, userId: true, supervisorId: true },
      },
    },
  });
  if (!order) return fail("Travel order tidak ditemukan", 404);

  const action = strOrNull(body.action);
  const isSelf = !!actor.id && order.employee.userId === actor.id;
  const isManagerPlus = assertRole(actor, MANAGER_PLUS_ROLES).ok;
  const allowedActor = isSelf || isManagerPlus;

  switch (action) {
    case "submit": {
      if (!allowedActor) return fail("Hanya pemilik order atau atasan yang bisa mengajukan", 403);
      if (order.status !== "draft") return fail("Hanya order berstatus draft yang bisa diajukan", 400);
      const updated = await db.travelOrder.update({
        where: { id },
        data: { status: "draft" },
        include: { employee: EMP_SELECT },
      });
      await logAudit({
        actorName: actor.name, actorRole: actor.role,
        action: "submit", entity: "hris_travel", entityId: id,
        entityLabel: `Dinas ${order.destination} — ${order.employee.preferredName}`,
        metadata: "Diajukan utk persetujuan direktur", req,
      });
      return ok({ order: updated });
    }

    case "approve": {
      const gate = assertRole(actor, DIRECTOR_ROLES);
      if (!gate.ok) return fail("Persetujuan dinas hanya oleh Direktur/Super Admin", 403);
      if (order.status !== "draft") return fail("Hanya order berstatus draft yang bisa disetujui", 400);
      const updated = await db.travelOrder.update({
        where: { id },
        data: { status: "approved", approvedBy: actor.name, decidedAt: new Date() },
        include: { employee: EMP_SELECT },
      });
      await logAudit({
        actorName: actor.name, actorRole: actor.role,
        action: "approve", entity: "hris_travel", entityId: id,
        entityLabel: `Dinas ${order.destination} — ${order.employee.preferredName}`,
        oldValue: order.status, newValue: "approved", req,
      });
      return ok({ order: updated });
    }

    case "start": {
      if (!allowedActor) return fail("Hanya pemilik order atau atasan yang bisa memulai dinas", 403);
      if (order.status !== "approved") return fail("Hanya order approved yang bisa dimulai", 400);
      const updated = await db.travelOrder.update({
        where: { id },
        data: { status: "ongoing" },
        include: { employee: EMP_SELECT },
      });
      await logAudit({
        actorName: actor.name, actorRole: actor.role,
        action: "start", entity: "hris_travel", entityId: id,
        entityLabel: `Dinas ${order.destination} — ${order.employee.preferredName}`,
        oldValue: "approved", newValue: "ongoing", req,
      });
      return ok({ order: updated });
    }

    case "settle": {
      if (!allowedActor) return fail("Hanya pemilik order atau atasan yang bisa mengajukan settlement", 403);
      if (order.status !== "ongoing") return fail("Hanya order ongoing yang bisa di-settle", 400);
      const actualAmount = numOrNull(body.actualAmount);
      if (actualAmount === null || actualAmount < 0) {
        return fail("Nominal realisasi biaya (actualAmount) wajib diisi dan tidak boleh negatif");
      }
      const settlementStatus =
        actualAmount < order.advanceAmount
          ? "return_due"
          : actualAmount > order.advanceAmount
            ? "additional_payable"
            : "balanced";
      const updated = await db.travelOrder.update({
        where: { id },
        data: {
          actualAmount,
          status: "settlement_pending",
          settlementStatus,
          settlementDueAt: addBusinessDays(order.returnDate, 3),
        },
        include: { employee: EMP_SELECT },
      });
      await logAudit({
        actorName: actor.name, actorRole: actor.role,
        action: "settle", entity: "hris_travel", entityId: id,
        entityLabel: `Dinas ${order.destination} — ${order.employee.preferredName}`,
        newValue: `actual=${actualAmount};settlement=${settlementStatus}`,
        metadata: `advance=${order.advanceAmount}`, req,
      });
      return ok({ order: updated });
    }

    case "close": {
      const gate = assertRole(actor, FINANCE_CLOSE_ROLES);
      if (!gate.ok) return fail("Penutupan settlement hanya oleh Finance/Direktur/Super Admin", 403);
      if (order.status !== "settlement_pending") {
        return fail("Hanya order settlement_pending yang bisa ditutup", 400);
      }
      const updated = await db.travelOrder.update({
        where: { id },
        data: { status: "closed" },
        include: { employee: EMP_SELECT },
      });
      await logAudit({
        actorName: actor.name, actorRole: actor.role,
        action: "close", entity: "hris_travel", entityId: id,
        entityLabel: `Dinas ${order.destination} — ${order.employee.preferredName}`,
        oldValue: "settlement_pending", newValue: "closed",
        metadata: order.settlementStatus ?? undefined, req,
      });
      return ok({ order: updated });
    }

    default:
      return fail("action wajib salah dari: submit/approve/start/settle/close");
  }
}
