/**
 * Ronde 50 — CORE penomoran dokumen (MURNI, tanpa import DB — aman untuk client & server).
 *
 * Sistem penomoran per brand per jenis surat memakai TEMPLATE dgn token:
 *   {SEQ:3}  nomor urut zero-padded 3 digit; pada dokumen revisi → "012-1" (sufiks revisi)
 *   {SEQ}    nomor urut tanpa padding eksplisit (pad = lebar seq, minimal 1)
 *   {DOC}    kode jenis dokumen dari rule.docCode (mis. QT, INV)
 *   {BRAND}  kode singkat brand (brand.shortCode, mis. UDP)
 *   {ROMAN}  bulan romawi kapital (I..XII); {roman} huruf kecil
 *   {MM}     bulan 2 digit; {YY} tahun 2 digit; {YYYY} tahun 4 digit
 *
 * Contoh: template "{SEQ:3}/{DOC}-{BRAND}/{ROMAN}/{YY}" → "002/QT-UDP/I/26"
 * Revisi ke-1 dari seq 12 → "012-1/QT-UDP/I/26".
 */

export const NUMBERING_TOKENS = ["SEQ", "DOC", "BRAND", "ROMAN", "roman", "MM", "YY", "YYYY"] as const;

/** Regex token valid — dipakai untuk validasi template di API & highlight di UI builder. */
export const NUMBERING_TOKEN_RE = /\{(SEQ(?::\d{1,3})?|DOC|BRAND|ROMAN|roman|MM|YY|YYYY)\}/g;

/** Whitelist docType yang punya sistem penomoran (tambah di sini untuk jenis surat baru). */
export const NUMBERING_DOC_TYPES = ["quotation", "invoice"] as const;
export type NumberingDocType = (typeof NUMBERING_DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<NumberingDocType, string> = {
  quotation: "Quotation / Penawaran",
  invoice: "Invoice / Faktur",
};

/** Kode {DOC} default per jenis (bila admin tidak mengisi). */
export const DOC_TYPE_DEFAULT_CODE: Record<NumberingDocType, string> = {
  quotation: "QT",
  invoice: "INV",
};

export interface NumberingRuleContext {
  seq: number;
  /** 0 = dokumen asli; N = revisi ke-N (sufiks "-N" pada token SEQ). */
  revisionNo?: number;
  date?: Date;
  docCode?: string;
  brandCode?: string;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function monthRoman(date: Date): string {
  return ROMAN[date.getMonth()] ?? "I";
}

export function padSeq(seq: number, width: number): string {
  const safe = Math.max(1, Math.floor(width || 1));
  return String(Math.max(0, Math.floor(seq))).padStart(safe, "0");
}

/**
 * Render template → nomor dokumen final.
 * Revisi: sufiks "-N" menempel pada bagian SEQ (012 → 012-1) sesuai mekanisme revisi dokumen.
 */
export function renderNumberTemplate(template: string, ctx: NumberingRuleContext): string {
  const date = ctx.date ?? new Date();
  const revisionNo = Math.max(0, Math.floor(ctx.revisionNo ?? 0));
  const seqRaw = Math.max(0, Math.floor(ctx.seq));
  return template.replace(NUMBERING_TOKEN_RE, (_full, token: string) => {
    if (token === "DOC") return (ctx.docCode ?? "").trim() || "DOC";
    if (token === "BRAND") return (ctx.brandCode ?? "").trim() || "BRAND";
    if (token === "ROMAN") return monthRoman(date);
    if (token === "roman") return monthRoman(date).toLowerCase();
    if (token === "MM") return String(date.getMonth() + 1).padStart(2, "0");
    if (token === "YY") return String(date.getFullYear() % 100).padStart(2, "0");
    if (token === "YYYY") return String(date.getFullYear());
    if (token === "SEQ") return String(seqRaw) + (revisionNo > 0 ? `-${revisionNo}` : "");
    const padMatch = /^SEQ:(\d{1,3})$/.exec(token);
    if (padMatch) return padSeq(seqRaw, Number(padMatch[1])) + (revisionNo > 0 ? `-${revisionNo}` : "");
    return "";
  });
}

/**
 * Validasi template builder:
 * - wajib memuat minimal satu token {SEQ...}
 * - hanya token whitelist + teks biasa (tanpa kurung kurawal liar)
 */
export function validateNumberingTemplate(template: string): { valid: boolean; error?: string } {
  const t = template.trim();
  if (t.length < 3) return { valid: false, error: "Template terlalu pendek (min. 3 karakter)" };
  if (t.length > 80) return { valid: false, error: "Template maksimal 80 karakter" };
  if (!/\{SEQ(?::\d{1,3})?\}/.test(t)) return { valid: false, error: "Template wajib memuat token {SEQ} atau {SEQ:3}" };
  const withoutTokens = t.replace(NUMBERING_TOKEN_RE, "");
  if (/[{}]/.test(withoutTokens)) {
    return { valid: false, error: "Ada token tidak dikenal — gunakan chip token yang tersedia saja" };
  }
  return { valid: true };
}

/** Kunci periode utk reset counter: yearly → "2026", monthly → "2026-01", never → "" (tetap). */
export function periodKey(resetPeriod: string, date: Date): string {
  if (resetPeriod === "yearly") return String(date.getFullYear());
  if (resetPeriod === "monthly") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return "";
}

export const RESET_PERIOD_LABELS: Record<string, string> = {
  never: "Tidak pernah reset (counter terus berjalan)",
  yearly: "Reset tiap tahun (Januari mulai dari 1 lagi)",
  monthly: "Reset tiap bulan",
};

/**
 * Lepas sufiks revisi dari nomor: "012-1/QT-UDP/I/26" → "012/QT-UDP/I/26".
 * Hanya menyentuh segmen SEQ di depan (sebelum separator pertama).
 */
export function stripRevisionSuffix(number: string): string {
  const idx = number.indexOf("/");
  const head = idx === -1 ? number : number.slice(0, idx);
  const tail = idx === -1 ? "" : number.slice(idx);
  const stripped = head.replace(/-\d+$/, "");
  return stripped + tail;
}
