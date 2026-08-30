import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody } from "@/lib/crm/server";

/**
 * Preferensi notifikasi per pengguna (ronde 16-c) — persist di tabel UserPreference
 * agar tersinkron antar perangkat (localStorage di client hanya cache instan/offline).
 * Tanpa audit log (bukan data operasional).
 *
 * Tipe yang dikenal WAJIB sinkron dengan NOTIF_TYPES di @/lib/crm/notif-prefs.
 */
const KNOWN_TYPES = new Set(["sla", "approval", "cr", "task", "deadline", "invoice"]);
const PREFS_KEY = "notif-prefs";

/** GET /api/notif-prefs?user=email — preferensi tersimpan atau nilai default. */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("user")?.trim().toLowerCase();
  if (!email) return fail("Parameter user wajib diisi", 400);

  const row = await db.userPreference.findUnique({
    where: { userKey_key: { userKey: email, key: PREFS_KEY } },
  });

  let prefs = { muted: [] as string[], hideRead: false };
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as { muted?: unknown; hideRead?: unknown };
      prefs = {
        muted: Array.isArray(parsed.muted)
          ? parsed.muted.filter((m): m is string => typeof m === "string" && KNOWN_TYPES.has(m))
          : [],
        hideRead: parsed.hideRead === true,
      };
    } catch {
      // value korup — kembalikan default
    }
  }

  return ok({ prefs, updatedAt: row?.updatedAt.toISOString() ?? null });
}

/** PUT /api/notif-prefs {user, muted, hideRead} — upsert preferensi (sumber kebenaran lintas perangkat). */
export async function PUT(req: NextRequest) {
  const body = await readBody(req);
  const email = typeof body.user === "string" ? body.user.trim().toLowerCase() : "";
  if (!email) return fail("Parameter user wajib diisi", 400);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return fail("Pengguna tidak ditemukan", 404);

  if (!Array.isArray(body.muted)) return fail("muted wajib berupa array tipe notifikasi", 400);
  const muted = body.muted.filter((m): m is string => typeof m === "string" && KNOWN_TYPES.has(m));
  if (muted.length !== body.muted.length) return fail("Ada tipe notifikasi yang tidak dikenal", 400);
  if (typeof body.hideRead !== "boolean") return fail("hideRead wajib boolean", 400);
  const hideRead: boolean = body.hideRead;

  const value = JSON.stringify({ muted, hideRead: body.hideRead });
  const row = await db.userPreference.upsert({
    where: { userKey_key: { userKey: email, key: PREFS_KEY } },
    create: { userKey: email, key: PREFS_KEY, value },
    update: { value },
  });

  return ok({ prefs: { muted, hideRead }, updatedAt: row.updatedAt.toISOString() });
}
