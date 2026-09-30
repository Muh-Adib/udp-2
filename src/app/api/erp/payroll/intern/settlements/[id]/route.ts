import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Alur settlement uang saku magang:
 * - submit  : hr/super_admin — open → submitted (pengajuan).
 * - approve : director/super_admin — submitted → approved (approvedBy tercatat).
 * - pay     : finance/director/super_admin — approved → paid (paidAt, paidTotal =
 *             totalAccrued) + FinancialObligation sourceType "intern_settlement".
 *             (CashDisbursement dibuat slice finance terpisah.)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const settlement = await db.internSettlement.findUnique({
    where: { id },
    include: { employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
  });
  if (!settlement) return fail("Settlement tidak ditemukan", 404);
  const label = `${settlement.employee.employeeNumber} · ${settlement.employee.preferredName}`;
  const action = String(body.action ?? "");

  if (action === "submit") {
    const gate = assertRole(actor, ["hr", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (settlement.status !== "open") {
      return fail(`Hanya settlement open yang bisa diajukan (status: ${settlement.status})`, 409);
    }
    const updated = await db.internSettlement.update({
      where: { id },
      data: { status: "submitted" },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "submit", entity: "intern_settlement", entityId: id, entityLabel: label,
      field: "status", oldValue: "open", newValue: "submitted", req,
    });
    return ok({ settlement: updated });
  }

  if (action === "approve") {
    const gate = assertRole(actor, ["director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (settlement.status !== "submitted") {
      return fail(`Hanya settlement submitted yang bisa disetujui (status: ${settlement.status})`, 409);
    }
    const updated = await db.internSettlement.update({
      where: { id },
      data: { status: "approved", approvedBy: actor.name },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "approve", entity: "intern_settlement", entityId: id, entityLabel: label,
      field: "status", oldValue: "submitted", newValue: "approved",
      metadata: `Total Rp ${settlement.totalAccrued.toLocaleString("id-ID")}`, req,
    });
    return ok({ settlement: updated });
  }

  if (action === "pay") {
    const gate = assertRole(actor, ["finance", "director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (settlement.status !== "approved") {
      return fail(`Hanya settlement approved yang bisa dibayar (status: ${settlement.status})`, 409);
    }
    const paidAt = new Date();
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.internSettlement.update({
        where: { id },
        data: { status: "paid", paidAt, paidTotal: settlement.totalAccrued },
      });
      const obligation = await tx.financialObligation.create({
        data: {
          payeeType: "employee",
          payeeEmployeeId: settlement.employeeId,
          payeeName: settlement.employee.preferredName,
          amount: settlement.totalAccrued,
          currency: "IDR",
          sourceType: "intern_settlement",
          sourceId: settlement.id,
          status: "open",
        },
      });
      return { updated, obligation };
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "pay", entity: "intern_settlement", entityId: id, entityLabel: label,
      field: "status", oldValue: "approved", newValue: "paid",
      metadata: `Dibayar Rp ${settlement.totalAccrued.toLocaleString("id-ID")} · kewajiban tercatat`, req,
    });
    return ok({ settlement: result.updated, obligation: result.obligation });
  }

  return fail("action harus submit | approve | pay");
}
