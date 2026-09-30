import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES } from "../../../_shared";

/**
 * Task 2-d — Work Engine: publish versi workflow (aturan #1).
 * POST /api/erp/work/versions/[id]/publish (manager+).
 * - Hanya draft yang bisa dipublish (archived ditolak; published → 200 retry aman).
 * - Versi lama yang published di template yang sama → OTOMATIS archived
 *   (satu published per template) — dalam SATU transaksi.
 * - Versi tanpa tahapan ditolak.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const version = await db.workflowVersion.findUnique({
    where: { id },
    include: { _count: { select: { steps: true } } },
  });
  if (!version) return fail("Versi workflow tidak ditemukan", 404);

  // Retry aman: sudah published → kembalikan apa adanya (idempoten).
  if (version.status === "published") {
    return ok({ version, alreadyPublished: true });
  }
  if (version.status === "archived") {
    return fail("Versi sudah diarsipkan dan tidak bisa dipublish", 400);
  }
  if (version._count.steps === 0) {
    return fail("Versi belum punya tahapan (steps) — lengkapi dulu sebelum publish", 400);
  }

  const published = await db.$transaction(async (tx) => {
    // Satu published per template: arsipkan published lama (bukan versi ini).
    await tx.workflowVersion.updateMany({
      where: { templateId: version.templateId, status: "published", NOT: { id: version.id } },
      data: { status: "archived" },
    });
    return tx.workflowVersion.update({
      where: { id: version.id },
      data: { status: "published", publishedAt: new Date() },
      include: { steps: { orderBy: { position: "asc" } } },
    });
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "publish",
    entity: "workflow_version",
    entityId: version.id,
    entityLabel: `Template ${version.templateId} — v${version.version} published`,
    field: "status",
    oldValue: "draft",
    newValue: "published",
    req,
  });
  return ok({ version: published });
}
