import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, handleWonTransition } from "@/lib/crm/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunity = await db.opportunity.findUnique({
    where: { id },
    include: {
      brand: true,
      contact: { include: { company: true } },
      company: true,
      interactions: { orderBy: { createdAt: "asc" } },
      tasks: { orderBy: { dueDate: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      projects: { include: { milestones: { orderBy: { order: "asc" } } } },
      invoices: { include: { payments: true } },
      estimation: true,
      quotations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!opportunity) return fail("Opportunity tidak ditemukan", 404);

  // Related opportunities (same company, other brands)
  let related: unknown[] = [];
  if (opportunity.companyId) {
    related = await db.opportunity.findMany({
      where: { companyId: opportunity.companyId, id: { not: id }, deletedAt: null },
      include: { brand: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
  }

  return ok({ opportunity, related });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "system");

  const current = await db.opportunity.findUnique({ where: { id }, include: { brand: true } });
  if (!current) return fail("Opportunity tidak ditemukan", 404);

  const updatable = [
    "title", "serviceCategory", "serviceName", "leadSource", "brief", "requirements",
    "targetAudience", "deliverables", "estimatedValue", "currency", "probability",
    "ownerName", "priority", "stage", "temperature", "competitor", "nextAction",
    "lostReason", "lostNotes", "lastOfferValue", "nurtureSegment", "followUpDate",
    "expectedCloseDate", "targetDeadline", "nextActionDate", "reactivation",
  ];
  const data: Record<string, unknown> = {};
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];

  for (const field of updatable) {
    if (!(field in body)) continue;
    let value = body[field];
    if (["expectedCloseDate", "targetDeadline", "nextActionDate", "followUpDate"].includes(field)) {
      value = value ? new Date(String(value)) : null;
    }
    if (["estimatedValue", "lastOfferValue", "probability"].includes(field)) {
      value = value === null || value === "" ? null : Number(value);
    }
    if (field === "reactivation") value = Boolean(value);
    const old = (current as unknown as Record<string, unknown>)[field];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
    if (norm(old) !== norm(value)) {
      data[field] = value;
      changes.push({ field, oldValue: old, newValue: value });
    }
  }

  if (body.stage && body.stage !== current.stage) {
    const newStage = String(body.stage);
    if (newStage === "lost") {
      const reason = String(body.lostReason ?? current.lostReason ?? "").trim();
      if (!reason) return fail("Lost reason wajib dipilih sebelum pindah ke stage Lost");
      data.lostReason = reason;
    }
    if (current.stage === "lost" || current.stage === "nurture") {
      data.reactivation = true;
    }
  }

  const opportunity = await db.opportunity.update({
    where: { id },
    data,
    include: { brand: true, contact: { include: { company: true } }, company: true },
  });

  for (const ch of changes) {
    await logAudit({
      actorName, actorRole,
      action: ch.field === "stage" ? "stage_change" : "update",
      entity: "opportunity",
      entityId: id,
      entityLabel: opportunity.title,
      field: ch.field,
      oldValue: ch.oldValue,
      newValue: ch.newValue,
      req,
    });
  }

  // Won → auto create project + milestones + DP invoice
  let createdProject: Awaited<ReturnType<typeof handleWonTransition>> = null;
  if (data.stage === "won" && current.stage !== "won") {
    createdProject = await handleWonTransition(id);
    await logAudit({
      actorName, actorRole,
      action: "create",
      entity: "project",
      entityId: createdProject?.id ?? id,
      entityLabel: createdProject?.code ?? opportunity.title,
      metadata: "Project otomatis dibuat dari opportunity Won beserta milestone & invoice DP",
      req,
    });
  }

  return ok({ opportunity, createdProject });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await db.opportunity.findUnique({ where: { id } });
  if (!current) return fail("Opportunity tidak ditemukan", 404);
  await db.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
  await logAudit({
    actorName: "System", action: "delete", entity: "opportunity", entityId: id,
    entityLabel: current.title, metadata: "Soft delete opportunity", req,
  });
  return ok({ deleted: true });
}
