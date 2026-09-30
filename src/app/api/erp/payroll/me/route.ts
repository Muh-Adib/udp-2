import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Fase 6 — Self-service payroll (/me): slip milik sendiri + ringkasan poin sendiri
 * + reservasi & proposal insentif sendiri. Terbuka utk SEMUA user yang punya
 * record Employee (employee dicari via Employee.userId = sesi).
 */

async function pointsSummary(employeeId: string) {
  const [pos, neg, earned, redeemed, reserved] = await Promise.all([
    db.pointLedgerEntry.aggregate({ where: { employeeId, points: { gt: 0 } }, _sum: { points: true } }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, points: { lt: 0 } }, _sum: { points: true } }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, kind: "earn" }, _sum: { points: true } }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, kind: "redeem" }, _sum: { points: true } }),
    db.pointReservation.aggregate({ where: { employeeId, status: "reserved" }, _sum: { points: true } }),
  ]);
  const postedAvailable = (pos._sum.points ?? 0) + (neg._sum.points ?? 0);
  const reservedActive = reserved._sum.points ?? 0;
  return {
    earned: earned._sum.points ?? 0,
    redeemed: Math.abs(redeemed._sum.points ?? 0),
    reserved: reservedActive,
    available: postedAvailable - reservedActive,
  };
}

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const employee = await db.employee.findUnique({
    where: { userId: actor.id ?? "" },
  });
  if (!employee) return fail("Akun Anda belum terhubung ke data karyawan", 404);

  const [mySlips, points, myReservations, myIncentives] = await Promise.all([
    db.payslip.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        items: { orderBy: { id: "asc" } },
        run: { include: { period: { select: { id: true, name: true, payDate: true, status: true } } } },
      },
    }),
    pointsSummary(employee.id),
    db.pointReservation.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.incentiveProposal.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return ok({
    employee: {
      id: employee.id, employeeNumber: employee.employeeNumber, preferredName: employee.preferredName,
      employmentStatus: employee.employmentStatus, department: employee.department, position: employee.position,
    },
    mySlips,
    points,
    myReservations,
    myIncentives,
  });
}
