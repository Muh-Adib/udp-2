import { NextRequest } from "next/server";
import { ok, readBody } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { db } from "@/lib/db";

/** Hapus langganan push (mis. user mematikan push / subscription bermasalah). */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return ok({ deleted: 0 }, 401);

  const endpoint = body.endpoint ? String(body.endpoint) : "";
  if (actor.email) {
    if (endpoint) {
      // Hapus milik user ini saja (jangan menjenis langganan orang lain).
      const res = await db.pushSubscription.deleteMany({ where: { endpoint, userKey: actor.email } });
      return ok({ deleted: res.count });
    }
    // Tanpa endpoint = matikan semua perangkat milik user ini.
    const res = await db.pushSubscription.deleteMany({ where: { userKey: actor.email } });
    return ok({ deleted: res.count });
  }
  return ok({ deleted: 0 });
}
