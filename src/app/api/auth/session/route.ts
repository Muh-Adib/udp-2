import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { SESSION_COOKIE, getSessionUser, verifyLockToken } from "@/lib/crm/auth";

/**
 * Ronde 27 — introspeksi & pengakhiran sesi. Ronde 46 — status kunci layar.
 * GET  → user sesi saat ini (dari cookie, divalidasi + diperbarui dari DB)
 *        + flag `locked` (cookie kunci layar aktif).
 * POST → logout: hapus cookie sesi + kunci (client juga membersihkan store).
 */
export async function GET(req: NextRequest) {
  const s = await getSessionUser(req);
  if (!s) return ok({ user: null, locked: false });

  // Ronde 46: sesi terkunci — token kunci layar milik sesi yang sama & masih hidup.
  const lock = await verifyLockToken(req.cookies.get("crm_lock")?.value);
  const locked = !!lock && lock.uid === s.id;

  // Sesi bertanda tangan valid — pastikan user masih aktif & ambil data terkini.
  const user = await db.user.findUnique({
    where: { id: s.id },
    select: { id: true, name: true, email: true, role: true, avatarColor: true, brandAccess: true, active: true },
  });
  if (!user || !user.active) return ok({ user: null, locked: false });

  let companyName: string | null = null;
  if (user.role === "client") {
    const contact = await db.contact.findFirst({
      where: { email: user.email, deletedAt: null },
      include: { company: true },
    });
    companyName = contact?.company?.name ?? null;
  }

  return ok({
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      avatarColor: user.avatarColor, brandAccess: user.brandAccess, companyName,
    },
    locked,
  });
}

export async function POST() {
  const res = ok({ loggedOut: true });
  const response = new NextResponse(res.body, { status: res.status, headers: res.headers });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set("crm_lock", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
