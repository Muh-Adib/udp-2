import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Task 23-c — Hapus dokumen/MoU/catatan rapat dari secure link klien.
 * DELETE /api/portal/documents/:id → audit "delete" lalu hapus → { ok: true }.
 */

const KIND_LABEL: Record<string, string> = {
  mou: "MoU",
  meeting_note: "Catatan rapat",
  document: "Dokumen",
};

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const existing = await db.clientDocument.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!existing) return fail("Dokumen tidak ditemukan", 404);

  await db.clientDocument.delete({ where: { id } });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "delete",
    entity: "client_document",
    entityId: id,
    entityLabel: existing.title,
    oldValue: `${KIND_LABEL[existing.kind] ?? existing.kind} dihapus (${existing.company?.name ?? existing.companyId})`,
    req,
  });

  return ok({ ok: true });
}
