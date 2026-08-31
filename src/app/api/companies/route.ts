import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { extractDomain } from "@/lib/crm/utils";
import { resolveActor } from "@/lib/crm/auth";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const companies = await db.company.findMany({
    where: { deletedAt: null, ...(q ? { name: { contains: q } } : {}) },
    include: {
      contacts: { where: { deletedAt: null }, take: 5 },
      _count: { select: { opportunities: true, projects: true, invoices: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return ok({ companies });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama perusahaan wajib diisi");
  const website = body.website ? String(body.website) : null;
  const company = await db.company.create({
    data: {
      name,
      industry: body.industry ? String(body.industry) : null,
      website,
      websiteDomain: extractDomain(website),
      country: body.country ? String(body.country) : null,
      city: body.city ? String(body.city) : null,
      address: body.address ? String(body.address) : null,
      size: body.size ? String(body.size) : null,
      taxId: body.taxId ? String(body.taxId) : null,
      defaultCurrency: body.defaultCurrency ? String(body.defaultCurrency) : "IDR",
      notes: body.notes ? String(body.notes) : null,
    },
  });
  await logAudit({
    actorName: actor.name, action: "create",
    entity: "company", entityId: company.id, entityLabel: company.name, req,
  });
  return ok({ company }, 201);
}
