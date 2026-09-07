/**
 * Ronde 39 — Web Push (VAPID) helper.
 *
 * - Kirim push ke pengguna berdasarkan ROLE (resolusi email dari tabel User)
 *   atau langsung per email (userKey).
 * - Subscription kadaluarsa / dicabut (404/410 dari push service) dihapus
 *   otomatis agar tabel bersih.
 * - Tanpa VAPID env di production → fail-closed (log warning, tidak kirim).
 *   Di dev tanpa env → juga skip (UI sudah menyembunyikan toggle bila key kosong).
 */
import webpush from "web-push";
import { db } from "@/lib/db";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  type?: string;
}

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:dev@grup.co.id",
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Kirim push ke satu subscription; hapus bila push service bilang sudah tidak valid. */
async function sendToSubscription(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 }
    );
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
    return false;
  }
}

/** Kirim push ke semua perangkat milik email-email tertentu. */
export async function sendPushToUserKeys(userKeys: string[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  if (userKeys.length === 0) return 0;
  const subs = await db.pushSubscription.findMany({ where: { userKey: { in: userKeys } } });
  let sent = 0;
  for (const sub of subs) {
    const ok = await sendToSubscription(sub, payload);
    if (ok) sent += 1;
  }
  return sent;
}

/** Kirim push ke seluruh user aktif dengan salah satu role (mis. ["director","super_admin"]). */
export async function sendPushToRoles(roles: string[], payload: PushPayload, excludeUserKey?: string | null): Promise<number> {
  if (!ensureConfigured()) return 0;
  if (roles.length === 0) return 0;
  const users = await db.user.findMany({
    where: { role: { in: roles }, active: true },
    select: { email: true },
  });
  const keys = users.map((u) => u.email).filter((e) => e && e !== excludeUserKey);
  return sendPushToUserKeys(keys, payload);
}
