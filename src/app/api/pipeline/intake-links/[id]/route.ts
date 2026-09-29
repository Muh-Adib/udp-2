import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 57 — detail shareable intake link.
 *
 * PATCH  /api/pipeline/intake-links/:id  — { active?, label? } (aktifkan/matikan/rename).
 * DELETE /api/pipeline/intake-links/:id  — hapus permanen (link mati seketika).
 */

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  if (actor.role === "client") return fail("Tidak diizinkan", 403);

  const existing = await db.leadIntakeLink.findUnique({ where: { id }, include: { brand: true } });
  if (!existing) return fail("Link tidak ditemukan", 404);

  const data: { active?: boolean; label?: string | null } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if ("label" in body) {
    const label = body.label == null ? null : String(body.label).trim().slice(0, 120);
    data.label = label || null;
  }
  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan");

  const link = await db.leadIntakeLink.update({
    where: { id },
    data,
    include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    entity: "intake_link",
    entityId: id,
    entityLabel: `link form intake ${existing.brand.name}`,
    oldValue: { active: existing.active, label: existing.label },
    newValue: data,
    req,
  });

  return ok({ link });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  if (actor.role === "client") return fail("Tidak diizinkan", 403);

  const existing = await db.leadIntakeLink.findUnique({ where: { id }, include: { brand: true } });
  if (!existing) return fail("Link tidak ditemukan", 404);

  await db.leadIntakeLink.delete({ where: { id } });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "delete",
    entity: "intake_link",
    entityId: id,
    entityLabel: `link form intake ${existing.brand.name}${existing.label ? ` (${existing.label})` : ""}`,
    req,
  });

  return ok({ deleted: true });
}
