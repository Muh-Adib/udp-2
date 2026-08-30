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

// ---------------------------------------------------------------------------
// Ronde 20 — Panduan setup berpandu (wizard) per kanal, dirujuk ke dokumentasi
// resmi penyedia (Meta WhatsApp Cloud API, Instagram Messaging, SMTP).
// Dipakai oleh wizard UI; `copyables` mengacu pada nilai live dari /api/channels.
// ---------------------------------------------------------------------------

/** Tautan dokumentasi resmi yang direkomendasikan. */
export interface SetupDocLink {
  label: string;
  href: string;
}

export interface SetupCheckItem {
  text: string;
  link?: SetupDocLink;
}

/** Nilai dinamis dari sistem yang bisa disalin (callback URL / verify token). */
export interface SetupCopyable {
  kind: "callbackUrl" | "verifyToken";
  label: string;
}

export interface SetupPreset {
  label: string;
  description: string;
  values: Record<string, string>;
}

export interface SetupGuideStep {
  id: string;
  title: string;
  description: string;
  checklist?: SetupCheckItem[];
  copyables?: SetupCopyable[];
  /** Kunci kredensial yang diumpulkan pada langkah ini. */
  fields?: string[];
  presets?: SetupPreset[];
  note?: string;
  docLink?: SetupDocLink;
}

export interface SetupGuide {
  /** Ringkasan singkat di layar pembuka wizard. */
  intro: string;
  /** Estimasi waktu proses (menit) utk ekspektasi user. */
  minutes: number;
  steps: SetupGuideStep[];
  demoHint: string;
}

