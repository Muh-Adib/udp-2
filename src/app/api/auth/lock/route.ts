import { NextRequest, NextResponse } from "next/server";
import { ok, fail, logAudit } from "@/lib/crm/server";
import {
  getSessionUser, signSession, LOCK_COOKIE, LOCK_TTL_MS, SESSION_TTL_MS, SESSION_COOKIE,
} from "@/lib/crm/auth";

/**
 * Ronde 46 — KUNCI LAYAR (PIN untuk mengunci sesi, bukan untuk login).
 * POST /api/auth/lock → pasang cookie kunci `crm_lock` (HMAC, TTL 12 jam).
 * Selama terkunci: middleware menolak SEMUA mutasi API (423) — data aman
 * saat perangkat ditinggal; buka kunci dengan PIN (unlock) tanpa login ulang.
 */
export async function POST(req: NextRequest) {
  const s = await getSessionUser(req);
  if (!s) return fail("Belum masuk — tidak ada sesi untuk dikunci", 401);

  const token = await signSession(
    { uid: s.id, email: s.email, name: s.name, role: s.role, kind: "lock" },
    LOCK_TTL_MS,
  );

  await logAudit({
    actorName: s.name, actorRole: s.role, action: "session_lock", entity: "user",
    entityId: s.id, entityLabel: s.email, metadata: "Layar sesi dikunci (PIN)", req,
  });

  const res = ok({ locked: true });
  const response = new NextResponse(res.body, { status: res.status, headers: res.headers });
  response.cookies.set(LOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(LOCK_TTL_MS / 1000),
  });
  // Segarkan sesi agar TTL tidak habis saat perangkat terkunci lama.
  response.cookies.set(SESSION_COOKIE, await signSession(
    { uid: s.id, email: s.email, name: s.name, role: s.role, kind: "session" },
    SESSION_TTL_MS,
  ), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}
