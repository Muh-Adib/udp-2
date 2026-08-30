import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { PIPELINE_STAGES, stageLabel } from "@/lib/crm/constants";

/**
 * Import CSV opportunity (Task 15-a + 16-b) — round-trip dengan ekspor ronde 13.
 * Row schema = 17 header ekspor (key lowercase): judul, brand, perusahaan, kontak,
 * kategori_layanan, layanan, tahap, temperatur, prioritas, skor (DIABAIKAN — skor dihitung
 * server via computeLeadScore saat GET), nilai_estimasi, mata_uang, probabilitas_pct,
 * owner, target_close, aksi_berikutnya, dibuat (DIABAIKAN).
 *
 * - commit=false (preview): validasi + resolusi + deteksi duplikat tanpa menulis DB.
 *   Dedupe (16-b): baris valid = duplikat bila ada opportunity existing (non-deleted) dengan
 *   judul case-insensitive-trimmed sama + brandId sama + companyId sama (baris tanpa
 *   perusahaan: cukup judul + brand). Preview row mendapat `duplicateOf` + summary
 *   `duplicateCount`.
 * - commit=true: baris valid diproses sesuai `rowActions[index]` ("skip" | "create" |
 *   "update") — default baris duplikat = "skip", baris non-duplikat = "create".
 *   "update" memperbarui opportunity existing dengan field non-empty dari baris
 *   (tahap, nilai estimasi, target close, owner, prioritas, aksi berikutnya) — judul,
 *   brand, perusahaan, kontak TIDAK PERNAH ditimpa. Review/invalid selalu dilewati.
 *   SATU audit log batch dengan statistik dedupe.
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

function formatValueLog(n: number | null): string {
  return n == null ? "—" : `Rp ${n.toLocaleString("id-ID")}`;
}

function formatDateLog(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

// ---------- Deteksi duplikat (Task 16-b) ----------

interface ExistingOppLite {
  id: string;
  title: string;
  brandId: string;
  companyId: string | null;
  createdAt: Date;
}

async function loadExistingOpps(): Promise<ExistingOppLite[]> {
  return db.opportunity.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, brandId: true, companyId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Baris valid = duplikat bila ada opportunity existing (non-deleted, terlama dulu) dengan
 * judul case-insensitive-trimmed sama + brandId sama + companyId sama. Baris tanpa
 * perusahaan cukup mencocokkan judul + brand.
 */
function findDuplicate(
  input: { title: string; brandId?: string; companyId: string | null },
  existing: ExistingOppLite[]
): ExistingOppLite | null {
  const t = input.title.trim().toLowerCase();
  if (!t || !input.brandId) return null;
  const sameTitleBrand = existing.filter(
    (o) => o.brandId === input.brandId && o.title.trim().toLowerCase() === t
  );
  if (input.companyId) return sameTitleBrand.find((o) => o.companyId === input.companyId) ?? null;
  return sameTitleBrand[0] ?? null;
}

