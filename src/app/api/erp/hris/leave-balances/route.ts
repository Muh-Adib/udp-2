import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { HR_ROLES, MANAGER_PLUS_ROLES, roleIn, selfEmployee, strOrNull } from "../_utils";

// ============ Kuota Cuti Tahunan (LeaveBalanceLedger) ============
// GET  ?year=YYYY (default tahun UTC sekarang) & ?employeeId= (filter, manager+)
//   - manager+ (hr/manager/director/super_admin) → semua karyawan aktif
//   - role lain → OTOMATIS scope self (tanpa 403) agar UI staf tetap hidup
//   - usedDays = hari kerja Sen–Jum (di luar HolidayCalendar tahun tsb) dari
//     LeaveRequest type "cuti" status "approved" yang beririsan dengan tahun tsb
// POST (hr/director/super_admin saja) upsert @@unique([employeeId, year])

const DEFAULT_QUOTA_DAYS = 12;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

type BalanceEmployee = {
  id: string;
  employeeNumber: string;
  preferredName: string;
  employmentStatus: string;
  department: string | null;
};

/** Rentang UTC satu tahun kalender (1 Jan 00:00 – 31 Des 23:59:59.999). */
function yearRangeUtc(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  };
}

/** Hari kerja Sen–Jum dalam [from, to] (UTC, inklusif) yang bukan hari libur. */
function countBusinessDays(from: Date, to: Date, holidays: Set<string>): number {
  let count = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const endMs = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= endMs) {
    const dow = cursor.getUTCDay(); // 0 = Minggu, 6 = Sabtu
    if (dow !== 0 && dow !== 6 && !holidays.has(cursor.toISOString().slice(0, 10))) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function parseYear(v: unknown): number | null {
  const n = numOrNull(v);
  if (n === null || !Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) return null;
  return n;
}

// GET /api/erp/hris/leave-balances?year=&employeeId=
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sp = req.nextUrl.searchParams;
  const yearRaw = sp.get("year");
  const year = yearRaw !== null ? parseYear(yearRaw) : new Date().getUTCFullYear();
  if (year === null) return fail(`Tahun tidak valid — gunakan angka ${MIN_YEAR}–${MAX_YEAR}`);
  const employeeIdParam = sp.get("employeeId")?.trim() || null;

  // Scope akses: manager+ → semua karyawan aktif; role lain → self (auto-scope).
  let emps: BalanceEmployee[];
  if (roleIn(actor.role, MANAGER_PLUS_ROLES)) {
    emps = await db.employee.findMany({
      where: { active: true },
      select: {
        id: true, employeeNumber: true, preferredName: true,
        employmentStatus: true, department: true,
      },
      orderBy: { preferredName: "asc" },
    });
    if (employeeIdParam) emps = emps.filter((e) => e.id === employeeIdParam);
  } else {
    const self = await selfEmployee(actor);
    if (!self) return fail("Profil karyawan tidak ditemukan", 404);
    emps = [{
      id: self.id, employeeNumber: self.employeeNumber,
      preferredName: self.preferredName, employmentStatus: self.employmentStatus,
      department: self.department,
    }];
  }
  if (emps.length === 0) return ok({ year, balances: [] });
  const scopeIds = emps.map((e) => e.id);

  const { start, end } = yearRangeUtc(year);
  const [ledgers, cutiLeaves, holidays] = await Promise.all([
    db.leaveBalanceLedger.findMany({ where: { year, employeeId: { in: scopeIds } } }),
    db.leaveRequest.findMany({
      where: {
        type: "cuti",
        status: "approved",
        employeeId: { in: scopeIds },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
    db.holidayCalendar.findMany({
      where: { date: { gte: start, lte: end } },
      select: { date: true },
    }),
  ]);

  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  const ledgerMap = new Map(ledgers.map((l) => [l.employeeId, l]));

  const usedMap = new Map<string, number>();
  for (const lv of cutiLeaves) {
    // Hanya bagian rentang cuti yang jatuh pada tahun yang diminta.
    const from = lv.startDate > start ? lv.startDate : start;
    const to = lv.endDate < end ? lv.endDate : end;
    if (from > to) continue;
    const days = countBusinessDays(from, to, holidaySet);
    if (days > 0) usedMap.set(lv.employeeId, (usedMap.get(lv.employeeId) ?? 0) + days);
  }

  const balances = emps.map((e) => {
    const ledger = ledgerMap.get(e.id) ?? null;
    const quotaDays = ledger?.quotaDays ?? DEFAULT_QUOTA_DAYS;
    const carriedDays = ledger?.carriedDays ?? 0;
    const usedDays = usedMap.get(e.id) ?? 0;
    return {
      id: ledger?.id ?? null,
      employeeId: e.id,
      employeeNumber: e.employeeNumber,
      preferredName: e.preferredName,
      employmentStatus: e.employmentStatus,
      department: e.department,
      quotaDays,
      carriedDays,
      usedDays,
      remaining: quotaDays + carriedDays - usedDays,
    };
  });
  return ok({ year, balances });
}

// POST /api/erp/hris/leave-balances — upsert kuota per karyawan per tahun.
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const gate = assertRole(actor, HR_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeId = strOrNull(body.employeeId);
  if (!employeeId) return fail("employeeId wajib diisi");

  const year = parseYear(body.year);
  if (year === null) return fail(`Tahun wajib angka ${MIN_YEAR}–${MAX_YEAR}`);

  const quotaDays = numOrNull(body.quotaDays);
  if (quotaDays === null || quotaDays < 0 || quotaDays > 365) {
    return fail("Kuota cuti wajib angka 0–365");
  }
  const carriedDays = numOrNull(body.carriedDays);
  if (carriedDays === null || carriedDays < 0 || carriedDays > 365) {
    return fail("Bawaan tahun lalu wajib angka 0–365");
  }

  // note: undefined = tidak dikirim → pertahankan nilai lama (upsert);
  // null / "" → bersihkan; string → set.
  const note: string | null | undefined = body.note === undefined ? undefined : strOrNull(body.note);

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNumber: true, preferredName: true, active: true },
  });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);
  if (!employee.active) return fail("Karyawan tidak aktif — kuota hanya untuk karyawan aktif", 400);

  const existing = await db.leaveBalanceLedger.findUnique({
    where: { employeeId_year: { employeeId, year } },
    select: { id: true, quotaDays: true, carriedDays: true },
  });

  const balance = await db.leaveBalanceLedger.upsert({
    where: { employeeId_year: { employeeId, year } },
    create: { employeeId, year, quotaDays, carriedDays, note: note ?? null },
    update: { quotaDays, carriedDays, ...(note !== undefined ? { note } : {}) },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "upsert", entity: "hris_leave_balance", entityId: balance.id,
    entityLabel: `${employee.employeeNumber} — ${employee.preferredName} (${year})`,
    oldValue: existing ? `kuota=${existing.quotaDays} bawaan=${existing.carriedDays}` : null,
    newValue: `kuota=${quotaDays} bawaan=${carriedDays}`,
    metadata: note ?? undefined, req,
  });
  return ok({ balance });
}
