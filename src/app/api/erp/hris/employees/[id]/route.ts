import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { HR_ROLES, strOrNull, uniqueMessage, uniqueTargets, nonNegNumOrNull } from "../../_utils";

// PATCH /api/erp/hris/employees/[id] — hr/director/super_admin
// Update field yang dikirim; active=false = offboarding (leftOn diisi bila kosong).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, HR_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const current = await db.employee.findUnique({ where: { id } });
  if (!current) return fail("Karyawan tidak ditemukan", 404);

  const data: Record<string, unknown> = {};
  if ("employeeNumber" in body) {
    const v = strOrNull(body.employeeNumber);
    if (!v) return fail("Nomor karyawan tidak boleh kosong");
    data.employeeNumber = v;
  }
  if ("preferredName" in body) {
    const v = strOrNull(body.preferredName);
    if (!v) return fail("Nama karyawan tidak boleh kosong");
    data.preferredName = v;
  }
  if ("employmentStatus" in body) {
    const v = strOrNull(body.employmentStatus);
    if (!v || !["permanent", "intern", "freelance"].includes(v)) {
      return fail("Status kepegawaian tidak valid (permanent/intern/freelance)");
    }
    data.employmentStatus = v;
  }
  if ("department" in body) data.department = strOrNull(body.department);
  if ("position" in body) data.position = strOrNull(body.position);
  if ("umkRegion" in body) data.umkRegion = strOrNull(body.umkRegion);
  if ("bankName" in body) data.bankName = strOrNull(body.bankName);
  if ("bankAccount" in body) data.bankAccount = strOrNull(body.bankAccount);
  if ("internProgram" in body) data.internProgram = strOrNull(body.internProgram);
  if ("internStart" in body) data.internStart = dateOrNull(body.internStart);
  if ("internEnd" in body) data.internEnd = dateOrNull(body.internEnd);
  if ("stipendDaily" in body) data.stipendDaily = nonNegNumOrNull(body.stipendDaily);
  if ("joinedOn" in body) data.joinedOn = dateOrNull(body.joinedOn);

  if ("supervisorId" in body) {
    const supId = strOrNull(body.supervisorId);
    if (supId) {
      if (supId === id) return fail("Karyawan tidak bisa menjadi atasannya sendiri", 400);
      const sup = await db.employee.findUnique({ where: { id: supId }, select: { id: true } });
      if (!sup) return fail("Atasan (supervisor) tidak ditemukan", 400);
    }
    data.supervisorId = supId;
  }
  if ("userId" in body) {
    const uid = strOrNull(body.userId);
    if (uid) {
      const u = await db.user.findUnique({ where: { id: uid }, select: { id: true } });
      if (!u) return fail("User tidak ditemukan", 400);
    }
    data.userId = uid;
  }

  // Offboarding: active=false → isi leftOn bila masih kosong; aktifkan kembali → kosongkan.
  if ("active" in body) {
    const active = Boolean(body.active);
    data.active = active;
    if (!active && !current.leftOn) data.leftOn = new Date();
    if (active) data.leftOn = null;
  }

  try {
    const employee = await db.employee.update({
      where: { id },
      data,
      include: {
        supervisor: { select: { id: true, preferredName: true, employeeNumber: true } },
        user: { select: { id: true, email: true } },
      },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "active" in body && body.active === false ? "offboard" : "update",
      entity: "hris_employee", entityId: employee.id,
      entityLabel: `${employee.employeeNumber} — ${employee.preferredName}`,
      field: Object.keys(data).join(",") || null,
      oldValue: current.active, newValue: employee.active,
      req,
    });
    return ok({ employee });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(uniqueMessage(uniqueTargets(err)), 409);
    throw err;
  }
}
