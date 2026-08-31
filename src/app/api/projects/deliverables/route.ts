import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Task 22-4 — Keputusan review & hapus deliverable (tanpa path param).
 * PATCH  /api/projects/deliverables → { id, decision: "approved"|"revision", reviewComment? }
 *        Set status + reviewComment + reviewedBy/At, audit action "review".
 *        Ronde 27: reviewedBy/reviewedRole diambil dari SESI (body tidak dipercaya).
 * DELETE /api/projects/deliverables → { id }
 *        Hanya role super_admin/director/production ATAU pembuat deliverable
 *        (nama sesi === createdBy) yang boleh menghapus; selain itu 403. Audit action "delete".
 */

const REVIEW_ROLES = ["super_admin", "director", "production"];

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const id = String(body.id ?? "").trim();
  if (!id) return fail("id deliverable wajib", 400);

  const decision = String(body.decision ?? "").trim();
  if (decision !== "approved" && decision !== "revision") {
    return fail("Keputusan review harus 'approved' atau 'revision'", 400);
  }

  const existing = await db.projectDeliverable.findUnique({
    where: { id },
    include: { project: { select: { code: true, name: true } } },
  });
  if (!existing) return fail("Deliverable tidak ditemukan", 404);

  const reviewedBy = actor.name;
  const reviewComment = body.reviewComment ? String(body.reviewComment).trim() : null;

  const deliverable = await db.projectDeliverable.update({
    where: { id },
    data: {
      status: decision,
      reviewComment,
      reviewedBy,
      reviewedRole: actor.role,
      reviewedAt: new Date(),
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "review",
    entity: "deliverable",
    entityId: deliverable.id,
    entityLabel: `${existing.project.code} · ${existing.name}`,
    oldValue: JSON.stringify({ status: existing.status }),
    newValue: JSON.stringify({ status: decision, reviewComment }),
    req,
  });

  return ok({ deliverable });
}

export async function DELETE(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const id = String(body.id ?? "").trim();
  if (!id) return fail("id deliverable wajib", 400);

  const existing = await db.projectDeliverable.findUnique({
    where: { id },
    include: { project: { select: { code: true, name: true } } },
  });
  if (!existing) return fail("Deliverable tidak ditemukan", 404);

  // Ronde 27: izin hapus = role manajemen ATAU pembuat (dicocokkan dari nama sesi).
  const allowed = REVIEW_ROLES.includes(actor.role ?? "") || actor.name === existing.createdBy;
  if (!allowed) return fail("Hanya pembuat atau manajemen yang boleh menghapus", 403);

  await db.projectDeliverable.delete({ where: { id } });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "delete",
    entity: "deliverable",
    entityId: id,
    entityLabel: `${existing.project.code} · ${existing.name}`,
    oldValue: JSON.stringify({ name: existing.name, kind: existing.kind, status: existing.status }),
    req,
  });

  return ok({ ok: true });
}
