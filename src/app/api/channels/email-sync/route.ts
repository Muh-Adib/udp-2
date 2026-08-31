import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, logAudit } from "@/lib/crm/server";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject, type MailboxLockObject } from "imapflow";
import { friendlyVerifyError } from "@/lib/crm/channel-verify";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Ronde 21 — Tarik email MASUK via IMAP → interaction inbound (lead inbox).
 *
 * POST /api/channels/email-sync
 *  - butuh kanal email terhubung & non-demo dgn Host IMAP terisi
 *  - sejak: lastEmailSyncAt koneksi (default: 3 hari terakhir)
 *  - dedupe: externalId = Message-ID
 *  - setelah sukses: lastEmailSyncAt = sekarang
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

export async function POST(req: NextRequest) {
  // Ronde 27: identitas aktor diambil dari sesi (cookie).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const config = await db.channelConfig.findFirst({
    where: { channel: "email", status: "connected" },
    orderBy: { updatedAt: "desc" },
  });
  if (!config) return fail("Kanal email belum terhubung — sambungkan lewat wizard Saluran & Integrasi", 400);
  if (config.isDemo) return fail("Koneksi demo tidak punya mailbox nyata — sambungkan email asli (non-demo) untuk sinkron IMAP", 400);

  const creds = parseJsonObject(config.credentials);
  const host = (creds.imapHost ?? "").trim();
  if (!host) {
    return fail("Koneksi email belum mengisi Host IMAP — tekan Edit lalu isi Host/Port IMAP untuk menerima email masuk", 422);
  }
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
  let scanned = 0;

  try {
    // Timeout keras agar UI tidak menggantung bila server IMAP tak merespons.
    await Promise.race([
      client.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP: timeout saat koneksi")), 12_000)),
    ]);
    const lock: MailboxLockObject = await client.getMailboxLock("INBOX");
    try {
      // getMailboxLock membuka mailbox INBOX — fetch aman di dalam lock.
      const range = { since };
      const messages: FetchMessageObject[] = [];
      for await (const msg of client.fetch(range, { uid: true, envelope: true, internalDate: true, bodyStructure: true })) {
        messages.push(msg);
      }

      for (const msg of messages) {
        scanned += 1;
        const messageId = msg.envelope?.messageId ?? `imap-${msg.uid}-${new Date(msg.internalDate ?? 0).getTime()}`;
        // FIX r26: dedupe harus pakai bentuk TERSIMPAN (slice 250) — Message-ID panjang
        // dulu tidak pernah cocok → email re-sync duplikat setiap jalan.
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
              // content adalah stream — kumpulkan chunk hingga selesai.
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
        if (!text.trim()) text = "(isi email HTML/lampiran — lihat klien email untuk lengkapnya)";

        const fromAddr = msg.envelope?.from?.[0];
        const sender = fromAddr ? (fromAddr.name ? `${fromAddr.name} <${fromAddr.address ?? ""}>` : fromAddr.address ?? "tidak diketahui") : "tidak diketahui";

        await db.interaction.create({
          data: {
            channel: "email",
            direction: "inbound",
            brandId: config.brandId,
            externalId: storedMessageId,
            senderName: sender.slice(0, 250),
            recipientName: creds.smtpUser ?? config.accountRef,
            subject: msg.envelope?.subject ?? "(tanpa subjek)",
            content: text.slice(0, 8000),
            deliveryStatus: null,
          },
        });
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
      actorName: actor.name, actorRole: actor.role,
      action: "email_sync",
      entity: "channel", entityId: config.id,
      entityLabel: `sinkron IMAP ${config.displayName} gagal — ${note}`,
      newValue: { ok: false, note },
      req,
    });
    return fail(note, 502);
  }

  await db.channelConfig.update({ where: { id: config.id }, data: { lastEmailSyncAt: new Date() } });
  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "email_sync",
    entity: "channel", entityId: config.id,
    entityLabel: `sinkron IMAP ${config.displayName} — ${created} email baru, ${skipped} duplikat`,
    newValue: { ok: true, created, skipped, scanned },
    req,
  });

  return ok({ created, skipped, scanned, since: since.toISOString() });
}
