import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  NUMBERING_DOC_TYPES,
  validateNumberingTemplate,
  renderNumberTemplate,
  periodKey,
  DOC_TYPE_DEFAULT_CODE,
  type NumberingDocType,
} from "@/lib/crm/numbering-core";

/**
 * Ronde 50 — BUILDER SISTEM PENOMORAN SURAT per brand per jenis dokumen.
 * GET  /api/brands/:id/numbering → { rules: NumberingRule[], brand: {shortCode, quotePrefix, invoicePrefix} }
 * PUT  /api/brands/:id/numbering body { rules: [{docType, template, docCode, resetPeriod, seq}] }
 *   → upsert per docType (hanya quotation & invoice utk saat ini), validasi token template,
 *     counter (seq) bisa disetel manual (mis. mulai dari 11 supaya nomor berikut 012).
 */

function isDocType(v: unknown): v is NumberingDocType {
  return typeof v === "string" && (NUMBERING_DOC_TYPES as readonly string[]).includes(v);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await resolveActor(req, {});
  if (actor.denied) return fail(actor.reason, 401);

  const brand = await db.brand.findUnique({
    where: { id },
    select: { id: true, name: true, shortCode: true, quotePrefix: true, invoicePrefix: true },
  });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const rules = await db.numberingRule.findMany({ where: { brandId: id } });
  return ok({ rules, brand });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const brand = await db.brand.findUnique({ where: { id } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const rawRules = Array.isArray(body.rules) ? body.rules : [];
  if (rawRules.length === 0) return fail("Tidak ada rule penomoran yang dikirim");

  const now = new Date();
  const brandCode = brand.shortCode?.trim() || brand.name.slice(0, 4).toUpperCase();
  const saved: Array<{ docType: string; template: string; docCode: string; resetPeriod: string; seq: number }> = [];

  for (const raw of rawRules) {
    if (!isDocType(raw?.docType)) return fail("Jenis dokumen tidak dikenal", 400);
    const template = String(raw.template ?? "").trim();
    const check = validateNumberingTemplate(template);
    if (!check.valid) return fail(`Template ${raw.docType}: ${check.error}`, 400);

    const docCode = String(raw.docCode ?? DOC_TYPE_DEFAULT_CODE[raw.docType]).trim().toUpperCase().slice(0, 12) || DOC_TYPE_DEFAULT_CODE[raw.docType];
    const resetPeriod = ["never", "yearly", "monthly"].includes(String(raw.resetPeriod)) ? String(raw.resetPeriod) : "yearly";
    const seqNum = Number(raw.seq);
    const seq = Number.isFinite(seqNum) ? Math.min(999_999, Math.max(0, Math.floor(seqNum))) : 0;

    const existing = await db.numberingRule.findUnique({
      where: { brandId_docType: { brandId: id, docType: raw.docType } },
    });
    const data = {
      template,
      docCode,
      resetPeriod,
      seq,
      // resetKey disetel ke periode SEKARANG supaya counter yang baru disetel tidak langsung ter-reset.
      resetKey: periodKey(resetPeriod, now),
    };
    const rule = existing
      ? await db.numberingRule.update({ where: { id: existing.id }, data })
      : await db.numberingRule.create({ data: { brandId: id, docType: raw.docType, ...data } });
    saved.push({
      docType: rule.docType,
      template: rule.template,
      docCode: rule.docCode,
      resetPeriod: rule.resetPeriod,
      seq: rule.seq,
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "brand", entityId: id, entityLabel: brand.name,
      field: `numbering.${rule.docType}`,
      newValue: `${template} (kode ${docCode}, counter ${seq})`,
      metadata: `Builder penomoran ${rule.docType} brand ${brand.name}`,
      req,
    });
  }

  // Pratinjau nomor berikutnya utk tiap rule (pakai counter yang baru disimpan).
  const preview = saved.map((r) => ({
    docType: r.docType,
    nextNumber: renderNumberTemplate(r.template, {
      seq: r.seq + 1,
      revisionNo: 0,
      date: now,
      docCode: r.docCode,
      brandCode,
    }),
    revisionExample: renderNumberTemplate(r.template, {
      seq: r.seq + 1,
      revisionNo: 1,
      date: now,
      docCode: r.docCode,
      brandCode,
    }),
  }));

  return ok({ rules: saved, preview });
}
