"use client";

import type { Brand, QuotationDTO, QuotationItemDTO } from "@/lib/crm/types";
import { formatDate } from "@/lib/crm/utils";

/**
 * Ronde 50 — TEMPLATE SURAT PENAWARAN (gaya Unicam) siap cetak A4.
 * Struktur sesuai contoh dokumen resmi:
 *   Number / Attachment / Regarding → To / Attn. / Address → Dear … (isi surat)
 *   → tabel No|Description|Unit|Unit Price|Amount + TOTAL
 *   → blok Timeline | Revision | Notes | Term of Payment
 *   → paragraf penutup (kontak brand) + tanda tangan.
 * Kop surat per jenis dokumen: brand.docAssets.quotation → fallback letterheadHeader umum.
 */

function parseItems(items: string | QuotationItemDTO[]): QuotationItemDTO[] {
  if (Array.isArray(items)) return items;
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? (parsed as QuotationItemDTO[]) : [];
  } catch {
    return [];
  }
}

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

interface DocAssetSet {
  header?: string | null;
  footer?: string | null;
}

/** Ronde 50 — aset kop per jenis dokumen (JSON brand.docAssets). */
function parseDocAssets(raw?: string | null): Record<string, DocAssetSet> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DocAssetSet>)
      : {};
  } catch {
    return {};
  }
}

function safeHex(value?: string, fallback = "#0f172a"): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}

