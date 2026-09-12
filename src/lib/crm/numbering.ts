import { db } from "@/lib/db";
import {
  DOC_TYPE_DEFAULT_CODE,
  periodKey,
  renderNumberTemplate,
  stripRevisionSuffix,
  type NumberingDocType,
} from "@/lib/crm/numbering-core";

/**
 * Ronde 50 — layanan penomoran dokumen (SERVER, menyentuh DB).
 * - Rule per brand per docType di tabel NumberingRule (dibuat via builder UI brand).
 * - Tanpa rule → fallback pola legacy (quotePrefix/invoicePrefix + tahun) agar
 *   dokumen lama tidak berubah bentuk mendadak.
 * - Unik: kandidat dicek ke tabel dokumen terkait; tabrakan → seq+1 (maks 10x).
 * - Reset counter: never | yearly | monthly via resetKey.
 */

const MAX_ATTEMPT = 10;

function docTable(docType: NumberingDocType) {
  return docType === "quotation" ? db.quotation : db.invoice;
}

/** Pola legacy (kompatibilitas ronde lama) saat brand belum punya rule penomoran. */
function legacyTemplate(docType: NumberingDocType): string {
  return docType === "quotation" ? "{PREFIX}-{YYYY}-{SEQ:4}" : "{PREFIX}-{YYYY}-INV-{SEQ:3}";
}

function legacyCode(docType: NumberingDocType, prefix: string, year: number, seq: number): string {
  return docType === "quotation"
    ? `${prefix}-${year}-${String(seq).padStart(4, "0")}`
    : `${prefix}-${year}-INV-${String(seq).padStart(3, "0")}`;
}

export interface NextNumberResult {
  number: string;
  baseNumber: string;
  /** Nilai SEQ terpakai — disimpan di dokumen agar sufiks revisi menempel di posisi SEQ. */
  seq: number;
}

/**
 * Ambil nomor dokumen baru utk brand+docType. Menaikkan counter rule (persist).
 * `isTaken` opsional untuk dedupe tambahan (mis. nomor PO sumber saat revisi).
 */
export async function nextDocumentNumber(
  brandId: string,
  docType: NumberingDocType,
  opts?: { date?: Date },
): Promise<NextNumberResult> {
  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new Error("Brand tidak ditemukan");
  const now = opts?.date ?? new Date();
  const year = now.getFullYear();

  const rule = await db.numberingRule.findUnique({
    where: { brandId_docType: { brandId, docType } },
  });

  if (!rule) {
    // Fallback legacy — loop unik seperti perilaku lama (hitung global).
    const table = docTable(docType);
    const count = await (table as typeof db.invoice).count();
    const prefix = docType === "quotation" ? brand.quotePrefix || "QUO" : brand.invoicePrefix || "INV";
    for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
      const seq = count + attempt;
      const candidate = legacyCode(docType, prefix, year, seq);
      const exists = await (table as typeof db.invoice).findUnique({ where: { number: candidate } });
      if (!exists) return { number: candidate, baseNumber: candidate, seq };
    }
    throw new Error("Gagal menyusun nomor dokumen unik — coba sekali lagi");
  }

  const key = periodKey(rule.resetPeriod, now);
  const reset = rule.resetPeriod !== "never" && rule.resetKey !== key;
  let seq = reset ? 0 : rule.seq;
  const docCode = rule.docCode?.trim() || DOC_TYPE_DEFAULT_CODE[docType];
  const brandCode = brand.shortCode?.trim() || brand.name.slice(0, 4).toUpperCase();

  for (let attempt = 0; attempt < MAX_ATTEMPT; attempt++) {
    seq += 1;
    const candidate = renderNumberTemplate(rule.template, {
      seq,
      revisionNo: 0,
      date: now,
      docCode,
      brandCode,
    });
    const exists = await (docTable(docType) as typeof db.invoice).findUnique({ where: { number: candidate } });
    if (!exists) {
      await db.numberingRule.update({
        where: { id: rule.id },
        data: { seq, resetKey: key },
      });
      return { number: candidate, baseNumber: candidate, seq };
    }
  }
  throw new Error("Gagal menyusun nomor dokumen unik dari rule penomoran — coba sekali lagi");
}

/**
 * Nomor REVISI dokumen: sufiks "-N" menempel pada SEGMENT SEQ sesuai template.
 * Contoh (template "{SEQ:3}/{DOC}-{BRAND}/{ROMAN}/{YY}"):
 *   012/QT-UDP/I/26 (rev 0) → revisi ke-1 = 012-1/QT-UDP/I/26 → revisi ke-2 = 012-2/…
 * Bila rule penomoran tersedia + dokumen sumber menyimpan seqNo, nomor dirender ulang
 * dari template dengan tanggal dokumen SUMBER (segmen ROMAN/YY tetap konsisten dengan dasar).
 * Fallback (rule hilang / legacy): sufiks ditempel di akhir string dasar.
 */
export async function revisionDocumentNumber(
  brandId: string,
  docType: NumberingDocType,
  sourceNumber: string,
  sourceRevisionNo: number,
  sourceSeqNo: number,
  sourceDate?: Date | null,
): Promise<NextNumberResult> {
  const base = sourceRevisionNo > 0 ? stripRevisionSuffix(sourceNumber) : sourceNumber;
  const revNo = Math.max(1, sourceRevisionNo + 1);

  try {
    const rule = await db.numberingRule.findUnique({
      where: { brandId_docType: { brandId, docType } },
    });
    if (rule && sourceSeqNo > 0) {
      const brand = await db.brand.findUnique({ where: { id: brandId } });
      if (brand) {
        const number = renderNumberTemplate(rule.template, {
          seq: sourceSeqNo,
          revisionNo: revNo,
          date: sourceDate ?? new Date(),
          docCode: rule.docCode,
          brandCode: brand.shortCode?.trim() || brand.name.slice(0, 4).toUpperCase(),
        });
        return { number, baseNumber: base, seq: sourceSeqNo };
      }
    }
  } catch {
    // fallback di bawah
  }
  return { number: `${base}-${revNo}`, baseNumber: base, seq: sourceSeqNo };
}
