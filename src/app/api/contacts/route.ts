import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, findMatchCandidates } from "@/lib/crm/server";
import { normalizeEmail, normalizePhone, extractDomain } from "@/lib/crm/utils";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const type = sp.get("type"); // contacts | companies | all
  const companyId = sp.get("companyId");

  if (type === "companies") {
    const companies = await db.company.findMany({
      where: { deletedAt: null, ...(q ? { name: { contains: q } } : {}) },
      include: { contacts: { where: { deletedAt: null } }, _count: { select: { opportunities: true, projects: true, invoices: true } } },
      orderBy: { name: "asc" },
      take: 200,
    });
    return ok({ companies });
  }

  const contacts = await db.contact.findMany({
    where: {
      deletedAt: null,
      ...(companyId ? { companyId } : {}),
      ...(q ? {
        OR: [
          { fullName: { contains: q } },
          { email: { contains: q } },
          { whatsapp: { contains: q } },
          { position: { contains: q } },
        ],
      } : {}),
    },
    include: { company: true, _count: { select: { opportunities: true, interactions: true } } },
    orderBy: { fullName: "asc" },
    take: 200,
  });
  return ok({ contacts });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) return fail("Nama depan wajib diisi");

  const email = normalizeEmail(body.email ? String(body.email) : null);
  const whatsapp = normalizePhone(body.whatsapp ? String(body.whatsapp) : null);
  const phone = normalizePhone(body.phone ? String(body.phone) : null);

  // Company: pakai yang ada, atau buat baru jika companyName diberikan
  let companyId: string | null = body.companyId ? String(body.companyId) : null;
  if (!companyId && body.companyName) {
    const companyName = String(body.companyName).trim();
    const domain = extractDomain(body.companyWebsite ? String(body.companyWebsite) : null);
    let company = await db.company.findFirst({ where: { name: companyName, deletedAt: null } });
    if (!company) {
      company = await db.company.create({
        data: {
          name: companyName,
          industry: body.industry ? String(body.industry) : null,
          website: body.companyWebsite ? String(body.companyWebsite) : null,
          websiteDomain: domain,
          country: body.country ? String(body.country) : null,
          city: body.city ? String(body.city) : null,
        },
      });
      await logAudit({
        actorName: String(body.actorName ?? "System"), action: "create",
        entity: "company", entityId: company.id, entityLabel: company.name, req,
      });
    }
    companyId = company.id;
  }

  const contact = await db.contact.create({
    data: {
      firstName,
      lastName: lastName || null,
      fullName,
      position: body.position ? String(body.position) : null,
      email, emailAlt: body.emailAlt ? normalizeEmail(String(body.emailAlt)) : null,
      whatsapp, phone,
      country: body.country ? String(body.country) : null,
      city: body.city ? String(body.city) : null,
      timezone: body.timezone ? String(body.timezone) : null,
      language: body.language ? String(body.language) : "id",
      preferredChannel: body.preferredChannel ? String(body.preferredChannel) : "whatsapp",
      socialProfile: body.socialProfile ? String(body.socialProfile) : null,
      linkedin: body.linkedin ? String(body.linkedin) : null,
      instagram: body.instagram ? String(body.instagram).trim() : null,
      facebook: body.facebook ? String(body.facebook).trim() : null,
      tiktok: body.tiktok ? String(body.tiktok).trim() : null,
      tags: body.tags ? JSON.stringify(body.tags) : "[]",
      companyId,
    },
    include: { company: true },
  });

  await logAudit({
    actorName: String(body.actorName ?? "System"), actorRole: String(body.actorRole ?? "system"),
    action: "create", entity: "contact", entityId: contact.id, entityLabel: contact.fullName, req,
  });

  // Duplicate warnings
  const matches = await findMatchCandidates({
    email: contact.email, whatsapp: contact.whatsapp, phone: contact.phone,
    fullName: contact.fullName, companyName: contact.company?.name ?? null,
  });

  return ok({ contact, duplicateCandidates: matches.filter((m) => m.contactId !== contact.id && m.score >= 50) }, 201);
}
