import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { gate, FINANCE_READ_ROLES, periodNameFor, periodRange, BALANCE_TOLERANCE } from "../_lib";

/**
 * FASE 7 — Dashboard buku besar (aturan #4 blueprint):
 * GET /summary → {
 *   totalDebit, totalCredit        : agregat SEMUA posted lines (harus sama),
 *   byAccount[{code,name,type,debit,credit}] : mutasi per akun, urut mutasi terbesar,
 *   unbalancedCount                : jumlah entry posted dgn selisih > 0,01 (selalu 0),
 *   periodOpen                     : periode bulan berjalan open?,
 *   currentPeriod {id,name,status} | null,
 *   journalsThisMonth, pendingClaims, openObligations : KPI modul.
 * }
 */
export async function GET(req: NextRequest) {
  const g = await gate(req, FINANCE_READ_ROLES);
  if (g.res) return g.res;

  const postedLines = await db.journalLine.findMany({
    where: { entry: { status: "posted" } },
    include: { account: { select: { id: true, code: true, name: true, type: true } } },
  });

  // Agregasi per akun + per entry (utk verifikasi unbalanced).
  const byAccountId = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
  const byEntryId = new Map<string, { debit: number; credit: number }>();
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of postedLines) {
    const acc = byAccountId.get(line.accountId) ?? {
      code: line.account.code, name: line.account.name, type: line.account.type, debit: 0, credit: 0,
    };
    acc.debit += line.debit;
    acc.credit += line.credit;
    byAccountId.set(line.accountId, acc);
    const ent = byEntryId.get(line.entryId) ?? { debit: 0, credit: 0 };
    ent.debit += line.debit;
    ent.credit += line.credit;
    byEntryId.set(line.entryId, ent);
    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  let unbalancedCount = 0;
  byEntryId.forEach((t) => {
    if (Math.abs(t.debit - t.credit) > BALANCE_TOLERANCE) unbalancedCount += 1;
  });

  const byAccount = [...byAccountId.values()]
    .map((a) => ({ ...a, mutation: a.debit + a.credit }))
    .sort((a, b) => b.mutation - a.mutation);

  const now = new Date();
  const currentName = periodNameFor(now);
  const currentPeriod = await db.accountingPeriod.findUnique({ where: { name: currentName } });
  const periodOpen = !!currentPeriod && currentPeriod.status === "open";

  const range = periodRange(currentName);
  const [journalsThisMonth, pendingClaims, openObligations] = await Promise.all([
    db.journalEntry.count({ where: range ? { date: { gte: range.start, lt: range.end } } : undefined }),
    db.expenseClaim.count({ where: { status: "submitted" } }),
    db.financialObligation.count({ where: { status: "open" } }),
  ]);

  return ok({
    totalDebit,
    totalCredit,
    byAccount: byAccount.map(({ mutation: _mutation, ...rest }) => rest),
    unbalancedCount,
    periodOpen,
    currentPeriod: currentPeriod
      ? { id: currentPeriod.id, name: currentPeriod.name, status: currentPeriod.status }
      : null,
    journalsThisMonth,
    pendingClaims,
    openObligations,
  });
}
