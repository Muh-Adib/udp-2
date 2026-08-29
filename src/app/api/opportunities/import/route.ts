import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { PIPELINE_STAGES } from "@/lib/crm/constants";

/**
 * Import CSV opportunity (Task 15-a) — round-trip dengan ekspor ronde 13.
 * Row schema = 17 header ekspor (key lowercase): judul, brand, perusahaan, kontak,
 * kategori_layanan, layanan, tahap, temperatur, prioritas, skor (DIABAIKAN — skor dihitung
 * server via computeLeadScore saat GET), nilai_estimasi, mata_uang, probabilitas_pct,
 * owner, target_close, aksi_berikutnya, dibuat (DIABAIKAN).
 *
 * - commit=false (preview): validasi + resolusi tanpa menulis DB.
 * - commit=true: buat opportunity valid, review/invalid dilewati, SATU audit log batch.
 */

const MAX_ROWS = 200;

// ---------- Mapping tahap: label Indonesia ↔ slug ----------

const STAGE_BY_LABEL = new Map<string, string>();
for (const s of PIPELINE_STAGES) {
  STAGE_BY_LABEL.set(s.label.toLowerCase(), s.key);
  STAGE_BY_LABEL.set(s.key.toLowerCase(), s.key);
}

// Alias label Indonesia umum (ekspor memakai stageLabel Inggris — tetap terima versi Indonesia).
const STAGE_ALIASES_ID: Record<string, string> = {
  "baru": "new",
  "dicoba dihubungi": "contact_attempted",
  "terhubung": "connected",
  "terkualifikasi": "qualified",
  "kualifikasi": "qualified",
  "estimasi": "estimation",
  "proposal terkirim": "proposal_sent",
  "negosiasi": "negotiation",
  "kesepakatan verbal": "verbal_agreement",
  "menang": "won",
  "kalah": "lost",
  "nurture": "nurture",
};
for (const [alias, key] of Object.entries(STAGE_ALIASES_ID)) {
  if (!STAGE_BY_LABEL.has(alias)) STAGE_BY_LABEL.set(alias, key);
}

/** Map label Indonesia (mis. "Negotiation") atau slug mentah → stage slug. */
function resolveStage(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "new";
  return STAGE_BY_LABEL.get(s) ?? "new"; // tidak ada stage "lead" di PIPELINE_STAGES → default "new"
}

function resolveTemperature(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "hot" || s === "warm" || s === "cold") return s;
  return "cold";
}

function resolvePriority(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "low" || s === "medium" || s === "high" || s === "urgent") return s;
  return "medium";
}

// ---------- Parser tanggal: "dd MMM yyyy" (bulan Indonesia), ISO, dd/mm/yyyy ----------

const MONTHS_ID: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, jun: 5,
  jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11,
};

function parseTargetClose(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // dd/mm/yyyy (atau dd-mm-yyyy)
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // "dd MMM yyyy" bulan Indonesia pendek (format hasil ekspor formatDate id-ID)
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS_ID[m[2].toLowerCase()];
    if (mon !== undefined) {
      const d = new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

// ---------- Normalisasi & resolusi baris ----------

interface NormalizedOppRow {
  judul: string;
  brand: string;
  perusahaan: string;
  kontak: string;
  kategoriLayanan: string;
  layanan: string;
  tahap: string;
  temperatur: string;
  prioritas: string;
  nilaiEstimasi: string;
  mataUang: string;
  probabilitasPct: string;
  owner: string;
  targetClose: string;
  aksiBerikutnya: string;
}

function normalizeRows(raw: unknown): NormalizedOppRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const src = (r ?? {}) as Record<string, unknown>;
    // Kunci dinormalisasi lowercase agar toleran terhadap variasi header.
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) {
      row[k.trim().toLowerCase()] = v === undefined || v === null ? "" : String(v).trim();
    }
    return {
      judul: row["judul"] ?? "",
      brand: row["brand"] ?? "",
      perusahaan: row["perusahaan"] ?? "",
      kontak: row["kontak"] ?? "",
      kategoriLayanan: row["kategori_layanan"] ?? "",
      layanan: row["layanan"] ?? "",
      tahap: row["tahap"] ?? "",
      temperatur: row["temperatur"] ?? "",
      prioritas: row["prioritas"] ?? "",
      nilaiEstimasi: row["nilai_estimasi"] ?? "",
      mataUang: row["mata_uang"] ?? "",
      probabilitasPct: row["probabilitas_pct"] ?? "",
      owner: row["owner"] ?? "",
      targetClose: row["target_close"] ?? "",
      aksiBerikutnya: row["aksi_berikutnya"] ?? "",
    };
  });
}

