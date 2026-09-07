import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";
import { sendPushToRoles } from "@/lib/crm/push";

/**
 * Task 23-d — POST /api/portal/[token]/review (PUBLIK — tanpa login, kunci = token URL).
 * Klien mengirim keputusan review deliverable dari secure link:
 * body { deliverableId, decision: "approved"|"revision", comment?, reviewerName }.
 * Guard: token valid/aktif/tidak kedaluwarsa (404/403), deliverable ada (404),
 * deliverable harus milik company yang sama dgn tautan (403).
 * Ronde 25: schema kini punya kolom reviewedRole (diisi "client" untuk review dari secure link) —
 * peran "client" dicatat di AuditLog.actorRole.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await readBody(req);

  const deliverableId = String(body.deliverableId ?? "").trim();
  if (!deliverableId) return fail("deliverableId wajib diisi", 400);

  const decision = String(body.decision ?? "").trim();
  if (decision !== "approved" && decision !== "revision") {
    return fail("Keputusan review harus 'approved' atau 'revision'", 400);
  }

  const reviewerName = String(body.reviewerName ?? "").trim();
  if (!reviewerName) return fail("Nama reviewer wajib diisi", 400);

  const portal = await db.clientPortalToken.findUnique({ where: { token } });
  if (!portal) return fail("Tautan tidak valid atau sudah dihapus", 404);
  if (!portal.active) return fail("Tautan sudah dicabut — hubungi tim kami", 403);
  if (portal.expiresAt && portal.expiresAt.getTime() < Date.now()) {
    return fail("Tautan sudah kedaluwarsa", 403);
  }

  const existing = await db.projectDeliverable.findUnique({
    where: { id: deliverableId },
    include: { project: { select: { code: true, name: true, companyId: true } } },
  });
  if (!existing) return fail("Deliverable tidak ditemukan", 404);
  if (existing.project.companyId !== portal.companyId) {
    return fail("Item ini di luar cakupan tautan Anda", 403);
  }

  const comment = body.comment !== undefined && body.comment !== null ? String(body.comment).trim() : "";

  const deliverable = await db.projectDeliverable.update({
    where: { id: deliverableId },
    data: {
      status: decision,
      reviewComment: comment || null,
      reviewedBy: reviewerName,
      reviewedRole: "client",
      reviewedAt: new Date(),
    },
    include: { project: { select: { code: true, name: true } } },
  });

  await logAudit({
    actorName: reviewerName,
    actorRole: "client",
    action: "review",
    entity: "deliverable",
    entityId: deliverable.id,
    entityLabel: `${existing.project.code} · ${existing.name}`,
    oldValue: JSON.stringify({ status: existing.status }),
    newValue: JSON.stringify({ status: decision, reviewComment: comment || null, label: portal.label }),
    req,
  });

  // Ronde 39 — push VAPID: tim produksi & direktur tahu keputusan review klien
  // (revision = permintaan revisi dari klien — dulu tidak ada pemberitahuan sama sekali)
  void sendPushToRoles(
    ["production", "director", "super_admin"],
    {
      title: decision === "revision" ? "Permintaan revisi dari klien" : "Deliverable disetujui klien",
      body: `${existing.project.code} · ${existing.name}${comment ? ` — "${comment}"` : ""}`,
      url: "/?modul=projects",
      tag: `dlv-${deliverable.id}`,
      type: "portal",
    }
  ).catch(() => {});

  // Bentuk respons sama dgn kontrak: { deliverable: ProjectDeliverableDTO } (Date → string saat diserialisasi JSON).
  return ok({ deliverable });
}
