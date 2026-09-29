import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { sendDocumentEmail, isDelivered, randomToken, baseUrlFromReq } from "@/lib/crm/doc-send";

/**
 * Ronde 56 — kirim LINK PROJECT (portal klien) via email brand terhubung.
 * Dulu link portal hanya bisa DISALIN ke clipboard lalu dikirim manual —
 * laporan user: "link project tidak terkirim". Kini tombol email mengirim
 * nyata via SMTP kanal brand + interaksi tercatat (sinkron timeline & inbox).
 * Bila perusahaan belum punya portal token aktif, token BARU dibuat otomatis.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const project = await db.project.findUnique({
    where: { id },
    include: {
      brand: true,
      company: { select: { id: true, name: true } },
      opportunity: { select: { id: true, contactId: true } },
    },
  });
  if (!project) return fail("Project tidak ditemukan", 404);

  // Penerima: email eksplisit di dialog, else kontak opportunity, else kontak utama perusahaan.
  const contact = await db.contact.findUnique({
    where: { id: project.opportunity?.contactId ?? "" },
    select: { id: true, fullName: true, email: true },
  });
  const fallbackContact = contact?.email
    ? contact
    : await db.contact.findFirst({
        where: { companyId: project.companyId, email: { not: null } },
        select: { id: true, fullName: true, email: true },
        orderBy: { createdAt: "asc" },
      });
  const recipient = String(body.email ?? "").trim() || (fallbackContact?.email ?? "");
  if (!recipient || !recipient.includes("@")) {
    return fail("Tidak ada alamat email klien — isi email pada dialog kirim", 422);
  }
  if (body.confirmLegal !== true) {
    return fail("Konfirmasi syarat & ketentuan pengiriman wajib dicentang", 422);
  }

  // Portal token: pakai yang aktif, atau buat baru otomatis.
  let portal = await db.clientPortalToken.findFirst({
    where: { companyId: project.companyId, active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!portal) {
    portal = await db.clientPortalToken.create({
      data: {
        token: randomToken(24),
        companyId: project.companyId,
        label: `${fallbackContact?.fullName ?? project.company.name} — ${project.company.name}`.slice(0, 80),
        createdByName: actor.name,
      },
    });
  }
  const link = `${baseUrlFromReq(req)}/?portal=${portal.token}`;

  const subject = `Project ${project.name} — ${project.brand.name ?? "Client Portal"} access`;
  const progress = typeof project.progress === "number" ? project.progress : 0;
  const content = [
    `Dear ${fallbackContact?.fullName ?? project.company.name ?? "Valued Client"},`,
    "",
    `Your project "${project.name}" is now active (progress ${progress}%).`,
    "You can monitor milestones, review deliverables, and leave feedback anytime via your dedicated client portal:",
    link,
    "",
    "This link is private to your company — please do not forward it to third parties. Sharing project materials through this portal keeps all approvals documented in one place.",
    "",
    "Best regards,",
    project.brand.name ?? "Project Team",
  ].join("\n");

  const send = await sendDocumentEmail({
    req,
    actorName: actor.name,
    actorRole: actor.role,
    brandId: project.brandId,
    recipientEmail: recipient,
    recipientName: fallbackContact?.fullName ?? project.company.name ?? null,
    subject,
    content,
    interaction: {
      opportunityId: project.opportunityId ?? null,
      contactId: fallbackContact?.id ?? project.opportunity?.contactId ?? null,
      companyId: project.companyId,
    },
    entityLabel: `Kirim link project ${project.code} → ${recipient}`,
    auditMetadata: `Portal ${portal.token.slice(0, 8)}…`,
  });
  if (!isDelivered(send.status)) {
    return fail(`Gagal mengirim email link project: ${send.note ?? send.status} — periksa kanal email di Saluran & Integrasi`, 502);
  }

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "email_project_link",
    entity: "project",
    entityId: project.id,
    entityLabel: `${project.code} — ${project.name}`,
    newValue: { emailStatus: send.status, to: recipient },
    req,
  });

  return ok({ status: send.status, note: send.note, link, interactionId: send.interactionId });
}
