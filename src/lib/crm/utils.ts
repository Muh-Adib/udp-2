// ============ Normalisasi identitas (anti-duplikat) ============

/** Normalisasi nomor telepon/WhatsApp ke digit internasional (default Indonesia +62). */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;
  // 08xx -> 628xx
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  return digits;
}

/** Email valid sejati (x@y.tld) — MENOLAK handle Instagram (@username) dan teks bebas. */
export function isValidEmail(raw?: string | null): boolean {
  if (!raw) return false;
  const s = raw.trim();
  if (s.startsWith("@")) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s);
}

/**
 * Ekstrak email valid PERTAMA dari teks bebas (contoh: body pesan), lowercase.
 * Handle IG seperti "@rani.creativehouse" TIDAK dianggap email (domain tanpa TLD rill).
 */
export function extractEmailFromText(raw?: string | null): string | null {
  if (!raw) return null;
  const matches = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (!matches) return null;
  for (const candidate of matches) {
    if (isValidEmail(candidate)) return candidate.toLowerCase();
  }
  return null;
}

/** Deteksi handle sosial (Instagram/Twitter): diawali @ dan tanpa spasi. */
export function isSocialHandle(raw?: string | null): boolean {
  if (!raw) return false;
  const s = raw.trim();
  return s.startsWith("@") && !s.includes(" ") && s.length > 1;
}

/** Normalisasi email: lowercase + trim + VALIDASI asli (handle IG/teks sampah → null). */
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return isValidEmail(email) ? email : null;
}

/** Ambil domain dari website/email perusahaan. */
export function extractDomain(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (!s.includes(".")) return null;
  return s;
}

function tokenize(name?: string | null): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/\b(pt|cv|tb|persero|yayasan|kementerian|dinas|the|inc|ltd|llc|company|corporation)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Kemiripan nama sederhana berbasis token overlap (Jaccard). */
export function nameSimilarity(a?: string | null, b?: string | null): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : Math.round((inter / union) * 100);
}

export interface MatchCandidate {
  contactId: string;
  score: number;
  reasons: string[];
}

export interface MatchInput {
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  fullName?: string | null;
  companyName?: string | null;
}

/** Nilai "matchable" untuk pencarian sisi server. */
export function matchableIdentity(input: MatchInput) {
  return {
    email: normalizeEmail(input.email),
    whatsapp: normalizePhone(input.whatsapp),
    phone: normalizePhone(input.phone),
    fullName: input.fullName?.trim() || null,
    companyName: input.companyName?.trim() || null,
  };
}

// ============ Format helpers ============

export function formatCurrency(value?: number | null, currency = "IDR"): string {
  if (value === null || value === undefined) return "-";
  if (currency === "IDR") {
    if (Math.abs(value) >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)} M`;
    if (Math.abs(value) >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(0)} jt`;
    return `Rp ${value.toLocaleString("id-ID")}`;
  }
  return `${currency} ${value.toLocaleString("en-US")}`;
}

export function formatCurrencyFull(value?: number | null, currency = "IDR"): string {
  if (value === null || value === undefined) return "-";
  if (currency === "IDR") return `Rp ${value.toLocaleString("id-ID")}`;
  return `${currency} ${value.toLocaleString("en-US")}`;
}

export function formatDate(d?: string | Date | null): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d?: string | Date | null): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d?: string | Date | null): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  return `${months} bulan lalu`;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function parseJsonArray(s?: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
