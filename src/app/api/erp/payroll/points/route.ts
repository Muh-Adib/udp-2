import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Ledger poin karyawan (append-only) + ringkasan saldo.
 * GET /api/erp/payroll/points?employeeId= → { employee, account, entries, summary }
 * Saldo tersedia = Σ(poin positif) + Σ(poin negatif) − reservasi aktif.
 */

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeId = req.nextUrl.searchParams.get("employeeId");
  if (!employeeId) return fail("parameter employeeId wajib diisi");
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNumber: true, preferredName: true, employmentStatus: true, active: true },
  });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);

  const [entries, pos, neg, earned, redeemed, reserved, account] = await Promise.all([
    db.pointLedgerEntry.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, points: { gt: 0 } }, _sum: { points: true } }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, points: { lt: 0 } }, _sum: { points: true } }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, kind: "earn" }, _sum: { points: true } }),
    db.pointLedgerEntry.aggregate({ where: { employeeId, kind: "redeem" }, _sum: { points: true } }),
    db.pointReservation.aggregate({ where: { employeeId, status: "reserved" }, _sum: { points: true } }),
    db.pointAccount.findUnique({ where: { employeeId } }),
  ]);

  const reservedActive = reserved._sum.points ?? 0;
  return ok({
    employee,
    account: account
      ? { id: account.id, createdAt: account.createdAt, updatedAt: account.updatedAt }
      : null,
    entries,
    summary: {
      earned: earned._sum.points ?? 0,
      redeemed: Math.abs(redeemed._sum.points ?? 0),
      reserved: reservedActive,
      available: (pos._sum.points ?? 0) + (neg._sum.points ?? 0) - reservedActive,
    },
  });
}
