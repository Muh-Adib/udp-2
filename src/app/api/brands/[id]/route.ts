import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

/**
 * Task 22-3 — Edit brand: PATCH /api/brands/:id
 * Hanya key yang dikirim yang di-update (partial update). Tidak ada DELETE:
 * nonaktifkan brand via `active: false`.
 */

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function shortVal(v: unknown): string {
  const s = v === null || v === undefined || v === "" ? "∅" : String(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);

  const brand = await db.brand.findUnique({ where: { id } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return fail("Nama brand wajib diisi");
    data.name = name;
  }
  if (body.slug !== undefined) {
    const slug = slugify(String(body.slug));
    if (!slug) return fail("Slug brand tidak valid");
    data.slug = slug;
  }
  if (body.color !== undefined) {
    const color = String(body.color).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return fail("Warna harus format hex #RRGGBB");
    data.color = color;
  }
  if (body.logoEmoji !== undefined) {
    data.logoEmoji = String(body.logoEmoji).trim() || "◆";
  }
  if (body.description !== undefined) data.description = String(body.description).trim() || null;
  if (body.website !== undefined) data.website = String(body.website).trim() || null;
  if (body.primaryCurrency !== undefined) {
    data.primaryCurrency = String(body.primaryCurrency).trim().toUpperCase() || "IDR";
  }
  if (body.invoicePrefix !== undefined) {
    data.invoicePrefix = String(body.invoicePrefix).trim().toUpperCase();
  }
  if (body.quotePrefix !== undefined) {
    data.quotePrefix = String(body.quotePrefix).trim().toUpperCase();
  }
  if (body.slaHours !== undefined) {
    const sla = Number(body.slaHours);
    if (!Number.isInteger(sla) || sla < 1 || sla > 72) {
      return fail("SLA harus bilangan bulat antara 1 dan 72 jam");
    }
    data.slaHours = sla;
  }
  if (body.portalDomain !== undefined) data.portalDomain = String(body.portalDomain).trim() || null;
  if (body.active !== undefined) data.active = Boolean(body.active);

  if (Object.keys(data).length === 0) {
    return fail("Tidak ada field yang diubah");
  }

  // Slug unik — kecualikan brand ini sendiri.
  if (typeof data.slug === "string" && data.slug !== brand.slug) {
    const clash = await db.brand.findFirst({ where: { slug: data.slug, id: { not: id } } });
    if (clash) return fail("Slug sudah dipakai brand lain", 409);
  }

  const updated = await db.brand.update({ where: { id }, data });

  // Ringkasan singkat perubahan utk audit: "Ubah brand Unimasi (slaHours 4→6)".
  const prev: Record<string, unknown> = {
    name: brand.name, slug: brand.slug, color: brand.color, logoEmoji: brand.logoEmoji,
    description: brand.description, website: brand.website, primaryCurrency: brand.primaryCurrency,
    invoicePrefix: brand.invoicePrefix, quotePrefix: brand.quotePrefix, slaHours: brand.slaHours,
    portalDomain: brand.portalDomain, active: brand.active,
  };
  const changes = Object.keys(data)
    .filter((k) => data[k] !== prev[k])
    .map((k) => `${k} ${shortVal(prev[k])}→${shortVal(data[k])}`);
  const summary = changes.length
    ? `Ubah brand ${brand.name} (${changes.slice(0, 6).join(", ")})`
    : `Ubah brand ${brand.name} (tanpa perubahan nilai)`;

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: String(body.actorRole ?? "system"),
    action: "update",
    entity: "brand",
    entityId: id,
    entityLabel: updated.name,
    newValue: summary,
    req,
  });

  return ok({ brand: updated });
}
