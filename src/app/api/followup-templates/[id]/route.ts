import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

/**
 * Task 22-3 — CRUD template follow-up (per item).
 * PATCH  /api/followup-templates/:id — partial update; jika `body` berubah → version +1.
 * DELETE /api/followup-templates/:id — hapus template (tanpa relasi lain, aman).
 */

const TEMPLATE_CHANNELS = ["whatsapp", "instagram", "email"];

function shortVal(v: unknown): string {
  const s = v === null || v === undefined || v === "" ? "∅" : String(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);

  const tpl = await db.followUpTemplate.findUnique({ where: { id } });
  if (!tpl) return fail("Template tidak ditemukan", 404);

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return fail("Nama template wajib diisi");
    data.name = name;
  }
  if (body.body !== undefined) {
    const text = String(body.body).trim();
    if (!text) return fail("Isi template wajib diisi");
    data.body = text;
  }
  if (body.channel !== undefined) {
    const channel = String(body.channel).trim();
    if (!TEMPLATE_CHANNELS.includes(channel)) {
      return fail("Kanal harus salah satu dari: whatsapp, instagram, email");
    }
    data.channel = channel;
  }
  if (body.language !== undefined) {
    data.language = String(body.language).trim() || "id";
  }
  if (body.stage !== undefined) data.stage = String(body.stage).trim() || null;
  if (body.delayDays !== undefined) {
    const delay = Number(body.delayDays);
    if (!Number.isInteger(delay) || delay < 0 || delay > 30) {
      return fail("Jeda hari (delayDays) harus bilangan bulat 0–30");
    }
    data.delayDays = delay;
  }
  if (body.brandId !== undefined) {
    const brandId = body.brandId ? String(body.brandId) : null;
    if (brandId) {
      const brand = await db.brand.findUnique({ where: { id: brandId } });
      if (!brand) return fail("Brand tidak ditemukan", 404);
    }
    data.brandId = brandId;
  }
  if (body.approved !== undefined) data.approved = Boolean(body.approved);

  if (Object.keys(data).length === 0) {
    return fail("Tidak ada field yang diubah");
  }

  // Isi pesan berubah → naikkan versi (riwayat perubahan template).
  if (typeof data.body === "string" && data.body !== tpl.body) {
    data.version = tpl.version + 1;
  }

  const updated = await db.followUpTemplate.update({ where: { id }, data });

  const changes = Object.keys(data)
    .filter((k) => updated[k as keyof typeof updated] !== tpl[k as keyof typeof tpl])
    .map((k) => `${k} ${shortVal(tpl[k as keyof typeof tpl])}→${shortVal(updated[k as keyof typeof updated])}`);

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: String(body.actorRole ?? "system"),
    action: "update",
    entity: "template",
    entityId: id,
    entityLabel: updated.name,
    newValue: changes.length
      ? `Ubah template "${tpl.name}" (${changes.slice(0, 6).join(", ")})`
      : `Ubah template "${tpl.name}" (tanpa perubahan nilai)`,
    req,
  });

  return ok({ template: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req); // boleh kosong (fetch DELETE tanpa body)

  const tpl = await db.followUpTemplate.findUnique({ where: { id } });
  if (!tpl) return fail("Template tidak ditemukan", 404);

  await db.followUpTemplate.delete({ where: { id } });

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: String(body.actorRole ?? "system"),
    action: "delete",
    entity: "template",
    entityId: id,
    entityLabel: tpl.name,
    oldValue: `Hapus template "${tpl.name}" (v${tpl.version}, ${tpl.channel}, H+${tpl.delayDays})`,
    req,
  });

  return ok({ ok: true });
}
