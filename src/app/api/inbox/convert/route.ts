import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { extractEmailFromText } from "@/lib/crm/utils";
import { contactIdentityTokens, threadKeyForWithContact } from "@/lib/crm/thread";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Konversi lead inbox menjadi contact (+company) dan opportunity.
 * body: { interactionId, action: "link"|"new", contactId?, contact?, company?, opportunity }
 *
 * Ronde 26 engineering: pembuatan contact/company/opportunity, penautan lead,
 * dan task follow-up kini dalam SATU transaksi atomik — gagal di tengah tidak
 * menyisakan contact yatim / opportunity tanpa lead tertaut, dan dua konversi
 * bersamaan atas lead yang sama tidak lagi menghasilkan opportunity ganda
 * (cek ulang opportunityId di dalam transaksi).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const interactionId = String(body.interactionId ?? "");
  const action = String(body.action ?? "new");
  const actorName = actor.name;
  const actorRole = actor.role;

  const interaction = await db.interaction.findUnique({ where: { id: interactionId } });
  if (!interaction) return fail("Lead tidak ditemukan", 404);
  if (interaction.opportunityId) return fail("Lead sudah dikonversi");

  const oppData = (body.opportunity ?? {}) as Record<string, unknown>;
  const requestedBrandId = String(oppData.brandId ?? interaction.brandId ?? "");
  if (!requestedBrandId) return fail("Brand wajib dipilih");

  type ConvertResult = {
    opportunity: NonNullable<Awaited<ReturnType<typeof db.opportunity.findFirst>>>;
    contactId: string;
    companyId: string | null;
    contactName: string;
    createdContact: boolean;
  };

  let result: ConvertResult;
  try {
    result = await db.$transaction(async (tx) => {
      // Cek ulang DI DALAM transaksi — tutup race dua konversi bersamaan.
      const fresh = await tx.interaction.findUnique({ where: { id: interactionId } });
      if (!fresh) throw new Error("LEAD_GONE");
      if (fresh.opportunityId) throw new Error("ALREADY_CONVERTED");

      let contactId = action === "link" ? String(body.contactId ?? "") : "";
      let companyId: string | null = null;
      type ContactRow = NonNullable<Awaited<ReturnType<typeof db.contact.findUnique>>>;
      let contact: ContactRow | null = null;
      let createdContact = false;

      if (action === "link") {
        contact = await tx.contact.findUnique({ where: { id: contactId } });
        if (!contact) throw new Error("CONTACT_NOT_FOUND");
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
        const existing = await tx.contact.findFirst({
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
            let company = await tx.company.findFirst({ where: { name: companyName, deletedAt: null } });
            if (!company) {
              company = await tx.company.create({
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
          contact = await tx.contact.create({
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
          createdContact = true;
        }
      }

      const opportunity = await tx.opportunity.create({
        data: {
          title: String(oppData.title ?? `Lead baru dari ${interaction.channel}`),
          brandId: requestedBrandId,
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

      // Tautkan interaction ke opportunity + contact (conditional — masih null di tx ini)
      await tx.interaction.update({
        where: { id: interactionId },
        data: { opportunityId: opportunity.id, contactId, companyId },
      });

      // Task SLA follow-up
      await tx.task.create({
        data: {
          title: `Follow-up 1: ${opportunity.title}`,
          type: "follow_up",
          priority: "high",
          assigneeName: opportunity.ownerName ?? actorName,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          opportunityId: opportunity.id,
        },
      });

      return {
        opportunity,
        contactId,
        companyId,
        contactName: contact.fullName,
        createdContact,
      };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "LEAD_GONE") return fail("Lead tidak ditemukan", 404);
    if (msg === "ALREADY_CONVERTED") return fail("Lead sudah dikonversi");
    if (msg === "CONTACT_NOT_FOUND") return fail("Contact tidak ditemukan", 404);
    return fail("Konversi gagal — tidak ada perubahan tersimpan", 500);
  }

  const { opportunity, contactId, companyId, contactName, createdContact } = result;

  // Audit SETELAH transaksi commit (gagal audit tidak membatalkan konversi).
  if (createdContact) {
    await logAudit({
      actorName, actorRole, action: "create", entity: "contact",
      entityId: contactId, entityLabel: contactName,
      metadata: "Dibuat saat konversi lead inbox", req,
    });
  }

  // ===== Ronde 25 — SATUKAN pesan lain dari identitas yang sama =====
  // Semua pesan inbound lain yang belum dikonversi dan terbukti milik kontak yang sama
  // (email/nomor WA/handle IG/nama cocok) ikut tertaut ke contact + opportunity ini,
  // sehingga percakapan lintas kanal/website/negara jadi SATU lead berdasarkan kontak.
  // Best-effort SETELAH konversi utama commit — gagal tidak menggagalkan konversi.
  let unifiedCount = 0;
  try {
    const contactRow = await db.contact.findUnique({ where: { id: contactId } });
    if (contactRow) {
      const tokens = contactIdentityTokens(contactRow);
      const siblings = await db.interaction.findMany({
        where: {
          direction: "inbound",
          opportunityId: null,
          id: { not: interactionId },
          createdAt: { gte: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) },
        },
        select: { id: true, contactId: true, senderName: true, recipientName: true, brandId: true },
        take: 200,
      });
      for (const sib of siblings) {
        const key = threadKeyForWithContact(sib, tokens, contactId);
        if (key !== `c:${contactId}`) continue;
        await db.interaction.update({
          where: { id: sib.id },
          data: {
            contactId,
            companyId,
            opportunityId: opportunity.id,
            // brand tetap dari sumber masing-masing; hanya diisi bila kosong
            ...(sib.brandId ? {} : { brandId: requestedBrandId }),
          },
        });
        await logAudit({
          actorName, actorRole, action: "update", entity: "interaction",
          entityId: sib.id,
          entityLabel: `Pesan disatukan ke ${contactRow.fullName} · ${opportunity.title}`,
          field: "thread_unify",
          oldValue: null,
          newValue: opportunity.id,
          req,
        });
        unifiedCount += 1;
      }
    }
  } catch {
    // unify gagal tidak boleh menggagalkan konversi utama
  }

  await logAudit({
    actorName, actorRole, action: "convert", entity: "opportunity",
    entityId: opportunity.id, entityLabel: opportunity.title,
    metadata: `Lead inbox (${interaction.channel}) dikonversi menjadi opportunity via ${action === "link" ? "link ke contact existing" : "contact baru"}`,
    req,
  });

  return ok({ opportunity, contactId, unifiedCount }, 201);
}
