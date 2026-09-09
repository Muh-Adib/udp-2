"use client";

import type { Brand, InvoiceDTO } from "@/lib/crm/types";
import { formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";

/** Ronde 47 — dokumen invoice siap cetak (A4) dengan KOP SURAT brand.
 * Sinkron penuh dengan konfigurasi brand (Brand Configuration):
 * - letterheadHeader/letterheadFooter (gambar kop upload per brand)
 * - letterTemplate JSON (font, warna aksen, catatan kaki)
 * - fallback identitas brand (logo, tagline, alamat, kontak)
 * Termasuk ringkasan pembayaran & sisa tagihan untuk kwitansi internal. */

interface PaymentLite {
  id: string;
  amount: number;
  method: string;
  reference?: string | null;
  paidAt: string | Date;
}

/** Perluasan defensif: project relasi + payments bisa null dari beberapa endpoint. */
type InvoicePrintLike = Omit<InvoiceDTO, "payments"> & {
  payments?: PaymentLite[] | null;
  project?: { id: string; name: string } | null;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  transfer: "Transfer Bank",
  cash: "Tunai",
  qris: "QRIS",
  credit_card: "Kartu Kredit",
};

/** Ronde 40-C — template surat brand (JSON di brand.letterTemplate). */
interface LetterTemplate {
  fontFamily?: string;
  accentColor?: string;
  headerStyle?: string;
  showLogo?: boolean;
  footerNote?: string;
}

function parseLetterTemplate(raw?: string | null): LetterTemplate {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as LetterTemplate)
      : {};
  } catch {
    return {};
  }
}

/** Terima hanya nilai hex yang valid agar inline style tidak korup. */
function safeHex(value?: string, fallback = "#0f172a"): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}

