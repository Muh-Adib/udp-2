/**
 * Ronde 27 — inti sesi yang aman untuk Edge Runtime (middleware/proxy) DAN Node (route).
 *
 * ATURAN: file ini TIDAK boleh mengimpor node:crypto, Buffer, atau Prisma —
 * semuanya memakai Web Crypto + TextEncoder + btoa/atob yang tersedia di Edge.
 * Bagian khusus Node (scrypt PIN, resolveActor + DB, rate limit) tetap di
 * `lib/crm/auth.ts` yang me-re-export modul ini.
 */

export const SESSION_COOKIE = "crm_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

const SECRET = process.env.SESSION_SECRET || "grupcrm-dev-secret-ganti-di-produksi";

export type SessionPayload = { uid: string; email: string; name: string; role: string; exp: number };
export type SessionUser = { id: string; name: string; email: string; role: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

/** Perbandingan konstanta-waktu untuk string (panjang sig HMAC selalu tetap, aman). */
function safeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Buat token sesi bertanda tangan: `<payload-b64url>.<hmac>` (HMAC-SHA256). */
export async function signSession(payload: Omit<SessionPayload, "exp">): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const body = bytesToB64url(enc.encode(JSON.stringify(full)));
  const sig = await hmac(body);
  return `${body}.${bytesToB64url(sig)}`;
}

/** Verifikasi token sesi: signature konstanta-waktu + cek kedaluwarsa. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!body || !sig) return null;
  try {
    const expect = await hmac(body);
    if (!safeEqualStr(sig, bytesToB64url(expect))) return null;
    const payload = JSON.parse(dec.decode(b64urlToBytes(body))) as SessionPayload;
    if (!payload?.uid || !payload?.exp || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Ambil user dari cookie sesi request (tanpa DB — cukup untuk middleware /
 * pemeriksaan ringan). Param sengaja bertipe minimal agar bisa dipakai di
 * Edge (NextRequest) maupun Node tanpa tarik dependensi.
 */
export async function getSessionUser(
  req: { cookies: { get(name: string): { value?: string } | undefined } },
): Promise<SessionUser | null> {
  const p = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!p) return null;
  return { id: p.uid, name: p.name, email: p.email, role: p.role };
}
