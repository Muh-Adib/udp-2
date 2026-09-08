import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, handleWonTransition, numOrNull, clampNum, dateOrNull } from "@/lib/crm/server";
import { computeLeadScore } from "@/lib/crm/scoring";
import { resolveActor } from "@/lib/crm/auth";
import { sendPushToRoles } from "@/lib/crm/push";

/** Hitung skor lead + sisipkan score/scoreReasons/_count ke row opportunity Prisma. */
function enrichScore<
  T extends {
    stage: string;
    temperature: string;
    priority: string;
    estimatedValue: number | null;
    expectedCloseDate: Date | null;
    nextAction: string | null;
    updatedAt: Date;
    createdAt: Date;
    _count: { interactions: number; tasks: number };
  }
>(row: T) {
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
  return { ...row, score: result.score, scoreReasons: result.reasons };
}

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
      // Ronde 40 — approval estimasi yang menunggu keputusan (tombol keputusan di detail)
      approvals: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { interactions: true, tasks: true } },
    },
  });
  if (!opportunity) return fail("Opportunity tidak ditemukan", 404);

  // Related opportunities (same company, other brands)
  let related: unknown[] = [];
  if (opportunity.companyId) {
    const relatedRows = await db.opportunity.findMany({
      where: { companyId: opportunity.companyId, id: { not: id }, deletedAt: null },
      include: { brand: true, _count: { select: { interactions: true, tasks: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    related = relatedRows.map((row) => enrichScore(row));
  }

  const enrichedOpportunity = enrichScore(opportunity);

  // Ronde 40 — approvals di-rename ke pendingApprovals sesuai OpportunityDTO
  const { approvals, ...oppRest } = enrichedOpportunity;
  const pendingApprovals = approvals.map((a) => ({
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    entityLabel: a.entityLabel,
    amount: a.amount,
    requestedBy: a.requestedBy,
    status: a.status,
  }));

  return ok({ opportunity: { ...oppRest, pendingApprovals }, related });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const actorName = actor.name;
  const actorRole = actor.role;

  const current = await db.opportunity.findUnique({ where: { id }, include: { brand: true } });
  if (!current) return fail("Opportunity tidak ditemukan", 404);

  // Ronde 39 — editing sesuai user: hanya pemilik opportunity atau pimpinan
  // (super_admin/director) yang boleh mengubah; role lain (finance/production) read-only.
  const isLeadership = actorRole === "super_admin" || actorRole === "director";
  if (!isLeadership && current.ownerName !== actorName) {
    return fail("Hanya pemilik opportunity atau pimpinan yang dapat mengubah opportunity ini", 403);
  }
  // Ganti pemilik (ownerName) hanya boleh oleh pimpinan — anti self-assign oleh non-pimpinan.
  if (!isLeadership && "ownerName" in body && body.ownerName !== current.ownerName) {
    return fail("Hanya pimpinan yang dapat mengganti pemilik opportunity", 403);
  }

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
      // FIX r26: tanggal invalid → null (jangan Invalid Date masuk Prisma → 500)
      value = dateOrNull(value);
    }
    if (["estimatedValue", "lastOfferValue"].includes(field)) {
      const n = numOrNull(value);
      // FIX r26: NaN dulu lolos → Prisma error 500; nilai tak-valid jadi null
      value = value === null || value === "" ? null : n;
    }
    if (field === "probability") {
      const n = numOrNull(value);
      value = n === null ? null : clampNum(n, 0, 100, 20); // FIX r26: probabilitas 0–100
    }
    if (field === "reactivation") value = Boolean(value);
    const old = (current as unknown as Record<string, unknown>)[field];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
    if (norm(old) !== norm(value)) {
      data[field] = value;
      changes.push({ field, oldValue: old, newValue: value });
    }
  }

  // Ronde 42 — SATU PINTU perubahan relasi: ganti brand/kontak HANYA oleh pimpinan
  // (super_admin/director). Role lain ditolak 403 — UI menampilkan tooltip otorisasi.
  if ("brandId" in body || "contactId" in body) {
    if (!isLeadership) {
      return fail("Hanya Direktur/Admin yang dapat mengubah brand atau kontak opportunity", 403);
    }
    if ("brandId" in body) {
      const brandId = body.brandId ? String(body.brandId) : "";
      if (!brandId) return fail("Brand wajib dipilih");
      const brand = await db.brand.findUnique({ where: { id: brandId } });
      if (!brand) return fail("Brand tidak ditemukan", 400);
      if (brandId !== current.brandId) {
        data.brandId = brandId;
        changes.push({ field: "brand", oldValue: current.brand?.name ?? current.brandId, newValue: brand.name });
        // Mata uang mengikuti brand baru bila masih memakai mata uang brand lama (atau kosong)
        if (!current.currency || current.currency === current.brand?.primaryCurrency) {
          data.currency = brand.primaryCurrency;
        }
      }
    }
    if ("contactId" in body) {
      const contactId = body.contactId ? String(body.contactId) : "";
      if (!contactId) return fail("Kontak wajib dipilih");
      const contact = await db.contact.findUnique({ where: { id: contactId } });
      if (!contact) return fail("Kontak tidak ditemukan", 400);
      if (contactId !== current.contactId) {
        data.contactId = contactId;
        // Perusahaan ikut kontak baru (denormalisasi konsisten)
        if (contact.companyId) data.companyId = contact.companyId;
        changes.push({ field: "contact", oldValue: current.contactId, newValue: contactId });
      }
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
    // Ronde 39 — push VAPID: direktur & super admin tahu deal baru Won
    void sendPushToRoles(
      ["director", "super_admin"],
      {
        title: "Deal Won 🎉",
        body: `${opportunity.title} — project ${createdProject?.code ?? "?"} dibuat beserta invoice DP`,
        url: "/?modul=projects",
        tag: `won-${id}`,
        type: "opportunity",
      },
      actor.email
    ).catch(() => {});
  }

  return ok({ opportunity, createdProject });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Ronde 27: identitas aktor diambil dari sesi (cookie).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  // Ronde 39 — hapus opportunity hanya boleh pimpinan (dulu semua role bisa).
  if (actor.role !== "super_admin" && actor.role !== "director") {
    return fail("Hanya pimpinan yang dapat menghapus opportunity", 403);
  }
  const { id } = await params;
  const current = await db.opportunity.findUnique({ where: { id } });
  if (!current) return fail("Opportunity tidak ditemukan", 404);
  await db.opportunity.update({ where: { id }, data: { deletedAt: new Date() } });
  await logAudit({
    actorName: actor.name, action: "delete", entity: "opportunity", entityId: id,
    entityLabel: current.title, metadata: "Soft delete opportunity", req,
  });
  return ok({ deleted: true });
}
