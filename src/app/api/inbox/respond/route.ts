import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

/**
 * Fase 3 — Respons & catat lead inbox:
 * buat interaction outbound sebagai jawaban lead inbound, lalu tandai lead
 * `respondedBy/respondedAt` (memenuhi SLA & menghentikan countdown).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const interactionId = body.interactionId ? String(body.interactionId) : "";
  const content = String(body.content ?? "").trim();
  if (!interactionId) return fail("Lead tidak ditemukan", 404);
  if (!content) return fail("Isi respons wajib diisi");

  const lead = await db.interaction.findUnique({
    where: { id: interactionId },
    include: { contact: { include: { company: true } }, brand: true },
  });
  if (!lead) return fail("Lead tidak ditemukan", 404);
  if (lead.direction !== "inbound" || lead.opportunityId) {
    return fail("Lead sudah diproses atau dikonversi", 400);
  }

  const actorName = String(body.actorName ?? "Marketing");
  const actorRole = String(body.actorRole ?? "marketing");
  const channel = String(body.channel ?? lead.channel ?? "whatsapp");
  const contactId = body.contactId ? String(body.contactId) : lead.contactId;
  const companyId = body.companyId
    ? String(body.companyId)
    : lead.contact?.companyId ?? null;
  const subject = body.subject ? String(body.subject) : null;

  const reply = await db.interaction.create({
    data: {
      channel,
      direction: "outbound",
      brandId: lead.brandId,
      senderName: actorName,
      recipientName: lead.contact?.fullName ?? lead.senderName,
      subject,
      content,
      deliveryStatus: "delivered",
      opportunityId: null,
      contactId,
      companyId,
      externalId: `inbox-reply:${lead.id}`,
    },
    include: { contact: { include: { company: true } }, brand: true },
  });

  // Tandai lead inbound sudah direspons (SLA terpenuhi)
  const updatedLead = await db.interaction.update({
    where: { id: lead.id },
    data: { respondedBy: actorName, respondedAt: new Date() },
    include: { contact: { include: { company: true } }, brand: true },
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

  return ok({ reply, lead: updatedLead }, 201);
}
