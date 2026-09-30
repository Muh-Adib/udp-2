import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, checkPeriodForDate, parseJournalLines, ensureAccountsUsable, FINANCE_READ_ROLES, FINANCE_WRITE_ROLES, strOrNull, rawDateOrNull } from "../_lib";

/**
 * FASE 7 — Jurnal umum (aturan #1 blueprint Bab 31).
 * GET  ?status=&periodId=&sourceType=&q= : finance/director/super_admin — entry + lines+account, urut tanggal desc.
 * POST {date, memo, lines[{accountId,debit,credit}], sourceType?, sourceId?, postNow?}
 *      : finance/director — validasi balanced (toleransi 0.01) + periode open utk tanggal entry;
 *        status draft, atau langsung posted bila postNow=true (postedAt terisi).
 */
export async function GET(req: NextRequest) {
  const g = await gate(req, FINANCE_READ_ROLES);
  if (g.res) return g.res;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status")?.trim();
  const periodId = sp.get("periodId")?.trim();
  const sourceType = sp.get("sourceType")?.trim();
  const q = sp.get("q")?.trim().toLowerCase();

  const entries = await db.journalEntry.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(periodId ? { periodId } : {}),
      ...(sourceType && sourceType !== "all" ? { sourceType } : {}),
    },
    include: {
      lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } }, orderBy: { debit: "desc" } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  // q = memo / dibuat oleh — difilter in-memory agar case-insensitive di SQLite.
  const filtered = q
    ? entries.filter((e) => e.memo.toLowerCase().includes(q) || e.createdBy.toLowerCase().includes(q))
    : entries;

  return ok({
    journals: filtered.map((e) => ({
      ...e,
      totalDebit: e.lines.reduce((s, l) => s + l.debit, 0),
      totalCredit: e.lines.reduce((s, l) => s + l.credit, 0),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const date = rawDateOrNull(body.date);
  if (!date) return fail("Tanggal jurnal wajib diisi (format YYYY-MM-DD)");
  const memo = strOrNull(body.memo);
  if (!memo) return fail("Memo jurnal wajib diisi");

  const parsed = parseJournalLines(body.lines);
  if (!parsed.ok) return fail(parsed.error);
  const lines = parsed.lines;
  const accError = await ensureAccountsUsable(lines);
  if (accError) return fail(accError);

  // Periode wajib ada & open utk tanggal entry (TIDAK auto-create — blueprint).
  const period = await checkPeriodForDate(date);
  if (!period.ok) return fail(period.error);

  const postNow = body.postNow === true;
  const sourceType = strOrNull(body.sourceType);
  const sourceId = strOrNull(body.sourceId);

  const entry = await db.journalEntry.create({
    data: {
      date,
      memo: memo.slice(0, 200),
      sourceType: sourceType ? sourceType.slice(0, 40) : "manual",
      sourceId: sourceId ?? null,
      status: postNow ? "posted" : "draft",
      postedAt: postNow ? new Date() : null,
      createdBy: g.actor.name,
      periodId: period.period.id,
      lines: { create: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })) },
    },
    include: {
      lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } },
    },
  });

  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: postNow ? "post" : "create", entity: "journal_entry", entityId: entry.id,
    entityLabel: memo.slice(0, 80),
    field: "status", newValue: entry.status,
    metadata: postNow ? "Jurnal dibuat & langsung diposting" : "Jurnal draft dibuat", req,
  });
  return ok({ journal: entry }, 201);
}
