import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { INDUSTRY_SUGGESTIONS } from "@/lib/crm/constants";

/**
 * Ronde 57 — daftar saran "Jenis Industri" utk autocomplete SEMUA form.
 * Konstanta default + nilai unik nyata dari Company.industry (diurut abjad).
 * GET /api/industries → { industries: string[] }
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req, {});
  if (actor.denied) return fail(actor.reason, 401);

  const rows = await db.company.findMany({
    where: { deletedAt: null, industry: { not: null } },
    select: { industry: true },
    distinct: ["industry"],
  });
  const industries = Array.from(
    new Set([...INDUSTRY_SUGGESTIONS, ...rows.map((r) => r.industry ?? "").filter(Boolean)]),
  ).sort((a, b) => a.localeCompare(b));

  return ok({ industries });
}
