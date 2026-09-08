/**
 * Ronde 42 — Validasi format input (email, nomor telepon/WhatsApp) + util link WhatsApp.
 * Dipakai bersama oleh form kontak (modul Contacts), konversi lead (Inbox), dan form lain.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Email valid? Kosong = valid (field opsional) — keputusan wajib/tidak ada di pemanggil. */
export function isValidEmail(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  if (!s) return true;
  return EMAIL_RE.test(s);
}

/** Pesan error email, atau null bila valid. */
export function emailError(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return EMAIL_RE.test(s) ? null : "Format email tidak valid — contoh yang benar: nama@perusahaan.co.id";
}

/** Jumlah digit dalam string nomor. */
function digitCount(v: string): number {
  return (v.match(/\d/g) ?? []).length;
}

/**
 * Nomor nasional (tanpa kode negara) valid? Aturan:
 * - hanya digit, spasi, tanda hubung, kurung, titik
 * - 5–15 digit
 * - TIDAK diawali 0 / 08 (kode negara didepannya dari dropdown dial — permintaan Ronde 42)
 */
export function nationalPhoneError(v: string | null | undefined, allowLeadingZero: boolean): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (/[^+\d\-().\s]/.test(s)) return "Nomor hanya boleh berisi angka, spasi, tanda hubung, dan kurung.";
  const digits = digitCount(s);
  if (digits < 5) return "Nomor terlalu pendek — minimal 5 digit.";
  if (digits > 15) return "Nomor terlalu panjang — maksimal 15 digit (standar E.164).";
  const compact = s.replace(/\D/g, "");
  if (!allowLeadingZero && compact.startsWith("0")) {
    return "Tanpa awalan 0 — pilih kode negara di dropdown, lalu tulis nomor langsung (cth. 81234567890).";
  }
  return null;
}

/** E.164 penuh (mis. "628123456789") → URL wa.me; null bila tidak layak. */
export function waMeLink(e164: string | null | undefined): string | null {
  const digits = (e164 ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const noLeadingZero = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${noLeadingZero}`;
}