function paidAmount(inv: InvoicePrintLike): number {
  return (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
}

const STATUS_LABELS: Record<string, string> = {
  draft: "DRAFT",
  sent: "TERKIRIM",
  partial: "SEBAGIAN",
  paid: "LUNAS",
  overdue: "JATUH TEMPO",
  cancelled: "DIBATALKAN",
};

export function InvoicePrintArea({ invoice: inv, brand }: { invoice: InvoicePrintLike; brand?: Brand | null }) {
  const brandColor = brand?.color ?? "#18181b";
  const today = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  // Ronde 48 — showLogo & headerStyle kini benar-benar dipakai.
  const letter = parseLetterTemplate(brand?.letterTemplate);
  const fontFamily = letter.fontFamily?.trim() || "Helvetica";
  const accentColor = safeHex(letter.accentColor);
  const showLogo = letter.showLogo !== false;
  const centeredKop = letter.headerStyle === "logo-center";

  const paid = paidAmount(inv);
  const remaining = Math.max(0, inv.total - paid);
  const hasPayments = (inv.payments ?? []).length > 0;

  return (
    /* Ronde 48 — kanvas A4 presisi 794 × 1123 px; footer ter-anchored di dasar kertas. */
    <div
      id="print-area"
      className="mx-auto flex min-h-[1123px] w-[794px] max-w-full flex-col text-zinc-900"
      style={{ fontFamily: `"${fontFamily}", Arial, sans-serif` }}
    >
      {/* Kop surat gambar — FULL-WIDTH, rasio asli dipertahankan */}
      {brand?.letterheadHeader ? (
        <img src={brand.letterheadHeader} alt={`Kop surat ${brand.name}`} className="block w-full" />
      ) : null}

      <div className="flex flex-1 flex-col px-10 pt-6">
        {/* Kop fallback: hormati showLogo/headerStyle */}
        {!brand?.letterheadHeader ? (
          <div className={centeredKop ? "flex flex-col items-center gap-2 text-center" : "flex items-start justify-between gap-4"}>
            <div className="flex items-start gap-3">
              {showLogo && brand?.logoUrl ? (
                <img src={brand.logoUrl} alt={`Logo ${brand.name}`} className="h-12 w-auto max-w-28 object-contain" />
              ) : showLogo && brand ? (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg border text-2xl font-bold leading-none" style={{ color: brandColor }} aria-hidden>
                  {brand.name.charAt(0).toUpperCase()}
                </span>
              ) : null}
              <div className={centeredKop ? "flex flex-col items-center" : undefined}>
                <p className="text-xl font-bold leading-tight" style={{ color: brandColor }}>
                  {brand?.name ?? "UDP CRM"}
                </p>
                {brand?.tagline ? <p className="text-xs italic text-zinc-600">{brand.tagline}</p> : null}
                {brand?.address || brand?.city ? (
                  <p className="mt-0.5 max-w-sm text-[11px] leading-snug text-zinc-500">{brand?.address || brand?.city}</p>
                ) : brand?.description ? (
                  <p className="mt-0.5 max-w-sm text-[11px] leading-snug text-zinc-500">{brand.description}</p>
                ) : null}
                {brand?.phone || brand?.email ? (
                  <p className="mt-0.5 text-[11px] text-zinc-500">{[brand?.phone, brand?.email, brand?.website].filter(Boolean).join(" · ")}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

      <div className="mt-2 flex items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-bold uppercase tracking-wide" style={{ color: accentColor }}>Invoice</p>
          <p className="font-mono text-sm font-semibold">{inv.number}</p>
        </div>
        <div className="text-right">
          <span
            className="inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{
              borderColor: inv.status === "paid" ? "#059669" : inv.status === "cancelled" ? "#e11d48" : accentColor,
              color: inv.status === "paid" ? "#059669" : inv.status === "cancelled" ? "#e11d48" : accentColor,
            }}
          >
            {STATUS_LABELS[inv.status] ?? inv.status}
          </span>
        </div>
      </div>

      <div className="my-4 border-t-2" style={{ borderColor: accentColor }} />

      {/* Info dokumen + tujuan */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[220px]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Kepada</p>
          <p className="mt-1 text-base font-bold">{inv.company?.name ?? "-"}</p>
          <p className="text-xs text-zinc-600">
            {[inv.company?.industry, inv.company?.city, inv.company?.country].filter(Boolean).join(" · ") || "-"}
          </p>
        </div>
        <div className="space-y-1 text-xs">
          <p>
            <span className="text-zinc-500">Tanggal terbit: </span>
            <span className="font-medium">{formatDate(inv.issueDate)}</span>
          </p>
          <p>
            <span className="text-zinc-500">Jatuh tempo: </span>
            <span className="font-medium">{formatDate(inv.dueDate)}</span>
          </p>
          <p>
            <span className="text-zinc-500">Dicetak: </span>
            <span className="font-medium">{today}</span>
          </p>
        </div>
      </div>

      {/* Tabel item (invoice tunggal = satu baris tagihan) */}
      <table className="mt-5 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-100 text-left">
            <th className="border border-zinc-300 px-2 py-1.5 font-semibold">No</th>
            <th className="border border-zinc-300 px-2 py-1.5 font-semibold">Deskripsi</th>
            <th className="border border-zinc-300 px-2 py-1.5 text-right font-semibold">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-zinc-300 px-2 py-1.5 align-top">1</td>
            <td className="border border-zinc-300 px-2 py-1.5 align-top">
              {inv.description ?? "-"}
              {inv.project?.name ? (
                <span className="block text-[10px] text-zinc-500">Project: {inv.project.name}</span>
              ) : null}
            </td>
            <td className="border border-zinc-300 px-2 py-1.5 text-right align-top tabular-nums">
              {formatCurrencyFull(inv.amount, inv.currency)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Ringkasan total */}
      <div className="mt-4 flex justify-end">
        <table className="w-[300px] text-xs">
          <tbody>
            <tr>
              <td className="py-1 text-zinc-600">Subtotal</td>
              <td className="py-1 text-right font-medium tabular-nums">{formatCurrencyFull(inv.amount, inv.currency)}</td>
            </tr>
            <tr>
              <td className="py-1 text-zinc-600">{inv.taxName ? `${inv.taxName} ${inv.taxRate}%` : "Tanpa pajak"}</td>
              <td className="py-1 text-right font-medium tabular-nums">{formatCurrencyFull(inv.taxAmount, inv.currency)}</td>
            </tr>
            <tr className="border-t-4 border-double border-zinc-900">
              <td className="pt-1.5 text-sm font-bold uppercase">Total</td>
              <td className="pt-1.5 text-right text-sm font-bold tabular-nums">{formatCurrencyFull(inv.total, inv.currency)}</td>
            </tr>
            {hasPayments ? (
              <>
                <tr>
                  <td className="pt-1 text-emerald-700">Sudah dibayar</td>
                  <td className="pt-1 text-right font-medium tabular-nums text-emerald-700">{formatCurrencyFull(paid, inv.currency)}</td>
                </tr>
                <tr>
                  <td className="font-semibold">Sisa tagihan</td>
                  <td className={`text-right font-bold tabular-nums ${remaining > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                    {formatCurrencyFull(remaining, inv.currency)}
                  </td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Riwayat pembayaran (kwitansi internal) */}
      {hasPayments ? (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Riwayat Pembayaran</p>
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-100 text-left">
                <th className="border border-zinc-300 px-2 py-1 font-semibold">Tanggal</th>
                <th className="border border-zinc-300 px-2 py-1 font-semibold">Metode</th>
                <th className="border border-zinc-300 px-2 py-1 font-semibold">Referensi</th>
                <th className="border border-zinc-300 px-2 py-1 text-right font-semibold">Nominal</th>
              </tr>
            </thead>
            <tbody>
              {(inv.payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="border border-zinc-300 px-2 py-1">{formatDateTime(p.paidAt)}</td>
                  <td className="border border-zinc-300 px-2 py-1">{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="border border-zinc-300 px-2 py-1">{p.reference ?? "-"}</td>
                  <td className="border border-zinc-300 px-2 py-1 text-right tabular-nums">{formatCurrencyFull(p.amount, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Catatan */}
      {inv.notes ? (
        <div className="mt-5 border-l-4 border-zinc-300 pl-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Catatan</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-700">{inv.notes}</p>
        </div>
      ) : null}

      {/* Tanda tangan */}
      <div className="mt-10 flex justify-end">
        <div className="text-right text-xs">
          <p className="font-semibold">Hormat kami,</p>
          <div className="mt-12 border-t border-zinc-400 pt-1">
            <p className="font-medium" style={{ color: brandColor }}>{brand?.name ?? "-"}</p>
          </div>
        </div>
      </div>
      </div>

      {/* Footer surat — ANCHOR DASAR HALAMAN: tidak pernah naik walau isi pendek */}
      <div className="kop-footer-anchor mt-auto">
        {brand?.letterheadFooter ? (
          <img src={brand.letterheadFooter} alt={`Kaki surat ${brand.name}`} className="block w-full" />
        ) : (
          <p className="mx-10 mb-5 border-t border-dashed border-zinc-300 pt-2 text-center text-[10px] text-zinc-500">
            {brand?.website ? `${brand.name} · ${brand.website.replace(/^https?:\/\//, "")} · ` : ""}
            {letter.footerNote?.trim() || "Mohon lakukan pembayaran sebelum jatuh tempo. Terima kasih."}
          </p>
        )}
      </div>
    </div>
  );
}
