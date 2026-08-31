import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Task 22-4 — Deliverable project: daftar + kirim tautan/file untuk ditinjau.
 * GET  /api/projects/:id/deliverables → { deliverables } (terbaru dulu)
 * POST /api/projects/:id/deliverables → kirim deliverable baru (kind: link | file)
 *   - link: url wajib diawali http:// atau https://
 *   - file: fileName + fileData (base64 data URL) wajib, sizeBytes ≤ 1.2MB
 *   - status awal "pending" — menunggu review klien/manajemen.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) return fail("Project tidak ditemukan", 404);

  const deliverables = await db.projectDeliverable.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
  });
  return ok({ deliverables });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const project = await db.project.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
  if (!project) return fail("Project tidak ditemukan", 404);

  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama deliverable wajib diisi", 400);

  const kind = String(body.kind ?? "").trim();
  if (kind !== "link" && kind !== "file") return fail("Jenis deliverable harus 'link' atau 'file'", 400);

  let url: string | null = null;
  let fileName: string | null = null;
  let fileData: string | null = null;
  let mimeType: string | null = null;
  let sizeBytes: number | null = null;

  if (kind === "link") {
    url = String(body.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return fail("URL tautan wajib diawali http(s)://", 400);
  } else {
    fileName = String(body.fileName ?? "").trim();
    fileData = body.fileData ? String(body.fileData) : "";
    if (!fileName || !fileData) return fail("File wajib dilampirkan (nama + isi file)", 400);
    // FIX r26: ukuran DIHITUNG dari payload nyata (base64), bukan percaya body.sizeBytes
    // yang bisa dipalsukan klien — dulu sizeBytes kecil + fileData 10MB lolos filter.
    const base64 = fileData.includes(",") ? fileData.slice(fileData.indexOf(",") + 1) : fileData;
    sizeBytes = Math.floor((base64.length * 3) / 4);
    if (sizeBytes > 1_200_000) return fail("Ukuran file maksimal 1.2MB", 400);
    // Validasi data URL: wajib prefix data:<mime>;base64 bila dikirim sbg data URL
    if (fileData.startsWith("data:") && !/^data:[\w.+-]+\/[\w.+-]+;base64,/.test(fileData)) {
      return fail("Format file (data URL) tidak valid", 400);
    }
    mimeType = body.mimeType ? String(body.mimeType) : null;
  }

  const note = body.note ? String(body.note).trim() : null;
  const createdBy = actor.name;

  const deliverable = await db.projectDeliverable.create({
    data: {
      projectId: id,
      name,
      kind,
      url,
      fileName,
      fileData,
      mimeType,
      sizeBytes,
      note,
      status: "pending",
      createdBy,
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "deliverable",
    entityId: deliverable.id,
    entityLabel: `${project.code} · ${name}`,
    newValue: JSON.stringify({ kind, status: "pending", ...(kind === "link" ? { url } : { fileName, sizeBytes }) }),
    req,
  });

  return ok({ deliverable }, 201);
}
