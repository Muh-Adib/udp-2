import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, checkPeriodForDate, FINANCE_WRITE_ROLES } from "../../../_lib";

/**
 * FASE 7 — Posting jurnal draft (aturan #1): status posted + postedAt,
 * periode pembukuan utk tanggal entry wajib open — bila tidak ada →
 * 400 "Periode pembukuan belum dibuat"; bila ditutup → 400.
 * Jurnal posted immutable — PATCH akan menolak setelah titik ini.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const entry = await db.journalEntry.findUnique({ where: { id }, include: { lines: true } });
  if (!entry) return fail("Jurnal tidak ditemukan", 404);
  if (entry.status === "posted") {
    return fail("Jurnal sudah diposting — buat jurnal pembalik");
  }

  const period = await checkPeriodForDate(entry.date);
  if (!period.ok) return fail(period.error);

  const posted = await db.journalEntry.update({
    where: { id: entry.id },
    data: { status: "posted", postedAt: new Date(), periodId: period.period.id },
    include: { lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } } },
  });

  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: "post", entity: "journal_entry", entityId: entry.id, entityLabel: entry.memo.slice(0, 80),
    field: "status", oldValue: "draft", newValue: "posted",
    metadata: `Periode ${period.period.name}`, req,
  });
  return ok({ journal: posted });
}
