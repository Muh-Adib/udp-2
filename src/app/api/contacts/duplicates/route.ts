import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { extractDomain, nameSimilarity, normalizeEmail, normalizePhone } from "@/lib/crm/utils";
import type { DuplicatePairDTO } from "@/lib/crm/types";

/**
 * Scanner duplikat lintas sumber (Ronde 22).
 * Menggabungkan lead/kontak yang datang dari berbagai kanal (WhatsApp/Instagram/Email/Import)
 * dengan membandingkan semua kontak aktif berpasangan: email/WA/telepon sama,
 * domain perusahaan sama, dan kemiripan nama. Skor ≥ 75 dianggap kandidat kuat.
 */
export async function GET() {
  const contacts = await db.contact.findMany({
    where: { deletedAt: null },
    include: { company: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const pairs: DuplicatePairDTO[] = [];

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];
      const reasons: string[] = [];
      let score = 0;

      const ea = normalizeEmail(a.email);
      const eb = normalizeEmail(b.email);
      if (ea && eb && ea === eb) {
        score += 90;
        reasons.push("Email sama");
      }

      const wa = normalizePhone(a.whatsapp);
      const wb = normalizePhone(b.whatsapp);
      if (wa && wb && wa === wb) {
        score += 85;
        reasons.push("WhatsApp sama");
      }

      const pa = normalizePhone(a.phone);
      const pb = normalizePhone(b.phone);
      if (pa && pb && pa === pb) {
        score += 70;
        reasons.push("Telepon sama");
      }

      // Sosial profile sama (handle IG dkk.) — termasuk field terstruktur r23
      // (instagram/facebook/tiktok) karena handle lead kini disimpan di kolom tersebut.
      const socialsA = [a.socialProfile, a.instagram, a.facebook, a.tiktok]
        .map((v) => v?.trim().toLowerCase() ?? null)
        .filter((v): v is string => !!v);
      const socialsB = [b.socialProfile, b.instagram, b.facebook, b.tiktok]
        .map((v) => v?.trim().toLowerCase() ?? null)
        .filter((v): v is string => !!v);
      const socialMatch = socialsA.some((sa) => sa && socialsB.includes(sa));
      if (socialMatch) {
        score += 80;
        reasons.push("Sosial media sama");
      }

      // Domain perusahaan sama (via company website atau domain email)
      const da = a.company?.website
        ? extractDomain(a.company.website)
        : extractDomain(a.email);
      const dbb = b.company?.website
        ? extractDomain(b.company.website)
        : extractDomain(b.email);
      if (da && dbb && da === dbb && a.companyId && b.companyId && a.companyId !== b.companyId) {
        score = Math.max(score, 60);
        reasons.push(`Domain perusahaan sama (${da})`);
      }

      // Nama mirip — hanya dihitung bila ada sinyal kontak lain ATAU sangat mirip
      const sim = nameSimilarity(a.fullName, b.fullName);
      if (sim >= 80 && (score > 0 || sim >= 95)) {
        score = Math.max(score, sim);
        reasons.push(`Nama mirip (${sim}%)`);
      }

      if (score >= 75) {
        pairs.push({
          primaryId: a.id, // lebih tua (createdAt asc) sebagai usulan primary
          primaryName: a.fullName,
          primaryEmail: a.email,
          primaryWhatsapp: a.whatsapp,
          primaryCompany: a.company?.name ?? null,
          duplicateId: b.id,
          duplicateName: b.fullName,
          duplicateEmail: b.email,
          duplicateWhatsapp: b.whatsapp,
          duplicateCompany: b.company?.name ?? null,
          score,
          reasons,
        });
      }
    }
  }

  pairs.sort((x, y) => y.score - x.score);
  return ok({ pairs });
}
