import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { ok, fail, logAudit } from "@/lib/crm/server";

/**
 * Task 17-c — WhatsApp Cloud API webhook (rekomendasi ronde 16, Fase 3).
 * Task 18-a — validasi signature X-Hub-Signature-256 (HMAC-SHA256 dgn WHATSAPP_APP_SECRET).
 *
 * GET  : handshake verifikasi Meta (hub.mode/hub.verify_token/hub.challenge).
 *        Token dibandingkan dgn env WHATSAPP_VERIFY_TOKEN (fallback demo "grupcrm-demo-token").
 * POST : terima payload statuses { entry[].changes[].value.statuses[] } — update
 *        Interaction.deliveryStatus utk pesan outbound (delivered/read/sent/failed),
 *        tulis SATU audit log batch, dan selalu balas 200 (konvensi WhatsApp).
 *        Bila env WHATSAPP_APP_SECRET diset, request WAJIB membawa header
 *        X-Hub-Signature-256: sha256=<hmac> yang cocok dgn raw body (timing-safe).
 *        Tanpa env secret (mode demo) validasi dilewati.
 */

const DEMO_VERIFY_TOKEN = "grupcrm-demo-token";

/** Status pengiriman yang dikenali sistem (timestamps diabaikan — kita hanya melacak status). */
const KNOWN_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/** Bandingkan dua string secara timing-safe (hindari timing attack pada signature). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verifikasi X-Hub-Signature-256 terhadap raw body. Return null = valid/skip, string = alasan gagal. */
function verifySignature(rawBody: string, header: string | null): string | null {
  const envSecret = process.env.WHATSAPP_APP_SECRET;
  if (envSecret) {
    if (!header) return "header X-Hub-Signature-256 wajib ada";
    const expected = "sha256=" + createHmac("sha256", envSecret).update(rawBody, "utf8").digest("hex");
    if (!safeEqual(expected.toLowerCase(), header.toLowerCase())) {
      return "signature tidak cocok";
    }
    return null;
  }
  // Tanpa env secret — coba kredensial kanal WhatsApp yang tersimpan di DB (Ronde 19).
  const candidates = dbSecretsMemo;
  if (candidates.length > 0) {
    if (!header) return "header X-Hub-Signature-256 wajib ada";
    for (const secret of candidates) {
      const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
      if (safeEqual(expected.toLowerCase(), header.toLowerCase())) return null;
    }
    return "signature tidak cocok dgn kredensial terdaftar";
  }
  return null; // belum ada kredensial sama sekali — mode demo, validasi dilewati
}

/** Secret appSecret WhatsApp dari ChannelConfig (di-load per request, kecil & ter-cache 30 dtk). */
let dbSecretsCache: { secrets: string[]; at: number } = { secrets: [], at: 0 };
const DB_SECRETS_TTL_MS = 30_000;
let dbSecretsMemo: string[] = [];
async function refreshDbSecrets() {
  const now = Date.now();
  if (now - dbSecretsCache.at < DB_SECRETS_TTL_MS) return;
  const rows = await db.channelConfig.findMany({ where: { channel: "whatsapp" }, select: { credentials: true } });
  const secrets: string[] = [];
  for (const r of rows) {
    try {
      const creds = JSON.parse(r.credentials) as Record<string, unknown>;
      const s = typeof creds.appSecret === "string" ? creds.appSecret.trim() : "";
      if (s) secrets.push(s);
    } catch {
      // kredensial korup — abaikan
    }
  }
  dbSecretsCache = { secrets, at: now };
  dbSecretsMemo = secrets;
}

/** Token verify yang sah: env WHATSAPP_VERIFY_TOKEN ATAU verifyToken di ChannelConfig. */
async function verifyHandshakeToken(token: string): Promise<boolean> {
  if (token === (process.env.WHATSAPP_VERIFY_TOKEN || DEMO_VERIFY_TOKEN)) return true;
  const rows = await db.channelConfig.findMany({ where: { channel: "whatsapp" }, select: { credentials: true } });
  for (const r of rows) {
    try {
      const creds = JSON.parse(r.credentials) as Record<string, unknown>;
      const t = typeof creds.verifyToken === "string" ? creds.verifyToken.trim() : "";
      if (t && safeEqual(t, token)) return true;
    } catch {
      // kredensial korup — abaikan
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  if (mode !== "subscribe" || !challenge) {
    return fail("Permintaan verifikasi webhook tidak valid", 400);
  }
  if (!token || !(await verifyHandshakeToken(token))) {
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
  // Raw body dibutuhkan untuk verifikasi HMAC (bukan body yang sudah diparse).
  const rawBody = await req.text();
  await refreshDbSecrets();
  const sigError = verifySignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (sigError) {
    return fail(`Webhook ditolak: ${sigError}`, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return fail("Payload webhook WhatsApp tidak valid", 400);
  }
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
