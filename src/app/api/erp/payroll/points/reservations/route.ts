import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Daftar reservasi poin (semua karyawan) utk antrian Release/Settle.
 * GET /api/erp/payroll/points/reservations?status=reserved → { reservations }
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const status = req.nextUrl.searchParams.get("status");
  const reservations = await db.pointReservation.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      employee: { select: { id: true, employeeNumber: true, preferredName: true, employmentStatus: true } },
    },
  });
  return ok({ reservations });
}
