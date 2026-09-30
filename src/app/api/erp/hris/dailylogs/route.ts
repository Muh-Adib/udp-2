import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  MANAGER_PLUS_ROLES, requireSelfEmployee, strOrNull, parseIsoDate, utcDayRange,
} from "../_utils";

const EMP_SELECT = {
  select: {
    id: true, preferredName: true, employeeNumber: true,
    department: true, position: true, userId: true, supervisorId: true,
  },
} as const;

// GET /api/erp/hris/dailylogs?date=&projectId=&mine=1
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sp = req.nextUrl.searchParams;
  const mine = sp.get("mine") === "1";
  const dateParam = parseIsoDate(sp.get("date"));
  const projectId = strOrNull(sp.get("projectId"));

  let employeeIdFilter: string | null = null;
  if (mine) {
    const self = await requireSelfEmployee(actor);
    if (!self.ok) return self.res;
    employeeIdFilter = self.employee.id;
  } else {
    const gate = assertRole(actor, MANAGER_PLUS_ROLES);
    if (!gate.ok) return fail(gate.reason, 403);
  }

  const logs = await db.dailyLog.findMany({
    where: {
      ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}),
      ...(projectId ? { projectId } : {}),
      ...(dateParam ? { date: utcDayRange(dateParam).start } : {}),
    },
    include: { employee: EMP_SELECT },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return ok({ logs });
}

// POST /api/erp/hris/dailylogs — self; date & content wajib; hours 0–24.
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const self = await requireSelfEmployee(actor);
  if (!self.ok) return self.res;
  if (!self.employee.active) return fail("Karyawan tidak aktif — hubungi HR", 403);

  const dateStr = parseIsoDate(body.date);
  if (!dateStr) return fail("Tanggal wajib diisi (format YYYY-MM-DD)");
  const content = strOrNull(body.content);
  if (!content) return fail("Isi pekerjaan wajib diisi");
  const hours = numOrNull(body.hours) ?? 0;
  if (hours < 0 || hours > 24) return fail("Jam kerja harus di rentang 0–24");

  const projectId = strOrNull(body.projectId);

  const log = await db.dailyLog.create({
    data: {
      employeeId: self.employee.id,
      date: utcDayRange(dateStr).start,
      projectId,
      content,
      hours,
    },
    include: { employee: EMP_SELECT },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "hris_dailylog", entityId: log.id,
    entityLabel: `Log ${dateStr} — ${self.employee.preferredName}`,
    metadata: `${hours} jam`, req,
  });
  return ok({ log });
}
