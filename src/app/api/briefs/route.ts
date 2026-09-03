import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import type { Prisma } from "@prisma/client";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 18 — Brief Builder (Fase 2): brief terstruktur per opportunity.
 *
 * GET  /api/briefs?opportunityId=&brandId=&status= — daftar brief (filter opsional).
 * POST /api/briefs — buat brief baru utk satu opportunity (1:1, code BRF-YYYY-####).
 */

/** Parse JSON array field yang tersimpan sebagai string; korup → fallback []. */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const opportunityId = sp.get("opportunityId");
  const brandId = sp.get("brandId");
  const status = sp.get("status");

  const where: Prisma.ClientBriefWhereInput = {};
  if (opportunityId) where.opportunityId = opportunityId;
  if (brandId) where.brandId = brandId;
  if (status) where.status = status;

  const rows = await db.clientBrief.findMany({
    where,
    include: {
      brand: { select: { id: true, name: true, slug: true, color: true } },
      opportunity: { select: { id: true, title: true, stage: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const briefs = rows.map((r) => ({
    ...r,
    serviceTypes: parseJsonArray<string>(r.serviceTypes),
    deliverables: parseJsonArray<{ name: string; qty: number; notes?: string }>(r.deliverables),
    references: parseJsonArray<{ label: string; url: string }>(r.references),
    opportunityTitle: r.opportunity?.title ?? null,
  }));

  return ok({ briefs });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : "";
  if (!opportunityId) return fail("opportunityId wajib diisi");

  const opp = await db.opportunity.findUnique({
    where: { id: opportunityId },
    include: { brand: true },
  });
  if (!opp) return fail("Opportunity tidak ditemukan", 404);

  const existing = await db.clientBrief.findUnique({ where: { opportunityId } });
  if (existing) return fail("Opportunity ini sudah punya brief", 409);

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : opp.title;

  const year = new Date().getFullYear();
  const count = await db.clientBrief.count();
  const code = `BRF-${year}-${String(count + 1).padStart(4, "0")}`;

  const serviceTypes = Array.isArray(body.serviceTypes)
    ? (body.serviceTypes as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const deliverables = Array.isArray(body.deliverables) ? body.deliverables : [];
  const references = Array.isArray(body.references) ? body.references : [];

  const brief = await db.clientBrief.create({
    data: {
      code,
      opportunityId,
      brandId: opp.brandId,
      title,
      serviceTypes: JSON.stringify(serviceTypes),
      objectives: typeof body.objectives === "string" ? body.objectives : null,
      targetAudience: typeof body.targetAudience === "string" ? body.targetAudience : null,
      keyMessages: typeof body.keyMessages === "string" ? body.keyMessages : null,
      deliverables: JSON.stringify(deliverables),
      timelineStart: typeof body.timelineStart === "string" && body.timelineStart ? new Date(body.timelineStart) : null,
      timelineEnd: typeof body.timelineEnd === "string" && body.timelineEnd ? new Date(body.timelineEnd) : null,
      budgetMin: typeof body.budgetMin === "number" && Number.isFinite(body.budgetMin) ? body.budgetMin : null,
      budgetMax: typeof body.budgetMax === "number" && Number.isFinite(body.budgetMax) ? body.budgetMax : null,
      currency: typeof body.currency === "string" ? body.currency : opp.currency,
      references: JSON.stringify(references),
      attachmentsNote: typeof body.attachmentsNote === "string" ? body.attachmentsNote : null,
      status: "draft",
      createdBy: actor.name,
    },
    include: {
      brand: { select: { id: true, name: true, slug: true, color: true } },
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "brief",
    entityId: brief.id,
    entityLabel: `buat brief (${brief.code} · ${brief.title})`,
    newValue: { code: brief.code, title: brief.title },
    req,
  });

  return ok({
    brief: {
      ...brief,
      serviceTypes: parseJsonArray<string>(brief.serviceTypes),
      deliverables: parseJsonArray(brief.deliverables),
      references: parseJsonArray(brief.references),
    },
  }, 201);
}
