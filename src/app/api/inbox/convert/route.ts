import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { extractEmailFromText, extractDomain } from "@/lib/crm/utils";
import { findCountry } from "@/lib/crm/countries";
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
 *
 * Ronde 41: (1) contact baru menyimpan mata uang (body ?? turunan negara);
 * (2) mata uang opportunity mengalir dari kontak → brand → IDR;
 * (3) konversi kini membentuk DRAFT BRIEF AWAL (ClientBrief status draft)
 * berisi pesan lead sbg tujuan awal + layanan terpilih — bisa diedit di tab Brief.
 *
 * Ronde 44: perusahaan tertaut penuh — bila contact.companyId diberikan (dibuat
 * dari modal Detail Perusahaan di form konversi) perusahaan existing langsung
 * dipakai; bila hanya companyName, perusahaan dibuat/dipakai dengan detail
 * (industry, website, city, size, address) dari body.contact.company bila ada.
 * Contact baru juga menyimpan phone, preferredChannel, facebook & tiktok
 * (field-set form konversi kini identik dgn form Kontak Baru modul Contacts).
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

  // Ronde 40 — brand divalidasi + dipakai utk fallback mata uang brand
  const oppBrand = await db.brand.findUnique({ where: { id: requestedBrandId } });
  if (!oppBrand) return fail("Brand tidak ditemukan", 404);

  type ConvertResult = {
    opportunity: NonNullable<Awaited<ReturnType<typeof db.opportunity.findFirst>>>;
    contactId: string;
    companyId: string | null;
    contactName: string;
    createdContact: boolean;
    /** Ronde 41 — kode draft brief awal bila berhasil dibentuk otomatis. */
    briefCode: string | null;
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
          // ===== Perusahaan =====
          // Ronde 44 — urutan resolusi: companyId eksplisit (dari modal Detail Perusahaan,
          // detail lengkap tersimpan saat itu) → perusahaan existing by name → buat baru.
          const companyName = c.companyName ? String(c.companyName).trim() : "";
          const companyPayload = (c.company ?? body.company ?? {}) as Record<string, unknown>;
          if (c.companyId) {
            const linked = await tx.company.findFirst({
              where: { id: String(c.companyId), deletedAt: null },
              select: { id: true },
            });
            if (linked) companyId = linked.id;
          }
          // Ronde 41 — mata uang kontak: body ?? turunan negara (peta COUNTRIES)
          const contactCountry = c.country ? String(c.country) : null;
          const contactCurrency = c.currency
            ? String(c.currency).toUpperCase()
            : (contactCountry ? (findCountry(contactCountry)?.currency ?? null) : null);
          if (!companyId && companyName) {
            let company = await tx.company.findFirst({ where: { name: companyName, deletedAt: null } });
            if (!company) {
              const companyWebsite = companyPayload.website ? String(companyPayload.website) : null;
              company = await tx.company.create({
                data: {
                  name: companyName,
                  industry: companyPayload.industry ? String(companyPayload.industry) : (c.industry ? String(c.industry) : null),
                  website: companyWebsite,
                  websiteDomain: extractDomain(companyWebsite),
                  country: contactCountry ?? (companyPayload.country ? String(companyPayload.country) : null),
                  city: c.city ? String(c.city) : (companyPayload.city ? String(companyPayload.city) : null),
                  size: companyPayload.size ? String(companyPayload.size) : null,
                  address: companyPayload.address ? String(companyPayload.address) : null,
                  // Ronde 41/44 — mata uang default perusahaan: eksplisit ?? mata uang kontak ?? IDR
                  defaultCurrency: companyPayload.defaultCurrency
                    ? String(companyPayload.defaultCurrency).toUpperCase()
                    : (contactCurrency ?? "IDR"),
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
              // Ronde 44 — medsos terstruktur lain dari form bersama
              facebook: c.facebook ? String(c.facebook).trim() : null,
              tiktok: c.tiktok ? String(c.tiktok).trim() : null,
              country: contactCountry ?? "Indonesia",
              currency: contactCurrency ?? (contactCountry ? (findCountry(contactCountry)?.currency ?? null) : null),
              city: c.city ? String(c.city) : null,
              // Ronde 44 — kanal preferensi dari form bersama (default: kanal lead masuk)
              preferredChannel: c.preferredChannel ? String(c.preferredChannel) : interaction.channel,
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
          // Ronde 41 — mata uang: body ?? mata uang kontak (negara asal klien) ?? mata uang utama brand ?? IDR
          currency: oppData.currency
            ? String(oppData.currency)
            : (contact.currency ?? oppBrand.primaryCurrency ?? "IDR"),
          // Ronde 40 — owner default dari sesi (actorName), body hanya bila eksplisit
          ownerName: oppData.ownerName ? String(oppData.ownerName).trim() : actorName,
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

      // ===== Ronde 41 — DRAFT BRIEF AWAL =====
      // Konversi lead kini membentuk draft brief (ClientBrief status "draft"):
      // tujuan awal = pesan lead, layanan = layanan terpilih, mata uang = mata uang opportunity.
      // Best-effort: gagal membentuk brief tidak menggagalkan konversi (brief bisa dibuat manual di tab Brief).
      let briefCode: string | null = null;
      try {
        const briefYear = new Date().getFullYear();
        for (let attempt = 0; attempt < 5 && !briefCode; attempt++) {
          const count = await tx.clientBrief.count();
          const candidate = `BRF-${briefYear}-${String(count + attempt + 1).padStart(4, "0")}`;
          const exists = await tx.clientBrief.findUnique({ where: { code: candidate } });
          if (!exists) briefCode = candidate;
        }
        if (briefCode) {
          await tx.clientBrief.create({
            data: {
              code: briefCode,
              opportunityId: opportunity.id,
              brandId: requestedBrandId,
              title: opportunity.title,
              serviceTypes: JSON.stringify(opportunity.serviceName ? [opportunity.serviceName] : []),
              objectives: interaction.content ? interaction.content.slice(0, 2000) : null,
              currency: opportunity.currency,
              status: "draft",
              createdBy: actorName,
            },
          });
        }
      } catch {
        briefCode = null; // brief draft best-effort
      }

      return {
        opportunity,
        contactId,
        companyId,
        contactName: contact.fullName,
        createdContact,
        briefCode,
      };
    });
  } catch (e) {
    // Ronde 41: error asali dicatat ke log (sebelumnya tertelan → 500 generik tanpa jejak)
    console.error("[convert] transaction error:", e);
    const msg = e instanceof Error ? e.message : "";
    if (msg === "LEAD_GONE") return fail("Lead tidak ditemukan", 404);
    if (msg === "ALREADY_CONVERTED") return fail("Lead sudah dikonversi");
    if (msg === "CONTACT_NOT_FOUND") return fail("Contact tidak ditemukan", 404);
    return fail("Konversi gagal — tidak ada perubahan tersimpan", 500);
  }

  const { opportunity, contactId, companyId, contactName, createdContact, briefCode } = result;

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

  return ok({ opportunity, contactId, briefCode, unifiedCount }, 201);
}
