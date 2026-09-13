/**
 * Ronde 53 — sinkronisasi email masuk (IMAP) yang otomatis & terlihat:
 * - inti logika dipindah dari POST /api/channels/email-sync ke sini agar bisa
 *   dipicu otomatis saat modul Inbox dibuka (sweep=1) — dulu sync HANYA manual,
 *   sehingga email masuk nyata tidak pernah muncul di CRM (lastEmailSyncAt null).
 * - throttle berbasis lastEmailSyncAt (default 90 detik) agar IMAP tidak dipukul
 *   setiap kali Inbox di-refresh.
 * - nama lampiran kini diekstrak dari bodyStructure dan ditulis ke konten
 *   "[Lampiran: file.xlsx, ...]" — dulu email berlampiran tampil generik.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logAudit, unsafeAttachmentReason } from "@/lib/crm/server";
import { friendlyVerifyError } from "@/lib/crm/channel-verify";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";

export interface EmailSyncResult {
  ran: boolean;
  throttled: boolean;
  created: number;
  skipped: number;
  scanned: number;
  linked: number;
  reason?: "no_channel" | "no_imap_host";
  error?: string;
  /** Batas sejak kapan mailbox dipindai (ISO) — dipakai pesan manual sync. */
  since?: string;
}

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

/** Cari part teks (plain dulu, lalu html apa pun) dari bodyStructure. */
function findTextPart(node: MessageStructureObject | null | undefined, type = "text/plain"): string | null {
  if (!node) return null;
  if (typeof node.type === "string" && node.type.toLowerCase().startsWith(type)) {
    return node.part || "1";
  }
  const childNodes = node.childNodes as MessageStructureObject[] | undefined;
  if (Array.isArray(childNodes)) {
    for (const child of childNodes) {
      const found = findTextPart(child, type);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Ronde 54 — metadata part lampiran dari bodyStructure (rekursif).
 * Attachment = disposition "attachment" ATAU punya filename/name.
 */
interface AttachmentPart {
  part: string;
  filename: string;
  mime: string;
  sizeHint: number | null;
}

function collectAttachmentParts(node: MessageStructureObject | null | undefined, out: AttachmentPart[] = []): AttachmentPart[] {
  if (!node) return out;
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
  const disp = typeof node.disposition === "string" ? node.disposition.toLowerCase() : "";
  const dispParams = node.dispositionParameters as { filename?: string } | undefined;
  const params = node.parameters as { name?: string } | undefined;
  const filename = (dispParams?.filename ?? params?.name ?? "").trim().slice(0, 200);
  if (!type.startsWith("multipart/") && (disp === "attachment" || filename)) {
    const sizeHint = typeof node.size === "number" && node.size > 0 ? node.size : null;
    out.push({ part: node.part || "1", filename: filename || "lampiran", mime: type || "application/octet-stream", sizeHint });
  }
  const childNodes = node.childNodes as MessageStructureObject[] | undefined;
  if (Array.isArray(childNodes)) {
    for (const child of childNodes) collectAttachmentParts(child, out);
  }
  return out;
}

/** Buang tag HTML kasar agar konten tampil rapi sebagai teks. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function syncInboundEmails(options: {
  actorName: string;
  req?: NextRequest;
  /** null = tanpa throttle (tombol manual). Default 30_000 ms saat auto — Ronde 54
   * menurunkan 90s → 30s agar email masuk tampil mendekati real-time tanpa refresh. */
  throttleMs?: number | null;
  /** manual = audit selalu; auto = audit hanya bila ada email baru / gagal. */
  auditMode?: "manual" | "auto";
}): Promise<EmailSyncResult> {
  const auditMode = options.auditMode ?? "manual";
  const throttleMs = options.throttleMs === undefined ? 30_000 : options.throttleMs;
  const idle: EmailSyncResult = { ran: false, throttled: false, created: 0, skipped: 0, scanned: 0, linked: 0 };

  // Ronde 53 — HANYA kanal email NON-DEMO yang disinkron (kanal demo tidak punya
  // mailbox nyata). Dulu findFirst ambil kanal terbaru apa pun isDemo-nya.
  const config = await db.channelConfig.findFirst({
    where: { channel: "email", status: "connected", isDemo: false },
    orderBy: { updatedAt: "desc" },
  });
  if (!config) return { ...idle, reason: "no_channel" };

  // Throttle: jangan pukul IMAP lebih sering dari throttleMs.
  if (throttleMs !== null && config.lastEmailSyncAt) {
    const elapsed = Date.now() - config.lastEmailSyncAt.getTime();
    if (elapsed < throttleMs) return { ...idle, throttled: true };
  }

  const creds = parseJsonObject(config.credentials);
  const host = (creds.imapHost ?? "").trim();
  if (!host) return { ...idle, reason: "no_imap_host" };
  const user = (creds.imapUser ?? creds.smtpUser ?? "").trim();
  const pass = (creds.imapPassword ?? creds.smtpPassword ?? "").trim();
  const port = Number(creds.imapPort) > 0 ? Number(creds.imapPort) : 993;

  const since = config.lastEmailSyncAt ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
  });

  let created = 0;
  let skipped = 0;
  let linked = 0;
  let scanned = 0;

  try {
    // Timeout keras agar UI tidak menggantung bila server IMAP tak merespons.
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP: timeout saat koneksi")), 12_000)),
    ]);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const range = { since };
      const messages: FetchMessageObject[] = [];
      for await (const msg of client.fetch(range, { uid: true, envelope: true, internalDate: true, bodyStructure: true })) {
        messages.push(msg);
      }

      for (const msg of messages) {
        scanned += 1;
        const messageId = msg.envelope?.messageId ?? `imap-${msg.uid}-${new Date(msg.internalDate ?? 0).getTime()}`;
        // Dedupe pakai bentuk TERSIMPAN (slice 250) — Message-ID panjang dulu
        // tidak pernah cocok → email re-sync duplikat setiap jalan.
        const storedMessageId = messageId.slice(0, 250);
        const existing = await db.interaction.findFirst({ where: { externalId: storedMessageId, channel: "email" }, select: { id: true } });
        if (existing) {
          skipped += 1;
          continue;
        }

        // Konten: text/plain bila ada, fallback text/html (dibersihkan).
        let text = "";
        const partPlain = findTextPart(msg.bodyStructure, "text/plain");
        const partAny = partPlain ?? findTextPart(msg.bodyStructure, "text/");
        if (partAny) {
          try {
            const dl = await client.download(String(msg.uid), partAny, { uid: true });
            if (dl?.content) {
              const chunks: Buffer[] = [];
              for await (const chunk of dl.content) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
              }
              const raw = Buffer.concat(chunks).toString("utf8");
              text = partPlain ? raw : htmlToText(raw);
            }
          } catch {
            text = "";
          }
        }
        if (!text.trim()) text = "(isi email berupa HTML/lampiran — lihat klien email untuk lengkapnya)";

        // Ronde 54 — lampiran email masuk DIUNDUH dan disimpan sebagai data URL
        // (bentuk sama dgn lampiran outbound) sehingga bisa diunduh langsung dari
        // thread Inbox. Keamanan: tipe berbahaya diblokir (html/svg/js/exe…),
        // batas 2 MB/file (sama dgn composer), maks 5 file per email.
        const parts = collectAttachmentParts(msg.bodyStructure).slice(0, 8);
        const stored: { name: string; url: string; size: number }[] = [];
        const blockedNotes: string[] = [];
        const MAX_FILE_BYTES = 2 * 1024 * 1024;
        for (const p of parts) {
          if (stored.length >= 5) {
            blockedNotes.push(`${p.filename} (melebihi kuota 5 lampiran)`);
            continue;
          }
          const dataUrlProbe = `data:${p.mime};base64,x`;
          const unsafe = unsafeAttachmentReason(p.filename, dataUrlProbe);
          if (unsafe) {
            blockedNotes.push(`${p.filename} (diblokir — ${unsafe})`);
            continue;
          }
          if (p.sizeHint !== null && p.sizeHint > MAX_FILE_BYTES) {
            blockedNotes.push(`${p.filename} (${Math.ceil(p.sizeHint / 1024)} KB — >2 MB, unduh dari klien email)`);
            continue;
          }
          try {
            const dl = await client.download(String(msg.uid), p.part, { uid: true });
            if (!dl?.content) {
              blockedNotes.push(`${p.filename} (gagal diunduh)`);
              continue;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of dl.content) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
            }
            const buf = Buffer.concat(chunks);
            if (buf.length === 0) {
              blockedNotes.push(`${p.filename} (gagal diunduh)`);
              continue;
            }
            if (buf.length > MAX_FILE_BYTES) {
              blockedNotes.push(`${p.filename} (${Math.ceil(buf.length / 1024)} KB — >2 MB, unduh dari klien email)`);
              continue;
            }
            stored.push({ name: p.filename, url: `data:${p.mime};base64,${buf.toString("base64")}`, size: buf.length });
          } catch {
            blockedNotes.push(`${p.filename} (gagal diunduh)`);
          }
        }
        // Catat daftar lampiran di konten: tersimpan (bisa diunduh) + yang diblokir.
        const allNames = [...stored.map((s) => s.name), ...parts.filter((p) => !stored.some((s) => s.name === p.filename) && !blockedNotes.some((b) => b.startsWith(p.filename))).map((p) => p.filename)];
        const uniqueNames = Array.from(new Set(allNames)).slice(0, 10);
        if (uniqueNames.length > 0) {
          text = `${text}\n\n[Lampiran: ${uniqueNames.join(", ")}]`;
        }
        if (blockedNotes.length > 0) {
          text = `${text}\n[Blokir lampiran: ${Array.from(new Set(blockedNotes)).slice(0, 5).join("; ")}]`;
        }

        const fromAddr = msg.envelope?.from?.[0];
        const sender = fromAddr ? (fromAddr.name ? `${fromAddr.name} <${fromAddr.address ?? ""}>` : fromAddr.address ?? "tidak diketahui") : "tidak diketahui";

        const row = await db.interaction.create({
          data: {
            channel: "email",
            direction: "inbound",
            brandId: config.brandId,
            externalId: storedMessageId,
            senderName: sender.slice(0, 250),
            recipientName: creds.smtpUser ?? config.accountRef,
            subject: msg.envelope?.subject ?? "(tanpa subjek)",
            content: text.slice(0, 8000),
            // Ronde 54 — lampiran tersimpan sbg data URL → bisa diunduh dari thread.
            attachments: stored.length > 0 ? JSON.stringify(stored) : null,
            deliveryStatus: null,
          },
        });

        // Auto-link balasan pelanggan aktif: bila pengirim sudah jadi contact dan
        // punya opportunity TERBUKA, pesan langsung tertaut (tidak jadi lead baru).
        try {
          const email = (fromAddr?.address ?? "").trim().toLowerCase();
          if (email && email.includes("@")) {
            const contact = await db.contact.findFirst({
              where: { email },
              select: { id: true, companyId: true },
            });
            if (contact) {
              const openOpp = await db.opportunity.findFirst({
                where: { contactId: contact.id, stage: { notIn: ["won", "lost"] } },
                orderBy: { updatedAt: "desc" },
                select: { id: true },
              });
              if (openOpp) {
                await db.interaction.update({
                  where: { id: row.id },
                  data: { contactId: contact.id, companyId: contact.companyId, opportunityId: openOpp.id },
                });
                linked += 1;
              }
            }
          }
        } catch {
          // auto-link gagal → pesan tetap jadi lead biasa (tidak fatal)
        }
        created += 1;
      }
    } finally {
      lock.release();
    }
    client.close();
  } catch (err) {
    try {
      client.close();
    } catch {
      /* abaikan */
    }
    const note = friendlyVerifyError(err, "imap");
    await logAudit({
      actorName: options.actorName,
      action: "email_sync",
      entity: "channel",
      entityId: config.id,
      entityLabel: `sinkron IMAP ${config.displayName} gagal — ${note}`,
      newValue: { ok: false, note, auto: auditMode === "auto" },
      req: options.req,
    });
    return { ran: true, throttled: false, created: 0, skipped: 0, scanned: 0, linked: 0, error: note };
  }

  await db.channelConfig.update({ where: { id: config.id }, data: { lastEmailSyncAt: new Date() } });

  // Audit: manual selalu tercatat; auto hanya bila ada email baru (hindari spam audit).
  if (auditMode === "manual" || created > 0) {
    await logAudit({
      actorName: options.actorName,
      action: "email_sync",
      entity: "channel",
      entityId: config.id,
      entityLabel: `sinkron IMAP ${config.displayName} — ${created} email baru, ${skipped} duplikat`,
      newValue: { ok: true, created, skipped, scanned, linkedToOpportunity: linked, auto: auditMode === "auto" },
      req: options.req,
    });
  }

  return { ran: true, throttled: false, created, skipped, scanned, linked, since: since.toISOString() };
}
