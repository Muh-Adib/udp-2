import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Referensi UMK per wilayah per tahun (basis formula insentif dinas).
 * GET /api/erp/payroll/umk?year=2026 → { refs } (urut wilayah).
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const yearRaw = req.nextUrl.searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : null;
  const refs = await db.umkReference.findMany({
    where: year && Number.isFinite(year) ? { year } : undefined,
    orderBy: [{ year: "desc" }, { regionName: "asc" }],
  });
  return ok({ refs });
}