interface Lookups {
  brandByName: Map<string, { id: string; name: string }>;
  contactByName: Map<string, { id: string; companyId: string | null }>;
  companyByName: Map<string, string>;
}

async function loadLookups(): Promise<Lookups> {
  const [brands, contacts, companies] = await Promise.all([
    db.brand.findMany({ select: { id: true, name: true } }),
    db.contact.findMany({
      where: { deletedAt: null },
      select: { id: true, fullName: true, companyId: true },
      take: 1000,
    }),
    db.company.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
  ]);

  const brandByName = new Map<string, { id: string; name: string }>();
  for (const b of brands) brandByName.set(b.name.trim().toLowerCase(), b);

  const contactByName = new Map<string, { id: string; companyId: string | null }>();
  for (const c of contacts) {
    const k = c.fullName.trim().toLowerCase();
    if (!contactByName.has(k)) contactByName.set(k, c);
  }

  const companyByName = new Map<string, string>();
  for (const c of companies) {
    const k = c.name.trim().toLowerCase();
    if (!companyByName.has(k)) companyByName.set(k, c.id);
  }

  return { brandByName, contactByName, companyByName };
}

type RowStatus = "valid" | "review" | "invalid";

interface ResolvedRow {
  status: RowStatus;
  errors: string[];
  brandId?: string;
  contactId?: string;
  companyId: string | null;
  stage: string;
  temperature: string;
  priority: string;
  estimatedValue: number | null;
  currency: string;
  probability: number;
  expectedCloseDate: Date | null;
}

function resolveRow(row: NormalizedOppRow, lookups: Lookups): ResolvedRow {
  const errors: string[] = [];

  // judul: wajib
  if (!row.judul) errors.push("Judul wajib diisi");

  // brand: wajib, resolusi nama case-insensitive
  let brandId: string | undefined;
  if (!row.brand) {
    errors.push("Brand wajib diisi");
  } else {
    const brand = lookups.brandByName.get(row.brand.trim().toLowerCase());
    if (!brand) errors.push(`Brand tidak ditemukan: ${row.brand}`);
    else brandId = brand.id;
  }

  // kontak: wajib, resolusi nama lengkap exact case-insensitive-trimmed (deletedAt null)
  let contactId: string | undefined;
  let contactCompanyId: string | null = null;
  if (!row.kontak) {
    errors.push("Kontak wajib diisi");
  } else {
    const contact = lookups.contactByName.get(row.kontak.trim().toLowerCase());
    if (!contact) errors.push(`Kontak tidak ditemukan: ${row.kontak}`);
    else {
      contactId = contact.id;
      contactCompanyId = contact.companyId;
    }
  }

  // invalid bila judul/brand gagal (blokir pembuatan); review bila hanya kontak yang gagal
  const blocking = errors.some((e) => !e.startsWith("Kontak"));
  const status: RowStatus = errors.length === 0 ? "valid" : blocking ? "invalid" : "review";

  // perusahaan: cocokkan nama → fallback companyId milik kontak
  let companyId: string | null = null;
  if (row.perusahaan) companyId = lookups.companyByName.get(row.perusahaan.trim().toLowerCase()) ?? null;
  if (!companyId) companyId = contactCompanyId;

  const digits = row.nilaiEstimasi.replace(/\D/g, "");
  const estimatedValue = digits ? Number(digits) : null;

  const probDigits = row.probabilitasPct.replace(/\D/g, "");
  const probability = probDigits ? Math.max(0, Math.min(100, parseInt(probDigits, 10))) : 50;

  const currency = row.mataUang.trim().toUpperCase() || "IDR";

  return {
    status,
    errors,
    brandId,
    contactId,
    companyId,
    stage: resolveStage(row.tahap),
    temperature: resolveTemperature(row.temperatur),
    priority: resolvePriority(row.prioritas),
    estimatedValue,
    currency,
    probability,
    expectedCloseDate: parseTargetClose(row.targetClose),
  };
}

