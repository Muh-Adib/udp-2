import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { MANAGER_PLUS_ROLES, requireSelfEmployee, strOrNull } from "../_utils";

const LEAVE_TYPES = ["izin", "sakit", "cuti", "koreksi"];

const EMP_SELECT = {
  select: {
    id: true, preferredName: true, employeeNumber: true,
    department: true, position: true, userId: true, supervisorId: true,
  },
} as const;

// GET /api/erp/hris/leave?status=&mine=1
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

  const requests = await db.leaveRequest.findMany({
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

// POST /api/erp/hris/leave — self: buat pengajuan izin/sakit/cuti/koreksi.
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const self = await requireSelfEmployee(actor);
  if (!self.ok) return self.res;
  if (!self.employee.active) return fail("Karyawan tidak aktif — hubungi HR", 403);

  const type = strOrNull(body.type);
  if (!type || !LEAVE_TYPES.includes(type)) {
    return fail("Jenis pengajuan wajib salah dari: izin/sakit/cuti/koreksi");
  }
  const startStr = strOrNull(body.startDate);
  const endStr = strOrNull(body.endDate);
  const start = dateOrNull(startStr);
  const end = dateOrNull(endStr);
  if (!start) return fail("Tanggal mulai wajib diisi (format YYYY-MM-DD)");
  if (!end) return fail("Tanggal selesai wajib diisi (format YYYY-MM-DD)");
  if (start.getTime() > end.getTime()) return fail("Tanggal mulai harus <= tanggal selesai");

  const reason = strOrNull(body.reason);
  if (!reason) return fail("Alasan wajib diisi");

  const evidenceUrl = strOrNull(body.evidenceUrl);
  if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) {
    return fail("URL bukti harus dimulai http:// atau https://");
  }

  const request = await db.leaveRequest.create({
    data: {
      employeeId: self.employee.id,
      type,
      startDate: start,
      endDate: end,
      reason,
      evidenceUrl,
      status: "pending",
    },
    include: { employee: EMP_SELECT },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "hris_leave", entityId: request.id,
    entityLabel: `${type} — ${self.employee.preferredName}`,
    metadata: `${startStr} s/d ${endStr}`, req,
  });
  return ok({ request });
}
