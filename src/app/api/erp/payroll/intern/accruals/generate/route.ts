import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Generate akumulasi uang saku magang dari absensi.
 * POST { employeeId, month "YYYY-MM" } (hr/finance/director/super_admin):
 * scan AttendanceEvent check_in validationStatus="valid" dalam bulan → buat
 * InternAccrual per tanggal (rate = stipendDaily, fraction 1, amount = rate,
 * status "verified") yang BELUM ada (upsert-skip by unique employee+businessDate).
 */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeId = String(body.employeeId ?? "");
  const month = String(body.month ?? "").trim();
  if (!employeeId) return fail("employeeId wajib diisi");
  if (!MONTH_RE.test(month)) return fail("Format bulan harus YYYY-MM (contoh: 2026-10)");

  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);
  if (employee.employmentStatus !== "intern") {
    return fail(`${employee.preferredName} bukan karyawan magang (status: ${employee.employmentStatus})`, 400);
  }
  const rate = employee.stipendDaily ?? 0;
  if (rate <= 0) return fail(`Stipend harian ${employee.preferredName} belum diatur`, 400);

  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  const events = await db.attendanceEvent.findMany({
    where: {
      employeeId,
      kind: "check_in",
      validationStatus: "valid",
      businessDate: { gte: start, lt: end },
    },
    orderBy: { businessDate: "asc" },
  });
  // Satu baris accrual per tanggal bisnis (check_in bisa tercatat ganda).
  const dates = [...new Set(events.map((e) => e.businessDate.toISOString().slice(0, 10)))];
  if (dates.length === 0) {
    return fail(`Tidak ada absensi check-in valid untuk ${employee.preferredName} pada ${month}`, 409);
  }

  const existing = await db.internAccrual.findMany({
    where: { employeeId, businessDate: { gte: start, lt: end } },
    select: { businessDate: true },
  });
  const existingKeys = new Set(existing.map((e) => e.businessDate.toISOString().slice(0, 10)));
  const toCreate = dates.filter((d) => !existingKeys.has(d));

  const created = await db.$transaction(async (tx) => {
    const rows: { id: string; businessDate: Date; amount: number }[] = [];
    for (const d of toCreate) {
      const row = await tx.internAccrual.upsert({
        where: { employeeId_businessDate: { employeeId, businessDate: new Date(`${d}T00:00:00.000Z`) } },
        create: {
          employeeId,
          businessDate: new Date(`${d}T00:00:00.000Z`),
          rate,
          fraction: 1,
          amount: rate,
          status: "verified",
          sourceRef: "attendance",
        },
        update: {}, // sudah ada → skip (idempoten)
      });
      rows.push({ id: row.id, businessDate: row.businessDate, amount: row.amount });
    }
    return rows;
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "intern_accrual", entityId: employeeId,
    entityLabel: `${employee.employeeNumber} · ${employee.preferredName}`,
    field: "month", newValue: month,
    metadata: `Generate dari absensi: ${created.length} hari baru (${dates.length - created.length} sudah ada) · Rp ${(created.length * rate).toLocaleString("id-ID")}`,
    req,
  });
  return ok({ createdCount: created.length, skipped: dates.length - created.length, rate, dates: created }, 201);
}
