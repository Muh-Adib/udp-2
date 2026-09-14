/**
 * Ronde 56 — Generator PDF dokumen (server-side, jsPDF).
 *
 * Kebutuhan user: penawaran & invoice HARUS terkirim via email terhubung
 * dalam format PDF. Dokumen memakai BAHASA INGGRIS (permintaan eksplisit),
 * dengan kop surat brand:
 * - bila brand.letterheadHeader / docAssets[type].header berisi gambar
 *   (data URL PNG/JPEG atau path /brands/...) → gambar dirender FULL-WIDTH
 *   (full-bleed) di atas; footer sama, full-width di bawah halaman.
 * - bila tidak ada gambar → kop komposisi (logo + nama brand + garis aksen).
 *
 * jsPDF core fonts (helvetica) = latin-1: semua teks disanitasi ke latin-1
 * agar tidak ada glyph rusak.
 */

import { jsPDF } from "jspdf";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Ronde 57 — deskripsi jatuh tempo termin kini di lib bersama payment-terms (sinkron quotation ↔ invoice)
import { describeDueEn as describeDue } from "@/lib/crm/payment-terms";

// ============ Bentuk input (longgar — dari Prisma object apa adanya) ============

export interface PdfBrand {
  name?: string | null;
  color?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  letterheadHeader?: string | null;
  letterheadFooter?: string | null;
  docAssets?: string | null; // JSON { quotation:{header,footer}, invoice:{header,footer} }
  signerName?: string | null;
  signerClosing?: string | null;
  signatureImage?: string | null; // opsional (belum di schema Brand — abaikan bila null)
  bankAccounts?: string | null; // JSON [{bank,number,holder,branch}]
}

export interface PdfQuotation {
  number: string;
  issueDate?: Date | string | null;
  attachment?: number | null;
  regarding?: string | null;
  attn?: string | null;
  clientAddress?: string | null;
  letterBody?: string | null;
  letterClosing?: string | null;
  timeline?: string | null;
  revisionNotes?: string | null;
  termOfPayment?: string | null;
  validUntil?: Date | string | null;
  currency?: string | null;
  subtotal?: number;
  discountAmount?: number;
  taxName?: string | null;
  taxPct?: number;
  taxAmount?: number;
  total?: number;
  items?: string | Array<{ description?: string; qty?: number; unitPrice?: number; subtotal?: number }>;
  signedAt?: Date | string | null;
  signedByName?: string | null;
  signatureImage?: string | null;
}

export interface PdfInvoice {
  number: string;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  projectName?: string | null;
  purchaseNumber?: string | null;
  attn?: string | null;
  clientAddress?: string | null;
  currency?: string | null;
  amount?: number;
  items?: string | Array<{ description?: string; qty?: number; unit?: string; unitPrice?: number; total?: number }>;
  discountAmount?: number;
  taxName?: string | null;
  taxRate?: number;
  taxAmount?: number;
  taxMode?: string | null;
  downPaymentPct?: number;
  total?: number;
  terms?: string | null | Array<{ label?: string; pct?: number; dueDays?: number; dueEvent?: string }>;
  notes?: string | null;
}

export interface PdfCompany {
  name?: string | null;
  address?: string | null;
}

// ============ Util ============

const A4_W = 210;
const A4_H = 297;
const MARGIN = 14;

