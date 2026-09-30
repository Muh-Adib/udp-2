import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  MANAGER_PLUS_ROLES, requireSelfEmployee, parseIsoDate, utcDayRange, utcRange, utcToday,
  strOrNull, uniqueTargets,
} from "../_utils";

// GET /api/erp/hris/attendance?date=&employeeId=&mine=1[&from=&to=]
// mine=1 → hanya milik actor (self-service, tanpa cek role khusus);
// tanpa mine → role hr/manager/director/super_admin.
// `date` = satu hari bisnis; `from`+`to` = rentang inklusif (riwayat).
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sp = req.nextUrl.searchParams;
  const mine = sp.get("mine") === "1";
  const employeeIdParam = sp.get("employeeId")?.trim() || null;

  let employeeIdFilter: string | null = null;
  if (mine) {
    const self = await requireSelfEmployee(actor);
    if (!self.ok) return self.res;
    employeeIdFilter = self.employee.id;
  } else {
    const gate = assertRole(actor, MANAGER_PLUS_ROLES);
    if (!gate.ok) return fail(gate.reason, 403);
    employeeIdFilter = employeeIdParam;
  }

  // Rentang waktu: date (1 hari) → from+to (rentang) → default hari ini (UTC).
  const dateParam = parseIsoDate(sp.get("date"));
  const fromParam = parseIsoDate(sp.get("from"));
  const toParam = parseIsoDate(sp.get("to"));
  let range: { start: Date; end: Date };
  if (fromParam && toParam) {
    if (fromParam > toParam) return fail("Tanggal 'from' harus <= 'to'");
    range = utcRange(fromParam, toParam);
  } else if (dateParam) {
    range = utcDayRange(dateParam);
  } else {
    range = utcDayRange(utcToday());
  }

  const events = await db.attendanceEvent.findMany({
    where: {
      businessDate: { gte: range.start, lte: range.end },
      ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}),
    },
    include: {
      employee: {
        select: { id: true, preferredName: true, employeeNumber: true, department: true, position: true, userId: true },
      },
    },
    orderBy: [{ receivedAt: "desc" }],
    take: 500,
  });

  return ok({ events, businessDate: fromParam && toParam ? { from: fromParam, to: toParam } : (dateParam ?? utcToday()) });
}

// POST /api/erp/hris/attendance — self-service check-in / check-out.
// body { kind: "check_in"|"check_out", clientEventId?, lat?, lng?, accuracyM?, note? }
// businessDate = hari ini (UTC); locationVerdict: ada GPS → "matched", tanpa GPS →
// "unknown" + validationStatus "exception". Idempoten via clientEventId.
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const self = await requireSelfEmployee(actor);
  if (!self.ok) return self.res;
  const employee = self.employee;
  if (!employee.active) return fail("Karyawan tidak aktif — hubungi HR", 403);

  const kind = strOrNull(body.kind);
  if (kind !== "check_in" && kind !== "check_out") {
    return fail("kind wajib 'check_in' atau 'check_out'");
  }

  const clientEventId = strOrNull(body.clientEventId);

  // Idempotency: replay klien (offline queue) → kembalikan event existing (200).
  if (clientEventId) {
    const existing = await db.attendanceEvent.findFirst({
      where: { employeeId: employee.id, clientEventId },
    });
    if (existing) return ok({ event: existing, idempotent: true }, 200);
  }

  const lat = numOrNull(body.lat);
  const lng = numOrNull(body.lng);
  const accuracyM = numOrNull(body.accuracyM);
  const hasGps = lat !== null && lng !== null;

  // Verdict sederhana: GPS terkirim = matched (radius check opsional — lokasi kerja
  // berpindah/klien, jadi radius tidak ditegakkan di fase ini).
  const locationVerdict = hasGps ? "matched" : "unknown";
  const validationStatus = hasGps ? "valid" : "exception";

  const businessDate = utcDayRange(utcToday()).start;

  try {
    const event = await db.attendanceEvent.create({
      data: {
        employeeId: employee.id,
        kind,
        businessDate,
        clientEventId,
        claimedAt: body.claimedAt ? new Date(String(body.claimedAt)) : null,
        receivedAt: new Date(),
        lat,
        lng,
        accuracyM,
        locationVerdict,
        validationStatus,
        note: strOrNull(body.note),
      },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: kind, entity: "hris_attendance", entityId: event.id,
      entityLabel: `${employee.employeeNumber} — ${kind}`,
      metadata: `verdict=${locationVerdict};status=${validationStatus}`,
      req,
    });
    return ok({ event });
  } catch (err) {
    // Duel replay bersamaan → unique [employeeId, clientEventId] → kembalikan existing.
    if (isUniqueViolation(err) && clientEventId) {
      const existing = await db.attendanceEvent.findFirst({
        where: { employeeId: employee.id, clientEventId },
      });
      if (existing) return ok({ event: existing, idempotent: true }, 200);
      return fail(uniqueTargets(err).join(",") || "Event duplikat", 409);
    }
    throw err;
  }
}
