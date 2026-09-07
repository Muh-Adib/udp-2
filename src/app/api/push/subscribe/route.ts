import { NextRequest } from "next/server";
import { fail, ok, readBody } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { db } from "@/lib/db";

/** Simpan langganan push milik SESI (email dari cookie, bukan body). */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const sub = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
  const endpoint = sub?.endpoint ? String(sub.endpoint) : "";
  const p256dh = sub?.keys?.p256dh ? String(sub.keys.p256dh) : "";
  const auth = sub?.keys?.auth ? String(sub.keys.auth) : "";
  if (!endpoint || !p256dh || !auth) return fail("Data langganan tidak lengkap", 400);

  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  if (!actor.email) return fail("Email pengguna tidak ditemukan pada sesi", 401);
  const saved = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userKey: actor.email, endpoint, p256dh, auth, userAgent },
    update: { userKey: actor.email, p256dh, auth, userAgent },
  });
  return ok({ subscription: { id: saved.id } }, 201);
}
