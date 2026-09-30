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

// GET /api/erp/hris/overtime?status=&mine=1
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sp = req.nextUrl.searchParams;
  const mine = sp.get("mine") === "1";
  const status = sp.get("status")?.trim();

  let employeeIdFilter: string | null = null;
  if (mine) {
    const self = await requireSelfEmployee(actor);
    if (!self.ok) return self.res;
    employeeIdFilter = self.employee.id;
  } else {
    const gate = assertRole(actor, MANAGER_PLUS_ROLES);
    if (!gate.ok) return fail(gate.reason, 403);
  }

  const requests = await db.overtimeRequest.findMany({
    where: {
      ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}),
      ...(status && status !== "all" ? { status } : {}),
    },
    include: { employee: EMP_SELECT },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return ok({ requests });
}

// POST /api/erp/hris/overtime — self (atau manager+ mengajukan utk bawahan).
// consent HANYA boleh true jika pengaju = karyawan itu sendiri.
// endMinute > 1440 (lintas tengah malam) diperbolehkan; complianceFlag otomatis bila
// endMinute > 1440 atau durasi > 240 menit.
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  // Target karyawan: default diri sendiri; manager+ boleh mengajukan utk orang lain.
  const targetParam = strOrNull(body.employeeId);
  let employee;
  if (targetParam) {
    const gate = assertRole(actor, MANAGER_PLUS_ROLES);
    if (!gate.ok) return fail(gate.reason, 403);
    const found = await db.employee.findUnique({ where: { id: targetParam } });
    if (!found) return fail("Karyawan tidak ditemukan", 404);
    employee = found;
  } else {
    const self = await requireSelfEmployee(actor);
    if (!self.ok) return self.res;
    employee = self.employee;
  }
  if (!employee.active) return fail("Karyawan tidak aktif — hubungi HR", 403);

  const isSelfFiling = !!actor.id && employee.userId === actor.id;

  const dateStr = parseIsoDate(body.date);
  if (!dateStr) return fail("Tanggal lembur wajib diisi (format YYYY-MM-DD)");

  const startMinute = numOrNull(body.startMinute);
  const endMinute = numOrNull(body.endMinute);
  if (startMinute === null || !Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1439) {
    return fail("Jam mulai tidak valid (menit 0–1439)");
  }
  if (endMinute === null || !Number.isInteger(endMinute) || endMinute <= startMinute || endMinute > 2880) {
    return fail("Jam selesai harus lebih besar dari jam mulai (maks. 48:00 / lintas tengah malam)");
  }

  const reason = strOrNull(body.reason);
  if (!reason) return fail("Alasan lembur wajib diisi");

  // Consent milik staf — atasan TIDAK boleh memberi consent atas nama staf.
  const consent = isSelfFiling ? Boolean(body.consent) : false;

  const duration = endMinute - startMinute;
  const complianceFlag =
    endMinute > 1440 || duration > 240
      ? "perlu review HR: lewati batas harian"
      : null;

  const request = await db.overtimeRequest.create({
    data: {
      employeeId: employee.id,
      date: utcDayRange(dateStr).start,
      startMinute,
      endMinute,
      reason,
      taskRef: strOrNull(body.taskRef),
      consent,
      requestedBy: actor.name,
      status: "pending",
      complianceFlag,
    },
    include: { employee: EMP_SELECT },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "hris_overtime", entityId: request.id,
    entityLabel: `Lembur — ${employee.preferredName} (${dateStr})`,
    newValue: `${startMinute}-${endMinute} min`,
    metadata: consent ? "consent=ya" : "consent=tidak", req,
  });
  return ok({ request });
}
