import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Kunci periode payroll (open → locked). Hanya dari status "open".
 * Setelah terkunci, run baru tidak bisa dibuat (dicek di POST /runs).
 * Role: hr/director.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const period = await db.payrollPeriod.findUnique({ where: { id } });
  if (!period) return fail("Periode payroll tidak ditemukan", 404);
  if (period.status !== "open") {
    return fail(`Hanya periode berstatus open yang bisa dikunci (status saat ini: ${period.status})`, 409);
  }

  const updated = await db.payrollPeriod.update({
    where: { id },
    data: { status: "locked", lockedAt: new Date() },
  });
  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "payroll_period", entityId: updated.id, entityLabel: updated.name,
    field: "status", oldValue: "open", newValue: "locked",
    metadata: "Periode payroll dikunci — run baru ditolak", req,
  });
  return ok({ period: updated });
}
