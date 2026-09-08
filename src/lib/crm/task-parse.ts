import { unsafeAttachmentReason } from "@/lib/crm/server";

/**
 * Ronde 40 — parsing & validasi field task multi-assignee + lampiran.
 * Input bisa berupa array mentah (dari body JSON) atau JSON string (kolom DB).
 * Pelanggaran validasi melempar Error berbahasa Indonesia — caller route
 * menangkapnya dan membalas fail(e.message, 400).
 */

export type TaskAttachmentValue = {
  type: "link" | "file";
  name: string;
  url: string;
  size?: number;
};

const MAX_ASSIGNEES = 10;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB (ukuran decoded)

/** Ambil daftar mentah dari array atau JSON string (selain itu → kosong). */
function rawList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // bukan JSON valid → diperlakukan kosong
    }
  }
  return [];
}

/** Nama assignee: array / JSON string → trim, dedupe, buang kosong, maks 10. */
export function parseTaskAssignees(raw: unknown): string[] {
  const out: string[] = [];
  for (const item of rawList(raw)) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_ASSIGNEES) break;
  }
  return out;
}

/**
 * Lampiran task: tautan (http/https) atau file kecil (data URL ≤ 5 MB decoded).
 * Maksimal 5 lampiran; MIME/ekstensi berbahaya ditolak via unsafeAttachmentReason.
 */
export function parseTaskAttachments(raw: unknown): TaskAttachmentValue[] {
  const list = rawList(raw);
  if (list.length > MAX_ATTACHMENTS) {
    throw new Error(`Maksimal ${MAX_ATTACHMENTS} lampiran per task`);
  }
  const out: TaskAttachmentValue[] = [];
  for (const item of list) {
    const a = (item ?? {}) as Record<string, unknown>;
    const name = String(a.name ?? "").trim();
    const url = String(a.url ?? "").trim();
    if (!name) throw new Error("Nama lampiran wajib diisi");
    if (!url) throw new Error(`URL lampiran "${name}" wajib diisi`);

    if (a.type === "link") {
      if (!/^https?:\/\//i.test(url)) {
        throw new Error(`Lampiran tautan "${name}" harus diawali http:// atau https://`);
      }
      out.push({ type: "link", name, url });
      continue;
    }

    if (a.type === "file") {
      if (!url.startsWith("data:")) {
        throw new Error(`Lampiran file "${name}" harus berupa data URL`);
      }
      const reason = unsafeAttachmentReason(name, url);
      if (reason) throw new Error(`Lampiran "${name}" ditolak: ${reason}`);
      // Ukuran decoded dari bagian base64 (setelah koma pertama)
      const size = Buffer.from(url.split(",")[1] ?? "", "base64").length;
      if (size > MAX_FILE_BYTES) {
        throw new Error(`Lampiran file "${name}" melebihi batas 5 MB`);
      }
      out.push({ type: "file", name, url, size });
      continue;
    }

    throw new Error(`Tipe lampiran "${name}" harus "link" atau "file"`);
  }
  return out;
}
