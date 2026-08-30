import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";

/**
 * Task 23-c — Aktifkan/cabut & hapus token secure link klien.
 * PATCH  /api/portal/tokens/:id → { active?: boolean, actorName? }
 *        active=false = dicabut (URL mati), true = diaktifkan kembali. Audit "update".
 * DELETE /api/portal/tokens/:id → hapus permanen; URL yang sudah dibagikan mati. Audit "delete".
 */

function tokenLabel(name: string, label?: string | null) {
  return `Token portal ${name}${label ? ` · ${label}` : ""}`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);

  if (body.active === undefined || typeof body.active !== "boolean") {
    return fail("Field 'active' wajib diisi (true/false)", 400);
  }
  const active = body.active;

  const existing = await db.clientPortalToken.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!existing) return fail("Token tidak ditemukan", 404);

  const updated = await db.clientPortalToken.update({
    where: { id },
    data: { active },
  });

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: body.actorRole !== undefined && body.actorRole !== null ? String(body.actorRole) : null,
    action: "update",
    entity: "portal_token",
    entityId: id,
    entityLabel: tokenLabel(existing.company?.name ?? existing.companyId, existing.label),
    oldValue: existing.active ? "Aktif" : "Dicabut",
    newValue: active ? "Diaktifkan" : "Dicabut",
    req,
  });

  return ok({ token: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);

  const existing = await db.clientPortalToken.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!existing) return fail("Token tidak ditemukan", 404);

  await db.clientPortalToken.delete({ where: { id } });

  await logAudit({
    actorName: body.actorName !== undefined && body.actorName !== null ? String(body.actorName).trim() || "System" : "System",
    actorRole: body.actorRole !== undefined && body.actorRole !== null ? String(body.actorRole) : null,
    action: "delete",
    entity: "portal_token",
    entityId: id,
    entityLabel: tokenLabel(existing.company?.name ?? existing.companyId, existing.label),
    oldValue: `Token dihapus (${existing.label ?? "tanpa label"})`,
    req,
  });

  return ok({ ok: true });
}
