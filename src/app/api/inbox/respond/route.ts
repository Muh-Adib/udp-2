import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, unsafeAttachmentReason } from "@/lib/crm/server";
import { deliverEmailReply } from "@/lib/crm/email-delivery";
import { computeReplyChannels, REPLY_CHANNELS, reachableAddress, serializeInteractionAttachments } from "@/lib/crm/thread";
import { resolveActor } from "@/lib/crm/auth";
import type { InteractionAttachment } from "@/lib/crm/types";

/** Ronde 34-b — batas lampiran per pesan chat. */
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB per file (data URL)
const DATA_URL_RE = /^data:[\w.+-]+\/[\w.+-]+;base64,/;

/** Ronde 34-b — parse & validasi lampiran dari body (data URL saja, ada batas ukuran/jumlah). */
function parseAttachments(input: unknown): { list: InteractionAttachment[]; error: string | null } {
  if (input == null) return { list: [], error: null };
  if (!Array.isArray(input)) return { list: [], error: "Format lampiran tidak valid" };
  const list: InteractionAttachment[] = [];
  for (const raw of input.slice(0, MAX_ATTACHMENTS)) {
    const item = raw as { name?: unknown; url?: unknown };
    const name = String(item?.name ?? "").trim().slice(0, 200);
    const url = String(item?.url ?? "");
    if (!name || !url) continue;
    if (!DATA_URL_RE.test(url)) return { list: [], error: `Lampiran "${name}" harus berupa file (data URL)` };
    // Ronde 36 (audit): tolak file berbahaya (html/svg/js/exe…) dgn pesan jelas.
    const unsafe = unsafeAttachmentReason(name, url);
    if (unsafe) return { list: [], error: `Lampiran "${name}" ditolak — ${unsafe}` };
    const base64 = url.slice(url.indexOf(",") + 1);
    const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0));
    if (bytes > MAX_ATTACHMENT_BYTES) {
      return { list: [], error: `Lampiran "${name}" melebihi 2 MB` };
    }
    list.push({ name, url, size: bytes });
  }
  if (input.length > MAX_ATTACHMENTS) return { list, error: `Maksimal ${MAX_ATTACHMENTS} lampiran per pesan` };
  return { list, error: null };
}

