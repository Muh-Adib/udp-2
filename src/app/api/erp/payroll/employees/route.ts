import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Daftar ringkas karyawan utk picker modul payroll/poin/insentif/magang.
 * Field sensitif (bank/UMK region) TIDAK disertakan. Role: hr/finance/director/super_admin.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const employees = await db.employee.findMany({
    orderBy: { employeeNumber: "asc" },
    select: {
      id: true, employeeNumber: true, preferredName: true, employmentStatus: true,
      department: true, position: true, active: true, leftOn: true,
      internProgram: true, stipendDaily: true, umkRegion: true,
    },
  });
  return ok({ employees });
}