/** Uang dokumen quotation: IDR → "99,987,000" (tanpa simbol, sesuai contoh); lainnya → "USD 1,234.56". */
function docMoney(amount: number, currency: string): string {
  const n = Math.round(amount);
  if (currency === "IDR") {
    return n.toLocaleString("en-US");
  }
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function QuotationPrintArea({ quotation: q, brand }: { quotation: QuotationDTO; brand?: Brand | null }) {
  const items = parseItems(q.items);
  const brandColor = brand?.color ?? "#18181b";
  const letter = parseLetterTemplate(brand?.letterTemplate);
  const docAssets = parseDocAssets(brand?.docAssets);
  const fontFamily = letter.fontFamily?.trim() || "Helvetica";
  const accentColor = safeHex(letter.accentColor);
  const showLogo = letter.showLogo !== false;
  const centeredKop = letter.headerStyle === "logo-center";

  // Ronde 50 — kop per jenis surat: quotation punya gambar sendiri, fallback ke kop umum brand.
  const headerImg = docAssets.quotation?.header ?? brand?.letterheadHeader ?? null;
  const footerImg = docAssets.quotation?.footer ?? brand?.letterheadFooter ?? null;

  const attn = q.attn?.trim() || "-";
  const clientAddress = q.clientAddress?.trim() || brand?.address || q.company?.address || [q.company?.city, q.company?.country].filter(Boolean).join(", ") || "-";
  const attachment = q.attachment ?? 1;
  const regarding = q.regarding?.trim() || `Quotation${q.opportunity?.title ? ` — ${q.opportunity.title}` : ""}`;

  // Isi surat: custom (letterBody) atau default otomatis sesuai gaya Unicam.
  const subject = regarding.replace(/^quotation of\s*/i, "").trim() || q.opportunity?.title || "the project";
  const defaultBody = [
    `Dear ${attn},`,
    "We hope this message finds you well.",
    `Following up on our recent discussion regarding the plan to produce ${subject} for ${q.company?.name ?? "your company"}, we would like to formally submit our quotation for the production services as outlined below.`,
  ].join("\n");
  const letterBody = q.letterBody?.trim() || defaultBody;

  const phone = brand?.phone?.trim() || brand?.whatsappNumber?.trim() || "-";
  const email = brand?.email?.trim() || "-";
  const defaultClosing = [
    `If you have any further questions regarding this offer or are interested in working together, you can call ${phone} or send an email to: ${email}. We will be happy to answer your needs.`,
    "We look forward to cooperating with your company.",
  ].join("\n");
  const closing = q.letterClosing?.trim() || defaultClosing;

  const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
  const hasDiscount = q.discountAmount > 0;
  const hasTax = !!q.taxName && q.taxAmount !== 0;
  const showBreakdown = hasDiscount || hasTax;

  return (
    <div
      id="print-area"
      className="mx-auto flex min-h-[1123px] w-[794px] max-w-full flex-col text-zinc-900"
      style={{ fontFamily: `"${fontFamily}", Arial, sans-serif` }}
    >
      {/* Kop surat per jenis dokumen (gambar full-width, rasio asli) */}
      {headerImg ? (
        <img src={headerImg} alt={`Kop surat ${brand?.name ?? ""}`} className="block w-full" />
      ) : null}

      <div className="flex flex-1 flex-col px-12 pt-6">
        {/* Kop fallback tanpa gambar */}
        {!headerImg ? (
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
                ) : null}
                {brand?.phone || brand?.email ? (
                  <p className="mt-0.5 text-[11px] text-zinc-500">{[brand?.phone, brand?.email, brand?.website].filter(Boolean).join(" · ")}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Header dokumen: Number / Attachment / Regarding */}
        <table className="mt-3 w-full text-[12px]" aria-label="Header surat">
          <tbody>
            <tr>
              <td className="w-28 py-0.5 align-top font-medium">Number</td>
              <td className="w-3 py-0.5 align-top">:</td>
              <td className="py-0.5 align-top font-semibold">
                {q.number}
                {q.revisionNo && q.revisionNo > 0 ? (
                  <span className="ml-2 rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: accentColor, color: accentColor }}>
                    Revisi {q.revisionNo}
                  </span>
                ) : null}
              </td>
            </tr>
            <tr>
              <td className="py-0.5 align-top font-medium">Attachment</td>
              <td className="py-0.5 align-top">:</td>
              <td className="py-0.5 align-top">{attachment}</td>
            </tr>
            <tr>
              <td className="py-0.5 align-top font-medium">Regarding</td>
              <td className="py-0.5 align-top">:</td>
              <td className="py-0.5 align-top">{regarding}</td>
            </tr>
          </tbody>
        </table>

        {/* Tujuan: To / Attn. / Address */}
        <table className="mt-4 w-full text-[12px]" aria-label="Tujuan surat">
          <tbody>
            <tr>
              <td className="w-28 py-0.5 align-top font-medium">To</td>
              <td className="w-3 py-0.5 align-top">:</td>
              <td className="py-0.5 align-top font-semibold">{q.company?.name ?? "-"}</td>
            </tr>
            <tr>
              <td className="py-0.5 align-top font-medium">Attn.</td>
              <td className="py-0.5 align-top">:</td>
              <td className="py-0.5 align-top">{attn}</td>
            </tr>
            <tr>
              <td className="py-0.5 align-top font-medium">Address</td>
              <td className="py-0.5 align-top">:</td>
              <td className="max-w-[420px] py-0.5 align-top leading-snug">{clientAddress}</td>
            </tr>
          </tbody>
        </table>

        {/* Isi surat (Dear …) */}
        <div className="mt-5 space-y-2.5 text-[12px] leading-relaxed">
          {letterBody.split("\n").filter(Boolean).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        {/* Tabel penawaran: No | Description | Unit | Unit Price | Amount */}
        <table className="mt-5 w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-zinc-100 text-left">
              <th className="border border-zinc-400 px-2 py-1.5 font-semibold">No</th>
              <th className="border border-zinc-400 px-2 py-1.5 font-semibold">Description</th>
              <th className="border border-zinc-400 px-2 py-1.5 text-center font-semibold">Unit</th>
              <th className="border border-zinc-400 px-2 py-1.5 text-right font-semibold">Unit Price</th>
              <th className="border border-zinc-400 px-2 py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-zinc-400 px-2 py-3 text-center text-zinc-400">
                  Belum ada item.
                </td>
              </tr>
            ) : (
              items.map((it, idx) => (
                <tr key={idx}>
                  <td className="border border-zinc-400 px-2 py-1.5 align-top">{idx + 1}</td>
                  <td className="border border-zinc-400 px-2 py-1.5 align-top">{it.description}</td>
                  <td className="border border-zinc-400 px-2 py-1.5 text-center align-top tabular-nums">{it.qty}</td>
                  <td className="border border-zinc-400 px-2 py-1.5 text-right align-top tabular-nums">{docMoney(it.unitPrice, q.currency)}</td>
                  <td className="border border-zinc-400 px-2 py-1.5 text-right align-top tabular-nums">{docMoney(it.subtotal, q.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* TOTAL ( breakdown kecil bila ada diskon/pajak ) */}
        <div className="mt-1 flex justify-end">
          <table className="w-[320px] text-[12px]">
            <tbody>
              {showBreakdown ? (
                <>
                  <tr>
                    <td className="py-0.5 text-zinc-600">Subtotal</td>
                    <td className="py-0.5 text-right tabular-nums">{docMoney(subtotal, q.currency)}</td>
                  </tr>
                  {hasDiscount ? (
                    <tr>
                      <td className="py-0.5 text-zinc-600">Discount {q.discountPct}%</td>
                      <td className="py-0.5 text-right tabular-nums">-{docMoney(q.discountAmount, q.currency)}</td>
                    </tr>
                  ) : null}
                  {hasTax ? (
                    <tr>
                      <td className="py-0.5 text-zinc-600">{q.taxName} {q.taxPct}%</td>
                      <td className="py-0.5 text-right tabular-nums">{docMoney(q.taxAmount, q.currency)}</td>
                    </tr>
                  ) : null}
                </>
              ) : null}
              <tr>
                <td className="border-t-2 border-double border-zinc-900 pt-1 font-bold uppercase tracking-wide">Total</td>
                <td className="border-t-2 border-double border-zinc-900 pt-1 text-right text-[13px] font-bold tabular-nums">
                  {docMoney(q.total, q.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Blok Timeline | Revision | Notes | Term of Payment */}
        <table className="mt-5 w-full border-collapse text-[11px]" aria-label="Ketentuan penawaran">
          <thead>
            <tr className="bg-zinc-100 text-left">
              <th className="w-1/5 border border-zinc-400 px-2 py-1.5 font-semibold">Timeline</th>
              <th className="w-1/4 border border-zinc-400 px-2 py-1.5 font-semibold">Revision</th>
              <th className="w-1/5 border border-zinc-400 px-2 py-1.5 font-semibold">Notes</th>
              <th className="border border-zinc-400 px-2 py-1.5 font-semibold">Term of Payment</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-zinc-400 px-2 py-1.5 align-top whitespace-pre-line">{q.timeline?.trim() || "-"}</td>
              <td className="border border-zinc-400 px-2 py-1.5 align-top whitespace-pre-line">{q.revisionNotes?.trim() || "-"}</td>
              <td className="border border-zinc-400 px-2 py-1.5 align-top whitespace-pre-line">{q.notes?.trim() || "-"}</td>
              <td className="border border-zinc-400 px-2 py-1.5 align-top whitespace-pre-line">{q.termOfPayment?.trim() || "-"}</td>
            </tr>
          </tbody>
        </table>

        {/* Berlaku sampai (kecil, di bawah blok ketentuan) */}
        {q.validUntil ? (
          <p className="mt-3 text-[11px] text-zinc-500">
            This quotation is valid until <span className="font-semibold text-zinc-700">{formatDate(q.validUntil)}</span>.
          </p>
        ) : null}

        {/* Penutup */}
        <div className="mt-5 space-y-2.5 text-[12px] leading-relaxed">
          {closing.split("\n").filter(Boolean).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        {/* Tanda tangan */}
        <div className="mt-10 flex justify-end">
          <div className="text-right text-[12px]">
            <p>Hormat kami,</p>
            <div className="mt-12 min-w-48 border-t border-zinc-400 pt-1">
              <p className="font-semibold" style={{ color: brandColor }}>{brand?.signerName || brand?.name || "-"}</p>
              {brand?.signerName ? <p className="text-[10px] text-zinc-500">{brand.name}</p> : null}
            </div>
          </div>
        </div>
      </div>

      {/* Kaki surat per jenis dokumen — anchor dasar halaman */}
      <div className="kop-footer-anchor mt-auto">
        {footerImg ? (
          <img src={footerImg} alt={`Kaki surat ${brand?.name ?? ""}`} className="block w-full" />
        ) : (
          <p className="mx-12 mb-5 border-t border-dashed border-zinc-300 pt-2 text-center text-[10px] text-zinc-500">
            {brand?.website ? `${brand.name} · ${brand.website.replace(/^https?:\/\//, "")} · ` : ""}
            {letter.footerNote?.trim() || "Terima kasih atas kepercayaan Anda."}
          </p>
        )}
      </div>
    </div>
  );
}
