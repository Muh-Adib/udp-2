import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, periodRange, PERIOD_CLOSE_ROLES } from "../../../_lib";

/**
 * FASE 7 — Tutup buku periode (aturan #5 blueprint):
 * - Role director/super_admin (finance tidak berhak menutup).
 * - DITOLAK (400) bila masih ada jurnal DRAFT dengan tanggal dalam periode —
 *   pesan menyebut jumlahnya agar tahu berapa yang harus diselesaikan.
 * - Sukses: status closed + closedAt + closedBy. Posting berikutnya dgn tanggal
 *   dalam periode ini akan ditolak oleh checkPeriodForDate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await gate(req, PERIOD_CLOSE_ROLES, body);
  if (g.res) return g.res;

  const period = await db.accountingPeriod.findUnique({ where: { id } });
  if (!period) return fail("Periode tidak ditemukan", 404);
  if (period.status !== "open") return fail(`Periode ${period.name} sudah ditutup pada ${period.closedAt?.toISOString().slice(0, 10) ?? "-"}`);

  const range = periodRange(period.name);
  const draftCount = await db.journalEntry.count({
    where: range ? { status: "draft", date: { gte: range.start, lt: range.end } } : { status: "draft", periodId: period.id },
  });
  if (draftCount > 0) {
    return fail(`Tidak bisa menutup periode ${period.name} — masih ada ${draftCount} jurnal draft dengan tanggal dalam periode ini. Posting atau perbaiki dulu.`);
  }

  const closed = await db.accountingPeriod.update({
    where: { id: period.id },
    data: { status: "closed", closedAt: new Date(), closedBy: g.actor.name },
  });

  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: "close", entity: "accounting_period", entityId: closed.id, entityLabel: closed.name,
    field: "status", oldValue: "open", newValue: "closed",
    metadata: "Tutup buku — posting ke periode ini kini ditolak", req,
  });
  return ok({ period: closed });
}