/**
 * Fase 3 — Respons & catat lead inbox:
 * buat interaction outbound sebagai jawaban lead inbound, lalu tandai lead
 * `respondedBy/respondedAt` (memenuhi SLA & menghentikan countdown).
 *
 * Ronde 32 — FIX alur konversi: thread yang SUDAH dikonversi ke opportunity
 * TETAP bisa dibalas dari inbox (chat lanjutan dgn klien aktif). Balasan
 * outbound otomatis tertaut ke opportunity (opportunityId) sehingga muncul
 * juga di Timeline opportunity di Sales Pipeline.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const interactionId = body.interactionId ? String(body.interactionId) : "";
  const content = String(body.content ?? "").trim();
  if (!interactionId) return fail("Lead tidak ditemukan", 404);
  // Ronde 34-b — lampiran dokumen/gambar (maks 3 @2MB, data URL)
  const att = parseAttachments(body.attachments);
  if (att.error) return fail(att.error);
  // Ronde 34-b — pesan boleh HANYA lampiran (tanpa teks)
  if (!content && att.list.length === 0) return fail("Isi respons wajib diisi");

  const lead = await db.interaction.findUnique({
    where: { id: interactionId },
    include: { contact: { include: { company: true } }, brand: true },
  });
  if (!lead) return fail("Lead tidak ditemukan", 404);
  // Ronde 32: balasan pada thread terkonversi DIBOLEHKAN (dulu diblok total —
  // percakapan jadi mati setelah konversi). Hanya arah pesan yang tetap divalidasi.
  if (lead.direction !== "inbound") {
    return fail("Hanya pesan inbound yang bisa dibalas", 400);
  }

  const actorName = actor.name;
  const actorRole = actor.role;
  const contactId = body.contactId ? String(body.contactId) : lead.contactId;
  const companyId = body.companyId
    ? String(body.companyId)
    : lead.contact?.companyId ?? null;
  const subject = body.subject ? String(body.subject) : null;

  // ===== Ronde 25 — balasan HANYA via kanal yang punya alamat tujuan =====
  // email → butuh alamat email; WhatsApp/telepon → nomor; Instagram → handle.
  const available = computeReplyChannels({ channel: lead.channel, senderName: lead.senderName, contact: lead.contact });
  const requestedRaw = body.channel ? String(body.channel) : lead.channel ?? "";
  if (!(REPLY_CHANNELS as readonly string[]).includes(requestedRaw)) {
    return fail(
      available.length > 0
        ? `Balasan harus via kanal yang punya kontak: ${available.join(", ")}.`
        : "Belum ada kanal untuk membalas — lengkapi dulu email/nomor WhatsApp/handle Instagram pada kontak.",
      400,
    );
  }
  if (!available.includes(requestedRaw as (typeof REPLY_CHANNELS)[number])) {
    return fail(
      `Tidak bisa membalas via ${requestedRaw} — alamat tujuan tidak tersedia. Gunakan: ${available.join(", ")}.`,
      400,
    );
  }
  const channel = requestedRaw;
  const replyAddress = reachableAddress(channel, { senderName: lead.senderName, contact: lead.contact });

  // Ronde 21: email outbound → kirim NYATA via SMTP bila kanal terverifikasi (non-demo).
  let deliveryStatus: string | null = "delivered";
  let deliveryNote: string | null = null;
  if (channel === "email") {
    const delivery = await deliverEmailReply({
      recipientRaw: replyAddress ?? lead.contact?.fullName ?? lead.senderName ?? null,
      subject,
      content,
    });
    deliveryStatus = delivery.status;
    deliveryNote = delivery.note;
    // Ronde 34-b — jujur: lampiran tersimpan di CRM, belum ikut terkirim via SMTP
    if (att.list.length > 0) {
      deliveryNote = `${deliveryNote ?? ""}${deliveryNote ? " · " : ""}Lampiran tersimpan di CRM (belum ikut terkirim via SMTP)`;
    }
  }

  // Ronde 36 (audit): reply + penandaan SLA dalam SATU transaksi — gagal di tengah
  // tidak menyisakan balasan tercatat tapi lead masih dianggap belum direspons
  // (dulu memicu eskalasi SLA palsu oleh sweep).
  const { reply, updatedLead } = await db.$transaction(async (tx) => {
    const reply = await tx.interaction.create({
      data: {
        channel,
        direction: "outbound",
        brandId: lead.brandId,
        senderName: actorName,
        recipientName: replyAddress ?? lead.contact?.fullName ?? lead.senderName,
        subject,
        content,
        attachments: att.list.length > 0 ? JSON.stringify(att.list) : null, // Ronde 34-b
        deliveryStatus,
        deliveryNote,
        // Ronde 32: balasan pada thread terkonversi ikut tertaut ke opportunity —
        // muncul di Timeline opportunity (Pipeline) DAN di thread inbox (view=all).
        opportunityId: lead.opportunityId ?? null,
        contactId,
        companyId,
        externalId: `inbox-reply:${lead.id}`,
      },
      include: { contact: { include: { company: true } }, brand: true },
    });

    // Tandai lead inbound sudah direspons (SLA terpenuhi)
    const updatedLead = await tx.interaction.update({
      where: { id: lead.id },
      data: { respondedBy: actorName, respondedAt: new Date() },
      include: { contact: { include: { company: true } }, brand: true },
    });
    return { reply, updatedLead };
  });

  await logAudit({
    actorName,
    actorRole,
    action: "create",
    entity: "interaction",
    entityId: reply.id,
    entityLabel: `Respons ${channel} ke ${reply.recipientName ?? "lead"}`,
    field: "inbox_reply",
    oldValue: null,
    newValue: lead.id,
    metadata: content.slice(0, 120),
    req,
  });

  // Ronde 34-b — reply dikembalikan dgn attachments terparse (bukan JSON string mentah)
  return ok({ reply: { ...reply, attachments: serializeInteractionAttachments(reply.attachments) }, lead: updatedLead }, 201);
}
