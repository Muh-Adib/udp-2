import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, LOCK_COOKIE, verifySessionToken, verifyLockToken } from "@/lib/crm/session";

/**
 * Ronde 27 — gerbang sesi untuk API (edge-safe: Web Crypto, tanpa node:crypto/Prisma).
 * SEMUA mutasi (POST/PATCH/PUT/DELETE) ke /api/* WAJIB membawa cookie sesi
 * bertanda tangan — kecuali allowlist di bawah.
 *
 * RONDE 36 (audit keamanan) — GET tidak lagi terbuka bebas:
 * semua GET kini juga butuh sesi, KECUALI allowlist eksplisit di bawah.
 * Alasan: sebelumnya siapa pun tanpa login bisa membaca seluruh data CRM
 * (kontak, invoice, pipeline, audit, token portal klien). Allowlist dibatasi
 * pada yang memang harus bisa diakses tanpa sesi:
 *  - /api/auth/*        → cek sesi & login itu sendiri
 *  - /api/webhooks/*    → dipanggil server Meta (diverifikasi HMAC di route)
 *  - /api/bootstrap     → seeding pertama saat DB kosong (belum ada user)
 *  - /api/health        → probe sandbox/supervisor (payload detail dibatasi di route)
 *  - /api/users         → chip persona demo di layar login (field minimal, tanpa PIN)
 *  - /api/notifications, /api/notif-prefs → dipoll mini-service notif tanpa cookie
 *  - GET /api/portal/<token> (1 segmen) → portal klien publik; kuncinya token rahasia 48-hex
 * Catatan dokumentasi: keduanya (notifications & users) adalah kompromi desain
 * yang diketahui — dihasilkan hanya data minimal, dan dibahas di audit ronde 36.
 *
 * RONDE 46 — KUNCI LAYAR: saat cookie `crm_lock` valid (kind="lock", milik sesi
 * yang sama), SEMUA mutasi ditolak 423 Locked — perangkat ditinggal tetap aman;
 * GET tetap boleh (baca-tetap). Buka kunci via /api/auth/unlock dengan PIN.
 */

const ALLOWED_MUTATION_PREFIXES = [
  "/api/auth/",                        // login/session/logout/lock/unlock
  "/api/webhooks/",                    // diverifikasi HMAC X-Hub-Signature-256 di route
  "/api/bootstrap",                    // seeding pertama saat DB kosong (belum ada user utk login); force-reseed tergate di route
];

const ALLOWED_MUTATION_REGEXES = [
  /^\/api\/portal\/[^/]+\/review$/,    // review portal publik — auth = token rahasia di URL
];

// Ronde 46 — mutasi yang tetap boleh SAAT layar terkunci:
const LOCK_EXEMPT_PREFIXES = [
  "/api/push/subscribe",               // perangkat terkunci tetap boleh berlangganan push
  "/api/push/unsubscribe",
];

const ALLOWED_GET_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",                    // handshake GET Meta (hub.challenge)
  "/api/bootstrap",
  "/api/health",
  "/api/users",                        // persona login (tanpa PIN; kompromi terdokumentasi)
  "/api/notifications",                // dipoll notif-service tanpa cookie (kompromi terdokumentasi)
  "/api/notif-prefs",
];

const ALLOWED_GET_REGEXES = [
  // Portal klien publik — token rahasia di URL (1 segmen), TAPI bukan subpath
  // staf "tokens"/"documents" (dua route itu wajib sesi — Ronde 36 audit).
  /^\/api\/portal\/(?!tokens$|documents$)[^/]+$/,
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (mutating) {
    // Ronde 46 — cek kunci layar SEBELUM allowlist lain (kecuali /api/auth & push):
    // hanya mutasi dari sesi yang sama yang diblok; publik/portal lewat biasa.
    if (
      !ALLOWED_MUTATION_PREFIXES.some((p) => pathname.startsWith(p)) &&
      !ALLOWED_MUTATION_REGEXES.some((r) => r.test(pathname)) &&
      !LOCK_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p)) &&
      session
    ) {
      const lock = await verifyLockToken(req.cookies.get(LOCK_COOKIE)?.value);
      if (lock && lock.uid === session.uid) {
        return NextResponse.json(
          { error: "Layar terkunci — buka kunci dengan PIN untuk melanjutkan" },
          { status: 423 },
        );
      }
    }

    if (
      ALLOWED_MUTATION_PREFIXES.some((p) => pathname.startsWith(p)) ||
      ALLOWED_MUTATION_REGEXES.some((r) => r.test(pathname))
    ) {
      return NextResponse.next();
    }
  } else if (
    ALLOWED_GET_PREFIXES.some((p) => pathname.startsWith(p)) ||
    ALLOWED_GET_REGEXES.some((r) => r.test(pathname))
  ) {
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.json(
      { error: "Sesi tidak valid atau berakhir — silakan masuk kembali" },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
