import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, checkPeriodForDate, FINANCE_WRITE_ROLES } from "../../../_lib";

/**
 * FASE 7 — Koreksi via jurnal pembalik (aturan #2 blueprint):
 * - HANYA jurnal posted yang bisa dibalik (draft cukup diedit).
 * - Entry baru: salin semua lines dgn debit<->credit ditukar, memo
 *   "Pembalik dari JE-{id}", sourceType sama, status LANGSUNG posted.
 * - Entry asli TIDAK berubah (posted immutable tetap terjaga).
 * Role: finance/director. Tanggal pembalik = hari ini (periode wajib open).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const entry = await db.journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!entry) return fail("Jurnal tidak ditemukan", 404);
  if (entry.status !== "posted") {
    return fail("Hanya jurnal berstatus posted yang bisa dibalik — jurnal draft cukup diedit");
  }
  if (entry.lines.length === 0) return fail("Jurnal tidak memiliki baris untuk dibalik");

  const now = new Date();
  const period = await checkPeriodForDate(now);
  if (!period.ok) return fail(period.error);

  const reversed = await db.journalEntry.create({
    data: {
      date: now,
      memo: `Pembalik dari JE-${entry.id}`.slice(0, 200),
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      status: "posted",
      postedAt: now,
      createdBy: g.actor.name,
      periodId: period.period.id,
      lines: {
        create: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
      },
    },
    include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } } },
  });

  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: "reverse", entity: "journal_entry", entityId: reversed.id,
    entityLabel: reversed.memo.slice(0, 80),
    field: "reversalOf", newValue: entry.id,
    metadata: `Jurnal pembalik dari "${entry.memo.slice(0, 60)}" (${entry.date.toISOString().slice(0, 10)})`, req,
  });
  return ok({ journal: reversed }, 201);
}
