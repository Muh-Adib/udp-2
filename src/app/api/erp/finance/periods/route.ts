import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, isUniqueViolation } from "@/lib/crm/server";
import { gate, periodRange, periodNameFor, FINANCE_READ_ROLES, FINANCE_WRITE_ROLES, strOrNull } from "../_lib";

/**
 * FASE 7 — Periode pembukuan (aturan #5).
 * GET  : finance/director/super_admin — daftar periode + jumlah entry & draft tersisa
 *        (draft dalam periode = penghambat penutupan buku).
 * POST {name: "YYYY-MM"} : finance/director/super_admin — buat periode open baru.
 */
export async function GET(req: NextRequest) {
  const g = await gate(req, FINANCE_READ_ROLES);
  if (g.res) return g.res;

  const periods = await db.accountingPeriod.findMany({ orderBy: { name: "desc" } });

  const withCounts = await Promise.all(
    periods.map(async (p) => {
      const range = periodRange(p.name);
      const where = range ? { date: { gte: range.start, lt: range.end } } : { periodId: p.id };
      const [entryCount, draftCount] = await Promise.all([
        db.journalEntry.count({ where }),
        db.journalEntry.count({ where: { ...where, status: "draft" } }),
      ]);
      return { ...p, entryCount, draftCount };
    }),
  );

  return ok({ periods: withCounts, currentPeriodName: periodNameFor(new Date()) });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const name = strOrNull(body.name);
  if (!name) return fail("Nama periode wajib diisi (format YYYY-MM)");
  const range = periodRange(name);
  if (!range) return fail("Format periode harus YYYY-MM (contoh: 2026-09)");

  try {
    const period = await db.accountingPeriod.create({
      data: { name, status: "open" },
    });
    await logAudit({
      actorName: g.actor.name, actorRole: g.actor.role,
      action: "create", entity: "accounting_period", entityId: period.id, entityLabel: period.name,
      field: "status", newValue: "open", metadata: "Periode pembukuan dibuat (open)", req,
    });
    return ok({ period }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) return fail(`Periode ${name} sudah ada`, 409);
    throw err;
  }
}
