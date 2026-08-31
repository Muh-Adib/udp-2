import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySessionToken } from "@/lib/crm/session";

/**
 * Ronde 27 — AUTH SESI NYATA (pengganti model demo "actorName dari body").
 *
 * - Login menandatangani payload sesi (HMAC-SHA256, Web Crypto) ke cookie
 *   HttpOnly `crm_session` — inti algoritma ada di `lib/crm/session.ts`
 *   (kompatibel Edge + Node; file ini mengekspor ulang demi satu pintu impor).
 * - resolveActor(): sesi = sumber kebenaran identitas + peran (DB dicek ulang agar
 *   perubahan role/deaktivasi langsung berlaku); fallback body HANYA utk endpoint
 *   portal publik yang diizinkan eksplisit.
 * - PIN disimpan scrypt + salt; PIN legacy plaintext otomatis dimigrasi saat login.
 * - Rate limit login in-memory per IP+email.
 * - assertRole(): gerbang peran sisi server untuk route sensitif.
 */

// Re-export inti sesi (edge-safe) supaya route Node cukup impor dari sini.
export { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySessionToken, getSessionUser };
export type { SessionPayload, SessionUser } from "@/lib/crm/session";

export type ResolvedActor =
  | { name: string; role: string | null; id: string | null; fromSession: boolean; denied: false }
  | { denied: true; reason: string };

/**
 * Identitas aktor utk mutasi: sesi = sumber kebenaran; user dicek ulang ke DB
 * (role terbaru, harus aktif). Fallback body hanya bila `allowBodyFallback`
 * (endpoint portal publik/legacy) — selain itu denied (caller balas 401).
 */
export async function resolveActor(
  req: NextRequest,
  body: Record<string, unknown> = {},
  opts: { allowBodyFallback?: boolean } = {},
): Promise<ResolvedActor> {
  const s = await getSessionUser(req);
  if (s) {
    // Segarkan identitas dari DB: role baru/deaktivasi langsung berlaku.
    const fresh = await db.user.findUnique({
      where: { id: s.id },
      select: { name: true, role: true, active: true, email: true },
    });
    if (!fresh?.active) return { denied: true, reason: "Pengguna tidak aktif — hubungi administrator" };
    return { name: fresh.name, role: fresh.role, id: s.id, fromSession: true, denied: false };
  }
  if (opts.allowBodyFallback) {
    const name = String(body.actorName ?? "").trim() || "System";
    const role = body.actorRole ? String(body.actorRole) : null;
    return { name, role, id: null, fromSession: false, denied: false };
  }
  return { denied: true, reason: "Belum masuk — sesi tidak ditemukan" };
}

/**
 * Gerbang peran sisi server (mirror matriks canAccess UI). `allowed` berisi role
 * yang boleh; bila actor.role null (system/webhook) → hanya lolos bila "system"
 * ada di daftar. Dipakai pada route sensitif agar role tak bisa dipalsukan body.
 */
export function assertRole(
  actor: ResolvedActor,
  allowed: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (actor.denied) return { ok: false, reason: actor.reason };
  if (!actor.role) {
    return allowed.includes("system")
      ? { ok: true }
      : { ok: false, reason: "Identitas sistem tidak berhak untuk aksi ini" };
  }
  if (allowed.includes(actor.role)) return { ok: true };
  return { ok: false, reason: "Peran Anda tidak berhak melakukan aksi ini" };
}

// ===== PIN (scrypt + salt; migrasi otomatis dari plaintext legacy) =====

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function safeEqualBuffer(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPin(input: string, stored: string): boolean {
  if (stored.startsWith("scrypt$")) {
    const [, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    const calc = scryptSync(input, salt, 32);
    const expect = Buffer.from(hash, "hex");
    return safeEqualBuffer(calc, expect);
  }
  // Legacy plaintext (data demo lama) — dibandingkan timing-safe lalu dimigrasi login.
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  return safeEqualBuffer(a, b);
}

export function isPlainPin(stored: string): boolean {
  return !stored.startsWith("scrypt$");
}

// ===== Rate limit login (in-memory, per proses) =====
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function loginRateLimitReset(key: string): void {
  attempts.delete(key);
}
