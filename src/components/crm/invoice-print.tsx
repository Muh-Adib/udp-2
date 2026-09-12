"use client";

import type { Brand, InvoiceDTO, InvoiceItemDTO } from "@/lib/crm/types";
import { formatDate } from "@/lib/crm/utils";
import { terbilangID, terbilangEN } from "@/lib/crm/terbilang";

/**
 * Ronde 50 — TEMPLATE FAKTUR (gaya Unicam) siap cetak A4.
 * Struktur sesuai contoh dokumen resmi:
 *   Date / Client / Address (kanan) → Project / Invoice Number / Purchase Number
 *   → tabel No|Description|Qty|Unit Price|Total
 *   → baris Down Payment (N%) + PPh 23 (2%) dipotong → Total Payment
 *   → Terbilang (Rupiah) + Amount in Words (English)
 *   → Due Date → Payment to (rekening brand + NPWP) → salam & tanda tangan.
 * Kop surat per jenis dokumen: brand.docAssets.invoice → fallback letterheadHeader umum.
 */

interface PaymentLite {
  id: string;
  amount: number;
  method: string;
  reference?: string | null;
  paidAt: string | Date;
}

type InvoicePrintLike = Omit<InvoiceDTO, "payments"> & {
  payments?: PaymentLite[] | null;
  project?: { id: string; name: string } | null;
};

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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as LetterTemplate) : {};
  } catch {
    return {};
  }
}

interface DocAssetSet {
  header?: string | null;
  footer?: string | null;
}

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

export interface BrandBankAccount {
  bank: string;
  number: string;
  holder: string;
  branch: string;
}

function parseBankAccounts(raw?: string | null): BrandBankAccount[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((a) => ({
        bank: String((a as BrandBankAccount).bank ?? "").trim(),
        number: String((a as BrandBankAccount).number ?? "").trim(),
        holder: String((a as BrandBankAccount).holder ?? "").trim(),
        branch: String((a as BrandBankAccount).branch ?? "").trim(),
      }))
      .filter((a) => a.bank || a.number);
  } catch {
    return [];
  }
}

function safeHex(value?: string, fallback = "#0f172a"): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}

