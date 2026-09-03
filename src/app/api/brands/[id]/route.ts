import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

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
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

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

  // ==== Ronde 29-b — Identitas brand dari data asli situs ====
  // logoUrl: path aset publik ("/brands/…") atau data URL upload (≤1.6MB base64).
  if (body.logoUrl !== undefined) {
    const val = String(body.logoUrl).trim();
    if (val && !val.startsWith("/") && !val.startsWith("data:image/")) {
      return fail("logoUrl harus path aset publik atau data URL gambar");
    }
    if (val.startsWith("data:image/") && val.length > 1_600_000) {
      return fail("Ukuran logo terlalu besar (maksimal ±1.2MB)");
    }
    data.logoUrl = val || null;
  }
  if (body.tagline !== undefined) data.tagline = String(body.tagline).trim() || null;
  if (body.address !== undefined) data.address = String(body.address).trim() || null;
  if (body.city !== undefined) data.city = String(body.city).trim() || null;
  if (body.phone !== undefined) data.phone = String(body.phone).trim() || null;
  if (body.whatsappNumber !== undefined) data.whatsappNumber = String(body.whatsappNumber).trim() || null;
  if (body.instagramHandle !== undefined) {
    const ig = String(body.instagramHandle).trim();
    data.instagramHandle = ig ? (ig.startsWith("@") ? ig : `@${ig}`) : null;
  }
  if (body.threadsHandle !== undefined) {
    const th = String(body.threadsHandle).trim();
    data.threadsHandle = th ? (th.startsWith("@") ? th : `@${th}`) : null;
  }
  if (body.email !== undefined) data.email = String(body.email).trim().toLowerCase() || null;
  if (body.letterheadHeader !== undefined) {
    const val = String(body.letterheadHeader).trim();
    if (val && !val.startsWith("data:image/") && !val.startsWith("/")) {
      return fail("Kop surat harus berupa gambar (data URL)");
    }
    if (val.startsWith("data:image/") && val.length > 1_600_000) {
      return fail("Gambar kop surat terlalu besar (maksimal ±1.2MB)");
    }
    data.letterheadHeader = val || null;
  }
  if (body.letterheadFooter !== undefined) {
    const val = String(body.letterheadFooter).trim();
    if (val && !val.startsWith("data:image/") && !val.startsWith("/")) {
      return fail("Kaki surat harus berupa gambar (data URL)");
    }
    if (val.startsWith("data:image/") && val.length > 1_600_000) {
      return fail("Gambar kaki surat terlalu besar (maksimal ±1.2MB)");
    }
    data.letterheadFooter = val || null;
  }
  if (body.letterTemplate !== undefined) {
    // JSON style template surat — simpan apa adanya setelah validasi objek.
    if (body.letterTemplate === null || body.letterTemplate === "") {
      data.letterTemplate = null;
    } else {
      try {
        const parsed = typeof body.letterTemplate === "string" ? JSON.parse(body.letterTemplate) : body.letterTemplate;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return fail("Template surat harus berupa objek JSON");
        }
        data.letterTemplate = JSON.stringify(parsed);
      } catch {
        return fail("Template surat bukan JSON yang valid");
      }
    }
  }

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
    name: brand.name, slug: brand.slug, color: brand.color,
    description: brand.description, website: brand.website, primaryCurrency: brand.primaryCurrency,
    invoicePrefix: brand.invoicePrefix, quotePrefix: brand.quotePrefix, slaHours: brand.slaHours,
    portalDomain: brand.portalDomain, active: brand.active,
    logoUrl: brand.logoUrl, tagline: brand.tagline, address: brand.address, city: brand.city,
    phone: brand.phone, whatsappNumber: brand.whatsappNumber, instagramHandle: brand.instagramHandle,
    threadsHandle: brand.threadsHandle, email: brand.email,
  };
  const changes = Object.keys(data)
    .filter((k) => data[k] !== prev[k])
    .map((k) => (String(data[k] ?? "").length > 40 ? k : `${k} ${shortVal(prev[k])}→${shortVal(data[k])}`));
  const summary = changes.length
    ? `Ubah brand ${brand.name} (${changes.slice(0, 6).join(", ")})`
    : `Ubah brand ${brand.name} (tanpa perubahan nilai)`;

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    entity: "brand",
    entityId: id,
    entityLabel: updated.name,
    newValue: summary,
    req,
  });

  return ok({ brand: updated });
}
