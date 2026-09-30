import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Akumulasi uang saku magang (InternAccrual).
 * GET /api/erp/payroll/intern/accruals?month=YYYY-MM&employeeId=
 * → { accruals, totals } — filter opsional per bulan dan/atau karyawan.
 */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const month = req.nextUrl.searchParams.get("month");
  const employeeId = req.nextUrl.searchParams.get("employeeId");

  let range: { gte: Date; lte: Date } | undefined;
  if (month) {
    if (!MONTH_RE.test(month)) return fail("Format bulan harus YYYY-MM");
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    range = { gte: start, lte: new Date(end.getTime() - 1) };
  }

  const accruals = await db.internAccrual.findMany({
    where: {
      ...(range ? { businessDate: range } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
    orderBy: { businessDate: "asc" },
    include: {
      employee: { select: { id: true, employeeNumber: true, preferredName: true, internProgram: true, stipendDaily: true } },
    },
  });

  const totals = new Map<string, { employeeId: string; name: string; days: number; total: number }>();
  for (const a of accruals) {
    const cur = totals.get(a.employeeId) ?? {
      employeeId: a.employeeId, name: a.employee.preferredName, days: 0, total: 0,
    };
    cur.days += 1;
    cur.total += a.amount;
    totals.set(a.employeeId, cur);
  }

  return ok({ accruals, totals: [...totals.values()] });
}
