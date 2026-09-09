import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import {
  SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySecret, hashSecret,
  isPlainPin, loginRateLimit, loginRateLimitEmail, loginRateLimitReset,
} from "@/lib/crm/auth";

/**
 * Ronde 27 — login sesi nyata. Ronde 46 — PASSWORD menjadi kredensial utama:
 * - Login = email + password (hash scrypt). PIN tidak lagi dipakai untuk masuk —
 *   PIN kini khusus membuka kunci layar sesi (Layar Terkunci).
 * - Akun legacy tanpa password masih bisa masuk via PIN (migrasi transisi),
 *   dengan metadata audit jelas.
 * - Rate limit per IP+email + global per email, audit gagal/berhasil.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const legacyPin = typeof body.pin === "string" ? body.pin.trim() : "";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
  // Ronde 36 (audit): batas GLOBAL per email — ganti IP tidak lagi melewati limit.
  const rlEmail = loginRateLimitEmail(email);
  if (!rlEmail.allowed) {
    return fail(`Terlalu banyak percobaan masuk utk akun ini — coba lagi dalam ${Math.ceil(rlEmail.retryAfterSec / 60)} menit`, 429);
  }
  const rl = loginRateLimit(`${ip}:${email}`);
  if (!rl.allowed) {
    return fail(`Terlalu banyak percobaan masuk — coba lagi dalam ${Math.ceil(rl.retryAfterSec / 60)} menit`, 429);
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    await logAudit({
      actorName: email || "(kosong)", actorRole: null, action: "login_failed", entity: "user",
      entityId: email || "(kosong)", entityLabel: email,
      metadata: `Login gagal: ${!user ? "email tidak terdaftar" : "akun tidak aktif"}`, req,
    });
    // Ronde 36 (audit): pesan DISERAGAMKAN agar tak bisa dipakai menebak
    // email mana yang terdaftar (email enumeration). Detail tetap tercatat di audit log.
    return fail("Email atau password salah", 401);
  }

  // Verifikasi kredensial: password utama; PIN legacy hanya bila akun belum punya password.
  let viaLegacyPin = false;
  if (password) {
    if (!user.password || !verifySecret(password, user.password)) {
      await logAudit({
        actorName: user.name, actorRole: user.role, action: "login_failed", entity: "user",
        entityId: user.id, entityLabel: user.email,
        metadata: user.password ? "Login gagal: password salah" : "Login gagal: akun belum punya password", req,
      });
      return fail("Email atau password salah", 401);
    }
  } else if (legacyPin && !user.password) {
    if (!verifySecret(legacyPin, user.pin)) {
      await logAudit({
        actorName: user.name, actorRole: user.role, action: "login_failed", entity: "user",
        entityId: user.id, entityLabel: user.email,
        metadata: "Login gagal: PIN salah (akun legacy)", req,
      });
      return fail("Email atau password salah", 401);
    }
    viaLegacyPin = true;
  } else {
    await logAudit({
      actorName: user.name, actorRole: user.role, action: "login_failed", entity: "user",
      entityId: user.id, entityLabel: user.email,
      metadata: "Login gagal: password kosong", req,
    });
    return fail("Password wajib diisi", 401);
  }

  // Migrasi diam-diam: PIN plaintext legacy → hash scrypt (sekali per pengguna).
  if (isPlainPin(user.pin)) {
    await db.user.update({ where: { id: user.id }, data: { pin: hashSecret(user.pin) } });
  }

  loginRateLimitReset(`${ip}:${email}`);

  // Untuk role client: temukan company dari contact dengan email sama
  let companyName: string | null = null;
  if (user.role === "client") {
    const contact = await db.contact.findFirst({
      where: { email, deletedAt: null },
      include: { company: true },
    });
    companyName = contact?.company?.name ?? null;
  }

  const token = await signSession({ uid: user.id, email: user.email, name: user.name, role: user.role, kind: "session" });

  await logAudit({
    actorName: user.name, actorRole: user.role, action: "login", entity: "user",
    entityId: user.id, entityLabel: user.email,
    metadata: viaLegacyPin ? "Login berhasil (PIN legacy — set password Anda)" : "Login berhasil (password, sesi cookie)", req,
  });

  const res = ok({
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      avatarColor: user.avatarColor, brandAccess: user.brandAccess, companyName,
    },
    legacyPin,
  });
  // NextResponse.json → NextResponse; set cookie pada response.
  const response = new NextResponse(res.body, { status: res.status, headers: res.headers });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}
