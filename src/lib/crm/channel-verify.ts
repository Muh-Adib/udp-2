/**
 * Ronde 21 — Verifikasi koneksi kanal SECARA NYATA (bukan sekadar format).
 *
 * - Email : handshake + auth SMTP (nodemailer verify) dan login IMAP (imapflow)
 * - WhatsApp : panggil Graph API GET /{phoneNumberId} dengan access token
 * - Instagram : panggil Graph API GET /{igUserId}?fields=username
 *
 * Semua verifikasi punya timeout ketat (8–12 detik) dan mengembalikan pesan
 * error yang bisa dipahami operator (bukan stack trace mentah).
 */

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

export interface VerifyResult {
  ok: boolean;
  /** Catatan ringkas utk operator (dipakai sbg statusNote). */
  note: string;
  detail?: string;
}

const HARD_TIMEOUT_MS = 12_000;

/** Bungkus promise dgn timeout keras supaya UI tidak menggantung. */
function withTimeout<T>(p: Promise<T>, ms = HARD_TIMEOUT_MS, label = "verifikasi"): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}) timeout setelah ${Math.round(ms / 1000)} detik`)), ms)
    ),
  ]);
}

/** Terjemahkan error teknis menjadi pesan yang bisa ditindaklanjuti. */
export function friendlyVerifyError(err: unknown, kind: "smtp" | "imap" | "graph"): string {
  const e = err as { code?: string; response?: string; responseCode?: number; message?: string; text?: string };
  const msg = e?.message ?? String(err ?? "");
  const code = e?.code ?? "";

  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /ENOTFOUND/i.test(msg)) {
    return `${kind.toUpperCase()}: host tidak ditemukan — periksa ejaan host`;
  }
  if (code === "ECONNREFUSED") {
    return `${kind.toUpperCase()}: koneksi ditolak — port salah atau server tidak aktif`;
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(msg)) {
    return `${kind.toUpperCase()}: timeout — host/port tidak merespons (coba port SSL 465/993 vs 587/143, cek firewall)`;
  }
  if (code === "EAUTH" || e?.responseCode === 535 || /authentication|invalid login|535/i.test(msg + (e?.response ?? ""))) {
    return `${kind.toUpperCase()}: autentikasi gagal — username atau App Password salah (Gmail wajib App Password, bukan password biasa)`;
  }
  if (e?.responseCode === 530 || /authentication required|530/i.test(msg)) {
    return `${kind.toUpperCase()}: server mewajibkan autentikasi/TLS — aktifkan secure connection`;
  }
  if (/certificate|self-signed|TLS/i.test(msg)) {
    return `${kind.toUpperCase()}: sertifikat TLS tidak valid — periksa pengaturan SSL server`;
  }
  if (kind === "graph" && /190|invalid.*token|expired/i.test(msg + (e?.response ?? ""))) {
    return "Graph API: access token tidak valid / kedaluwarsa — buat token permanen (System User)";
  }
  if (kind === "graph" && /100|invalid.*id|unsupported/i.test(msg + (e?.response ?? ""))) {
    return "Graph API: ID akun tidak valid untuk token ini — pastikan Phone Number ID / IG Account ID milik app yang sama";
  }
  const short = msg.split("\n")[0]?.slice(0, 140) ?? "error tidak diketahui";
  return `${kind.toUpperCase()}: ${short}`;
}

// ---------------------------------------------------------------------------
// EMAIL — SMTP (kirim) + IMAP (terima)
// ---------------------------------------------------------------------------

function parsePort(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 65535 ? n : fallback;
}

async function verifySmtp(creds: Record<string, string>): Promise<VerifyResult> {
  const host = (creds.smtpHost ?? "").trim();
  const user = (creds.smtpUser ?? "").trim();
  const pass = (creds.smtpPassword ?? "").trim();
  const port = parsePort(creds.smtpPort, 465);

  if (!host) return { ok: false, note: "SMTP: host belum diisi" };
  if (!user || !pass) return { ok: false, note: "SMTP: username/password belum diisi" };

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });

  try {
    await withTimeout(transport.verify(), 12_000, "SMTP");
    return { ok: true, note: `SMTP terverifikasi nyata (handshake + login OK) — ${host}:${port}` };
  } catch (err) {
    return { ok: false, note: friendlyVerifyError(err, "smtp") };
  } finally {
    transport.close();
  }
}

async function verifyImap(creds: Record<string, string>): Promise<VerifyResult> {
  const host = (creds.imapHost ?? "").trim();
  if (!host) {
    return { ok: true, note: "IMAP tidak diisi — email masuk belum akan tersinkron (isi Host IMAP bila ingin lead otomatis)" };
  }
  const user = (creds.imapUser ?? creds.smtpUser ?? "").trim();
  const pass = (creds.imapPassword ?? creds.smtpPassword ?? "").trim();
  const port = parsePort(creds.imapPort, 993);

  if (!user || !pass) return { ok: false, note: "IMAP: username/password belum lengkap" };

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
  });

  try {
    await withTimeout(client.connect(), 12_000, "IMAP");
    return { ok: true, note: `SMTP+IMAP terverifikasi nyata (login OK) — ${host}:${port}` };
  } catch (err) {
    return { ok: false, note: friendlyVerifyError(err, "imap") };
  } finally {
    try {
      client.close();
    } catch {
      /* sudah tertutup */
    }
  }
}

/** Verifikasi kanal email: SMTP wajib lulus; IMAP divalidasi bila diisi. */
export async function verifyEmailChannel(creds: Record<string, string>): Promise<VerifyResult> {
  const smtp = await verifySmtp(creds);
  if (!smtp.ok) return smtp;

  const imap = await verifyImap(creds);
  if (!imap.ok) {
    return { ok: false, note: `${smtp.note} — tetapi ${imap.note}` };
  }
  return { ok: true, note: imap.note.includes("IMAP tidak diisi") ? smtp.note + " · " + imap.note : imap.note };
}

// ---------------------------------------------------------------------------
// WHATSAPP / INSTAGRAM — Graph API (Meta)
// ---------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

async function graphGet(path: string, token: string): Promise<{ ok: boolean; body: Record<string, unknown>; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${GRAPH_BASE}${path}&access_token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.error) {
      const err = body.error as { message?: string; code?: number } | undefined;
      const friendly = friendlyVerifyError(
        { message: err?.message ?? `HTTP ${res.status}`, response: err?.message ?? "", responseCode: err?.code },
        "graph"
      );
      return { ok: false, body, error: friendly };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, body: {}, error: friendlyVerifyError(err, "graph") };
  } finally {
    clearTimeout(timer);
  }
}

/** WhatsApp Cloud API: GET /{phoneNumberId} — token & ID harus valid. */
export async function verifyWhatsAppChannel(creds: Record<string, string>): Promise<VerifyResult> {
  const phoneId = (creds.phoneNumberId ?? "").trim();
  const token = (creds.accessToken ?? "").trim();
  if (!phoneId || !token) return { ok: false, note: "Phone Number ID / Access Token belum lengkap" };

  const res = await graphGet(`/${phoneId}?fields=verified_name,display_phone_number,quality_rating`, token);
  if (!res.ok) return { ok: false, note: res.error ?? "Verifikasi Graph API gagal" };

  const displayName = (res.body.verified_name as string) ?? "";
  const phone = (res.body.display_phone_number as string) ?? "";
  return {
    ok: true,
    note: `Terverifikasi nyata via Graph API: "${displayName}"${phone ? ` (${phone})` : ""}`,
    detail: JSON.stringify(res.body).slice(0, 200),
  };
}

/** Instagram Messaging: GET /{igUserId}?fields=username — token & ID harus valid. */
export async function verifyInstagramChannel(creds: Record<string, string>): Promise<VerifyResult> {
  const igId = (creds.accountId ?? "").trim();
  const token = (creds.accessToken ?? "").trim();
  if (!igId || !token) return { ok: false, note: "IG Business Account ID / Access Token belum lengkap" };

  const res = await graphGet(`/${igId}?fields=username,name`, token);
  if (!res.ok) return { ok: false, note: res.error ?? "Verifikasi Graph API gagal" };

  const username = (res.body.username as string) ?? "";
  return {
    ok: true,
    note: `Terverifikasi nyata via Graph API: @${username}`,
    detail: JSON.stringify(res.body).slice(0, 200),
  };
}

/** Verifikasi universal per tipe kanal. */
export async function verifyChannel(channel: string, creds: Record<string, string>): Promise<VerifyResult> {
  switch (channel) {
    case "email":
      return verifyEmailChannel(creds);
    case "whatsapp":
      return verifyWhatsAppChannel(creds);
    case "instagram":
      return verifyInstagramChannel(creds);
    default:
      return { ok: false, note: "Tipe kanal tidak dikenal" };
  }
}

// ---------------------------------------------------------------------------
// KIRIM EMAIL NYATA (SMTP) — dipakai saat membalas lead di inbox.
// ---------------------------------------------------------------------------

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** Ambil alamat email pertama dari teks bebas ("Budi <budi@x.co>" → budi@x.co). */
export function extractEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

export async function sendEmailViaSmtp(
  creds: Record<string, string>,
  options: { to: string; subject: string; text: string; from?: string }
): Promise<SendEmailResult> {
  const host = (creds.smtpHost ?? "").trim();
  const user = (creds.smtpUser ?? "").trim();
  const pass = (creds.smtpPassword ?? "").trim();
  const port = parsePort(creds.smtpPort, 465);
  if (!host || !user || !pass) {
    return { ok: false, error: "Kredensial SMTP belum lengkap" };
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  try {
    const info = await withTimeout(
      transport.sendMail({
        from: options.from ?? user,
        to: options.to,
        subject: options.subject,
        text: options.text,
      }),
      20_000,
      "SMTP send"
    );
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return { ok: false, error: friendlyVerifyError(err, "smtp") };
  } finally {
    transport.close();
  }
}
