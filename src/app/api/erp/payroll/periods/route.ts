import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Periode payroll (cutoff 21 → bayar 25, dimajukan ke Jumat bila weekend).
 * GET  : daftar periode (desc by name) + jumlah run.
 * POST : { name "YYYY-MM", startDate, endDate } — hr/director/super_admin.
 *        payDate otomatis = endDate + 4 hari; Sabtu → Jumat, Minggu → Jumat.
 */

const PERIOD_EDITOR = ["hr", "director", "super_admin"];
const PAYROLL_ROLES = ["hr", "finance", "director", "super_admin"];
const NAME_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** payDate = endDate + 4 hari, dimajukan ke Jumat bila jatuh Sabtu/Minggu (blueprint Bab 30). */
function advancePayDate(endDate: Date): Date {
  const d = new Date(endDate.getTime());
  d.setUTCDate(d.getUTCDate() + 4);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); // Sabtu → Jumat
  else if (dow === 0) d.setUTCDate(d.getUTCDate() - 2); // Minggu → Jumat
  return d;
}

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, PAYROLL_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const periods = await db.payrollPeriod.findMany({
    orderBy: { name: "desc" },
    include: { runs: { select: { id: true, status: true, revision: true } } },
  });
  return ok({
    periods: periods.map((p) => ({
      id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate,
      payDate: p.payDate, status: p.status, lockedAt: p.lockedAt, createdAt: p.createdAt,
      runCount: p.runs.length,
      hasActiveRun: p.runs.some((r) => r.status === "draft" || r.status === "calculated"),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, PERIOD_EDITOR);
  if (!gate.ok) return fail(gate.reason, 403);

  const name = String(body.name ?? "").trim();
  if (!NAME_RE.test(name)) {
    return fail("Nama periode harus berformat YYYY-MM (contoh: 2026-11)");
  }
  const startDate = dateOrNull(body.startDate);
  const endDate = dateOrNull(body.endDate);
  if (!startDate || !endDate) return fail("Tanggal mulai & akhir periode wajib diisi");
  if (startDate.getTime() >= endDate.getTime()) {
    return fail("Tanggal mulai harus sebelum tanggal akhir periode");
  }
  const payDate = advancePayDate(endDate);

  try {
    const period = await db.payrollPeriod.create({
      data: { name, startDate, endDate, payDate, status: "open" },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "create", entity: "payroll_period", entityId: period.id, entityLabel: period.name,
      field: "status", newValue: "open",
      metadata: `Periode payroll ${name} · cutoff ${endDate.toISOString().slice(0, 10)} · bayar ${payDate.toISOString().slice(0, 10)}`,
      req,
    });
    return ok({ period }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) return fail(`Periode "${name}" sudah ada`, 409);
    throw err;
  }
}
