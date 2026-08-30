/**
 * Ronde 19 — Saluran & Integrasi (Fase 3): katalog tipe kanal + skema kredensial.
 * Dipakai bersama oleh API (validasi) dan UI (form dinamis + ikon/warna).
 */

export interface ChannelField {
  key: string;
  label: string;
  /** Secret → input password & ditampilkan termask di API ("••••1234"). */
  secret?: boolean;
  required: boolean;
  placeholder?: string;
  hint?: string;
}

export interface ChannelTypeMeta {
  key: string;
  label: string;
  color: string; // warna aksen kanal
  description: string;
  accountRefLabel: string; // label identitas akun (nomor/username/email)
  accountRefPlaceholder: string;
  fields: ChannelField[];
}

export const CHANNEL_TYPES: Record<string, ChannelTypeMeta> = {
  whatsapp: {
    key: "whatsapp",
    label: "WhatsApp Business",
    color: "#25D366",
    description: "Terima lead & kirim balasan via WhatsApp Cloud API; status terkirim/terbaca lewat webhook.",
    accountRefLabel: "Nomor WhatsApp bisnis",
    accountRefPlaceholder: "+6281234567890",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", required: true, placeholder: "mis. 1093xxxxxxxxx", hint: "Meta Business → WhatsApp → API Setup" },
      { key: "wabaId", label: "WABA ID", required: false, placeholder: "mis. 2039xxxxxxxxx" },
      { key: "accessToken", label: "Access Token", required: true, secret: true, placeholder: "EAAG…", hint: "Permanent token (System User)" },
      { key: "verifyToken", label: "Webhook Verify Token", required: true, secret: true, placeholder: "teks acak ≥ 16 karakter", hint: "Dipakai saat handshake webhook Meta" },
      { key: "appSecret", label: "App Secret", required: false, secret: true, placeholder: "mis. 1a2b3c4d…", hint: "Validasi X-Hub-Signature-256" },
    ],
  },
  instagram: {
    key: "instagram",
    label: "Instagram Direct",
    color: "#E1306C",
    description: "Terima DM & komentar sebagai lead; balas dari inbox terpusat.",
    accountRefLabel: "Username Instagram",
    accountRefPlaceholder: "@unimasi.official",
    fields: [
      { key: "accountId", label: "IG Business Account ID", required: true, placeholder: "mis. 1784xxxxxxxxx" },
      { key: "accessToken", label: "Access Token", required: true, secret: true, placeholder: "IGQV…" },
    ],
  },
  email: {
    key: "email",
    label: "Email Bisnis",
    color: "#6366f1",
    description: "Email masuk jadi lead otomatis; balasan terkirim atas nama alamat bisnis.",
    accountRefLabel: "Alamat email",
    accountRefPlaceholder: "hello@unimasi.co.id",
    fields: [
      { key: "provider", label: "Penyedia", required: true, placeholder: "smtp / zoho / gmail" },
      { key: "smtpHost", label: "Host IMAP/SMTP", required: true, placeholder: "mis. smtp.zoho.com" },
      { key: "smtpPort", label: "Port", required: false, placeholder: "465" },
      { key: "smtpUser", label: "Username", required: true, placeholder: "hello@unimasi.co.id" },
      { key: "smtpPassword", label: "Password / App Password", required: true, secret: true, placeholder: "••••••••" },
    ],
  },
};

export const CHANNEL_TYPE_KEYS = Object.keys(CHANNEL_TYPES) as Array<keyof typeof CHANNEL_TYPES & string>;

/** Kredensial yang wajib ada utk sebuah kanal (kunci field required). */
export function requiredCredentialKeys(channel: string): string[] {
  return (CHANNEL_TYPES[channel]?.fields ?? []).filter((f) => f.required).map((f) => f.key);
}

/** Mask nilai kredensial utk respons API: "••••" + 4 karakter terakhir. */
export function maskCredentialValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}
