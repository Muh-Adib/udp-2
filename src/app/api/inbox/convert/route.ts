import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { extractEmailFromText } from "@/lib/crm/utils";

/**
 * Konversi lead inbox menjadi contact (+company) dan opportunity.
 * body: { interactionId, action: "link"|"new", contactId?, contact?, company?, opportunity }
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const interactionId = String(body.interactionId ?? "");
  const action = String(body.action ?? "new");
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "marketing");

  const interaction = await db.interaction.findUnique({ where: { id: interactionId } });
  if (!interaction) return fail("Lead tidak ditemukan", 404);
  if (interaction.opportunityId) return fail("Lead sudah dikonversi");

  let contactId = action === "link" ? String(body.contactId ?? "") : "";
  let companyId: string | null = null;
  type ContactRow = NonNullable<Awaited<ReturnType<typeof db.contact.findUnique>>>;
  let contact: ContactRow | null = null;

  if (action === "link") {
    contact = await db.contact.findUnique({ where: { id: contactId } });
    if (!contact) return fail("Contact tidak ditemukan", 404);
    companyId = contact.companyId;
  } else {
    const c = (body.contact ?? {}) as Record<string, unknown>;
    const firstName = String(c.firstName ?? "Kontak").trim();
    const lastName = String(c.lastName ?? "").trim();
    const fullName = `${firstName} ${lastName}`.trim();

    // Cegah duplikat: jika whatsapp/email sama dengan contact yang ada, gunakan yang lama
    const wa = c.whatsapp ? String(c.whatsapp) : null;
    // FIX r22: email divalidasi sungguhan — handle IG (@username) BUKAN email,
    // disimpan sbg socialProfile agar tidak mencemari kolom email & pencocokan duplikat.
    const rawEmailInput = c.email ? String(c.email).trim() : "";
    const em = extractEmailFromText(rawEmailInput);
    const socialHandle = !em && rawEmailInput.startsWith("@") && !rawEmailInput.includes(" ") ? rawEmailInput : null;
    const existing = await db.contact.findFirst({
      where: {
        OR: [
          ...(wa ? [{ whatsapp: wa }] : []),
          ...(em ? [{ email: em }] : []),
        ],
      },
      include: { company: true },
    });

    if (existing) {
      contact = existing;
      contactId = existing.id;
      companyId = existing.companyId;
    } else {
      // Company
      const companyName = c.companyName ? String(c.companyName).trim() : "";
      if (companyName) {
        let company = await db.company.findFirst({ where: { name: companyName, deletedAt: null } });
        if (!company) {
          company = await db.company.create({
            data: {
              name: companyName,
              industry: c.industry ? String(c.industry) : null,
              country: c.country ? String(c.country) : null,
              city: c.city ? String(c.city) : null,
            },
          });
        }
        companyId = company.id;
      }
      contact = await db.contact.create({
        data: {
          firstName, lastName: lastName || null, fullName,
          position: c.position ? String(c.position) : null,
          email: em, whatsapp: wa, phone: c.phone ? String(c.phone) : null,
          // Ronde 23: kolom instagram terstruktur + socialProfile (handle) dipertahankan
          // agar scanner duplikat lintas sumber tetap mengenali lead dari IG.
          socialProfile: socialHandle,
          instagram: c.instagram ? String(c.instagram).trim() : null,
          country: c.country ? String(c.country) : "Indonesia",
          city: c.city ? String(c.city) : null,
          preferredChannel: interaction.channel,
          companyId,
        },
      });
      contactId = contact.id;
      await logAudit({
        actorName, actorRole, action: "create", entity: "contact",
        entityId: contact.id, entityLabel: contact.fullName,
        metadata: "Dibuat saat konversi lead inbox", req,
      });
    }
  }

  const oppData = (body.opportunity ?? {}) as Record<string, unknown>;
  const brandId = String(oppData.brandId ?? interaction.brandId ?? "");
  if (!brandId) return fail("Brand wajib dipilih");

  const opportunity = await db.opportunity.create({
    data: {
      title: String(oppData.title ?? `Lead baru dari ${interaction.channel}`),
      brandId,
      contactId,
      companyId,
      serviceCategory: oppData.serviceCategory ? String(oppData.serviceCategory) : null,
      serviceName: oppData.serviceName ? String(oppData.serviceName) : null,
      leadSource: interaction.channel,
      brief: interaction.content,
      estimatedValue: oppData.estimatedValue ? Number(oppData.estimatedValue) : null,
      currency: oppData.currency ? String(oppData.currency) : "IDR",
      ownerName: oppData.ownerName ? String(oppData.ownerName) : actorName,
      stage: String(oppData.stage ?? "new"),
      temperature: String(oppData.temperature ?? "warm"),
      priority: String(oppData.priority ?? "medium"),
    },
    include: { brand: true, contact: { include: { company: true } } },
  });

  // Tautkan interaction ke opportunity + contact
  await db.interaction.update({
    where: { id: interactionId },
    data: { opportunityId: opportunity.id, contactId, companyId },
  });

  // Task SLA follow-up
  await db.task.create({
    data: {
      title: `Follow-up 1: ${opportunity.title}`,
      type: "follow_up",
      priority: "high",
      assigneeName: opportunity.ownerName ?? actorName,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      opportunityId: opportunity.id,
    },
  });

  await logAudit({
    actorName, actorRole, action: "convert", entity: "opportunity",
    entityId: opportunity.id, entityLabel: opportunity.title,
    metadata: `Lead inbox (${interaction.channel}) dikonversi menjadi opportunity via ${action === "link" ? "link ke contact existing" : "contact baru"}`,
    req,
  });

  return ok({ opportunity, contactId }, 201);
}
