import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { extractDomain } from "@/lib/crm/utils";
import { resolveActor } from "@/lib/crm/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await db.company.findUnique({
    where: { id },
    include: {
      contacts: { where: { deletedAt: null }, take: 5 },
      _count: { select: { opportunities: true, projects: true, invoices: true } },
    },
  });
  if (!company || company.deletedAt) return fail("Perusahaan tidak ditemukan", 404);
  return ok({ company });
}

/**
 * Ronde 45 — Edit Perusahaan: perbarui data perusahaan existing.
 * Nama tetap dicek duplikat (case-insensitive) KECUALI dirinya sendiri;
 * perubahan diAudit log utk jejak pembaruan.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const current = await db.company.findUnique({ where: { id } });
  if (!current || current.deletedAt) return fail("Perusahaan tidak ditemukan", 404);

  const data: Record<string, unknown> = {};
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  const track = (field: string, next: unknown, prev: unknown) => {
    if (next !== prev) {
      data[field] = next;
      changes.push({ field, oldValue: prev, newValue: next });
    }
  };

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return fail("Nama perusahaan wajib diisi");
    if (name.toLowerCase() !== current.name.trim().toLowerCase()) {
      const dup = await db.company.findFirst({
        where: { name: { equals: name }, deletedAt: null, id: { not: id } },
      });
      if (dup) return fail(`Perusahaan "${dup.name}" sudah terdaftar — nama harus unik`);
      track("name", name, current.name);
    }
  }
  if ("industry" in body) track("industry", body.industry ? String(body.industry).trim() : null, current.industry);
  if ("country" in body) track("country", body.country ? String(body.country).trim() : null, current.country);
  if ("city" in body) track("city", body.city ? String(body.city).trim() : null, current.city);
  if ("address" in body) track("address", body.address ? String(body.address).trim() : null, current.address);
  if ("size" in body) track("size", body.size && body.size !== "none" ? String(body.size) : null, current.size);
  if ("taxId" in body) track("taxId", body.taxId ? String(body.taxId).trim() : null, current.taxId);
  if ("notes" in body) track("notes", body.notes ? String(body.notes) : null, current.notes);
  if ("defaultCurrency" in body) {
    const cur = String(body.defaultCurrency ?? "").trim() || "IDR";
    track("defaultCurrency", cur, current.defaultCurrency);
  }
  if ("website" in body) {
    const website = body.website ? String(body.website).trim() : null;
    track("website", website, current.website);
    // domain dihitung ulang mengikuti website terbaru (pemakaian: dedup/katalog klien)
    const domain = extractDomain(website);
    if (domain !== current.websiteDomain) data.websiteDomain = domain;
  }

  if (Object.keys(data).length === 0) {
    return ok({ company: current, changed: false });
  }

  const company = await db.company.update({ where: { id }, data });
  for (const ch of changes) {
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "company", entityId: company.id, entityLabel: company.name,
      field: ch.field, oldValue: ch.oldValue, newValue: ch.newValue, req,
    });
  }
  return ok({ company, changed: true });
}
