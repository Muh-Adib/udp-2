import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/crm/session";

/**
 * Ronde 27 — gerbang sesi untuk API (edge-safe: Web Crypto, tanpa node:crypto/Prisma).
 * SEMUA mutasi (POST/PATCH/PUT/DELETE) ke /api/* WAJIB membawa cookie sesi
 * bertanda tangan — kecuali allowlist di bawah.
 * GET dibiarkan terbuka (read-only, konsisten dgn transparansi demo).
 */

const ALLOWED_MUTATION_PREFIXES = [
  "/api/auth/",                        // login/session/logout
  "/api/webhooks/",                    // diverifikasi HMAC X-Hub-Signature-256 di route
  "/api/bootstrap",                    // seeding pertama saat DB kosong (belum ada user utk login); force-reseed tergate di route
];

const ALLOWED_MUTATION_REGEXES = [
  /^\/api\/portal\/[^/]+\/review$/,    // review portal publik — auth = token rahasia di URL
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (!mutating) return NextResponse.next();

  if (
    ALLOWED_MUTATION_PREFIXES.some((p) => pathname.startsWith(p)) ||
    ALLOWED_MUTATION_REGEXES.some((r) => r.test(pathname))
  ) {
    return NextResponse.next();
  }

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
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
