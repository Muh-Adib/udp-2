import { NextRequest } from "next/server";
import { ok } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { getVapidPublicKey } from "@/lib/crm/push";

/** Public VAPID key untuk pushManager.subscribe — butuh sesi (Ronde 36 gate GET). */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return ok({ publicKey: null }, 401);
  return ok({ publicKey: getVapidPublicKey() });
}