/** Uang faktur gaya contoh Unicam: IDR → "Rp.  31.500.000" (id-ID); lainnya → "USD 1,234.56". */
function docMoney(amount: number, currency: string): string {
  const n = Math.round(amount);
  if (currency === "IDR") {
    return `Rp. ${n.toLocaleString("id-ID")}`;
  }
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Nilai dalam kurung (potongan) — sesuai contoh "(Rp.         315.000)". */
function docMoneyNegative(amount: number, currency: string): string {
  return `(${docMoney(amount, currency)})`;
}

function parseItems(raw?: string | null): InvoiceItemDTO[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((it) => it && String((it as InvoiceItemDTO).description ?? "").trim())
      .map((it) => {
        const qty = Number((it as InvoiceItemDTO).qty ?? 1) || 1;
        const unitPrice = Number((it as InvoiceItemDTO).unitPrice ?? 0) || 0;
        return {
          description: String((it as InvoiceItemDTO).description).trim(),
          qty,
          unit: String((it as InvoiceItemDTO).unit ?? "").trim(),
          unitPrice,
          total: Math.round(qty * unitPrice),
        };
      });
  } catch {
    return [];
  }
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
  const letter = parseLetterTemplate(brand?.letterTemplate);
  const docAssets = parseDocAssets(brand?.docAssets);
  const fontFamily = letter.fontFamily?.trim() || "Helvetica";
  const accentColor = safeHex(letter.accentColor);
  const showLogo = letter.showLogo !== false;
  const centeredKop = letter.headerStyle === "logo-center";

  // Kop per jenis surat — invoice punya gambar sendiri (fallback kop umum brand).
  const headerImg = docAssets.invoice?.header ?? brand?.letterheadHeader ?? null;
  const footerImg = docAssets.invoice?.footer ?? brand?.letterheadFooter ?? null;

  const items = parseItems(inv.items);
  const rows: InvoiceItemDTO[] =
    items.length > 0
      ? items
      : [
          {
            description: inv.description ?? "-",
            qty: 1,
            unit: "",
            unitPrice: inv.amount,
            total: inv.amount,
          },
        ];

  const currency = inv.currency ?? "IDR";
  const taxMode = inv.taxMode ?? "add";
  const dpPct = inv.downPaymentPct ?? 0;
  const hasDp = dpPct > 0;
  const hasTax = !!inv.taxName && inv.taxAmount !== 0;
  const isWithhold = taxMode === "withhold";

  const clientAddress =
    inv.clientAddress?.trim() ||
    brand?.address ||
    inv.company?.address ||
    [inv.company?.city, inv.company?.country].filter(Boolean).join(", ") ||
    "-";
  const attn = inv.attn?.trim() || inv.company?.name || "-";
  const banks = parseBankAccounts(brand?.bankAccounts);
  const signerName = brand?.signerName?.trim() || brand?.name || "-";
  const signerClosing = brand?.signerClosing?.trim() || "Best regards and enjoy the process,";

  // Terbilang — dari TOTAL yang harus dibayar (contoh: 15.435.000).
  const wordsID = terbilangID(inv.total, currency);
  const wordsEN = terbilangEN(inv.total, currency);

  return (
    <div
      id="print-area"
      className="mx-auto flex min-h-[1123px] w-[794px] max-w-full flex-col text-zinc-900"
      style={{ fontFamily: `"${fontFamily}", Arial, sans-serif` }}
    >
      {/* Kop surat per jenis dokumen */}
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

        {/* Status chip — hanya saat perlu perhatian (draft/batal/jatuh tempo) */}
        {["draft", "cancelled", "overdue"].includes(inv.status) ? (
          <div className="mt-2 flex justify-end">
            <span
              className="rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
              style={{ borderColor: inv.status === "cancelled" ? "#e11d48" : accentColor, color: inv.status === "cancelled" ? "#e11d48" : accentColor }}
            >
              {STATUS_LABELS[inv.status] ?? inv.status}
            </span>
          </div>
        ) : null}

        {/* Baris info atas: kiri (Project/Number/PO) — kanan (Date/Client/Address) */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
          <table className="min-w-[280px] max-w-[340px] text-[12px]" aria-label="Identitas faktur">
            <tbody>
              <tr>
                <td className="w-32 py-0.5 align-top font-medium">Project</td>
                <td className="w-3 py-0.5 align-top">:</td>
                <td className="py-0.5 align-top font-semibold">{inv.projectName || inv.project?.name || inv.description?.split(" — ")[0] || "-"}</td>
              </tr>
              <tr>
                <td className="py-0.5 align-top font-medium">Invoice Number</td>
                <td className="py-0.5 align-top">:</td>
                <td className="py-0.5 align-top font-semibold">
                  {inv.number}
                  {inv.revisionNo && inv.revisionNo > 0 ? (
                    <span className="ml-2 rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider" style={{ borderColor: accentColor, color: accentColor }}>
                      Revisi {inv.revisionNo}
                    </span>
                  ) : null}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 align-top font-medium">Purchase Number</td>
                <td className="py-0.5 align-top">:</td>
                <td className="py-0.5 align-top">{inv.purchaseNumber?.trim() || "-"}</td>
              </tr>
            </tbody>
          </table>
          <table className="min-w-[260px] max-w-[320px] text-[12px]" aria-label="Klien & tanggal">
            <tbody>
              <tr>
                <td className="w-20 py-0.5 align-top font-medium">Date</td>
                <td className="w-3 py-0.5 align-top">:</td>
                <td className="py-0.5 align-top">{formatDate(inv.issueDate)}</td>
              </tr>
              <tr>
                <td className="py-0.5 align-top font-medium">Client</td>
                <td className="py-0.5 align-top">:</td>
                <td className="py-0.5 align-top font-semibold">{inv.company?.name ?? "-"}</td>
              </tr>
              <tr>
                <td className="py-0.5 align-top font-medium">Address</td>
                <td className="py-0.5 align-top">:</td>
                <td className="py-0.5 align-top leading-snug">{clientAddress}</td>
              </tr>
              {attn !== (inv.company?.name ?? "-") ? (
                <tr>
                  <td className="py-0.5 align-top font-medium">Attn.</td>
                  <td className="py-0.5 align-top">:</td>
                  <td className="py-0.5 align-top">{attn}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Tabel item faktur: No | Description | Qty | Unit Price | Total */}
        <table className="mt-5 w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-zinc-100 text-left">
              <th className="border border-zinc-400 px-2 py-1.5 font-semibold">No</th>
              <th className="border border-zinc-400 px-2 py-1.5 font-semibold">Description</th>
              <th className="border border-zinc-400 px-2 py-1.5 text-center font-semibold">Qty</th>
              <th className="border border-zinc-400 px-2 py-1.5 text-right font-semibold">Unit Price</th>
              <th className="border border-zinc-400 px-2 py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, idx) => (
              <tr key={idx}>
                <td className="border border-zinc-400 px-2 py-1.5 align-top">{idx + 1}</td>
                <td className="border border-zinc-400 px-2 py-1.5 align-top">{it.description}</td>
                <td className="border border-zinc-400 px-2 py-1.5 text-center align-top tabular-nums">
                  {it.qty}
                  {it.unit ? ` ${it.unit}` : ""}
                </td>
                <td className="border border-zinc-400 px-2 py-1.5 text-right align-top tabular-nums">{docMoney(it.unitPrice, currency)}</td>
                <td className="border border-zinc-400 px-2 py-1.5 text-right align-top tabular-nums">{docMoney(it.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Baris pembayaran: Down Payment → pajak (potong/tambah) → Total Payment */}
        <div className="mt-1 flex justify-end">
          <table className="w-[360px] text-[12px]">
            <tbody>
              {hasDp ? (
                <tr>
                  <td className="py-1 text-zinc-700">Down Payment ({dpPct % 1 === 0 ? dpPct : dpPct.toFixed(1)}%)</td>
                  <td className="py-1 text-right font-medium tabular-nums">{docMoney(Math.round((inv.amount * dpPct) / 100), currency)}</td>
                </tr>
              ) : null}
              {hasTax ? (
                <tr>
                  <td className="py-1 text-zinc-700">
                    {inv.taxName} ({inv.taxRate % 1 === 0 ? inv.taxRate : inv.taxRate.toFixed(1)}%)
                  </td>
                  <td className={`py-1 text-right font-medium tabular-nums ${isWithhold ? "text-rose-700" : ""}`}>
                    {isWithhold ? docMoneyNegative(inv.taxAmount, currency) : docMoney(inv.taxAmount, currency)}
                  </td>
                </tr>
              ) : null}
              <tr>
                <td className="border-t-2 border-double border-zinc-900 pt-1 font-bold uppercase tracking-wide">Total Payment</td>
                <td className="border-t-2 border-double border-zinc-900 pt-1 text-right text-[13px] font-bold tabular-nums">
                  {docMoney(inv.total, currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Terbilang — Rupiah + English (sesuai contoh) */}
        <div className="mt-5 border border-zinc-400 bg-zinc-50 px-3 py-2">
          <p className="text-[12px] leading-relaxed">
            <span className="font-semibold">Terbilang</span>
            <span className="mx-2">:</span>
            <span className="italic">#{wordsID}#</span>
          </p>
          <p className="text-[12px] leading-relaxed">
            <span className="font-semibold">Amount in Words</span>
            <span className="mx-2">:</span>
            <span className="italic">{wordsEN}</span>
          </p>
        </div>

        {/* Due Date */}
        <p className="mt-4 text-[12px]">
          <span className="font-semibold">Due Date</span>
          <span className="mx-2">:</span>
          <span className={inv.status === "overdue" ? "font-semibold text-rose-700" : ""}>
            {inv.dueDate ? formatDate(inv.dueDate) : "-"}
          </span>
        </p>

        {/* Payment to (rekening brand) + NPWP */}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-6">
          <div className="text-[12px]">
            <p className="font-semibold">Payment to :</p>
            {banks.length === 0 ? (
              <p className="mt-1 text-zinc-500">Rekening belum diatur di pengaturan brand.</p>
            ) : (
              banks.map((acc, i) => (
                <div key={i} className="mt-2 leading-relaxed">
                  <p className="font-mono font-semibold tracking-wider">{acc.number}</p>
                  <p>
                    {acc.bank}
                    {acc.branch ? ` Cabang ${acc.branch}` : ""}
                  </p>
                  {acc.holder ? <p>Attn. {acc.holder}</p> : null}
                </div>
              ))
            )}
          </div>
          <div className="text-right text-[12px]">
            {brand?.npwp ? (
              <p>
                <span className="font-semibold">NPWP</span>
                <span className="mx-2">:</span>
                <span className="font-mono">{brand.npwp}</span>
              </p>
            ) : null}
          </div>
        </div>

        {/* Salam penutup + tanda tangan */}
        <div className="mt-8">
          <p className="text-[12px]">{signerClosing}</p>
          <div className="mt-14 w-fit text-[12px]">
            <p className="font-semibold" style={{ color: brandColor }}>{signerName}</p>
            {brand?.phone ? <p className="text-[11px] text-zinc-600">Mobile : {brand.phone}</p> : null}
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
            {letter.footerNote?.trim() || "Mohon lakukan pembayaran sebelum jatuh tempo. Terima kasih."}
          </p>
        )}
      </div>
    </div>
  );
}
