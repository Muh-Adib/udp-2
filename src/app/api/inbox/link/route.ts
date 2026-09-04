import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { contactIdentityTokens, threadKeyForWithContact } from "@/lib/crm/thread";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 33 — AKSI YANG HILANG: gabungkan identitas lead ke contact existing
 * TANPA memaksa pembuatan opportunity.
 *
 * Latar (laporan user): di modal Identifikasi, setelah memilih kandidat
 * ("Dipilih — akan digabung ke contact ini"), satu-satunya aksi berikutnya adalah
 * "Konversi jadi Opportunity". Marketing yang hanya ingin menyatukan log percakapan
 * lintas kanal ke contact yang sama (mis. klien lama menghubungi lagi lewat kanal baru,
 * atau lead yang masih diragukan layak masuk pipeline) tidak punya pintu lain selain
 * konversi — aksi penggabungan murni memang TIDAK ADA.
 *
 * Route ini melengkapi alur: tautkan interaction ke contact + company, thread
 * percakapan otomatis menyatu (threadKey → c:<contactId>), kanal balasan mengikuti
 * alamat contact. Konversi ke opportunity tetap bisa dilakukan belakangan lewat
 * alur konversi biasa (lead tetap tampil di "Perlu Tindakan").
 *
 * body: { interactionId, contactId }
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Identitas aktor dari sesi (cookie) — konsisten dgn route tulis lainnya.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const interactionId = String(body.interactionId ?? "");
  const contactId = String(body.contactId ?? "");
  if (!interactionId) return fail("interactionId wajib diisi");
  if (!contactId) return fail("Pilih kandidat contact yang akan digabungkan");

  const interaction = await db.interaction.findUnique({ where: { id: interactionId } });
  if (!interaction) return fail("Lead tidak ditemukan", 404);
  if (interaction.direction !== "inbound") return fail("Hanya pesan masuk yang bisa digabungkan");
  if (interaction.opportunityId) {
    return fail("Lead sudah dikonversi — kelola percakapannya dari Pipeline atau Inbox tab Semua Percakapan");
  }

  const contact = await db.contact.findUnique({ where: { id: contactId }, include: { company: true } });
  if (!contact) return fail("Contact tidak ditemukan", 404);

  await db.interaction.update({
    where: { id: interactionId },
    data: { contactId, companyId: contact.companyId },
  });

  // Audit SETELAH update commit — gagal audit tidak menggagalkan penggabungan.
  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    entity: "interaction",
    entityId: interactionId,
    entityLabel: `Identitas lead digabungkan ke ${contact.fullName} (tanpa konversi)`,
    field: "contactId",
    oldValue: interaction.contactId,
    newValue: contactId,
    metadata: `Thread ${interaction.channel} digabung ke contact existing — belum jadi opportunity`,
    req,
  });

  // ===== Best-effort: pesan se-identitas lain yang BELUM terkonversi ikut tertaut =====
  // Sama dgn unify saat konversi, tapi TIDAK menyentuh opportunityId — tiap lead tetap
  // tersendiri di "Perlu Tindakan" sampai masing-masing dikonversi.
  let unifiedCount = 0;
  try {
    const tokens = contactIdentityTokens(contact);
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
        data: { contactId, companyId: contact.companyId },
      });
      await logAudit({
        actorName: actor.name,
        actorRole: actor.role,
        action: "update",
        entity: "interaction",
        entityId: sib.id,
        entityLabel: `Pesan disatukan ke ${contact.fullName} (identitas sama)`,
        field: "thread_unify",
        oldValue: null,
        newValue: contactId,
        req,
      });
      unifiedCount += 1;
    }
  } catch {
    // unify gagal tidak boleh menggagalkan penggabungan utama
  }

  return ok({ contactId, contactName: contact.fullName, unifiedCount });
}
