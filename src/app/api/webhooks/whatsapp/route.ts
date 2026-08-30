import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

/**
 * Task 17-c — WhatsApp Cloud API webhook (rekomendasi ronde 16, Fase 3).
 *
 * GET  : handshake verifikasi Meta (hub.mode/hub.verify_token/hub.challenge).
 *        Token dibandingkan dgn env WHATSAPP_VERIFY_TOKEN (fallback demo "grupcrm-demo-token").
 * POST : terima payload statuses { entry[].changes[].value.statuses[] } — update
 *        Interaction.deliveryStatus utk pesan outbound (delivered/read/sent/failed),
 *        tulis SATU audit log batch, dan selalu balas 200 (konvensi WhatsApp).
 */

const DEMO_VERIFY_TOKEN = "grupcrm-demo-token";

/** Status pengiriman yang dikenali sistem (timestamps diabaikan — kita hanya melacak status). */
const KNOWN_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || DEMO_VERIFY_TOKEN;

  if (mode !== "subscribe" || !challenge) {
    return fail("Permintaan verifikasi webhook tidak valid", 400);
  }
  if (!token || token !== expected) {
    return fail("hub.verify_token tidak valid", 403);
  }
  // Echo challenge sebagai plain-text 200 sesuai konvensi Meta.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

type RawStatus = { id?: unknown; status?: unknown };

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const entry = body.entry;
  if (!Array.isArray(entry)) {
    return fail("Payload webhook WhatsApp tidak valid", 400);
  }

  let updated = 0;
  let unknown = 0;
  const updates: { id: string; from: string | null; to: string }[] = [];

  for (const entryItem of entry) {
    const changes = (entryItem as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: unknown } | null)?.value as
        | { statuses?: unknown }
        | null
        | undefined;
      if (!value || !Array.isArray(value.statuses)) continue;
      for (const raw of value.statuses as RawStatus[]) {
        const id = typeof raw?.id === "string" ? raw.id : "";
        const status = typeof raw?.status === "string" ? raw.status : "";
        if (!id || !KNOWN_STATUSES.has(status)) {
          unknown++;
          continue;
        }
        // Cari interaction: externalId = id apa adanya, atau bentuk legacy `inbox-reply:<id>`
        // (respons lead yang dibuat lewat alur Respons & Catat inbox).
        const match = await db.interaction.findFirst({
          where: {
            direction: "outbound",
            externalId: { in: [id, `inbox-reply:${id}`] },
          },
          select: { id: true, deliveryStatus: true },
        });
        if (!match) {
          unknown++;
          continue;
        }
        await db.interaction.update({
          where: { id: match.id },
          data: { deliveryStatus: status },
        });
        updated++;
        updates.push({ id: match.id, from: match.deliveryStatus ?? null, to: status });
      }
    }
  }

  // Satu entri audit batch per payload webhook (hanya bila ada interaction terupdate).
  if (updates.length > 0) {
    await logAudit({
      actorName: "WhatsApp Cloud API",
      actorRole: "system",
      action: "webhook",
      entity: "interaction",
      entityId: updates[0].id,
      entityLabel: `Webhook status WhatsApp (${updates.length} pesan)`,
      field: "deliveryStatus",
      oldValue: JSON.stringify(updates.map((u) => ({ id: u.id, status: u.from }))),
      newValue: JSON.stringify(updates.map((u) => ({ id: u.id, status: u.to }))),
      metadata: updates
        .map((u) => `${u.id}: ${u.from ?? "-"} → ${u.to}`)
        .join("; ")
        .slice(0, 500),
      req,
    });
  }

  // Selalu 200 — konvensi WhatsApp: retry berulang bila webhook gagal.
  return ok({ received: true, updated, unknown });
}
