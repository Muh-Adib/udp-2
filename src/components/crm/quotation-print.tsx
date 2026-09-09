"use client";

import type { Brand, QuotationDTO, QuotationItemDTO } from "@/lib/crm/types";
import { formatCurrencyFull, formatDate } from "@/lib/crm/utils";

/** Parsing defensif item quotation (bisa string JSON dari API atau array). */
function parseItems(items: string | QuotationItemDTO[]): QuotationItemDTO[] {
  if (Array.isArray(items)) return items;
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? (parsed as QuotationItemDTO[]) : [];
  } catch {
    return [];
  }
}

/** Ronde 40-C — template surat brand (JSON di brand.letterTemplate), dipakai
 * untuk font, warna aksen & catatan kaki dokumen quotation. */
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

/**
 * Layout dokumen quotation siap cetak (A4-friendly).
 * Dirender di dalam #print-area — hanya tampil saat window.print() (lihat globals.css).
 */
export function QuotationPrintArea({ quotation: q, brand }: { quotation: QuotationDTO; brand?: Brand | null }) {
  const items = parseItems(q.items);
  const brandColor = brand?.color ?? "#18181b";
  const docDate = q.sentAt ?? q.createdAt;
  const today = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  // Ronde 40-C — terapkan template surat brand (font & aksen) dgn default Helvetica / #0f172a.
  // Ronde 48 — showLogo & headerStyle KINI benar-benar dipakai (sebelumnya tersimpan tapi diabaikan).
  const letter = parseLetterTemplate(brand?.letterTemplate);
  const fontFamily = letter.fontFamily?.trim() || "Helvetica";
  const accentColor = safeHex(letter.accentColor);
  const showLogo = letter.showLogo !== false;
  const centeredKop = letter.headerStyle === "logo-center";

  return (
    /* Ronde 48 — kanvas A4 presisi: 794 × 1123 px (96 DPI). Flex-col + mt-auto
     * menancapkan footer ke DASAR kertas — tidak naik walau isi surat pendek. */
    <div
      id="print-area"
      className="mx-auto flex min-h-[1123px] w-[794px] max-w-full flex-col text-zinc-900"
      style={{ fontFamily: `"${fontFamily}", Arial, sans-serif` }}
    >
      {/* Kop surat gambar — FULL-WIDTH 794px, rasio asli dipertahankan (tinggi mengikuti gambar).
       * Tidak lagi dipaksa h-24 object-contain yang membuat kop letterbox/terpotong. */}
      {brand?.letterheadHeader ? (
        <img src={brand.letterheadHeader} alt={`Kop surat ${brand.name}`} className="block w-full" />
      ) : null}

      <div className="flex flex-1 flex-col px-10 pt-6">
        {/* Kop fallback (tanpa gambar): logo + identitas brand — hormati showLogo/headerStyle */}
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

        <div className="mt-2 flex items-end justify-end gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold uppercase tracking-wide" style={{ color: accentColor }}>Quotation</p>
            <p className="font-mono text-sm font-semibold">{q.number}</p>
          </div>
        </div>

      <div className="my-4 border-t-2" style={{ borderColor: accentColor }} />

      {/* Info dokumen + tujuan */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[220px]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Kepada</p>
          <p className="mt-1 text-base font-bold">{q.company?.name ?? "-"}</p>
          <p className="text-xs text-zinc-600">
            {[q.company?.industry, q.company?.city, q.company?.country].filter(Boolean).join(" · ") || "-"}
          </p>
        </div>
        <div className="space-y-1 text-xs">
          <p>
            <span className="text-zinc-500">Tanggal: </span>
            <span className="font-medium">{formatDate(docDate)}</span>
          </p>
          <p>
            <span className="text-zinc-500">Dicetak: </span>
            <span className="font-medium">{today}</span>
          </p>
          {q.validUntil ? (
            <p>
              <span className="text-zinc-500">Berlaku s/d: </span>
              <span className="font-medium">{formatDate(q.validUntil)}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* Tabel item */}
      <table className="mt-5 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-zinc-100 text-left">
            <th className="border border-zinc-300 px-2 py-1.5 font-semibold">No</th>
            <th className="border border-zinc-300 px-2 py-1.5 font-semibold">Deskripsi</th>
            <th className="border border-zinc-300 px-2 py-1.5 text-right font-semibold">Qty</th>
            <th className="border border-zinc-300 px-2 py-1.5 text-right font-semibold">Harga Satuan</th>
            <th className="border border-zinc-300 px-2 py-1.5 text-right font-semibold">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="border border-zinc-300 px-2 py-3 text-center text-zinc-400">
                Tidak ada item.
              </td>
            </tr>
          ) : (
            items.map((it, idx) => (
              <tr key={idx}>
                <td className="border border-zinc-300 px-2 py-1.5 align-top">{idx + 1}</td>
                <td className="border border-zinc-300 px-2 py-1.5 align-top">{it.description}</td>
                <td className="border border-zinc-300 px-2 py-1.5 text-right align-top tabular-nums">{it.qty}</td>
                <td className="border border-zinc-300 px-2 py-1.5 text-right align-top tabular-nums">
                  {formatCurrencyFull(it.unitPrice, q.currency)}
                </td>
                <td className="border border-zinc-300 px-2 py-1.5 text-right align-top tabular-nums">
                  {formatCurrencyFull(it.subtotal, q.currency)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Ringkasan total */}
      <div className="mt-4 flex justify-end">
        <table className="w-[300px] text-xs">
          <tbody>
            <tr>
              <td className="py-1 text-zinc-600">Subtotal</td>
              <td className="py-1 text-right font-medium tabular-nums">{formatCurrencyFull(q.subtotal, q.currency)}</td>
            </tr>
            <tr>
              <td className="py-1 text-zinc-600">Diskon {q.discountPct}%</td>
              <td className="py-1 text-right font-medium tabular-nums">-{formatCurrencyFull(q.discountAmount, q.currency)}</td>
            </tr>
            <tr>
              <td className="py-1 text-zinc-600">PPN {q.taxPct}%</td>
              <td className="py-1 text-right font-medium tabular-nums">{formatCurrencyFull(q.taxAmount, q.currency)}</td>
            </tr>
            <tr className="border-t-4 border-double border-zinc-900">
              <td className="pt-1.5 text-sm font-bold uppercase">Total</td>
              <td className="pt-1.5 text-right text-sm font-bold tabular-nums">{formatCurrencyFull(q.total, q.currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Catatan */}
      {q.notes ? (
        <div className="mt-5 border-l-4 border-zinc-300 pl-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Catatan</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-700">{q.notes}</p>
        </div>
      ) : null}

      {/* Tanda tangan */}
      <div className="mt-10 flex justify-between">
        <div className="text-xs">
          <p className="font-semibold">Disetujui oleh,</p>
          <div className="mt-12 border-t border-zinc-400 pt-1">
            <p className="font-medium">{q.company?.name ?? "Klien"}</p>
          </div>
        </div>
        <div className="text-right text-xs">
          <p className="font-semibold">Hormat kami,</p>
          <div className="mt-12 border-t border-zinc-400 pt-1">
            <p className="font-medium" style={{ color: brandColor }}>{brand?.name ?? "-"}</p>
          </div>
        </div>
      </div>
      </div>

      {/* Footer surat — ANCHOR DASAR HALAMAN (mt-auto + break-inside avoid):
       * gambar full-width rasio asli; tidak pernah "naik" walau isi surat pendek. */}
      <div className="kop-footer-anchor mt-auto">
        {brand?.letterheadFooter ? (
          <img src={brand.letterheadFooter} alt={`Kaki surat ${brand.name}`} className="block w-full" />
        ) : (
          <p className="mx-10 mb-5 border-t border-dashed border-zinc-300 pt-2 text-center text-[10px] text-zinc-500">
            {brand?.website ? `${brand.name} · ${brand.website.replace(/^https?:\/\//, "")} · ` : ""}
            {letter.footerNote?.trim() || "Terima kasih atas kepercayaan Anda."}
          </p>
        )}
      </div>
    </div>
  );
}
