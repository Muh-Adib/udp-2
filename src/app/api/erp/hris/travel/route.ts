import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull, dateOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { MANAGER_PLUS_ROLES, requireSelfEmployee, strOrNull } from "../_utils";

const EMP_SELECT = {
  select: {
    id: true, preferredName: true, employeeNumber: true,
    department: true, position: true, userId: true, supervisorId: true,
  },
} as const;

// GET /api/erp/hris/travel?status=&mine=1
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

  const orders = await db.travelOrder.findMany({
    where: {
      ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}),
      ...(status && status !== "all" ? { status } : {}),
    },
    include: { employee: EMP_SELECT },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return ok({ orders });
}

// POST /api/erp/hris/travel — self, status awal "draft".
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const self = await requireSelfEmployee(actor);
  if (!self.ok) return self.res;
  if (!self.employee.active) return fail("Karyawan tidak aktif — hubungi HR", 403);

  const purpose = strOrNull(body.purpose);
  if (!purpose) return fail("Keperluan dinas wajib diisi");
  const destination = strOrNull(body.destination);
  if (!destination) return fail("Kota/tujuan wajib diisi");

  const departDate = dateOrNull(body.departDate);
  const returnDate = dateOrNull(body.returnDate);
  if (!departDate) return fail("Tanggal berangkat wajib diisi (format YYYY-MM-DD)");
  if (!returnDate) return fail("Tanggal kembali wajib diisi (format YYYY-MM-DD)");
  if (returnDate.getTime() < departDate.getTime()) {
    return fail("Tanggal kembali harus >= tanggal berangkat");
  }

  const advanceAmount = numOrNull(body.advanceAmount) ?? 0;
  const allowanceDaily = numOrNull(body.allowanceDaily) ?? 0;
  if (advanceAmount < 0 || allowanceDaily < 0) {
    return fail("Nominal advance/allowance tidak boleh negatif");
  }

  const order = await db.travelOrder.create({
    data: {
      employeeId: self.employee.id,
      purpose,
      projectRef: strOrNull(body.projectRef),
      destination,
      departDate,
      returnDate,
      advanceAmount,
      allowanceDaily,
      status: "draft",
      settlementStatus: "none",
    },
    include: { employee: EMP_SELECT },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "hris_travel", entityId: order.id,
    entityLabel: `Dinas ${destination} — ${self.employee.preferredName}`,
    metadata: `advance=${advanceAmount}`, req,
  });
  return ok({ order });
}
