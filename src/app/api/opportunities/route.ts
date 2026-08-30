import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { computeLeadScore } from "@/lib/crm/scoring";
import { normalizeEmail, normalizePhone } from "@/lib/crm/utils";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const stage = sp.get("stage");
  const brandId = sp.get("brandId");
  const q = sp.get("q");
  const owner = sp.get("owner");

  const where: Record<string, unknown> = { deletedAt: null };
  if (stage && stage !== "all") where.stage = stage;
  if (brandId && brandId !== "all") where.brandId = brandId;
  if (owner && owner !== "all") where.ownerName = owner;

  if (q) {
    where.OR = [
      { title: { contains: q } },
      { serviceName: { contains: q } },
      { contact: { is: { fullName: { contains: q } } } },
      { company: { is: { name: { contains: q } } } },
    ];
  }

  const opportunities = await db.opportunity.findMany({
    where,
    include: {
      brand: true,
      contact: { include: { company: true } },
      company: true,
      _count: { select: { interactions: true, tasks: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  // Lead scoring (Fase 4): hitung skor + alasan dari rule-based scoring lib.
  const enriched = opportunities.map((row) => {
    const result = computeLeadScore(
      {
        stage: row.stage,
        temperature: row.temperature,
        priority: row.priority,
        estimatedValue: row.estimatedValue,
        expectedCloseDate: row.expectedCloseDate ? row.expectedCloseDate.toISOString() : null,
        nextAction: row.nextAction,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      },
      { interactions: row._count.interactions, tasks: row._count.tasks }
    );
    return { ...row, score: result.score, scoreReasons: result.reasons, _count: row._count };
  });

  return ok({ opportunities: enriched });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const title = String(body.title ?? "").trim();
  const brandId = String(body.brandId ?? "");
  const contactId = String(body.contactId ?? "");
  if (!title || !brandId || !contactId) return fail("Title, brand, dan contact wajib diisi");

  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact) return fail("Contact tidak ditemukan", 404);

  const estimatedValue = body.estimatedValue ? Number(body.estimatedValue) : null;

  const opp = await db.opportunity.create({
    data: {
      title,
      brandId,
      contactId,
      companyId: contact.companyId ?? (body.companyId ? String(body.companyId) : null),
      serviceCategory: body.serviceCategory ? String(body.serviceCategory) : null,
      serviceName: body.serviceName ? String(body.serviceName) : null,
      leadSource: body.leadSource ? String(body.leadSource) : "manual",
      brief: body.brief ? String(body.brief) : null,
      estimatedValue,
      currency: body.currency ? String(body.currency) : "IDR",
      probability: body.probability ? Number(body.probability) : 20,
      expectedCloseDate: body.expectedCloseDate ? new Date(String(body.expectedCloseDate)) : null,
      ownerName: body.ownerName ? String(body.ownerName) : null,
      priority: body.priority ? String(body.priority) : "medium",
      stage: body.stage ? String(body.stage) : "new",
      temperature: body.temperature ? String(body.temperature) : "warm",
      nextAction: body.nextAction ? String(body.nextAction) : null,
      nextActionDate: body.nextActionDate ? new Date(String(body.nextActionDate)) : null,
      crossSellOfId: body.crossSellOfId ? String(body.crossSellOfId) : null,
    },
    include: { brand: true, contact: { include: { company: true } }, company: true },
  });

  // Auto-create follow-up task untuk lead baru
  if (opp.stage === "new") {
    await db.task.create({
      data: {
        title: `Follow-up 1: ${opp.title}`,
        type: "follow_up",
        priority: "high",
        assigneeName: opp.ownerName ?? "Belum ditentukan",
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        opportunityId: opp.id,
      },
    });
  }

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: String(body.actorRole ?? "system"),
    action: "create",
    entity: "opportunity",
    entityId: opp.id,
    entityLabel: opp.title,
    metadata: `Opportunity dibuat untuk brand ${opp.brand?.name ?? brandId}`,
    req,
  });

  return ok({ opportunity: opp }, 201);
}

/** Utility dipakai route lain */
export function normalizeIdentity(email?: string | null, phone?: string | null) {
  return { email: normalizeEmail(email), phone: normalizePhone(phone) };
}
