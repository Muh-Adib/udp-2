import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, checkPeriodForDate, parseJournalLines, ensureAccountsUsable, FINANCE_WRITE_ROLES, strOrNull, rawDateOrNull } from "../../_lib";

/**
 * FASE 7 — Edit jurnal HANYA saat draft (aturan #1: POSTED immutable).
 * PATCH {memo?, date?, lines?} — finance/director.
 * Posting ditolak dgn pesan: "Jurnal sudah diposting — buat jurnal pembalik".
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const entry = await db.journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!entry) return fail("Jurnal tidak ditemukan", 404);
  if (entry.status === "posted") {
    return fail("Jurnal sudah diposting — buat jurnal pembalik");
  }

  // Validasi tanggal baru (bila dikirim) — periode tujuan wajib open.
  let date = entry.date;
  let newPeriodId: string | null = null;
  if ("date" in body) {
    const d = rawDateOrNull(body.date);
    if (!d) return fail("Tanggal jurnal tidak valid");
    const period = await checkPeriodForDate(d);
    if (!period.ok) return fail(period.error);
    date = d;
    newPeriodId = period.period.id;
  }

  // Validasi memo baru (bila dikirim).
  let memo = entry.memo;
  if ("memo" in body) {
    const m = strOrNull(body.memo);
    if (!m) return fail("Memo jurnal wajib diisi");
    memo = m.slice(0, 200);
  }

  // Baris diganti seluruhnya bila `lines` dikirim (replace, bukan merge).
  const replaceLines = "lines" in body ? parseJournalLines(body.lines) : null;
  if (replaceLines && !replaceLines.ok) return fail(replaceLines.error);
  const newLines = replaceLines?.lines ?? null;
  if (newLines) {
    const accError = await ensureAccountsUsable(newLines);
    if (accError) return fail(accError);
  }

  const updated = await db.$transaction(async (tx) => {
    if (newLines) {
      await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
      await tx.journalLine.createMany({
        data: newLines.map((l) => ({ entryId: entry.id, accountId: l.accountId, debit: l.debit, credit: l.credit })),
      });
    }
    return tx.journalEntry.update({
      where: { id: entry.id },
      data: { memo, date, ...(newPeriodId !== null ? { periodId: newPeriodId } : {}) },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } } },
    });
  });

  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: "update", entity: "journal_entry", entityId: entry.id, entityLabel: memo.slice(0, 80),
    field: ["memo", "date", "lines"].filter((f) => f in body).join(", "),
    metadata: "Jurnal draft diedit", req,
  });
  return ok({ journal: updated });
}