function toDuplicateOfDTO(d: ExistingOppLite): { id: string; title: string; createdAt: string } {
  return { id: d.id, title: d.title, createdAt: d.createdAt.toISOString() };
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
    const existing = await loadExistingOpps();
    const preview = rows.map((row, i) => {
      const r = resolveRow(row, lookups);
      const dup =
        r.status === "valid"
          ? findDuplicate({ title: row.judul, brandId: r.brandId, companyId: r.companyId }, existing)
          : null;
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
        duplicateOf: dup ? toDuplicateOfDTO(dup) : null,
      };
    });
    return ok({
      preview,
      summary: {
        total: preview.length,
        valid: preview.filter((p) => p.status === "valid").length,
        invalid: preview.filter((p) => p.status === "invalid").length,
        review: preview.filter((p) => p.status === "review").length,
        duplicateCount: preview.filter((p) => p.duplicateOf).length,
      },
    });
  }

  // ============ COMMIT ============
  // rowActions: Record<rowIndex, "skip" | "create" | "update"> — hanya dipakai untuk baris
  // yang terdeteksi duplikat (16-b). Default duplikat tanpa aksi = "skip".
  const rowActions = new Map<number, "skip" | "create" | "update">();
  if (body.rowActions && typeof body.rowActions === "object") {
    for (const [k, v] of Object.entries(body.rowActions as Record<string, unknown>)) {
      const idx = Number(k);
      const a = String(v);
      if (Number.isInteger(idx) && (a === "skip" || a === "create" || a === "update")) {
        rowActions.set(idx, a);
      }
    }
  }

  // Deteksi duplikat dihitung SEKALI sebelum penulisan apa pun agar deterministik
  // (baris dalam batch yang sama tidak saling mempengaruhi).
  const existing = await loadExistingOpps();
  const dupByIndex = new Map<number, ExistingOppLite>();
  for (let i = 0; i < rows.length; i++) {
    const r = resolveRow(rows[i], lookups);
    if (r.status !== "valid") continue;
    const dup = findDuplicate({ title: rows[i].judul, brandId: r.brandId, companyId: r.companyId }, existing);
    if (dup) dupByIndex.set(i, dup);
  }

  const summary = { created: 0, skipped: 0, invalid: 0, updated: 0 };
  const results: {
    index: number;
    action: "create" | "skip" | "invalid" | "update";
    opportunityId?: string;
    label?: string;
    error?: string;
    duplicateOf?: { id: string; title: string; createdAt: string } | null;
    changed?: string[];
  }[] = [];
  let dupSkipped = 0;
  const updateDetails: string[] = [];

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

    const dup = dupByIndex.get(i) ?? null;
    const dupDTO = dup ? toDuplicateOfDTO(dup) : null;
    const requested = rowActions.get(i);
    const action = requested ?? (dup ? "skip" : "create");

    if (action === "skip") {
      summary.skipped++;
      if (dup) dupSkipped++;
      results.push({
        index: i,
        action: "skip",
        label: row.judul,
        duplicateOf: dupDTO,
        error: dup ? `Duplikat dari: ${dup.title}` : undefined,
      });
      continue;
    }

    // "update" hanya bermakna untuk baris duplikat; tanpa target → fallback create.
    if (action === "update" && dup) {
      const target = await db.opportunity.findFirst({ where: { id: dup.id, deletedAt: null } });
      if (!target) {
        // Target terhapus antara preview dan commit → perlakukan sebagai create baru.
      } else {
        const data: {
          stage?: string;
          estimatedValue?: number;
          expectedCloseDate?: Date;
          ownerName?: string;
          priority?: string;
          nextAction?: string;
        } = {};
        const changes: string[] = [];
        if (row.tahap) {
          const st = resolveStage(row.tahap);
          if (st !== target.stage) changes.push(`tahap: ${stageLabel(target.stage)} → ${stageLabel(st)}`);
          data.stage = st;
        }
        if (r.estimatedValue != null && r.estimatedValue !== target.estimatedValue) {
          changes.push(`nilai: ${formatValueLog(target.estimatedValue)} → ${formatValueLog(r.estimatedValue)}`);
          data.estimatedValue = r.estimatedValue;
        }
        // Impor bergranulasi tanggal (bukan jam) — bandingkan per hari agar timestamp jam
        // existing (mis. 23:07) tidak dianggap berubah oleh tanggal CSV tengah malam.
        const existingCloseDay = target.expectedCloseDate ? target.expectedCloseDate.toISOString().slice(0, 10) : null;
        if (r.expectedCloseDate && r.expectedCloseDate.toISOString().slice(0, 10) !== existingCloseDay) {
          changes.push(`target close: ${formatDateLog(target.expectedCloseDate)} → ${formatDateLog(r.expectedCloseDate)}`);
          data.expectedCloseDate = r.expectedCloseDate;
        }
        if (row.owner && row.owner !== (target.ownerName ?? "")) {
          changes.push(`owner: ${target.ownerName ?? "—"} → ${row.owner}`);
          data.ownerName = row.owner;
        }
        if (row.prioritas && r.priority !== target.priority) {
          changes.push(`prioritas: ${target.priority} → ${r.priority}`);
          data.priority = r.priority;
        }
        if (row.aksiBerikutnya && row.aksiBerikutnya !== (target.nextAction ?? "")) {
          changes.push(`aksi berikutnya: ${target.nextAction ?? "—"} → ${row.aksiBerikutnya}`);
          data.nextAction = row.aksiBerikutnya;
        }
        await db.opportunity.update({ where: { id: target.id }, data });
        summary.updated++;
        if (changes.length) updateDetails.push(`${target.title} (${changes.join("; ")})`);
        results.push({
          index: i,
          action: "update",
          opportunityId: target.id,
          label: target.title,
          duplicateOf: toDuplicateOfDTO(target as ExistingOppLite),
          changed: changes,
        });
        continue;
      }
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
    results.push({ index: i, action: "create", opportunityId: opp.id, label: opp.title, duplicateOf: dupDTO });
  }

  // SATU audit log untuk seluruh batch impor (+ statistik dedupe).
  const metaParts = [
    `Hasil: ${summary.created} dibuat, ${summary.updated} diperbarui, ${summary.skipped} dilewati, ${summary.invalid} invalid`,
  ];
  if (dupSkipped > 0 || summary.updated > 0) {
    metaParts.push(`duplikat: ${dupSkipped} dilewati, ${summary.updated} diperbarui`);
  }
  if (updateDetails.length > 0) {
    metaParts.push(`Perubahan: ${updateDetails.join(" | ")}`);
  }
  await logAudit({
    actorName,
    actorRole,
    action: "import",
    entity: "opportunity",
    entityId: "import-batch",
    entityLabel: `Impor CSV (${rows.length} baris)`,
    metadata: metaParts.join(" · "),
    req,
  });

  return ok({ summary, results }, 201);
}
