import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 40 — master pajak bebas (model Tax): nama + persentase.
 * GET  : auto-seed [PPN 11, PPh 21 5, PPh 23 2] bila tabel kosong, lalu semua pajak aktif (nama asc).
 * POST : {name, rate} — rate dipatok 0–100.
 * PATCH: {id, name?, rate?, active?}.
 * Tulis hanya finance/director/super_admin.
 */

const DEFAULT_TAXES = [
  { name: "PPN", rate: 11 },
  { name: "PPh 21", rate: 5 },
  { name: "PPh 23", rate: 2 },
];

const TAX_EDITOR_ROLES = ["finance", "director", "super_admin"];

/** Pastikan master pajak tidak kosong (seed sekali). */
async function ensureSeeded() {
  const count = await db.tax.count();
  if (count === 0) await db.tax.createMany({ data: DEFAULT_TAXES });
}

export async function GET() {
  await ensureSeeded();
  const taxes = await db.tax.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return ok({ taxes });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  if (!actor.role || !TAX_EDITOR_ROLES.includes(actor.role)) {
    return fail("Hanya Keuangan, Direktur, atau Super Admin yang dapat mengelola pajak", 403);
  }
  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama pajak wajib diisi");
  const rate = numOrNull(body.rate);
  if (rate === null) return fail("Persentase pajak wajib berupa angka");

  const tax = await db.tax.create({
    data: { name: name.slice(0, 80), rate: Math.min(100, Math.max(0, rate)) },
  });
  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "tax", entityId: tax.id, entityLabel: tax.name,
    field: "rate", newValue: tax.rate, metadata: "Master pajak baru", req,
  });
  return ok({ tax }, 201);
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  if (!actor.role || !TAX_EDITOR_ROLES.includes(actor.role)) {
    return fail("Hanya Keuangan, Direktur, atau Super Admin yang dapat mengelola pajak", 403);
  }
  const id = String(body.id ?? "");
  if (!id) return fail("id pajak wajib diisi");
  const current = await db.tax.findUnique({ where: { id } });
  if (!current) return fail("Pajak tidak ditemukan", 404);

  const data: { name?: string; rate?: number; active?: boolean } = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return fail("Nama pajak wajib diisi");
    data.name = name.slice(0, 80);
  }
  if ("rate" in body) {
    const rate = numOrNull(body.rate);
    if (rate === null) return fail("Persentase pajak wajib berupa angka");
    data.rate = Math.min(100, Math.max(0, rate));
  }
  if ("active" in body) data.active = Boolean(body.active);
  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan yang dikirim");

  const tax = await db.tax.update({ where: { id }, data });
  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "tax", entityId: tax.id, entityLabel: tax.name,
    field: Object.keys(data).join(", "),
    oldValue: `${current.name} ${current.rate}%${current.active ? "" : " (nonaktif)"}`,
    newValue: `${tax.name} ${tax.rate}%${tax.active ? "" : " (nonaktif)"}`,
    req,
  });
  return ok({ tax });
}