// ---------- Handler ----------

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const commit = Boolean(body.commit);
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "marketing");
  const rows = normalizeRows(body.rows);

  if (!Array.isArray(body.rows) || rows.length === 0) return fail("Tidak ada baris untuk diimpor");
  if (rows.length > MAX_ROWS) return fail(`Maksimal ${MAX_ROWS} baris per impor`);

  const lookups = await loadLookups();

  // ============ PREVIEW ============
  if (!commit) {
    const preview = rows.map((row, i) => {
      const r = resolveRow(row, lookups);
      return {
        index: i,
        judul: row.judul,
        brand: row.brand,
        kontak: row.kontak,
        tahap: row.tahap,
        tahapResolved: r.stage,
        nilai: row.nilaiEstimasi,
        status: r.status,
        errors: r.errors,
      };
    });
    return ok({
      preview,
      summary: {
        total: preview.length,
        valid: preview.filter((p) => p.status === "valid").length,
        invalid: preview.filter((p) => p.status === "invalid").length,
        review: preview.filter((p) => p.status === "review").length,
      },
    });
  }

  // ============ COMMIT ============
  const summary = { created: 0, skipped: 0, invalid: 0 };
  const results: { index: number; action: "create" | "skip" | "invalid"; opportunityId?: string; label?: string; error?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = resolveRow(row, lookups);

    if (r.status === "invalid") {
      summary.invalid++;
      results.push({ index: i, action: "invalid", label: row.judul, error: r.errors.join("; ") });
      continue;
    }
    if (r.status === "review") {
      // Baris review (kontak tidak cocok) dilewati — tidak dibuat otomatis.
      summary.skipped++;
      results.push({ index: i, action: "skip", label: row.judul, error: r.errors.join("; ") });
      continue;
    }

    const opp = await db.opportunity.create({
      data: {
        title: row.judul,
        brandId: r.brandId!,
        contactId: r.contactId!,
        companyId: r.companyId,
        serviceCategory: row.kategoriLayanan || null,
        serviceName: row.layanan || null,
        leadSource: "import_csv",
        estimatedValue: r.estimatedValue,
        currency: r.currency,
        probability: r.probability,
        expectedCloseDate: r.expectedCloseDate,
        ownerName: row.owner || null,
        priority: r.priority,
        stage: r.stage,
        temperature: r.temperature,
        nextAction: row.aksiBerikutnya || null,
      },
      include: { brand: true, contact: { include: { company: true } }, company: true },
    });
    summary.created++;
    results.push({ index: i, action: "create", opportunityId: opp.id, label: opp.title });
  }

  // SATU audit log untuk seluruh batch impor.
  await logAudit({
    actorName,
    actorRole,
    action: "import",
    entity: "opportunity",
    entityId: "import-batch",
    entityLabel: `Impor CSV (${rows.length} baris)`,
    metadata: `Hasil: ${summary.created} dibuat, ${summary.skipped} dilewati (review), ${summary.invalid} invalid`,
    req,
  });

  return ok({ summary, results }, 201);
}
