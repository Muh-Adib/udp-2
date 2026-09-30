import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, PUBLISH_ROLES, APPROVE_INTERNAL_ROLES } from "../../../../_shared";

/**
 * Task 2-d — Work Engine: aksi versi deliverable (aturan #4 — inti blueprint test #4).
 * PATCH /api/erp/work/deliverables/[id]/versions/[vid] { action, feedback?, clientName? }
 *
 * - submit_internal   : draft → internal_review (write: production/marketing/manager+).
 * - approve_internal  : internal_review → client_review (manager/director/super_admin/production);
 *                       reviewedBy = nama aktor.
 * - request_revision  : internal_review|client_review → revision; feedback WAJIB;
 *                       bila dari client_review → clientReviewedBy = clientName (wajib).
 * - approve_client    : client_review → approved + clientReviewedBy = clientName (wajib);
 *                       dicatat staf internal atas nama klien.
 * - publish           : approved → published + publishedAt (production/manager/director/super_admin);
 *                       VALIDASI KETAT hanya dari "approved" (draft/revision TIDAK bisa → 400);
 *                       IDEMPOTEN: sudah published → 200 (retry aman, tidak publish ganda);
 *                       versi lain sudah published → 409 "Sudah ada versi published".
 * Sinkron induk saat publish sukses: ProjectDeliverable.status="approved",
 * url = version.url ?? induk.url, reviewComment = null.
 */

const REVIEW_STATUSES = ["internal_review", "client_review"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;

  const version = await db.deliverableVersion.findUnique({ where: { id: vid } });
  if (!version || version.deliverableId !== id) return fail("Versi deliverable tidak ditemukan", 404);
  const deliverable = await db.projectDeliverable.findUnique({ where: { id } });
  if (!deliverable) return fail("Deliverable tidak ditemukan", 404);

  const action = String(body.action ?? "").trim();
  const feedback = body.feedback ? String(body.feedback).trim().slice(0, 2000) : null;
  const clientName = body.clientName ? String(body.clientName).trim().slice(0, 120) : null;
  const audit = (act: string, extra: Record<string, unknown> = {}) =>
    logAudit({
      actorName: actor.name, actorRole: actor.role, action: act,
      entity: "deliverable_version", entityId: version.id,
      entityLabel: `${deliverable.name} — v${version.version}`, req, ...extra,
    });

  switch (action) {
    case "submit_internal": {
      if (version.status !== "draft") {
        return fail(`Aksi submit internal hanya untuk versi draft (status sekarang: ${labelStatus(version.status)})`, 400);
      }
      const updated = await db.deliverableVersion.update({
        where: { id: version.id },
        data: { status: "internal_review" },
      });
      await audit("submit_internal", { field: "status", oldValue: "draft", newValue: "internal_review" });
      return ok({ version: updated });
    }

    case "approve_internal": {
      const roleGate = requireRole(actor, APPROVE_INTERNAL_ROLES);
      if (roleGate) return roleGate;
      if (version.status !== "internal_review") {
        return fail(`Aksi setujui internal hanya untuk versi dalam review internal (status sekarang: ${labelStatus(version.status)})`, 400);
      }
      const updated = await db.deliverableVersion.update({
        where: { id: version.id },
        data: { status: "client_review", reviewedBy: actor.name },
      });
      await audit("approve_internal", { field: "status", oldValue: "internal_review", newValue: "client_review" });
      return ok({ version: updated });
    }

    case "request_revision": {
      if (!(REVIEW_STATUSES as readonly string[]).includes(version.status)) {
        return fail(`Minta revisi hanya untuk versi yang sedang review internal/klien (status sekarang: ${labelStatus(version.status)})`, 400);
      }
      if (!feedback) return fail("Feedback wajib diisi saat meminta revisi", 400);
      const fromClient = version.status === "client_review";
      if (fromClient && !clientName) {
        return fail("Nama reviewer klien (clientName) wajib diisi untuk revisi dari review klien", 400);
      }
      const updated = await db.deliverableVersion.update({
        where: { id: version.id },
        data: {
          status: "revision",
          feedback,
          ...(fromClient ? { clientReviewedBy: clientName } : {}),
        },
      });
      await audit("request_revision", {
        field: "status", oldValue: version.status, newValue: "revision",
        metadata: feedback,
      });
      return ok({ version: updated });
    }

    case "approve_client": {
      if (version.status !== "client_review") {
        return fail(`Aksi setujui klien hanya untuk versi dalam review klien (status sekarang: ${labelStatus(version.status)})`, 400);
      }
      if (!clientName) return fail("Nama klien (clientName) wajib diisi — persetujuan dicatat atas nama klien", 400);
      const updated = await db.deliverableVersion.update({
        where: { id: version.id },
        data: { status: "approved", clientReviewedBy: clientName },
      });
      await audit("approve_client", {
        field: "status", oldValue: "client_review", newValue: "approved",
        metadata: `Disetujui klien atas nama: ${clientName}`,
      });
      return ok({ version: updated });
    }

    case "publish": {
      const roleGate = requireRole(actor, PUBLISH_ROLES);
      if (roleGate) return roleGate;

      // IDEMPOTEN: retry publish saat sudah published → 200 tanpa efek samping
      // (scheduler/retry tidak akan publish ganda).
      if (version.status === "published") {
        return ok({ version, alreadyPublished: true });
      }
      // VALIDASI KETAT: hanya dari "approved".
      if (version.status !== "approved") {
        return fail("Hanya versi approved yang boleh dipublish", 400);
      }
      // Satu published per deliverable.
      const other = await db.deliverableVersion.findFirst({
        where: { deliverableId: id, status: "published", NOT: { id: version.id } },
      });
      if (other) {
        return fail(`Sudah ada versi published (v${other.version}) untuk deliverable ini`, 409);
      }

      const now = new Date();
      const result = await db.$transaction(async (tx) => {
        const updated = await tx.deliverableVersion.update({
          where: { id: version.id },
          data: { status: "published", publishedAt: now },
        });
        // Sinkron induk: deliverable dianggap final sesuai versi yang dipublish.
        await tx.projectDeliverable.update({
          where: { id },
          data: {
            status: "approved",
            url: updated.url ?? deliverable.url,
            reviewComment: null,
            reviewedBy: actor.name,
            reviewedRole: actor.role ?? "publish",
            reviewedAt: now,
          },
        });
        return updated;
      });

      await audit("publish", { field: "status", oldValue: "approved", newValue: "published" });
      return ok({ version: result });
    }

    default:
      return fail("Aksi tidak dikenal (submit_internal/approve_internal/request_revision/approve_client/publish)", 400);
  }
}

function labelStatus(status: string): string {
  switch (status) {
    case "draft": return "draft";
    case "internal_review": return "review internal";
    case "client_review": return "review klien";
    case "approved": return "approved";
    case "published": return "published";
    case "revision": return "revisi";
    default: return status;
  }
}
