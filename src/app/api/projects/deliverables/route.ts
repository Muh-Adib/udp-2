import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";

/**
 * Task 22-4 — Keputusan review & hapus deliverable (tanpa path param).
 * PATCH  /api/projects/deliverables → { id, decision: "approved"|"revision", reviewComment?, reviewedBy, reviewedRole? }
 *        Set status + reviewComment + reviewedBy/At, audit action "review".
 * DELETE /api/projects/deliverables → { id, actorName, actorRole }
 *        Hanya role super_admin/director/production ATAU pembuat deliverable (actorName === createdBy)
 *        yang boleh menghapus; selain itu 403. Audit action "delete".
 *
 * Catatan kompatibilitas: api.deleteDeliverable(id) lama hanya mengirim { id } —
 * bila actorName/actorRole sama-sama tidak dikirim, hapus diizinkan (pemanggil internal)
 * dan audit memakai nama pembuat sebagai aktor.
 */

const REVIEW_ROLES = ["super_admin", "director", "production"];

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
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

  const reviewedBy = String(body.reviewedBy ?? "").trim();
  if (!reviewedBy) return fail("reviewedBy wajib diisi", 400);
  const reviewComment = body.reviewComment ? String(body.reviewComment).trim() : null;

  const deliverable = await db.projectDeliverable.update({
    where: { id },
    data: {
      status: decision,
      reviewComment,
      reviewedBy,
      reviewedRole: body.reviewedRole ? String(body.reviewedRole).slice(0, 40) : null,
      reviewedAt: new Date(),
    },
  });

  await logAudit({
    actorName: reviewedBy,
    actorRole: body.reviewedRole ? String(body.reviewedRole) : null,
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
  const id = String(body.id ?? "").trim();
  if (!id) return fail("id deliverable wajib", 400);

  const existing = await db.projectDeliverable.findUnique({
    where: { id },
    include: { project: { select: { code: true, name: true } } },
  });
  if (!existing) return fail("Deliverable tidak ditemukan", 404);

  const actorName = body.actorName !== undefined && body.actorName !== null ? String(body.actorName).trim() : "";
  const actorRole = body.actorRole !== undefined && body.actorRole !== null ? String(body.actorRole).trim() : "";

  let allowed: boolean;
  let auditActor: string;
  let auditRole: string | null;
  if (!actorName && !actorRole) {
    // Pemanggil internal lama (api.deleteDeliverable tanpa info aktor) — izinkan, audit sebagai pembuat.
    allowed = true;
    auditActor = existing.createdBy ?? "System";
    auditRole = "system";
  } else {
    allowed = REVIEW_ROLES.includes(actorRole) || (actorName !== "" && actorName === existing.createdBy);
    auditActor = actorName || "System";
    auditRole = actorRole || null;
  }
  if (!allowed) return fail("Hanya pembuat atau manajemen yang boleh menghapus", 403);

  await db.projectDeliverable.delete({ where: { id } });

  await logAudit({
    actorName: auditActor,
    actorRole: auditRole,
    action: "delete",
    entity: "deliverable",
    entityId: id,
    entityLabel: `${existing.project.code} · ${existing.name}`,
    oldValue: JSON.stringify({ name: existing.name, kind: existing.kind, status: existing.status }),
    req,
  });

  return ok({ ok: true });
}
