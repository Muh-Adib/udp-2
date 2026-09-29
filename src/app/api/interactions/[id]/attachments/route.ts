import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/crm/session";
import { unsafeAttachmentReason } from "@/lib/crm/server";

/**
 * Ronde 55 — unduh lampiran pesan (inbound & outbound) secara AMAN.
 *
 * Dulu: UI memakai data-URL base64 yang dikirim utuh di setiap respons inbox —
 * payload membengkak DAN konten diekspos mentah ke browser.
 * Kini: bubble chat hanya membawa {name, size}; unduhan lewat endpoint ini:
 * - wajib login (cookie sesi);
 * - konten di-decode dari penyimpanan (kolom attachments Interaction);
 * - nama file dibersihkan (path traversal, karakter terlarang, panjang);
 * - ekstensi/MIME berbahaya diblokir lagi di sini (defense in depth — tipe
 *   berbahaya sudah diblokir saat upload/sync, dicek ulang saat unduh);
 * - Content-Type dipaksa application/octet-stream + Content-Disposition:
 *   attachment → browser TIDAK pernah me-render konten inline (XSS-safe);
 * - X-Content-Type-Options: nosniff, Cache-Control: private, no-store.
 */

/** Ekstensi yang tak boleh diunduh/buka via CRM (pelengkap blocklist MIME). */
const BLOCKED_EXT = new Set([
  "exe", "dll", "bat", "cmd", "com", "scr", "msi", "jar", "vbs", "ps1", "sh",
  "js", "mjs", "cjs", "html", "htm", "xhtml", "xht", "svg", "htaccess", "php", "jsp", "aspx",
]);

function sanitizeFilename(raw: string): string {
  // Buang path (../, C:\, dsb.), karakter kontrol & terlarang, batasi panjang.
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned.length > 0 ? cleaned : "lampiran";
  return safe.slice(0, 150);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req);
  if (!user) {
    return Response.json({ error: "Harus login untuk mengunduh lampiran" }, { status: 401 });
  }

  const { id } = await params;
  const idxRaw = req.nextUrl.searchParams.get("index");
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0 || idx > 20) {
    return Response.json({ error: "Index lampiran tidak valid" }, { status: 400 });
  }

  const row = await db.interaction.findUnique({
    where: { id },
    select: { attachments: true },
  });
  if (!row) {
    return Response.json({ error: "Pesan tidak ditemukan" }, { status: 404 });
  }

  let list: Array<{ name?: unknown; url?: unknown }> = [];
  try {
    const parsed: unknown = JSON.parse(row.attachments ?? "null");
    if (Array.isArray(parsed)) list = parsed as Array<{ name?: unknown; url?: unknown }>;
  } catch {
    return Response.json({ error: "Data lampiran rusak" }, { status: 500 });
  }

  const att = list[idx];
  if (!att || typeof att.url !== "string" || !att.url.startsWith("data:")) {
    return Response.json({ error: "Lampiran tidak tersedia untuk pesan ini" }, { status: 404 });
  }

  const comma = att.url.indexOf(",");
  const meta = comma > 5 ? att.url.slice(5, comma) : "";
  if (!/(^|;)base64$/i.test(meta)) {
    return Response.json({ error: "Format lampiran tidak didukung" }, { status: 415 });
  }
  const mime = (meta.replace(/;base64$/i, "") || "application/octet-stream").toLowerCase();

  const name = sanitizeFilename(typeof att.name === "string" && att.name.trim() ? att.name : "lampiran");
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const probe = `data:${mime};base64,x`;
  const unsafe = unsafeAttachmentReason(name, probe);
  if (unsafe || (ext && BLOCKED_EXT.has(ext))) {
    return Response.json(
      { error: `Lampiran diblokir oleh keamanan (${unsafe ?? `.${ext}`})` },
      { status: 403 },
    );
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(att.url.slice(comma + 1), "base64");
  } catch {
    return Response.json({ error: "Isi lampiran tidak dapat dibaca" }, { status: 500 });
  }
  if (buf.length === 0) {
    return Response.json({ error: "Lampiran kosong" }, { status: 404 });
  }

  const asciiFallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(buf), {
    headers: {
      // octet-stream: browser tidak menebak/meng-eksekusi tipe konten
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buf.length),
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