export const SETUP_GUIDES: Record<string, SetupGuide> = {
  whatsapp: {
    intro:
      "Panduan resmi WhatsApp Cloud API (Meta). Selesaikan 4 langkah berikut — callback URL dan verify token untuk Meta sudah disediakan otomatis oleh sistem ini.",
    minutes: 15,
    demoHint: "Belum punya kredensial Meta? Gunakan Mode Demo untuk mencoba alur tanpa akun Meta.",
    steps: [
      {
        id: "prasyarat",
        title: "Siapkan akun bisnis",
        description: "Pastikan prasyarat akun Meta terpenuhi sebelum lanjut.",
        checklist: [
          {
            text: "Meta Business Portfolio aktif (akun perusahaan, bukan profil pribadi).",
            link: { label: "Buka business.facebook.com", href: "https://business.facebook.com" },
          },
          {
            text: "Nomor telepon bisnis aktif & belum terdaftar WhatsApp pribadi (harus bisa menerima SMS/telepon verifikasi).",
          },
          { text: "Anda punya akses admin ke Business Settings." },
        ],
        docLink: { label: "Dokumentasi: Memulai WhatsApp Cloud API", href: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" },
      },
      {
        id: "kredensial",
        title: "Buat Meta App & ambil kredensial",
        description: "Kredensial diambil dari dashboard Meta — isi kolom berikut sambil mengikuti checklist.",
        checklist: [
          {
            text: "developers.facebook.com → My Apps → Create App (tipe Business) → tambahkan produk WhatsApp.",
            link: { label: "Buka My Apps", href: "https://developers.facebook.com/apps" },
          },
          { text: "WhatsApp → API Setup: salin Phone Number ID (WABA ID opsional)." },
          {
            text: "Token permanen: Business Settings → Users → System Users → buat token dengan izin whatsapp_business_messaging & whatsapp_business_management.",
            link: { label: "Buka Business Settings", href: "https://business.facebook.com/settings" },
          },
        ],
        fields: ["phoneNumberId", "wabaId", "accessToken", "appSecret"],
        note: "App Secret opsional — bila diisi, sistem memvalidasi signature webhook (X-Hub-Signature-256) untuk keamanan ekstra.",
        docLink: { label: "Dokumentasi: System User & token permanen", href: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" },
      },
      {
        id: "webhook",
        title: "Daftarkan webhook ke Meta",
        description: "Sambungkan server ini ke Meta agar pesan masuk diterima real-time. Salin kedua nilai di bawah ke Meta App.",
        checklist: [
          { text: "Meta App → WhatsApp → Configuration → Edit." },
          { text: "Tempel Callback URL dan Verify Token dari kotak di bawah." },
          { text: "Klik Verify and Save — server ini merespons handshake otomatis." },
          { text: "Subscribe field: messages." },
        ],
        copyables: [
          { kind: "callbackUrl", label: "Callback URL" },
          { kind: "verifyToken", label: "Verify Token aktif" },
        ],
        note: "Verify Token yang dipakai di Meta HARUS sama dengan kolom Webhook Verify Token pada langkah berikutnya.",
        docLink: { label: "Dokumentasi: Webhook WhatsApp", href: "https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks" },
      },
      {
        id: "verifikasi",
        title: "Verifikasi & aktifkan",
        description: "Isi Webhook Verify Token (sama dengan yang ditempel di Meta), lalu sistem menguji koneksi.",
        fields: ["verifyToken"],
        note: "Setelah terhubung, kirim pesan uji ke nomor bisnis dari WhatsApp mana pun — pesan akan muncul di Inbox.",
      },
    ],
  },
  instagram: {
    intro:
      "Panduan resmi Instagram Messaging (Meta). DM bisnis masuk ke inbox terpusat — butuh akun Instagram Professional yang terhubung ke Facebook Page.",
    minutes: 12,
    demoHint: "Belum siap konfigurasi Meta? Gunakan Mode Demo untuk melihat alurnya dulu.",
    steps: [
      {
        id: "prasyarat",
        title: "Ubah ke akun Professional",
        description: "Instagram bisnis harus akun Professional dan terhubung ke Facebook Page.",
        checklist: [
          {
            text: "Instagram → Settings → Account type → Switch to Professional Account (Business).",
            link: { label: "Panduan akun profesional", href: "https://help.instagram.com/502981923235522" },
          },
          { text: "Hubungkan akun IG ke Facebook Page bisnis (Page Settings → Linked accounts)." },
          { text: "Izinkan akses pesan: Settings → Messages and message replies → Connect to Messenger." },
        ],
        docLink: { label: "Dokumentasi: Instagram Messaging", href: "https://developers.facebook.com/docs/messenger-platform/instagram" },
      },
      {
        id: "kredensial",
        title: "Ambil IG User ID & Access Token",
        description: "Kredensial diambil via Graph API Explorer — isi kolom berikut.",
        checklist: [
          {
            text: "Graph API Explorer → pilih app Anda → centang izin instagram_basic, instagram_manage_messages, pages_show_list → Generate Access Token.",
            link: { label: "Buka Graph API Explorer", href: "https://developers.facebook.com/tools/explorer" },
          },
          { text: "Ambil ID: GET /me?fields=instagram_business_account (ID tampil sebagai IG Business Account ID)." },
        ],
        fields: ["accountId", "accessToken"],
        docLink: { label: "Dokumentasi: Graph API Explorer", href: "https://developers.facebook.com/docs/graph-api/explorer" },
      },
      {
        id: "webhook",
        title: "Daftarkan webhook",
        description: "Pakai Callback URL & Verify Token yang sama seperti WhatsApp (objek webhook: instagram).",
        checklist: [
          { text: "Meta App → Configuration → Edit webhook, tempel nilai di bawah." },
          { text: "Subscribe field: messages & messaging_postbacks." },
        ],
        copyables: [
          { kind: "callbackUrl", label: "Callback URL" },
          { kind: "verifyToken", label: "Verify Token aktif" },
        ],
      },
      {
        id: "verifikasi",
        title: "Verifikasi & aktifkan",
        description: "Sistem menguji format kredensial. Setelah aktif, kirim DM uji ke akun bisnis.",
      },
    ],
  },
  email: {
    intro:
      "Sambungkan email bisnis via SMTP/IMAP. Email masuk menjadi lead otomatis dan balasan terkirim atas nama alamat bisnis.",
    minutes: 5,
    demoHint: "Coba dulu tanpa server email nyata? Gunakan Mode Demo.",
    steps: [
      {
        id: "prasyarat",
        title: "Pilih penyedia & siapkan App Password",
        description: "Penyedia populer memakai App Password (bukan password biasa).",
        checklist: [
          {
            text: "Gmail: aktifkan 2-Step Verification, lalu buat App Password.",
            link: { label: "Buat App Password Google", href: "https://myaccount.google.com/apppasswords" },
          },
          { text: "Zoho Mail: aktifkan IMAP (Settings → Mail Accounts), lalu pakai password aplikasi." },
          { text: "SMTP lain: siapkan host, port (465 SSL / 587 TLS), username, dan password." },
        ],
        docLink: { label: "Dokumentasi: App Password Google", href: "https://support.google.com/accounts/answer/185833" },
      },
      {
        id: "kredensial",
        title: "Isi kredensial SMTP",
        description: "Gunakan preset cepat di bawah atau isi manual sesuai penyedia Anda.",
        presets: [
          { label: "Zoho Mail", description: "smtp.zoho.com · port 465 (SSL)", values: { provider: "zoho", smtpHost: "smtp.zoho.com", smtpPort: "465" } },
          { label: "Gmail", description: "smtp.gmail.com · port 465 (SSL)", values: { provider: "gmail", smtpHost: "smtp.gmail.com", smtpPort: "465" } },
          { label: "Mailgun", description: "smtp.mailgun.org · port 587 (TLS)", values: { provider: "mailgun", smtpHost: "smtp.mailgun.org", smtpPort: "587" } },
        ],
        fields: ["provider", "smtpHost", "smtpPort", "smtpUser", "smtpPassword"],
      },
      {
        id: "verifikasi",
        title: "Verifikasi & aktifkan",
        description: "Sistem menguji format host/port. Setelah aktif, forward email ke inbox terpusat.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Ronde 20 — Mode Demo: pembuatan koneksi 1-klik dengan kredensial buatan.
// ---------------------------------------------------------------------------

function randSuffix(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const DEMO_CONNECTIONS: Record<string, { displayName: string; accountRef: string; credentials: Record<string, string> }> = {
  whatsapp: {
    displayName: "WhatsApp Bisnis (Demo)",
    accountRef: "+628123450001",
    credentials: {
      phoneNumberId: `1093${randSuffix(11)}`,
      wabaId: `2039${randSuffix(11)}`,
      accessToken: `EAAG-demo-${randSuffix(20)}`,
      verifyToken: `demo-vt-${randSuffix(16)}`,
      appSecret: `demo-secret-${randSuffix(12)}`,
    },
  },
  instagram: {
    displayName: "Instagram Direct (Demo)",
    accountRef: "@unimasi.demo",
    credentials: {
      accountId: `1784${randSuffix(11)}`,
      accessToken: `IGQV-demo-${randSuffix(20)}`,
    },
  },
  email: {
    displayName: "Email Bisnis (Demo)",
    accountRef: "hello@demo-unimasi.co.id",
    credentials: {
      provider: "zoho",
      smtpHost: "smtp.zoho.com",
      smtpPort: "465",
      smtpUser: "hello@demo-unimasi.co.id",
      smtpPassword: `demo-pass-${randSuffix(12)}`,
    },
  },
};
