import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { HR_ROLES, strOrNull, uniqueMessage, uniqueTargets, nonNegNumOrNull } from "../_utils";

// GET /api/erp/hris/employees?q=&status=
// Field sensitif (bankName, bankAccount) HANYA utk hr/director/super_admin.
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sensitive = assertRole(actor, HR_ROLES).ok;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const status = sp.get("status")?.trim();

  const employees = await db.employee.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { preferredName: { contains: q } },
              { employeeNumber: { contains: q } },
              { position: { contains: q } },
              { department: { contains: q } },
            ],
          }
        : {}),
      ...(status && status !== "all" ? { employmentStatus: status } : {}),
    },
    include: {
      supervisor: { select: { id: true, preferredName: true, employeeNumber: true } },
      user: { select: { id: true, email: true } },
    },
    orderBy: [{ active: "desc" }, { employeeNumber: "asc" }],
    take: 300,
  });

  // Non-privileged: bankName/bankAccount di-undefined → tidak masuk JSON.
  const safe = employees.map((e) =>
    sensitive ? e : { ...e, bankName: undefined, bankAccount: undefined },
  );
  return ok({ employees: safe, canSeeBank: sensitive });
}

// POST /api/erp/hris/employees — hr/director/super_admin
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, HR_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeNumber = strOrNull(body.employeeNumber);
  const preferredName = strOrNull(body.preferredName);
  if (!employeeNumber) return fail("Nomor karyawan wajib diisi");
  if (!preferredName) return fail("Nama karyawan wajib diisi");

  const employmentStatus = strOrNull(body.employmentStatus) ?? "permanent";
  if (!["permanent", "intern", "freelance"].includes(employmentStatus)) {
    return fail("Status kepegawaian tidak valid (permanent/intern/freelance)");
  }

  // supervisorId opsional — harus ada bila dikirim.
  const supervisorId = strOrNull(body.supervisorId);
  if (supervisorId) {
    const sup = await db.employee.findUnique({ where: { id: supervisorId }, select: { id: true } });
    if (!sup) return fail("Atasan (supervisor) tidak ditemukan", 400);
  }
  // userId opsional — link ke User (harus belum terpakai).
  const userId = strOrNull(body.userId);
  if (userId) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) return fail("User tidak ditemukan", 400);
  }

  try {
    const employee = await db.employee.create({
      data: {
        employeeNumber,
        preferredName,
        employmentStatus,
        department: strOrNull(body.department),
        position: strOrNull(body.position),
        supervisorId,
        userId,
        joinedOn: dateOrNull(body.joinedOn),
        internProgram: strOrNull(body.internProgram),
        internStart: dateOrNull(body.internStart),
        internEnd: dateOrNull(body.internEnd),
        stipendDaily: nonNegNumOrNull(body.stipendDaily),
        bankName: strOrNull(body.bankName),
        bankAccount: strOrNull(body.bankAccount),
        umkRegion: strOrNull(body.umkRegion),
        active: body.active === undefined ? true : Boolean(body.active),
      },
      include: {
        supervisor: { select: { id: true, preferredName: true, employeeNumber: true } },
        user: { select: { id: true, email: true } },
      },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "create", entity: "hris_employee", entityId: employee.id,
      entityLabel: `${employee.employeeNumber} — ${employee.preferredName}`, req,
    });
    return ok({ employee });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(uniqueMessage(uniqueTargets(err)), 409);
    throw err;
  }
}