/** Sanitasi ke latin-1 (jsPDF core font) — karakter di luar diganti aman. */
function latin(text: unknown): string {
  return String(text ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // buang karakter non latin-1 lain (CJK, emoji, dsb.)
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return "-";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

/** Pemformat uang gaya dokumen Inggris: 1,850,000 (IDR tetap bilangan bulat). */
export function moneyDoc(v: number, currency: string | null | undefined): string {
  const n = Math.round(Number(v) || 0);
  const cur = (currency ?? "IDR").toUpperCase();
  const grouped = n.toLocaleString("en-US");
  if (cur === "IDR") return `Rp${grouped}`;
  if (cur === "USD") return `US$${grouped}`;
  return `${cur} ${grouped}`;
}

/** Item quotation/invoice dari JSON string atau array. */
function parseItems<T>(raw: string | T[] | null | undefined): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** docAssets brand → {header, footer} untuk jenis dokumen tsb (fallback kop umum). */
function kopFor(brand: PdfBrand, docType: "quotation" | "invoice"): { header: string | null; footer: string | null } {
  let per: { header?: string; footer?: string } | null = null;
  try {
    const parsed: unknown = brand.docAssets ? JSON.parse(brand.docAssets) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const node = (parsed as Record<string, unknown>)[docType];
      if (node && typeof node === "object" && !Array.isArray(node)) {
        per = node as { header?: string; footer?: string };
      }
    }
  } catch {
    per = null;
  }
  const pick = (v: string | undefined, fallback: string | null | undefined): string | null => {
    const s = (v ?? "").trim();
    return s || (fallback ?? null) || null;
  };
  return {
    header: pick(per?.header, brand.letterheadHeader),
    footer: pick(per?.footer, brand.letterheadFooter),
  };
}

/** Baca gambar (data URL atau path /brands/...) → {dataUrl, w, h} atau null. */
function loadImage(src: string | null | undefined): { dataUrl: string; w: number; h: number } | null {
  if (!src) return null;
  try {
    let dataUrl = src.trim();
    let buf: Buffer;
    if (dataUrl.startsWith("data:")) {
      const comma = dataUrl.indexOf(",");
      const meta = dataUrl.slice(5, comma).toLowerCase();
      if (!meta.includes("image/png") && !meta.includes("image/jpeg")) return null; // svg/webp tak didukung jsPDF
      buf = Buffer.from(dataUrl.slice(comma + 1), "base64");
    } else if (dataUrl.startsWith("/")) {
      const p = join(process.cwd(), "public", dataUrl);
      buf = readFileSync(p);
      dataUrl = `data:image/${p.endsWith(".jpg") || p.endsWith(".jpeg") ? "jpeg" : "png"};base64,${buf.toString("base64")}`;
    } else {
      return null;
    }
    // Ukur dimensi PNG/JPEG dari header bytes (tanpa dependency)
    let w = 0;
    let h = 0;
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      // PNG: IHDR di offset 16 (w) & 20 (h), big-endian
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
    } else if (buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG: cari marker SOF
      let off = 2;
      while (off < buf.length - 9) {
        if (buf[off] !== 0xff) { off += 1; continue; }
        const marker = buf[off + 1];
        const len = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          h = buf.readUInt16BE(off + 5);
          w = buf.readUInt16BE(off + 7);
          break;
        }
        off += 2 + len;
      }
    }
    if (!w || !h) return null;
    return { dataUrl, w, h };
  } catch {
    return null;
  }
}

