import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, FINANCE_WRITE_ROLES, strOrNull } from "../../_lib";

/**
 * FASE 7 — Ubah akun (rename / aktif-nonaktif). TIDAK ada hapus (aturan blueprint:
 * akun dengan mutasi jurnal tidak boleh hilang dari buku besar).
 * PATCH {name?, active?} — finance/director.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const current = await db.account.findUnique({ where: { id } });
  if (!current) return fail("Akun tidak ditemukan", 404);

  const data: { name?: string; active?: boolean } = {};
  if ("name" in body) {
    const name = strOrNull(body.name);
    if (!name) return fail("Nama akun wajib diisi");
    data.name = name.slice(0, 120);
  }
  if ("active" in body) data.active = Boolean(body.active);
  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan yang dikirim");

  const account = await db.account.update({ where: { id }, data });
  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: "update", entity: "account", entityId: account.id, entityLabel: `${account.code} — ${account.name}`,
    field: Object.keys(data).join(", "),
    oldValue: `${current.name} (${current.active ? "aktif" : "nonaktif"})`,
    newValue: `${account.name} (${account.active ? "aktif" : "nonaktif"})`,
    req,
  });
  return ok({ account });
}
