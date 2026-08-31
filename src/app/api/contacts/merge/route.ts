import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

/** Gabungkan duplicate contact ke contact utama (dapat dilacak: dup jadi soft-delete + log).
 * Ronde 26 engineering: pemindahan relasi + soft-delete + pengayaan data kini dalam
 * SATU transaksi — crash di tengah tidak menyisakan dup setengah-merge. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const primaryId = String(body.primaryId ?? "");
  const duplicateId = String(body.duplicateId ?? "");
  const actorName = String(body.actorName ?? "System");

  if (!primaryId || !duplicateId) return fail("primaryId dan duplicateId wajib");
  if (primaryId === duplicateId) return fail("Tidak bisa menggabungkan contact yang sama");

  const [primary, duplicate] = await Promise.all([
    db.contact.findUnique({ where: { id: primaryId } }),
    db.contact.findUnique({ where: { id: duplicateId } }),
  ]);
  if (!primary || !duplicate) return fail("Contact tidak ditemukan", 404);

  await db.$transaction(async (tx) => {
    // Pindahkan relasi ke primary
    await tx.opportunity.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.interaction.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.contact.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });

    // Perkaya primary dengan data dup yang lebih lengkap
    const enrich: Record<string, unknown> = {};
    if (!primary.email && duplicate.email) enrich.email = duplicate.email;
    if (!primary.whatsapp && duplicate.whatsapp) enrich.whatsapp = duplicate.whatsapp;
    if (!primary.phone && duplicate.phone) enrich.phone = duplicate.phone;
    if (!primary.position && duplicate.position) enrich.position = duplicate.position;
    if (!primary.companyId && duplicate.companyId) enrich.companyId = duplicate.companyId;
    if (Object.keys(enrich).length) await tx.contact.update({ where: { id: primaryId }, data: enrich });
  });

  await logAudit({
    actorName, action: "merge", entity: "contact", entityId: primaryId,
    entityLabel: primary.fullName,
    metadata: `Merge contact "${duplicate.fullName}" (${duplicateId}) ke "${primary.fullName}". Data dup: ${duplicate.email ?? "-"} / ${duplicate.whatsapp ?? "-"}`,
    req,
  });

  return ok({ merged: true, primaryId });
}
