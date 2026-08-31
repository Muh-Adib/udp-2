import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, fail, logAudit, findMatchCandidates, loadMatchContacts } from "@/lib/crm/server";
import { normalizeEmail, normalizePhone, isValidEmail } from "@/lib/crm/utils";

/** Batas baris per impor — cukup untuk use case agency, mencegah abuse. */
const MAX_ROWS = 200;

interface ImportRow {
  fullName: string;
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  company?: string | null;
  position?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  country?: string | null;
  city?: string | null;
}

interface NormalizedRow extends ImportRow {
  email: string | null;
  whatsapp: string | null;
  phone: string | null;
}

type RowAction = "auto_create" | "review" | "invalid";

interface PreviewResult {
  index: number;
  fullName: string;
  company?: string | null;
  status: "valid" | "invalid";
  errors: string[];
  action: RowAction;
  /** "create" bila aman dibuat, "link:<id>" bila kandidat kuat, "skip" bila invalid. */
  suggested: string;
  candidates: { contactId: string; score: number; reasons: string[]; name?: string | null; company?: string | null }[];
  /** Peringatan duplikat di dalam file yang sama. */
  intraBatch?: string;
}

function normalizeRows(raw: unknown): NormalizedRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
    return {
      fullName: s(row.fullName) ?? "",
      email: normalizeEmail(s(row.email)),
      whatsapp: normalizePhone(s(row.whatsapp)),
      phone: normalizePhone(s(row.phone)),
      company: s(row.company),
      position: s(row.position),
      instagram: s(row.instagram),
      facebook: s(row.facebook),
      tiktok: s(row.tiktok),
      country: s(row.country),
      city: s(row.city),
    };
  });
}

function validateRow(row: NormalizedRow): string[] {
  const errors: string[] = [];
  if (!row.fullName) errors.push("Nama wajib diisi");
  if (!row.email && !row.whatsapp && !row.phone) errors.push("Minimal satu kontak (email/WA/telepon)");
  if (row.email && !isValidEmail(row.email)) errors.push("Format email tidak valid (handle sosial @username bukan email)");
  return errors;
}

