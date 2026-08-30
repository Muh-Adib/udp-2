/**
 * Ronde 21 — pengiriman email outbound yang jujur:
 * - kanal email terhubung + non-demo → kirim NYATA via SMTP → sent/failed
 * - demo / belum terhubung → "simulated" (tidak menampilkan tick palsu "Terkirim")
 * Dipakai bersama oleh POST /api/inbox/respond dan POST /api/interactions.
 */

import { db } from "@/lib/db";
import { sendEmailViaSmtp, extractEmailAddress } from "./channel-verify";

export interface DeliveryOutcome {
  status: string | null; // sent | failed | simulated | delivered | null
  note: string | null;
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
}): Promise<DeliveryOutcome> {
  const config = await db.channelConfig.findFirst({
    where: { channel: "email", status: "connected" },
    orderBy: { updatedAt: "desc" },
  });

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

  const send = await sendEmailViaSmtp(creds, {
    to,
    subject: options.subject ?? "(tanpa subjek)",
    text: options.content,
    from: creds.smtpUser || config.accountRef || undefined,
  });

  if (send.ok) {
    return { status: "sent", note: `Terkirim nyata via ${creds.smtpHost} → ${to}` };
  }
  return { status: "failed", note: send.error ?? "Pengiriman SMTP gagal" };
}
