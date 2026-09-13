import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { syncInboundEmails } from "@/lib/crm/email-sync";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Ronde 21 — Tarik email MASUK via IMAP → interaction inbound (lead inbox).
 *
 * POST /api/channels/email-sync
 *  - butuh kanal email terhubung & non-demo dgn Host IMAP terisi
 *  - sejak: lastEmailSyncAt koneksi (default: 3 hari terakhir)
 *  - dedupe: externalId = Message-ID
 *  - setelah sukses: lastEmailSyncAt = sekarang
 *
 * Ronde 53 — logika inti pindah ke lib/crm/email-sync.ts agar alur yang sama
 * bisa dijalankan OTOMATIS saat modul Inbox dibuka (throttle 90 detik) — dulu
 * sinkron hanya bisa manual sehingga email masuk nyata tak pernah muncul.
 */

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : String(v ?? "");
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  // Ronde 27: identitas aktor diambil dari sesi (cookie).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  // Pre-check dengan pesan presisi per kondisi (aturan lama dipertahankan).
  const config = await db.channelConfig.findFirst({
    where: { channel: "email", status: "connected" },
    orderBy: { updatedAt: "desc" },
  });
  if (!config) return fail("Kanal email belum terhubung — sambungkan lewat wizard Saluran & Integrasi", 400);
  if (config.isDemo) return fail("Koneksi demo tidak punya mailbox nyata — sambungkan email asli (non-demo) untuk sinkron IMAP", 400);
  const creds = parseJsonObject(config.credentials);
  if (!(creds.imapHost ?? "").trim()) {
    return fail("Koneksi email belum mengisi Host IMAP — tekan Edit lalu isi Host/Port IMAP untuk menerima email masuk", 422);
  }

  const result = await syncInboundEmails({ actorName: actor.name, req, throttleMs: null, auditMode: "manual" });
  if (result.error) return fail(result.error, 502);

  return ok({
    created: result.created,
    skipped: result.skipped,
    scanned: result.scanned,
    since: result.since ?? new Date().toISOString(),
  });
}
