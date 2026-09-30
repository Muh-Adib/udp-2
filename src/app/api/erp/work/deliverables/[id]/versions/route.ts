import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork } from "../../../_shared";

/**
 * Task 2-d — Work Engine: buat versi baru deliverable (inti blueprint test #4).
 * POST /api/erp/work/deliverables/[id]/versions { content?, url? } (write: production/marketing/manager+).
 * - Versi baru = maxVersion + 1, status "draft".
 * - HANYA bila tidak ada versi yang sedang review (internal_review/client_review)
 *   — satu review aktif per deliverable → else 409.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;

  const deliverable = await db.projectDeliverable.findUnique({ where: { id } });
  if (!deliverable) return fail("Deliverable tidak ditemukan", 404);

  // Satu review aktif per deliverable — jangan biarkan dua draft review paralel.
  const activeReview = await db.deliverableVersion.findFirst({
    where: { deliverableId: id, status: { in: ["internal_review", "client_review"] } },
    orderBy: { version: "desc" },
  });
  if (activeReview) {
    return fail(
      `Masih ada versi dalam review: v${activeReview.version} (${activeReview.status === "internal_review" ? "review internal" : "review klien"}). Selesaikan review itu sebelum membuat versi baru.`,
      409,
    );
  }

  const max = await db.deliverableVersion.aggregate({ where: { deliverableId: id }, _max: { version: true } });
  const nextVersion = (max._max.version ?? 0) + 1;

  const version = await db.deliverableVersion.create({
    data: {
      deliverableId: id,
      version: nextVersion,
      content: body.content ? String(body.content).trim().slice(0, 5000) : null,
      url: body.url ? String(body.url).trim().slice(0, 500) : null,
      status: "draft",
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "deliverable_version",
    entityId: version.id,
    entityLabel: `${deliverable.name} — draft v${nextVersion}`,
    newValue: String(nextVersion),
    req,
  });
  return ok({ version }, 201);
}
