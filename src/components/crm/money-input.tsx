"use client";

/**
 * Ronde 56 — input nominal sadar-lokasi (permintaan user: "semua input nominal
 * disesuaikan negaranya — USD ada desimal, Indonesia ada pemecah ribuan
 * sehingga user tidak bingung").
 *
 * Perilaku:
 * - IDR → pemisah ribuan gaya id (1.850.000), TANPA desimal.
 * - USD (dan mata uang lain) → pemisah ribuan + 2 desimal (1,850,000.00).
 * - User tetap mengetik angka biasa; tampilan diformat saat blur/focus-out,
 *   nilai mentah (number) dikirim lewat onChange agar API tak berubah.
 */

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function formatMoneyDisplay(raw: string, currency: string): string {
  const cur = (currency ?? "IDR").toUpperCase();
  const isDecimal = cur !== "IDR";
  // Buang semua non-digit kecuali titik/koma pertama sbg desimal
  let cleaned = raw.replace(/[^\d.,]/g, "");
  // Normalisasi: koma → titik (input user Indonesia)
  if (isDecimal) {
    cleaned = cleaned.replace(/,/g, ".");
    const parts = cleaned.split(".");
    const frac = parts.length > 1 ? parts.pop() ?? "" : "";
    const intPart = parts.join("").slice(0, 15);
    const grouped = intPart ? Number(intPart).toLocaleString("en-US") : "";
    const frac2 = frac.slice(0, 2);
    return grouped + (cleaned.endsWith(".") || frac2 ? `.${frac2}` : "");
  }
  const digits = cleaned.replace(/\D/g, "").slice(0, 15);
  return digits ? Number(digits).toLocaleString("id-ID") : "";
}

/** Nilai number dari teks terformat (memahami 1.850.000 dan 1,850,000.00). */
export function parseMoneyInput(formatted: string): number | null {
  // Ambil digit + pemisah; tentukan desimal terakhir
  let s = formatted.trim();
  if (!s) return null;
  s = s.replace(/ IDR| USD| Rp|US\$/gi, "").trim();
  // Gaya id: titik = ribuan, koma = desimal. Gaya en: koma = ribuan, titik = desimal.
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // pemisah terakhir menang sebagai desimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    const parts = s.split(",");
    if (parts[parts.length - 1].length === 3) s = s.replace(/,/g, ""); // ribuan
    else s = s.replace(",", ".");
  }
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function MoneyInput({
  value,
  onChange,
  currency = "IDR",
  id,
  className,
  placeholder,
  disabled,
  required,
  ariaLabel,
}: {
  value: string; // nilai mentah (string angka) atau "" — dikontrol parent
  onChange: (raw: string) => void;
  currency?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  // Tampilan terkontrol penuh tanpa ref/effect: saat user sedang mengetik
  // (focused + draft aktif) tampilkan draft; selain itu tampilkan nilai prop
  // yang sudah diformat — otomatis sinkron saat form di-reset dari luar.
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const formattedValue = value ? formatMoneyDisplay(value, currency) : "";
  const display = focused && draft !== null ? draft : formattedValue;

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-400" aria-hidden>
        {(currency ?? "IDR").toUpperCase()}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        className={cn("pl-11", className)}
        value={display}
        placeholder={placeholder ?? (currency.toUpperCase() === "IDR" ? "1.850.000" : "1,850,000.00")}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel ?? `Nominal dalam ${currency}`}
        onFocus={() => {
          setFocused(true);
          setDraft(formattedValue); // mulai mengetik dari nilai terformat saat ini
        }}
        onChange={(e) => {
          const formatted = formatMoneyDisplay(e.target.value, currency);
          setDraft(formatted);
          const raw = parseMoneyInput(formatted);
          onChange(raw === null ? "" : String(raw));
        }}
        onBlur={() => {
          setFocused(false);
          setDraft(null); // kembali menampilkan nilai prop terformat
        }}
      />
    </div>
  );
}