/**
 * Import kontak massal dengan dedupe identity matching.
 * - commit=false (preview): validasi + kandidat duplikat + deteksi duplikat intra-batch, TIDAK menulis DB.
 * - commit=true: eksekusi per keputusan — "skip" | "create" | "link:<contactId>".
 *   Tanpa keputusan: auto create bila tanpa kandidat ≥50, selain itu skip.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const commit = Boolean(body.commit);
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "marketing");
  const rows = normalizeRows(body.rows);
  const decisions = (body.decisions ?? {}) as Record<string, string>;

  if (!Array.isArray(body.rows) || rows.length === 0) return fail("Tidak ada baris untuk diimpor");
  if (rows.length > MAX_ROWS) return fail(`Maksimal ${MAX_ROWS} baris per impor`);

  // ============ PREVIEW ============
  if (!commit) {
    // Deteksi duplikat intra-batch berdasarkan email/WA/telepon ternormalisasi
    const seenEmail = new Map<string, number>();
    const seenWa = new Map<string, number>();
    const seenPhone = new Map<string, number>();
    const results: PreviewResult[] = [];

    // FIX r26 (N+1): muat pool kontak SEKALI untuk seluruh baris impor
    const contactPool = await loadMatchContacts();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const errors = validateRow(row);
      let intraBatch: string | undefined;

      if (!errors.length) {
        const prevEmail = row.email ? seenEmail.get(row.email) : undefined;
        const prevWa = !prevEmail && row.whatsapp ? seenWa.get(row.whatsapp) : undefined;
        const prevPhone = !prevEmail && !prevWa && row.phone ? seenPhone.get(row.phone) : undefined;
        if (prevEmail !== undefined) intraBatch = `Email sama dengan baris ${prevEmail + 1}`;
        else if (prevWa !== undefined) intraBatch = `WhatsApp sama dengan baris ${prevWa + 1}`;
        else if (prevPhone !== undefined) intraBatch = `Telepon sama dengan baris ${prevPhone + 1}`;
        if (row.email) seenEmail.set(row.email, i);
        if (row.whatsapp) seenWa.set(row.whatsapp, i);
        if (row.phone) seenPhone.set(row.phone, i);
      }

      // FIX r26 (N+1): pool kontak dimuat sekali di luar loop (dulu hingga 200× query 500 kontak)
      const candidates = errors.length ? [] : await findMatchCandidates({
        email: row.email, whatsapp: row.whatsapp, phone: row.phone,
        fullName: row.fullName, companyName: row.company,
      }, contactPool);
      const filtered = candidates.filter((c) => c.score >= 50).slice(0, 3);

      let action: RowAction = errors.length ? "invalid" : filtered.length > 0 ? "review" : "auto_create";
      const top = filtered[0];
      const suggested = errors.length
        ? "skip"
        : action === "review"
          ? (top && top.score >= 85 ? `link:${top.contactId}` : "create")
          : "create";

      results.push({
        index: i,
        fullName: row.fullName,
        company: row.company,
        status: errors.length ? "invalid" : "valid",
        errors,
        action,
        suggested,
        candidates: filtered.map((c) => ({
          contactId: c.contactId, score: c.score, reasons: c.reasons,
          name: c.contact?.fullName ?? null, company: c.contact?.company?.name ?? null,
        })),
        ...(intraBatch ? { intraBatch } : {}),
      });
    }
    return ok({ preview: results, summary: {
      total: results.length,
      valid: results.filter((r) => r.status === "valid").length,
      invalid: results.filter((r) => r.status === "invalid").length,
      review: results.filter((r) => r.action === "review").length,
    }});
  }

  // ============ COMMIT ============
  const summary = { created: 0, linked: 0, skipped: 0, invalid: 0, companiesCreated: 0 };
  const results: { index: number; action: string; contactId?: string; label?: string; error?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors = validateRow(row);
    if (errors.length) {
      summary.invalid++;
      results.push({ index: i, action: "invalid", error: errors.join("; ") });
      continue;
    }

    const decision = decisions[String(i)] ?? "";

    if (decision === "skip") {
      summary.skipped++;
      results.push({ index: i, action: "skip", label: row.fullName });
      continue;
    }

    // Link ke contact existing: lengkapi field kosong, jangan menimpa data yang sudah ada
    if (decision.startsWith("link:")) {
      const targetId = decision.slice(5);
      const target = await db.contact.findUnique({ where: { id: targetId }, include: { company: true } });
      if (!target) {
        summary.skipped++;
        results.push({ index: i, action: "skip", error: "Contact tujuan link tidak ditemukan", label: row.fullName });
        continue;
      }
      const newCompanyId = !target.companyId && row.company
        ? (await (async () => {
            let company = await db.company.findFirst({ where: { name: row.company!, deletedAt: null } });
            if (!company) {
              company = await db.company.create({ data: { name: row.company!, country: row.country, city: row.city } });
              summary.companiesCreated++;
              await logAudit({ actorName, actorRole, action: "create", entity: "company", entityId: company.id, entityLabel: company.name, metadata: "Import CSV", req });
            }
            return company.id;
          })())
        : null;

      await db.contact.update({
        where: { id: targetId },
        data: {
          ...(!target.email && row.email ? { email: row.email } : {}),
          ...(!target.whatsapp && row.whatsapp ? { whatsapp: row.whatsapp } : {}),
          ...(!target.phone && row.phone ? { phone: row.phone } : {}),
          ...(!target.position && row.position ? { position: row.position } : {}),
          ...(!target.instagram && row.instagram ? { instagram: row.instagram } : {}),
          ...(!target.facebook && row.facebook ? { facebook: row.facebook } : {}),
          ...(!target.tiktok && row.tiktok ? { tiktok: row.tiktok } : {}),
          ...(newCompanyId ? { companyId: newCompanyId } : {}),
          ...(!target.city && row.city ? { city: row.city } : {}),
          ...(!target.country && row.country ? { country: row.country } : {}),
        },
      });
      summary.linked++;
      results.push({ index: i, action: "link", contactId: targetId, label: target.fullName });
      await logAudit({
        actorName, actorRole, action: "update", entity: "contact", entityId: targetId,
        entityLabel: target.fullName, field: "import",
        newValue: "data dilengkapi dari import CSV", metadata: `Impor CSV baris ${i + 1}: digabung ke contact existing (dedupe)`, req,
      });
      continue;
    }

    // Create baru (decision "create" atau auto bila aman)
    if (decision && decision !== "create") {
      summary.skipped++;
      results.push({ index: i, action: "skip", error: `Keputusan tidak dikenal: ${decision}`, label: row.fullName });
      continue;
    }

    let companyId: string | null = null;
    if (row.company) {
      let company = await db.company.findFirst({ where: { name: row.company, deletedAt: null } });
      if (!company) {
        company = await db.company.create({ data: { name: row.company, country: row.country, city: row.city } });
        summary.companiesCreated++;
        await logAudit({ actorName, actorRole, action: "create", entity: "company", entityId: company.id, entityLabel: company.name, metadata: "Import CSV", req });
      }
      companyId = company.id;
    }

    const nameParts = row.fullName.split(/\s+/);
    const contact = await db.contact.create({
      data: {
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(" ") || null,
        fullName: row.fullName,
        email: row.email,
        whatsapp: row.whatsapp,
        phone: row.phone,
        position: row.position,
        instagram: row.instagram,
        facebook: row.facebook,
        tiktok: row.tiktok,
        country: row.country,
        city: row.city,
        companyId,
        tags: JSON.stringify(["import-csv"]),
      },
      include: { company: true },
    });
    summary.created++;
    results.push({ index: i, action: "create", contactId: contact.id, label: contact.fullName });
    await logAudit({
      actorName, actorRole, action: "create", entity: "contact", entityId: contact.id,
      entityLabel: contact.fullName, metadata: `Impor CSV baris ${i + 1}${row.company ? ` — ${row.company}` : ""}`, req,
    });
  }

  await logAudit({
    actorName, actorRole, action: "create", entity: "contact", entityId: "import-batch",
    entityLabel: `Impor CSV (${rows.length} baris)`,
    metadata: `Hasil: ${summary.created} baru, ${summary.linked} digabung, ${summary.skipped} dilewati, ${summary.invalid} invalid, ${summary.companiesCreated} perusahaan baru`, req,
  });

  return ok({ summary, results }, 201);
}
