/**
 * Ronde 21 — pengiriman email outbound yang jujur:
 * - kanal email terhubung + non-demo → kirim NYATA via SMTP → sent/failed
 * - demo / belum terhubung → "simulated" (tidak menampilkan tick palsu "Terkirim")
 * Dipakai bersama oleh POST /api/inbox/respond dan POST /api/interactions.
 *
 * Ronde 53:
 * - lampiran (data URL) kini IKUT TERKIRIM via SMTP (dulu hanya tersimpan di CRM).
 * - pemilihan kanal sadar-brand: kanal email brand tsb (non-demo) → kanal non-demo
 *   lain → fallback demo ("simulated"). Dulu findFirst buta-brand/demo sehingga
 *   kirim nyata bisa terlewat meski kanal asli brand sudah terhubung.
 */

import { db } from "@/lib/db";
import { sendEmailViaSmtp, extractEmailAddress } from "./channel-verify";
import type { ChannelConfig } from "@prisma/client";

export interface DeliveryOutcome {
  status: string | null; // sent | failed | simulated | delivered | null
  note: string | null;
}

export interface DeliveryAttachment {
  name: string;
  url: string; // data URL
}

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : String(v ?? "");
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export async function deliverEmailReply(options: {
  recipientRaw: string | null;
  subject: string | null;
  content: string;
  attachments?: DeliveryAttachment[];
  /** Ronde 53 — brand interaksi agar kanal email yg tepat (per brand) yg dipakai. */
  brandId?: string | null;
}): Promise<DeliveryOutcome> {
  // Ronde 53 — 1) kanal email NON-DEMO milik brand interaksi (paling spesifik),
  // 2) kanal non-demo lain, 3) fallback demo → "simulated" yang jujur.
  let config: ChannelConfig | null = null;
  const brandId = options.brandId ?? null;
  if (brandId) {
    config = await db.channelConfig.findFirst({
      where: { channel: "email", status: "connected", isDemo: false, brandId },
      orderBy: { updatedAt: "desc" },
    });
  }
  if (!config) {
    config = await db.channelConfig.findFirst({
      where: { channel: "email", status: "connected", isDemo: false },
      orderBy: { updatedAt: "desc" },
    });
  }
  if (!config) {
    config = await db.channelConfig.findFirst({
      where: { channel: "email", status: "connected", isDemo: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!config) {
    return { status: "simulated", note: "Kanal email belum terhubung — respons hanya tercatat di CRM" };
  }
  if (config.isDemo) {
    return { status: "simulated", note: "Koneksi demo — email tidak benar-benar terkirim" };
  }

  const creds = parseJsonObject(config.credentials);
  const to = extractEmailAddress(options.recipientRaw);
  if (!to) {
    return { status: "failed", note: "Alamat email penerima tidak ditemukan pada data lead" };
  }

  // Ronde 53 — lampiran data URL → attachment SMTP (maks 5, total ±10 MB).
  const attachments = (options.attachments ?? []).slice(0, 5).map((a) => ({
    filename: a.name,
    content: Buffer.from(a.url.slice(a.url.indexOf(",") + 1), "base64"),
  }));

  const send = await sendEmailViaSmtp(creds, {
    to,
    subject: options.subject ?? "(tanpa subjek)",
    text: options.content,
    from: creds.smtpUser || config.accountRef || undefined,
    attachments,
  });

  if (send.ok) {
    const attNote = attachments.length > 0 ? ` · ${attachments.length} lampiran ikut terkirim` : "";
    return { status: "sent", note: `Terkirim nyata via ${creds.smtpHost} → ${to}${attNote}` };
  }
  return { status: "failed", note: send.error ?? "Pengiriman SMTP gagal" };
}
