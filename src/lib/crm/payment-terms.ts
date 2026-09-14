/**
 * Ronde 57 — Mesin Term of Payment (TOP) terstruktur yang DIPAKAI BERSAMA
 * oleh Quotation (penawaran) & Invoice (finance) agar jatuh tempo SELALU sinkron.
 *
 * Alur sinkronisasi:
 *   1. Sales mengisi TOP terstruktur di dialog quotation (label, %, momen jatuh tempo,
 *      offset hari) — mis. DP 50% setelah invoice terbit, Final 50% H+3 setelah BASTP.
 *   2. Server menyimpan jadwal di `Quotation.terms` (JSON) SEKALIGUS men-generate
 *      teks `termOfPayment` berformat standar (EN — dokumen Inggris) supaya PDF,
 *      cetak, dan halaman share publik menampilkan format yang konsisten.
 *   3. Saat quotation diterima & dikonversi menjadi invoice (finance), jadwal termin
 *      quotation DIWARISI penuh oleh `Invoice.terms` — finance menghitung jatuh tempo
 *      dari kombinasi dueEvent + dueDays tanpa input ulang.
 *
 * dueEvent (momen mulai jatuh tempo):
 *   - invoice       : setelah invoice terbit
 *   - down_payment  : setelah DP diterima (project mulai)
 *   - bastp         : setelah BASTP (serah terima pekerjaan) ditandatangani
 *   - handover      : setelah serah terima project
 *   - delivery      : setelah final delivery
 */

export interface PaymentTerm {
  label: string;
  pct: number;
  dueDays: number;
  dueEvent: string;
}

/** Opsi momen jatuh tempo — satu sumber kebenaran untuk UI quotation & finance. */
export const DUE_EVENTS: Array<{ value: string; label: string }> = [
  { value: "invoice", label: "Setelah invoice terbit" },
  { value: "down_payment", label: "Setelah DP diterima" },
  { value: "bastp", label: "Setelah BASTP ditandatangani" },
  { value: "handover", label: "Setelah serah terima project" },
  { value: "delivery", label: "Setelah final delivery" },
];

const EVENT_VALUES = DUE_EVENTS.map((e) => e.value);

/**
 * Validasi & sanitasi jadwal termin dari body request / JSON tersimpan.
 * - maks 6 baris, label wajib (fallback "Payment"), pct 0–100, dueDays 0–365,
 *   dueEvent di-whitelist (nilai asing → "invoice").
 */
export function parsePaymentTerms(raw: unknown): PaymentTerm[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object")
    .slice(0, 6)
    .map((t) => {
      const term = t as { label?: unknown; pct?: unknown; dueDays?: unknown; dueEvent?: unknown };
      const label = String(term.label ?? "").trim().slice(0, 80) || "Payment";
      const pct = Math.min(100, Math.max(0, Number(term.pct) || 0));
      const dueDays = Math.min(365, Math.max(0, Math.round(Number(term.dueDays) || 0)));
      const dueEvent = EVENT_VALUES.includes(String(term.dueEvent)) ? String(term.dueEvent) : "invoice";
      return { label, pct, dueDays, dueEvent };
    });
}

/** Parse JSON tersimpan (kolom terms) → baris valid; tidak pernah throw. */
export function parseTermsJson(raw: string | null | undefined): PaymentTerm[] {
  if (!raw) return [];
  try {
    return parsePaymentTerms(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Total persentase semua termin — UI memakainya untuk validasi 100%. */
export function termPctSum(terms: PaymentTerm[]): number {
  return terms.reduce((s, t) => s + (Number(t.pct) || 0), 0);
}

/**
 * Deskripsi jatuh tempo termin dalam bahasa Inggris (dokumen EN).
 * Dipakai di PDF quotation/invoice & teks TOP terformat.
 */
export function describeDueEn(event: string | undefined, dueDays: number | undefined): string {
  const days = Math.max(0, Math.round(Number(dueDays) || 0));
  const n = (txt: string) => (days > 0 ? `${days} day${days > 1 ? "s" : ""} after ${txt}` : `upon ${txt}`);
  switch ((event ?? "invoice").toLowerCase()) {
    case "down_payment": return n("down payment received");
    case "bastp": return days > 0 ? `${days} day${days > 1 ? "s" : ""} after BASTP signed — project handover` : "upon BASTP signed — project handover";
    case "handover": return n("project handover");
    case "delivery": return n("final delivery");
    default: return n("invoice issuance");
  }
}

/**
 * Format hasil TOP standar (gaya Unicam) — inilah "hasil formatnya" yang tampil
 * di dokumen penawaran, halaman share, dan preview editor:
 *   1. Down Payment: 50% (upon invoice issuance)
 *   2. Final Payment: 50% (3 days after BASTP signed — project handover)
 */
export function formatTermOfPaymentText(terms: PaymentTerm[]): string {
  return terms
    .filter((t) => t.label.trim() !== "")
    .map((t, i) => `${i + 1}. ${t.label.trim()}: ${Math.round(Number(t.pct) || 0)}% (${describeDueEn(t.dueEvent, t.dueDays)})`)
    .join("\n");
}

/** Termin default (mengikuti contoh Unicam): DP 50% setelah invoice + Final 50% H+3 setelah BASTP. */
export function defaultPaymentTerms(): PaymentTerm[] {
  return [
    { label: "Down Payment", pct: 50, dueDays: 0, dueEvent: "invoice" },
    { label: "Final Payment", pct: 50, dueDays: 3, dueEvent: "bastp" },
  ];
}
