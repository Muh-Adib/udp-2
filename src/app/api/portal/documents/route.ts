import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody, unsafeAttachmentReason } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Task 23-c — Dokumen / MoU / catatan rapat pada secure link klien.
 * GET  /api/portal/documents?companyId= → daftar per perusahaan (createdAt desc).
 *      fileData SERTAKAN — dipakai portal publik (secure link) utk unduh langsung.
 * POST /api/portal/documents → { companyId, kind: mou|meeting_note|document, title,
 *      content?, url?, fileName?, fileData?(base64 dataURL ≤1.2MB), mimeType?,
 *      sizeBytes?, meetingAt?, attendees?, actorName? } → 201 { document }.
 */

const KINDS = ["mou", "meeting_note", "document"] as const;
const MAX_FILE_BYTES = 1.2 * 1024 * 1024; // 1.2 MB — file kecil via base64, besar via tautan

const KIND_LABEL: Record<string, string> = {
  mou: "MoU",
  meeting_note: "Catatan rapat",
  document: "Dokumen",
};

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId")?.trim() ?? "";
  if (!companyId) return fail("companyId wajib diisi (query param)", 400);

  const documents = await db.clientDocument.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
  return ok({ documents });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  // 1) Perusahaan harus ada
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId) return fail("companyId wajib diisi", 400);
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  if (!company) return fail("Perusahaan tidak ditemukan", 404);

  // 2) Kind valid
  const kind = String(body.kind ?? "").trim();
  if (!(KINDS as readonly string[]).includes(kind)) {
    return fail("Jenis dokumen harus mou, meeting_note, atau document", 400);
  }

  // 3) Judul wajib
  const title = String(body.title ?? "").trim();
  if (!title) return fail("Judul wajib diisi", 400);

  // 4) URL (bila diisi) harus http(s)
  const url = body.url !== undefined && body.url !== null ? String(body.url).trim() : "";
  if (url && !/^https?:\/\//i.test(url)) {
    return fail("URL harus diawali http:// atau https://", 400);
  }

  // 5) File (bila diisi) maksimal 1.2 MB
  // FIX r26: ukuran SELALU dihitung dari payload base64 nyata — body.sizeBytes dari
  // klien tidak dipercaya lagi (dulu sizeBytes:100 + fileData 10MB lolos).
  const fileData = body.fileData !== undefined && body.fileData !== null ? String(body.fileData).trim() : "";
  let sizeBytes: number | null = null;
  if (fileData) {
    const base64 = fileData.includes(",") ? fileData.slice(fileData.indexOf(",") + 1) : fileData;
    sizeBytes = Math.floor((base64.length * 3) / 4);
    if (sizeBytes > MAX_FILE_BYTES) {
      return fail("Ukuran file melebihi batas 1.2 MB — gunakan tautan (mis. Google Drive) untuk file besar", 400);
    }
    if (fileData.startsWith("data:") && !/^data:[\w.+-]+\/[\w.+-]+;base64,/.test(fileData)) {
      return fail("Format file (data URL) tidak valid", 400);
    }
    // Ronde 36 (audit): tolak file berbahaya (html/svg/js/exe…) dgn pesan jelas.
    const unsafe = unsafeAttachmentReason(String(body.fileName ?? "").trim() || title, fileData);
    if (unsafe) return fail(`File ditolak — ${unsafe}`, 400);
  }

  // 6) Tanggal rapat (bila diisi) harus tanggal valid
  let meetingAt: Date | null = null;
  const meetingRaw = body.meetingAt !== undefined && body.meetingAt !== null ? String(body.meetingAt).trim() : "";
  if (meetingRaw) {
    const d = new Date(meetingRaw);
    if (Number.isNaN(d.getTime())) return fail("Tanggal rapat tidak valid", 400);
    meetingAt = d;
  }

  const content = body.content !== undefined && body.content !== null ? String(body.content).trim() : "";
  const fileName = body.fileName !== undefined && body.fileName !== null ? String(body.fileName).trim() : "";
  const mimeType = body.mimeType !== undefined && body.mimeType !== null ? String(body.mimeType).trim() : "";
  const attendees = body.attendees !== undefined && body.attendees !== null ? String(body.attendees).trim() : "";

  const created = await db.clientDocument.create({
    data: {
      companyId,
      kind,
      title,
      content: content || null,
      url: url || null,
      fileName: fileName || null,
      fileData: fileData || null,
      mimeType: mimeType || null,
      sizeBytes,
      meetingAt,
      attendees: attendees || null,
      createdByName: actor.name,
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "client_document",
    entityId: created.id,
    entityLabel: title,
    newValue: `${KIND_LABEL[kind] ?? kind} ditambahkan untuk ${company.name}`,
    req,
  });

  return ok({ document: created }, 201);
}
