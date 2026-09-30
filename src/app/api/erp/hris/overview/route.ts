import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { utcToday, utcDayRange, isoDay } from "../_utils";

type StatusKehadiran = "hadir" | "izin" | "belum" | "exception";

// GET /api/erp/hris/overview?month=YYYY-MM
// Kartu ringkasan atas modul HRIS: statistik hari ini + status kehadiran per karyawan.
// presentToday = ada check_in valid (bukan exception) hari ini;
// onLeaveToday = leave approved yang mencakup hari ini.
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sp = req.nextUrl.searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") ?? "") ? sp.get("month") : null;

  const today = utcToday();
  const { start, end } = utcDayRange(today);

  const [employees, eventsToday, leavesToday, pendingLeaves, pendingOvertimes, activeTravels] =
    await Promise.all([
      db.employee.findMany({
        where: { active: true },
        select: {
          id: true, preferredName: true, employeeNumber: true,
          department: true, position: true, userId: true,
        },
        orderBy: { preferredName: "asc" },
      }),
      db.attendanceEvent.findMany({
        where: { businessDate: { gte: start, lte: end } },
        select: {
          employeeId: true, kind: true, validationStatus: true, receivedAt: true,
          locationVerdict: true,
        },
        orderBy: { receivedAt: "asc" },
      }),
      db.leaveRequest.findMany({
        where: {
          status: "approved",
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { employeeId: true, type: true },
      }),
      db.leaveRequest.count({ where: { status: "pending" } }),
      db.overtimeRequest.count({ where: { status: "pending" } }),
      db.travelOrder.count({ where: { status: { in: ["approved", "ongoing", "settlement_pending"] } } }),
    ]);

  // Kumpulkan event per karyawan (check_in terawal, check_out terakhir).
  const byEmployee = new Map<
    string,
    { checkInAt: Date | null; checkOutAt: Date | null; exception: boolean }
  >();
  let exceptionsToday = 0;
  for (const ev of eventsToday) {
    if (ev.validationStatus === "exception") exceptionsToday += 1;
    const cur =
      byEmployee.get(ev.employeeId) ?? { checkInAt: null, checkOutAt: null, exception: false };
    if (ev.kind === "check_in" && (cur.checkInAt === null || ev.receivedAt < cur.checkInAt)) {
      cur.checkInAt = ev.receivedAt;
      if (ev.validationStatus === "exception") cur.exception = true;
    }
    if (ev.kind === "check_out" && (cur.checkOutAt === null || ev.receivedAt > cur.checkOutAt)) {
      cur.checkOutAt = ev.receivedAt;
    }
    byEmployee.set(ev.employeeId, cur);
  }

  const leaveByEmployee = new Map<string, string>();
  for (const l of leavesToday) leaveByEmployee.set(l.employeeId, l.type);

  let presentToday = 0;
  let onLeaveToday = 0;
  let exceptionEmployees = 0;
  let belumCheckIn = 0;

  const todayAttendance = employees.map((e) => {
    const ev = byEmployee.get(e.id);
    const leaveType = leaveByEmployee.get(e.id);
    let status: StatusKehadiran = "belum";
    if (ev && ev.checkInAt) {
      status = ev.exception ? "exception" : "hadir";
    } else if (leaveType) {
      status = "izin";
    }
    if (status === "hadir") presentToday += 1;
    else if (status === "izin") onLeaveToday += 1;
    else if (status === "exception") exceptionEmployees += 1;
    else belumCheckIn += 1;

    return {
      employeeId: e.id,
      employeeNumber: e.employeeNumber,
      preferredName: e.preferredName,
      department: e.department,
      position: e.position,
      userId: e.userId,
      status,
      leaveType: status === "izin" ? leaveType ?? null : null,
      checkInAt: ev?.checkInAt ? ev.checkInAt.toISOString() : null,
      checkOutAt: ev?.checkOutAt ? ev.checkOutAt.toISOString() : null,
    };
  });

  return ok({
    businessDate: today,
    month,
    stats: {
      totalEmployees: employees.length,
      presentToday,
      onLeaveToday,
      belumCheckIn,
      exceptionsToday: exceptionEmployees || exceptionsToday,
      pendingLeaves,
      pendingOvertimes,
      activeTravels,
    },
    todayAttendance,
    serverDay: isoDay(new Date()),
  });
}
