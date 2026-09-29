"use client";

/**
 * Ronde 50 — TERBILANG (angka → kata) untuk dokumen faktur.
 * Contoh wajib (dari format invoice Unicam):
 *   15.435.000 → ID: "Lima Belas Juta Empat Ratus Tiga Puluh Lima Ribu Rupiah"
 *              → EN: "Fifteen Million Four Hundred Thirty-Five Thousand Rupiah"
 */

// ============ INDONESIA ============

const ID_UNITS = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];

function idWords(n: number): string {
  if (n < 12) return ID_UNITS[n] ?? "";
  if (n < 20) return `${idWords(n - 10)} Belas`;
  if (n < 100) return [idWords(Math.floor(n / 10)), "Puluh", idWords(n % 10)].filter(Boolean).join(" ");
  if (n < 200) return n % 100 ? `Seratus ${idWords(n % 100)}` : "Seratus";
  if (n < 1000) return [idWords(Math.floor(n / 100)), "Ratus", idWords(n % 100)].filter(Boolean).join(" ");
  if (n < 2000) return n % 1000 ? `Seribu ${idWords(n % 1000)}` : "Seribu";
  if (n < 1_000_000) return [idWords(Math.floor(n / 1000)), "Ribu", idWords(n % 1000)].filter(Boolean).join(" ");
  if (n < 1_000_000_000) return [idWords(Math.floor(n / 1_000_000)), "Juta", idWords(n % 1_000_000)].filter(Boolean).join(" ");
  if (n < 1_000_000_000_000) return [idWords(Math.floor(n / 1_000_000_000)), "Miliar", idWords(n % 1_000_000_000)].filter(Boolean).join(" ");
  return [idWords(Math.floor(n / 1_000_000_000_000)), "Triliun", idWords(n % 1_000_000_000_000)].filter(Boolean).join(" ");
}

/** "Lima Belas Juta Empat Ratus Tiga Puluh Lima Ribu Rupiah" (IDR); mata uang lain → kode. */
export function terbilangID(amount: number, currency = "IDR"): string {
  const n = Math.round(Math.abs(amount));
  if (!Number.isFinite(n) || n === 0) return currency === "IDR" ? "Nol Rupiah" : `Nol ${currency}`;
  const words = idWords(n);
  if (currency === "IDR") return `${words} Rupiah`;
  return `${words} ${currency}`;
}

// ============ ENGLISH ============

const EN_UNITS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function enWords(n: number): string {
  if (n < 20) return EN_UNITS[n] ?? "Zero";
  if (n < 100) {
    const t = EN_TENS[Math.floor(n / 10)];
    return n % 10 ? `${t}-${EN_UNITS[n % 10]}` : t;
  }
  if (n < 1000) return [enWords(Math.floor(n / 100)), "Hundred", enWords(n % 100)].filter(Boolean).join(" ");
  const scales: Array<[number, string]> = [
    [1_000_000_000_000, "Trillion"],
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ];
  for (const [scale, label] of scales) {
    if (n >= scale) {
      return [enWords(Math.floor(n / scale)), label, enWords(n % scale)].filter(Boolean).join(" ");
    }
  }
  return EN_UNITS[n] ?? "Zero";
}

const CURRENCY_EN: Record<string, string> = {
  IDR: "Rupiah",
  USD: "US Dollars",
  SGD: "Singapore Dollars",
  MYR: "Malaysian Ringgit",
  EUR: "Euros",
  GBP: "Pounds Sterling",
  JPY: "Japanese Yen",
  AUD: "Australian Dollars",
  CNY: "Chinese Yuan",
  HKD: "Hong Kong Dollars",
};

/** "Fifteen Million Four Hundred Thirty-Five Thousand Rupiah" (IDR); mata uang lain pakai namanya. */
export function terbilangEN(amount: number, currency = "IDR"): string {
  const n = Math.round(Math.abs(amount));
  const unit = CURRENCY_EN[currency?.toUpperCase() ?? "IDR"] ?? currency ?? "Rupiah";
  if (!Number.isFinite(n) || n === 0) return `Zero ${unit}`;
  return `${enWords(n)} ${unit}`;
}
