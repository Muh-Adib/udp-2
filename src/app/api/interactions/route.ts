import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, logAudit, fail, unsafeAttachmentReason } from "@/lib/crm/server";
import { deliverEmailReply } from "@/lib/crm/email-delivery";
import { resolveActor } from "@/lib/crm/auth";

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
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const content = String(body.content ?? "").trim();
  if (!content) return ok({ error: "Konten pesan wajib diisi" }, 400);

  const channel = String(body.channel ?? "whatsapp");
  const direction = String(body.direction ?? "outbound");
  const subject = body.subject ? String(body.subject) : null;
  const recipientRaw = body.recipientName ? String(body.recipientName) : null;

  // Ronde 21: email outbound → kirim nyata via SMTP (lihat email-delivery.ts).
  // Ronde 56 — FIX "timeline tidak sinkron / lampiran tidak terkirim":
  // - deliverEmailReply kini menerima brandId → memakai kanal email MILIK BRAND
  //   interaksi (dulu kanal email acak/non-brand);
  // - lampiran (data URL ≤2MB, maks 3) ikut dikirim via SMTP DAN disimpan di
  //   interaksi sehingga bisa diunduh dari thread inbox & timeline.
  let deliveryStatus: string | null = null;
  let deliveryNote: string | null = null;
  const parsedAttachments: Array<{ name: string; url: string; size?: number }> = [];
  if (channel === "email" && direction === "outbound") {
    if (Array.isArray(body.attachments)) {
      for (const raw of body.attachments.slice(0, 3)) {
        const item = raw as { name?: unknown; url?: unknown };
        const name = String(item?.name ?? "").trim().slice(0, 200);
        const url = String(item?.url ?? "");
        if (!name || !url.startsWith("data:")) continue;
        const unsafe = unsafeAttachmentReason(name, url);
        if (unsafe) return fail(`Lampiran "${name}" ditolak — ${unsafe}`, 422);
        const base64 = url.slice(url.indexOf(",") + 1);
        const bytes = Math.floor((base64.length * 3) / 4);
        if (bytes > 2 * 1024 * 1024) return fail(`Lampiran "${name}" melebihi 2 MB`, 422);
        parsedAttachments.push({ name, url, size: bytes });
      }
    }
    const delivery = await deliverEmailReply({
      recipientRaw,
      subject,
      content,
      brandId: body.brandId ? String(body.brandId) : null,
      ...(parsedAttachments.length > 0 ? { attachments: parsedAttachments } : {}),
    });
    deliveryStatus = delivery.status;
    deliveryNote = delivery.note;
  } else if (direction === "outbound") {
    // Perilaku simulasi lama untuk kanal lain (whatsapp/instagram dsb).
    deliveryStatus = "delivered";
  }

  const interaction = await db.interaction.create({
    data: {
      channel,
      direction,
      brandId: body.brandId ? String(body.brandId) : null,
      externalId: body.externalId ? String(body.externalId) : null,
      senderName: body.senderName ? String(body.senderName) : null,
      recipientName: recipientRaw,
      subject,
      content,
      respondedBy: body.respondedBy ? String(body.respondedBy) : null,
      respondedAt: body.respondedBy ? new Date() : null,
      deliveryStatus,
      deliveryNote,
      ...(parsedAttachments.length > 0 ? { attachments: JSON.stringify(parsedAttachments) } : {}),
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
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "interaction", entityId: interaction.id,
    entityLabel: `Pesan ${interaction.channel} ${interaction.direction}`,
    metadata: content.slice(0, 120), req,
  });

  return ok({ interaction }, 201);
}