/** Hex brand → RGB; fallback oranye default bila tak valid. */
function brandColor(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return [30, 41, 59];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ============ Terbilang ============

const ONES_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS_EN = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function englishWords(n: number): string {
  if (n < 20) return ONES_EN[n];
  if (n < 100) return TENS_EN[Math.floor(n / 10)] + (n % 10 ? `-${ONES_EN[n % 10]}` : "");
  if (n < 1000) return `${ONES_EN[Math.floor(n / 100)]} hundred${n % 100 ? ` ${englishWords(n % 100)}` : ""}`;
  if (n < 1_000_000) return `${englishWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${englishWords(n % 1000)}` : ""}`;
  if (n < 1_000_000_000) return `${englishWords(Math.floor(n / 1_000_000))} million${n % 1_000_000 ? ` ${englishWords(n % 1_000_000)}` : ""}`;
  return `${englishWords(Math.floor(n / 1_000_000_000))} billion${n % 1_000_000_000 ? ` ${englishWords(n % 1_000_000_000)}` : ""}`;
}

const ID_WORDS: Array<[number, string]> = [[1_000_000_000, "milyar"], [1_000_000, "juta"], [1_000, "ribu"], [100, "ratus"]];
const ONES_ID = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

function indonesianWords(n: number): string {
  if (n < 12) return ONES_ID[n];
  if (n < 20) return `${indonesianWords(n - 10)} belas`;
  if (n < 100) return `${ONES_ID[Math.floor(n / 10)]} puluh${n % 10 ? ` ${indonesianWords(n % 10)}` : ""}`;
  for (const [v, w] of ID_WORDS) {
    if (n >= v) {
      const lead = Math.floor(n / v);
      const leadTxt = lead === 1 && v === 1000 ? "seribu" : `${indonesianWords(lead)} ${w}`;
      return `${leadTxt}${n % v ? ` ${indonesianWords(n % v)}` : ""}`;
    }
  }
  return String(n);
}

const CURRENCY_EN: Record<string, string> = { IDR: "Rupiah", USD: "US Dollar", SGD: "Singapore Dollar", EUR: "Euro", AUD: "Australian Dollar", JPY: "Japanese Yen" };

/** "Sepuluh Juta Rupiah" + "Ten Million Rupiah" (gaya contoh faktur Unicam). */
export function amountInWords(total: number, currency: string | null | undefined): { id: string; en: string } {
  const n = Math.round(Number(total) || 0);
  const cur = (currency ?? "IDR").toUpperCase();
  const idName = cur === "IDR" ? "Rupiah" : cur;
  const enName = CURRENCY_EN[cur] ?? cur;
  return {
    id: `${indonesianWords(n).replace(/\b\w/g, (c) => c.toUpperCase())} ${idName}`,
    en: `${englishWords(n).replace(/\b\w/g, (c) => c.toUpperCase())} ${enName}`,
  };
}

// ============ Kerangka halaman bersama ============

interface PageCtx {
  doc: jsPDF;
  y: number;
  accent: [number, number, number];
}

/** Gambar kop atas: gambar full-width bila ada, else kop komposisi. */
function drawHeader(ctx: PageCtx, brand: PdfBrand, docType: "quotation" | "invoice"): void {
  const kop = kopFor(brand, docType);
  const img = loadImage(kop.header);
  if (img) {
    const w = A4_W;
    const h = Math.min(70, (img.h / img.w) * w);
    try {
      const fmt = img.dataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
      ctx.doc.addImage(img.dataUrl, fmt, 0, 0, w, h);
      ctx.y = h + 8;
      return;
    } catch {
      /* jatuh ke kop komposisi */
    }
  }
  // Kop komposisi: logo + nama brand + garis aksen
  let y = 16;
  const logo = loadImage(brand.logoUrl);
  if (logo) {
    const lh = Math.min(16, (logo.h / logo.w) * 16);
    try {
      const fmt = logo.dataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
      ctx.doc.addImage(logo.dataUrl, fmt, MARGIN, y - 4, 16, lh);
    } catch {
      /* abaikan logo bermasalah */
    }
  }
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(20);
  ctx.doc.setTextColor(...ctx.accent);
  ctx.doc.text(latin(brand.name ?? "UDP"), MARGIN + (logo ? 20 : 0), y + 6);
  y += 10;
  const contact = [brand.address, brand.city].filter(Boolean).map((v) => latin(v)).join(" · ");
  if (contact) {
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(8.5);
    ctx.doc.setTextColor(90);
    ctx.doc.text(contact, MARGIN, y + 4, { maxWidth: A4_W - MARGIN * 2 });
    y += brand.phone || brand.email ? 6 : 2;
    if (brand.phone || brand.email) {
      ctx.doc.text([brand.phone, brand.email].filter(Boolean).map(latin).join("   ·   "), MARGIN, y + 4);
    }
  }
  ctx.doc.setDrawColor(...ctx.accent);
  ctx.doc.setLineWidth(1.2);
  ctx.doc.line(MARGIN, y + 10, A4_W - MARGIN, y + 10);
  ctx.y = y + 18;
}

/** Gambar footer: gambar full-width di dasar halaman bila ada, else baris kontak. */
function drawFooter(ctx: PageCtx, brand: PdfBrand, docType: "quotation" | "invoice"): void {
  const kop = kopFor(brand, docType);
  const img = loadImage(kop.footer);
  if (img) {
    const w = A4_W;
    const h = Math.min(46, (img.h / img.w) * w);
    try {
      const fmt = img.dataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
      ctx.doc.addImage(img.dataUrl, fmt, 0, A4_H - h, w, h);
      return;
    } catch {
      /* fallback baris kontak */
    }
  }
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setFontSize(8);
  ctx.doc.setTextColor(120);
  const line = [brand.address, brand.city, brand.phone, brand.email].filter(Boolean).map(latin).join("  ·  ");
  if (line) ctx.doc.text(line, MARGIN, A4_H - 10, { maxWidth: A4_W - MARGIN * 2 });
}

function ensureSpace(ctx: PageCtx, needed: number): void {
  if (ctx.y + needed <= A4_H - 30) return;
  // Sederhana: konten dokumen CRM jarang >1 halaman; bila penuh, lanjut halaman baru tanpa kop gambar.
  ctx.doc.addPage();
  ctx.y = MARGIN + 6;
}

function textBlock(ctx: PageCtx, text: string, size: number, style: "normal" | "bold" | "italic", color: [number, number, number] = [30, 30, 30], maxWidth = A4_W - MARGIN * 2): number {
  ctx.doc.setFont("helvetica", style);
  ctx.doc.setFontSize(size);
  ctx.doc.setTextColor(...color);
  const lines = ctx.doc.splitTextToSize(latin(text), maxWidth) as string[];
  for (const line of lines) {
    ensureSpace(ctx, 5);
    ctx.doc.text(line, MARGIN, ctx.y);
    ctx.y += size * 0.5 + 1.2;
  }
  return ctx.y;
}

/** Tabel baris item gaya dokumen Unicam (header berwarna). */
function itemsTable(
  ctx: PageCtx,
  cols: { label: string; width: number; align?: "left" | "right" | "center" }[],
  rows: string[][],
  accent: [number, number, number],
): void {
  const rowH = 7.5;
  const drawRow = (cells: string[], fill: [number, number, number] | null, bold: boolean, textColor: [number, number, number]) => {
    ensureSpace(ctx, rowH);
    let x = MARGIN;
    if (fill) {
      ctx.doc.setFillColor(...fill);
      ctx.doc.rect(MARGIN, ctx.y - rowH + 2, A4_W - MARGIN * 2, rowH, "F");
    }
    ctx.doc.setDrawColor(180);
    ctx.doc.setLineWidth(0.2);
    ctx.doc.rect(MARGIN, ctx.y - rowH + 2, A4_W - MARGIN * 2, rowH);
    cells.forEach((cell, i) => {
      const col = cols[i];
      ctx.doc.setFont("helvetica", bold ? "bold" : "normal");
      ctx.doc.setFontSize(8.6);
      ctx.doc.setTextColor(...textColor);
      const cx = col.align === "right" ? x + col.width - 2 : col.align === "center" ? x + col.width / 2 : x + 2;
      const text = latin(cell);
      const lines = ctx.doc.splitTextToSize(text, col.width - 4) as string[];
      const ty = ctx.y - rowH / 2 + 1.2;
      if (lines.length === 1) {
        ctx.doc.text(lines[0], cx, ty, { align: col.align ?? "left" });
      } else {
        // multi-baris: kecilkan agar muat 1 baris tabel
        ctx.doc.setFontSize(7.2);
        ctx.doc.text(lines.slice(0, 2).join(" "), cx, ty, { align: col.align ?? "left" });
      }
      x += col.width;
    });
    ctx.y += rowH;
  };

  drawRow(cols.map((c) => c.label), accent, true, [255, 255, 255]);
  rows.forEach((cells, idx) => drawRow(cells, idx % 2 === 1 ? [245, 246, 248] : null, false, [30, 30, 30]));
}

/** Blok baris total kanan (Discount / Sub Total / Gross-Up / Total / Less / Total Payment). */
function totalsBlock(ctx: PageCtx, rows: Array<{ label: string; value: string; bold?: boolean; muted?: boolean; red?: boolean }>): void {
  const w = 92;
  const x = A4_W - MARGIN - w;
  for (const r of rows) {
    ensureSpace(ctx, 7);
    ctx.doc.setDrawColor(200);
    ctx.doc.setLineWidth(0.2);
    ctx.doc.line(x, ctx.y + 2.4, A4_W - MARGIN, ctx.y + 2.4);
    ctx.doc.setFont("helvetica", r.bold ? "bold" : "italic");
    ctx.doc.setFontSize(9);
    const rowColor: [number, number, number] = r.red ? [200, 40, 40] : r.muted ? [110, 110, 110] : [30, 30, 30];
    ctx.doc.setTextColor(...rowColor);
    ctx.doc.text(latin(r.label), x + 2, ctx.y);
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.text(latin(r.value), A4_W - MARGIN - 2, ctx.y, { align: "right" });
    ctx.y += 7;
  }
}

// ============ Quotation PDF ============

export function buildQuotationPdf(q: PdfQuotation, brand: PdfBrand, company: PdfCompany): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const accent = brandColor(brand.color);
  const ctx: PageCtx = { doc, y: 0, accent };
  const cur = q.currency ?? "IDR";

  drawHeader(ctx, brand, "quotation");

  // Meta kiri-kanan
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(`Number`, MARGIN, ctx.y);
  doc.text(fmtDate(q.issueDate), A4_W - MARGIN, ctx.y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(`:  ${latin(q.number)}`, MARGIN + 24, ctx.y);
  ctx.y += 6;
  if (q.attachment != null) {
    doc.text("Attachment", MARGIN, ctx.y);
    doc.text(`:  ${q.attachment || "-"}`, MARGIN + 24, ctx.y);
    ctx.y += 6;
  }
  if (q.regarding) {
    doc.text("Regarding", MARGIN, ctx.y);
    doc.text(`:  ${latin(q.regarding)}`, MARGIN + 24, ctx.y);
    ctx.y += 6;
  }
  ctx.y += 2;

  // Blok tujuan
  const toLines: Array<[string, string]> = [["To", company.name ?? "-"]];
  if (q.attn) toLines.push(["Attn.", q.attn]);
  if (q.clientAddress) toLines.push(["Address", q.clientAddress]);
  for (const [label, value] of toLines) {
    ensureSpace(ctx, 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(latin(label), MARGIN, ctx.y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(latin(value), A4_W - MARGIN * 2 - 26) as string[];
    lines.forEach((line, i) => doc.text(i === 0 ? `:  ${line}` : line, MARGIN + 24, ctx.y + i * 4.4));
    ctx.y += Math.max(6, lines.length * 4.4 + 1.5);
  }
  ctx.y += 3;

  // Paragraf pembuka
  const intro = q.letterBody?.trim()
    ? q.letterBody
    : `Respectfully,\nThrough this email, we would like to follow up on the results of the discussion regarding ${q.regarding || "the project"}. We would like to submit a price offer for the following services:`;
  textBlock(ctx, intro, 9, "normal", [45, 45, 45]);
  ctx.y += 2;

  // Tabel item
  const items = parseItems<{ description?: string; qty?: number; unitPrice?: number; subtotal?: number }>(q.items);
  const subtotal = items.length > 0 ? items.reduce((s, it) => s + Math.round((Number(it.qty) || 1) * (Number(it.unitPrice) || 0)), 0) : Math.round(Number(q.subtotal) || 0);
  const discount = Math.max(0, Math.round(Number(q.discountAmount) || 0));
  const afterDiscount = subtotal - discount;
  const taxName = (q.taxName ?? "").trim();
  const taxPct = taxName ? Math.max(0, Number(q.taxPct) || 0) : 0;
  const taxAmount = taxName ? Math.round((afterDiscount * taxPct) / 100) : 0;
  const total = afterDiscount + taxAmount;

  if (items.length > 0) {
    const cols = [
      { label: "No.", width: 12, align: "center" as const },
      { label: "Service", width: 78 },
      { label: "Unit", width: 26, align: "center" as const },
      { label: "Unit Price", width: 32, align: "right" as const },
      { label: "Amount", width: 32, align: "right" as const },
    ];
    itemsTable(
      ctx,
      cols,
      items.map((it, i) => [
        String(i + 1),
        latin(it.description ?? ""),
        String(Number(it.qty) || 1),
        moneyDoc(Number(it.unitPrice) || 0, cur),
        moneyDoc((Number(it.qty) || 1) * (Number(it.unitPrice) || 0), cur),
      ]),
      accent,
    );
  }
  totalsBlock(ctx, [
    ...(discount > 0 ? [{ label: "Discount", value: `-${moneyDoc(discount, cur)}` }] : []),
    { label: "TOTAL", value: moneyDoc(total, cur), bold: true },
  ]);
  ctx.y += 4;

  // Blok Timeline / Revision / Term of Payment (3 kolom gaya Unimasi)
  const infoCols: Array<{ title: string; body: string; w: number }> = [
    { title: "Timeline", body: q.timeline || "-", w: 58 },
    { title: "Revision", body: q.revisionNotes || "-", w: 40 },
    { title: "Term of Payment", body: q.termOfPayment || "-", w: 82 },
  ];
  ensureSpace(ctx, 40);
  const colY = ctx.y;
  let x = MARGIN;
  for (const col of infoCols) {
    doc.setFillColor(...accent);
    doc.rect(x, colY - 5, col.w, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.4);
    doc.setTextColor(255, 255, 255);
    doc.text(col.title, x + col.w / 2, colY - 0.6, { align: "center" });
    doc.setDrawColor(185);
    doc.setLineWidth(0.2);
    doc.rect(x, colY + 1.5, col.w, 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(45, 45, 45);
    const bodyLines = doc.splitTextToSize(latin(col.body), col.w - 4) as string[];
    bodyLines.slice(0, 8).forEach((line, i) => doc.text(line, x + 2, colY + 6.5 + i * 3.6));
    x += col.w;
  }
  ctx.y = colY + 36;

  // Validity + penutup
  if (q.validUntil) {
    textBlock(ctx, `This quotation is valid until ${fmtDate(q.validUntil)}.`, 8.5, "italic", [110, 110, 110]);
  }
  const closing = q.letterClosing?.trim()
    ? q.letterClosing
    : "Should you have any questions regarding this offer, please feel free to contact us. We look forward to cooperating with your company.";
  textBlock(ctx, closing, 9, "normal", [45, 45, 45]);
  ctx.y += 4;

  // Tanda tangan: klien (e-sign) bila sudah ttd, else brand signer
  ensureSpace(ctx, 34);
  const signX = A4_W - MARGIN - 62;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(45, 45, 45);
  doc.text("Yours Truly,", signX, ctx.y);
  ctx.y += 2;
  const brandSig = loadImage((brand as { signatureImage?: string | null }).signatureImage);
  const clientSig = loadImage(q.signatureImage);
  const sig = clientSig ?? brandSig;
  if (sig) {
    const sw = 34;
    const sh = Math.min(18, (sig.h / sig.w) * sw);
    try {
      doc.addImage(sig.dataUrl, sig.dataUrl.includes("image/jpeg") ? "JPEG" : "PNG", signX + 8, ctx.y, sw, sh);
      ctx.y += sh + 2;
    } catch {
      ctx.y += 6;
    }
  } else {
    ctx.y += 14;
  }
  if (clientSig) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(latin(q.signedByName ?? "Client"), signX + 8, ctx.y + 4);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Electronically signed via secure link", signX + 8, ctx.y + 8);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(latin(brand.signerName ?? brand.name ?? ""), signX + 8, ctx.y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(latin(brand.name ?? ""), signX + 8, ctx.y + 8);
  }

  drawFooter(ctx, brand, "quotation");
  return new Uint8Array(doc.output("arraybuffer"));
}

// ============ Invoice PDF ============

export function buildInvoicePdf(inv: PdfInvoice, brand: PdfBrand, company: PdfCompany): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const accent = brandColor(brand.color);
  const ctx: PageCtx = { doc, y: 0, accent };
  const cur = inv.currency ?? "IDR";

  drawHeader(ctx, brand, "invoice");

  // Judul + kotak No/Date
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(25, 25, 25);
  doc.text("INVOICE", MARGIN, ctx.y + 4);
  const boxW = 88;
  const bx = A4_W - MARGIN - boxW;
  doc.setFontSize(9);
  doc.setFillColor(...accent);
  doc.rect(bx, ctx.y - 5, boxW / 2, 7, "F");
  doc.rect(bx + boxW / 2, ctx.y - 5, boxW / 2, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("No. Invoice", bx + boxW / 4, ctx.y, { align: "center" });
  doc.text("Date", bx + (boxW * 3) / 4, ctx.y, { align: "center" });
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "normal");
  doc.rect(bx, ctx.y + 2, boxW / 2, 7);
  doc.rect(bx + boxW / 2, ctx.y + 2, boxW / 2, 7);
  doc.text(latin(inv.number), bx + boxW / 4, ctx.y + 6.4, { align: "center" });
  doc.text(fmtDate(inv.issueDate), bx + (boxW * 3) / 4, ctx.y + 6.4, { align: "center" });
  ctx.y += 14;

  // Blok kiri (Project, Purchase Number) & kanan (Client, Attn, Address)
  const leftY = ctx.y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(45, 45, 45);
  doc.text("Project", MARGIN, leftY);
  doc.text(`:  ${latin(inv.projectName ?? "-")}`, MARGIN + 30, leftY);
  doc.text("Purchase Number", MARGIN, leftY + 5);
  doc.text(`:  ${latin(inv.purchaseNumber || "-")}`, MARGIN + 30, leftY + 5);

  const rightX = A4_W / 2 + 8;
  doc.text("Client", rightX, leftY);
  doc.text(`:  ${latin(company.name ?? "-")}`, rightX + 14, leftY);
  doc.text("Attn.", rightX, leftY + 5);
  doc.text(`:  ${latin(inv.attn ?? "-")}`, rightX + 14, leftY + 5);
  if (inv.clientAddress) {
    doc.text("Address", rightX, leftY + 10);
    const addrLines = doc.splitTextToSize(latin(inv.clientAddress), A4_W - MARGIN - (rightX + 14)) as string[];
    addrLines.slice(0, 3).forEach((line, i) => doc.text(i === 0 ? `:  ${line}` : line, rightX + 14, leftY + 10 + i * 4.4));
  }
  ctx.y = leftY + 22;

  // Tabel item
  const items = parseItems<{ description?: string; qty?: number; unit?: string; unitPrice?: number; total?: number }>(inv.items);
  const subtotalFromItems = items.length > 0
    ? items.reduce((s, it) => s + Math.round((Number(it.qty) || 1) * (Number(it.unitPrice) || 0)), 0)
    : 0;
  const baseAmount = items.length > 0 ? subtotalFromItems : Math.round(Number(inv.amount) || 0);
  const discount = Math.min(baseAmount, Math.max(0, Math.round(Number(inv.discountAmount) || 0)));
  const afterDiscount = baseAmount - discount;
  const dpPct = Math.min(100, Math.max(0, Number(inv.downPaymentPct) || 0));
  const dpBase = dpPct > 0 ? Math.round((afterDiscount * dpPct) / 100) : afterDiscount;
  const taxName = (inv.taxName ?? "").trim();
  const taxRate = Math.max(0, Number(inv.taxRate) || 0);
  const taxAmount = taxName ? Math.round((dpBase * taxRate) / 100) : 0;
  const taxMode = inv.taxMode === "withhold" ? "withhold" : inv.taxMode === "grossup" ? "grossup" : "add";
  const total = taxMode === "withhold" ? dpBase - taxAmount : taxMode === "grossup" ? dpBase : dpBase + taxAmount;

  if (items.length > 0) {
    const cols = [
      { label: "No.", width: 12, align: "center" as const },
      { label: "Description", width: 86 },
      { label: "Qty", width: 18, align: "center" as const },
      { label: "Unit Price", width: 32, align: "right" as const },
      { label: "Total", width: 32, align: "right" as const },
    ];
    itemsTable(
      ctx,
      cols,
      items.map((it, i) => [
        String(i + 1),
        latin(it.description ?? ""),
        String(Number(it.qty) || 1),
        moneyDoc(Number(it.unitPrice) || 0, cur),
        moneyDoc((Number(it.qty) || 1) * (Number(it.unitPrice) || 0), cur),
      ]),
      accent,
    );
  }
  totalsBlock(ctx, [
    ...(discount > 0 ? [{ label: "Discount", value: moneyDoc(discount, cur) }] : []),
    { label: "Sub Total", value: moneyDoc(dpBase, cur), bold: false },
    ...(taxName
      ? taxMode === "grossup"
        ? [
            { label: `Gross-Up ${taxName} (${taxRate}%)`, value: moneyDoc(taxAmount, cur) },
            { label: "Total", value: moneyDoc(dpBase + taxAmount, cur), bold: true },
            { label: `Less: ${taxName} (${taxRate}%)`, value: `-${moneyDoc(taxAmount, cur)}`, red: true },
          ]
        : taxMode === "withhold"
          ? [{ label: `Less: ${taxName} (${taxRate}%)`, value: `-${moneyDoc(taxAmount, cur)}`, red: true }]
          : [{ label: `${taxName} (${taxRate}%)`, value: moneyDoc(taxAmount, cur) }]
      : []),
    { label: "Total Payment", value: moneyDoc(total, cur), bold: true },
  ]);
  ctx.y += 4;

  // Terbilang (gaya contoh: dua baris hitam — ID + EN)
  const words = amountInWords(total, cur);
  ensureSpace(ctx, 14);
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, ctx.y - 4.4, A4_W - MARGIN * 2, 6, "F");
  doc.rect(MARGIN, ctx.y + 1.6, A4_W - MARGIN * 2, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bolditalic");
  doc.setFontSize(8.6);
  doc.text(latin(`Terbilang: ${words.id}`), A4_W / 2, ctx.y, { align: "center" });
  doc.text(latin(`Amount in Words: ${words.en}`), A4_W / 2, ctx.y + 6, { align: "center" });
  ctx.y += 14;

  // Term of payment (jadwal termin bila ada, else teks bebas via notes)
  const terms = parseItems<{ label?: string; pct?: number; dueDays?: number; dueEvent?: string }>(inv.terms);
  if (terms.length > 0) {
    ensureSpace(ctx, 8 + terms.length * 6 + 4);
    doc.setFillColor(...accent);
    doc.rect(MARGIN, ctx.y - 5, A4_W - MARGIN * 2, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(255, 255, 255);
    doc.text("Term of Payment", A4_W / 2, ctx.y - 0.6, { align: "center" });
    ctx.y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6);
    doc.setTextColor(45, 45, 45);
    for (const t of terms) {
      const pct = Math.max(0, Number(t.pct) || 0);
      const pctTxt = pct > 0 ? ` (${pct}% — ${moneyDoc(Math.round((total * pct) / 100), cur)})` : "";
      const dueTxt = describeDue(t.dueEvent, t.dueDays);
      ensureSpace(ctx, 5);
      doc.text(latin(`${t.label ?? "Payment"}${pctTxt} — due ${dueTxt}`), MARGIN + 2, ctx.y);
      ctx.y += 5;
    }
    ctx.y += 3;
  }

  // Payment method (rekening bank brand)
  const banks = parseItems<{ bank?: string; number?: string; holder?: string; branch?: string }>(brand.bankAccounts ?? null);
  if (banks.length > 0) {
    ensureSpace(ctx, 10 + banks.length * 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text("Payment Method", MARGIN, ctx.y);
    ctx.y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6);
    doc.setTextColor(60, 60, 60);
    for (const b of banks.slice(0, 3)) {
      doc.text(latin([b.bank, b.number, b.holder, b.branch].filter(Boolean).join(" — ")), MARGIN + 2, ctx.y, { maxWidth: A4_W / 2 - MARGIN });
      ctx.y += 4.6;
    }
  }

  // Tanda tangan kanan
  ensureSpace(ctx, 34);
  const signX = A4_W - MARGIN - 66;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(45, 45, 45);
  doc.text("For and on behalf of", signX, ctx.y);
  doc.setFont("helvetica", "bold");
  doc.text(latin(brand.name ?? ""), signX, ctx.y + 5);
  ctx.y += 8;
  const brandSig = loadImage((brand as { signatureImage?: string | null }).signatureImage);
  if (brandSig) {
    const sw = 36;
    const sh = Math.min(18, (brandSig.h / brandSig.w) * sw);
    try {
      doc.addImage(brandSig.dataUrl, brandSig.dataUrl.includes("image/jpeg") ? "JPEG" : "PNG", signX + 4, ctx.y, sw, sh);
      ctx.y += sh + 2;
    } catch {
      ctx.y += 8;
    }
  } else {
    ctx.y += 16;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(latin(brand.signerName ?? ""), signX + 4, ctx.y + 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("Director", signX + 4, ctx.y + 6.5);

  if (inv.notes) {
    ctx.y += 12;
    textBlock(ctx, latin(inv.notes), 8, "italic", [110, 110, 110]);
  }

  drawFooter(ctx, brand, "invoice");
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Deskripsi jatuh tempo termin (EN — dokumen Inggris). Ronde 57: pindah ke payment-terms.ts (dipakai bersama quotation & invoice). */
export { describeDue };

/** Nama file PDF yang aman. */
export function pdfFileName(kind: "Quotation" | "Invoice", number_: string): string {
  const safe = number_.replace(/[^\w.-]+/g, "-").slice(0, 80);
  return `${kind}-${safe}.pdf`;
}
