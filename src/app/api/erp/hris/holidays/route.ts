import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, numOrNull } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

// GET /api/erp/hris/holidays?year= → { holidays }
// Semua user ber-sesi boleh melihat kalender libur (dipakai klasifikasi hari kerja).
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = numOrNull(yearParam);

  const holidays = await db.holidayCalendar.findMany({
    where:
      year !== null && Number.isInteger(year) && year >= 2000 && year <= 2100
        ? {
            date: {
              gte: new Date(Date.UTC(year, 0, 1)),
              lt: new Date(Date.UTC(year + 1, 0, 1)),
            },
          }
        : {},
    orderBy: { date: "asc" },
    take: 400,
  });
  return ok({ holidays });
}
