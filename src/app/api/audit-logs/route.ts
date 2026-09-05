import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, pageLimit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

export async function GET(req: NextRequest) {
  // Ronde 36 (audit): audit log memuat jejak aktifitas internal (termasuk
  // percobaan login gagal) — kini wajib sesi + peran Super Admin/Direktur
  // (mirror matriks modul Audit di UI).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const { searchParams } = new URL(req.url);
  const limit = pageLimit(searchParams.get("limit"), 100, 300); // FIX r26: limit=abc dulu → take NaN → 500
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");

  const logs = await db.auditLog.findMany({
    where: {
      ...(entity && entity !== "all" ? { entity } : {}),
      ...(action && action !== "all" ? { action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return ok({ logs });
}
