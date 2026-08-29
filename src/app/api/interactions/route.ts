import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, logAudit } from "@/lib/crm/server";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const contactId = sp.get("contactId");
  const opportunityId = sp.get("opportunityId");
  const channelId = sp.get("channel");
  const direction = sp.get("direction");
  const unassigned = sp.get("unassigned");
  const companyId = sp.get("companyId");

  const interactions = await db.interaction.findMany({
    where: {
      ...(contactId ? { contactId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
      ...(channelId && channelId !== "all" ? { channel: channelId } : {}),
      ...(direction ? { direction } : {}),
      ...(unassigned === "true" ? { opportunityId: null } : {}),
      ...(companyId ? { companyId } : {}),
    },
    include: {
      contact: { include: { company: true } },
      opportunity: { include: { brand: true } },
      brand: true,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return ok({ interactions });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const content = String(body.content ?? "").trim();
  if (!content) return ok({ error: "Konten pesan wajib diisi" }, 400);

  const interaction = await db.interaction.create({
    data: {
      channel: String(body.channel ?? "whatsapp"),
      direction: String(body.direction ?? "outbound"),
      brandId: body.brandId ? String(body.brandId) : null,
      externalId: body.externalId ? String(body.externalId) : null,
      senderName: body.senderName ? String(body.senderName) : null,
      recipientName: body.recipientName ? String(body.recipientName) : null,
      subject: body.subject ? String(body.subject) : null,
      content,
      respondedBy: body.respondedBy ? String(body.respondedBy) : null,
      respondedAt: body.respondedBy ? new Date() : null,
      deliveryStatus: String(body.direction ?? "outbound") === "outbound" ? "delivered" : "delivered",
      opportunityId: body.opportunityId ? String(body.opportunityId) : null,
      contactId: body.contactId ? String(body.contactId) : null,
      companyId: body.companyId ? String(body.companyId) : null,
    },
    include: { contact: { include: { company: true } }, opportunity: true, brand: true },
  });

  // Update next action date agar opportunity tetap hangat
  if (interaction.opportunityId) {
    await db.opportunity.update({
      where: { id: interaction.opportunityId },
      data: { updatedAt: new Date() },
    });
  }

  await logAudit({
    actorName: String(body.actorName ?? "System"), actorRole: String(body.actorRole ?? "system"),
    action: "create", entity: "interaction", entityId: interaction.id,
    entityLabel: `Pesan ${interaction.channel} ${interaction.direction}`,
    metadata: content.slice(0, 120), req,
  });

  return ok({ interaction }, 201);
}
