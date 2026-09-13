/**
 * Ronde 56 — pengiriman dokumen (quotation/invoice/project link) via email
 * brand yang TERHUBUNG, dengan bukti interaksi yang sinkron antara timeline
 * opportunity dan thread Inbox (contactId + opportunityId + brandId diisi).
 *
 * Dulu: action send quotation/invoice hanya MENANDAI status "sent" tanpa
 * mengirim apa pun; project link hanya disalin ke clipboard. Klien tidak
 * pernah menerima email — inilah akar laporan "penawaran/invoice/link tidak
 * terkirim".
 */

import { NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { deliverEmailReply, type DeliveryAttachment } from "@/lib/crm/email-delivery";
import { logAudit } from "@/lib/crm/server";
import { serializeInteractionAttachments } from "@/lib/crm/thread";

export function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

/** Origin absolut dari request (untuk link di email — tidak boleh relatif). */
export function baseUrlFromReq(req: NextRequest | undefined): string {
  const host = req?.headers.get("x-forwarded-host") ?? req?.headers.get("host") ?? "localhost:3000";
  const proto = req?.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export interface SendDocumentOptions {
  req?: NextRequest;
  actorName: string;
  actorRole?: string | null;
  /** Brand pemilik dokumen — menentukan kanal email mana yang dipakai. */
  brandId: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  content: string;
  attachments?: DeliveryAttachment[];
  /** Relasi interaksi agar pesan tampil di timeline opportunity & thread inbox. */
  interaction: {
    opportunityId?: string | null;
    contactId?: string | null;
    companyId?: string | null;
    senderName?: string | null;
  };
  /** Interaksi di catat sebagai "tanda kirim" walau SMTP gagal (dengan status jujur). */
  entityLabel: string;
  auditMetadata?: string;
}

export interface SendDocumentResult {
  status: string; // sent | failed | simulated
  note: string | null;
  interactionId: string;
}

/**
 * Kirim email dokumen + catat interaksi (status JUJUR).
 * Mengembalikan status; pemanggil memutuskan apakah dokumen boleh ditandai
 * "sent" (hanya bila status === "sent" atau "simulated" untuk kanal demo).
 */
export async function sendDocumentEmail(options: SendDocumentOptions): Promise<SendDocumentResult> {
  const delivery = await deliverEmailReply({
    recipientRaw: options.recipientEmail,
    subject: options.subject,
    content: options.content,
    attachments: options.attachments,
    brandId: options.brandId,
  });

  const attachmentJson = options.attachments && options.attachments.length > 0
    ? JSON.stringify(options.attachments.map((a) => ({ name: a.name, url: a.url, ...(a.size ? { size: a.size } : {}) })))
    : null;

  const interaction = await db.interaction.create({
    data: {
      channel: "email",
      direction: "outbound",
      brandId: options.brandId,
      opportunityId: options.interaction.opportunityId ?? null,
      contactId: options.interaction.contactId ?? null,
      companyId: options.interaction.companyId ?? null,
      senderName: options.interaction.senderName ?? options.actorName,
      recipientName: options.recipientName ? `${options.recipientName} <${options.recipientEmail}>`.slice(0, 250) : options.recipientEmail.slice(0, 250),
      subject: options.subject,
      content: options.content.slice(0, 8000),
      respondedBy: options.actorName,
      respondedAt: new Date(),
      deliveryStatus: delivery.status,
      deliveryNote: delivery.note,
      ...(attachmentJson ? { attachments: attachmentJson } : {}),
    },
    select: { id: true },
  });

  await logAudit({
    actorName: options.actorName,
    actorRole: options.actorRole ?? null,
    action: "email_document",
    entity: "interaction",
    entityId: interaction.id,
    entityLabel: options.entityLabel,
    newValue: { emailStatus: delivery.status, to: options.recipientEmail },
    metadata: options.auditMetadata,
    req: options.req,
  });

  return {
    // DeliveryOutcome.status nullable → normalkan agar pemanggil selalu banding string
    status: delivery.status ?? "unknown",
    note: delivery.note,
    interactionId: interaction.id,
  };
}

/** Apakah status pengiriman boleh dianggap "dokumen terkirim". */
export function isDelivered(status: string): boolean {
  return status === "sent" || status === "simulated";
}

/** Lampiran PDF → DeliveryAttachment (data URL application/pdf). */
export function pdfAttachment(name: string, buf: Uint8Array): DeliveryAttachment {
  return {
    name,
    url: `data:application/pdf;base64,${Buffer.from(buf).toString("base64")}`,
    size: buf.byteLength,
  };
}

/** Deserialize aman JSON attachment (dipakai route unduh & tampilan). */
export function safeParseAttachments(raw: string | null): Array<{ name?: string; url?: string; size?: number }> {
  return serializeInteractionAttachments(raw) ?? [];
}
