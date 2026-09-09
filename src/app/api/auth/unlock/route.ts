import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import {
  getSessionUser, verifyLockToken, verifySecret,
  loginRateLimit, loginRateLimitReset, LOCK_COOKIE,
} from "@/lib/crm/auth";

/**
 * Ronde 46 — BUKA KUNCI LAYAR dengan PIN.
 * PIN diverifikasi langsung ke hash scrypt di DB (bukan sesuatu yang bisa
 * dipalsukan client). Gagal diaudit + kena rate limit sama seperti login.
 */
export async function POST(req: NextRequest) {
  const s = await getSessionUser(req);
  if (!s) return fail("Sesi berakhir — masuk kembali dengan password", 401);

  const lock = await verifyLockToken(req.cookies.get(LOCK_COOKIE)?.value);
  if (!lock || lock.uid !== s.id) {
    return ok({ locked: false }); // tidak terkunci — tidak ada yang perlu dibuka
  }

  const body = await readBody(req);
  const pin = String(body.pin ?? "").trim();
  if (!pin) return fail("PIN wajib diisi", 400);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
  const rl = loginRateLimit(`unlock:${ip}:${s.id}`);
  if (!rl.allowed) {
    return fail(`Terlalu banyak percobaan PIN — coba lagi dalam ${Math.ceil(rl.retryAfterSec / 60)} menit`, 429);
  }

  const user = await db.user.findUnique({ where: { id: s.id }, select: { pin: true, active: true, name: true, role: true } });
  if (!user || !user.active) return fail("Akun tidak aktif — masuk kembali", 401);

  if (!verifySecret(pin, user.pin)) {
    await logAudit({
      actorName: s.name, actorRole: s.role, action: "session_unlock_failed", entity: "user",
      entityId: s.id, entityLabel: s.email, metadata: "PIN kunci layar salah", req,
    });
    return fail("PIN salah", 401);
  }

  loginRateLimitReset(`unlock:${ip}:${s.id}`);
  await logAudit({
    actorName: s.name, actorRole: s.role, action: "session_unlock", entity: "user",
    entityId: s.id, entityLabel: s.email, metadata: "Layar sesi dibuka (PIN benar)", req,
  });

  const res = ok({ locked: false });
  const response = new NextResponse(res.body, { status: res.status, headers: res.headers });
  response.cookies.set(LOCK_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
