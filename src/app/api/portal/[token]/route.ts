import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/crm/server";
import type { ClientDocumentDTO, PortalTokenPayload, ProjectDeliverableDTO } from "@/lib/crm/types";

/**
 * Task 23-d — GET /api/portal/[token] (PUBLIK — tanpa login, kunci = token URL).
 * Mengembalikan isi secure link klien sesuai kontrak PortalTokenPayload:
 * company (id/name/industry/city), token (label/createdAt), documents (termasuk
 * fileData utk unduh), projects + deliverables.
 * Payload PUBLIK — field internal (telepon, notes, tags, dsb.) TIDAK ikut.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const portal = await db.clientPortalToken.findUnique({
    where: { token },
    include: { company: true },
  });
  if (!portal) return fail("Tautan tidak valid atau sudah dihapus", 404);
  if (!portal.active) return fail("Tautan sudah dicabut — hubungi tim kami", 403);
  if (portal.expiresAt && portal.expiresAt.getTime() < Date.now()) {
    return fail("Tautan sudah kedaluwarsa", 403);
  }

  const [documents, projects] = await Promise.all([
    db.clientDocument.findMany({
      where: { companyId: portal.companyId },
      orderBy: { createdAt: "desc" },
    }),
    db.project.findMany({
      where: { companyId: portal.companyId },
      include: {
        deliverables: { orderBy: { createdAt: "desc" } },
        brand: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Catat akses (accessCount + lastAccessedAt) — untuk pantauan staf.
  await db.clientPortalToken.update({
    where: { id: portal.id },
    data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
  });

  const payload: PortalTokenPayload = {
    company: {
      id: portal.company.id,
      name: portal.company.name,
      industry: portal.company.industry,
      city: portal.company.city,
    },
    token: { label: portal.label, createdAt: portal.createdAt.toISOString() },
    documents: documents.map(
      (d): ClientDocumentDTO => ({
        id: d.id,
        companyId: d.companyId,
        kind: d.kind,
        title: d.title,
        content: d.content,
        url: d.url,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        meetingAt: d.meetingAt ? d.meetingAt.toISOString() : null,
        attendees: d.attendees,
        createdByName: d.createdByName,
        createdAt: d.createdAt.toISOString(),
        fileData: d.fileData,
      })
    ),
    projects: projects.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      progress: p.progress,
      dueDate: p.dueDate ? p.dueDate.toISOString() : null,
      brandName: p.brand?.name ?? null,
      deliverables: p.deliverables.map(
        (d): ProjectDeliverableDTO => ({
          id: d.id,
          projectId: d.projectId,
          name: d.name,
          kind: d.kind === "file" ? "file" : "link",
          url: d.url,
          fileName: d.fileName,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          note: d.note,
          status: d.status === "approved" ? "approved" : d.status === "revision" ? "revision" : "pending",
          reviewComment: d.reviewComment,
          reviewedBy: d.reviewedBy,
          reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
          createdBy: d.createdBy,
          createdAt: d.createdAt.toISOString(),
        })
      ),
    })),
  };

  return ok(payload);
}
