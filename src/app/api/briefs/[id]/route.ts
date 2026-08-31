import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import type { Prisma } from "@prisma/client";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 18 — Brief Builder (Fase 2): brief terstruktur per opportunity.
 *
 * GET    /api/briefs/:id — detail brief.
 * PATCH  /api/briefs/:id — update field (action "save", status draft/revision)
 *                          ATAU transisi status: submit | approve | request_revision | reopen.
 * DELETE /api/briefs/:id — hapus brief (hanya saat masih draft).
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

/** Transisi status yang sah: dari → [tujuan yang diizinkan]. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["in_review"],
  revision: ["in_review", "draft"],
  in_review: ["approved", "revision"],
  approved: ["draft"], // buka ulang (mis. brief tidak lagi relevan utk direvisi)
};

/** Include bersama agar tipe row konsisten antara load & update. */
const briefInclude = {
  brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } },
  opportunity: { select: { id: true, title: true, stage: true } },
} satisfies Prisma.ClientBriefInclude;

async function loadBrief(id: string) {
  return db.clientBrief.findUnique({
    where: { id },
    include: briefInclude,
  });
}

function serialize(brief: NonNullable<Awaited<ReturnType<typeof loadBrief>>>) {
  return {
    ...brief,
    serviceTypes: parseJsonArray<string>(brief.serviceTypes),
    deliverables: parseJsonArray<{ name: string; qty: number; notes?: string }>(brief.deliverables),
    references: parseJsonArray<{ label: string; url: string }>(brief.references),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = await loadBrief(id);
  if (!brief) return fail("Brief tidak ditemukan", 404);
  return ok({ brief: serialize(brief) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const brief = await loadBrief(id);
  if (!brief) return fail("Brief tidak ditemukan", 404);

  const actorName = actor.name;
  const actorRole = actor.role;
  const action = typeof body.action === "string" ? body.action : "save";

  // ---------- Transisi status ----------
  if (action !== "save") {
    const from = brief.status;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    const targetMap: Record<string, string> = {
      submit: "in_review",
      approve: "approved",
      request_revision: "revision",
      reopen: "draft",
    };
    const to = targetMap[action];
    if (!to) return fail(`Aksi tidak dikenal: ${action}`, 400);
    if (!allowed.includes(to)) {
      return fail(`Transisi status tidak diizinkan: ${from} → ${to}`, 422);
    }

    const data: Record<string, unknown> = { status: to };
    if (action === "submit") {
      data.submittedAt = new Date();
      data.revisionNote = null;
    }
    if (action === "approve") {
      data.approvedAt = new Date();
      data.approvedBy = actorName;
    }
    if (action === "request_revision") {
      const note = typeof body.revisionNote === "string" ? body.revisionNote.trim() : "";
      if (!note) return fail("Catatan revisi wajib diisi");
      data.revisionNote = note;
    }
    if (action === "reopen") {
      data.approvedAt = null;
      data.approvedBy = null;
      data.submittedAt = null;
    }

    const updated = await db.clientBrief.update({ where: { id }, data, include: briefInclude });
    await logAudit({
      actorName,
      actorRole,
      action: action === "approve" ? "approve" : action === "request_revision" ? "update" : "update",
      entity: "brief",
      entityId: id,
      entityLabel: `brief ${updated.code} — status ${from} → ${to}`,
      field: "status",
      oldValue: { status: from },
      newValue: { status: to, revisionNote: updated.revisionNote ?? null },
      req,
    });
    // Ratakan opportunity (updatedAt) agar urutan aktivitas ikut segar.
    await db.opportunity.update({ where: { id: brief.opportunityId }, data: { updatedAt: new Date() } });
    return ok({ brief: serialize(updated) });
  }

  // ---------- Simpan field (hanya saat draft / revision) ----------
  if (brief.status === "approved") {
    return fail("Brief sudah disetujui — buka ulang dulu bila ingin mengubah", 422);
  }

  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (Array.isArray(body.serviceTypes)) {
    data.serviceTypes = JSON.stringify((body.serviceTypes as unknown[]).filter((s): s is string => typeof s === "string"));
  }
  if ("objectives" in body) data.objectives = typeof body.objectives === "string" ? body.objectives : null;
  if ("targetAudience" in body) data.targetAudience = typeof body.targetAudience === "string" ? body.targetAudience : null;
  if ("keyMessages" in body) data.keyMessages = typeof body.keyMessages === "string" ? body.keyMessages : null;
  if (Array.isArray(body.deliverables)) data.deliverables = JSON.stringify(body.deliverables);
  if (Array.isArray(body.references)) data.references = JSON.stringify(body.references);
  if ("timelineStart" in body) data.timelineStart = typeof body.timelineStart === "string" && body.timelineStart ? new Date(body.timelineStart) : null;
  if ("timelineEnd" in body) data.timelineEnd = typeof body.timelineEnd === "string" && body.timelineEnd ? new Date(body.timelineEnd) : null;
  if ("budgetMin" in body) data.budgetMin = typeof body.budgetMin === "number" && Number.isFinite(body.budgetMin) ? body.budgetMin : null;
  if ("budgetMax" in body) data.budgetMax = typeof body.budgetMax === "number" && Number.isFinite(body.budgetMax) ? body.budgetMax : null;
  if ("attachmentsNote" in body) data.attachmentsNote = typeof body.attachmentsNote === "string" ? body.attachmentsNote : null;

  if (Object.keys(data).length === 0) {
    return fail("Tidak ada field yang diubah");
  }

  const updated = await db.clientBrief.update({ where: { id }, data, include: briefInclude });
  await logAudit({
    actorName,
    actorRole,
    action: "update",
    entity: "brief",
    entityId: id,
    entityLabel: `update brief (${updated.code} · ${updated.title})`,
    field: "fields",
    newValue: { fields: Object.keys(data) },
    req,
  });
  await db.opportunity.update({ where: { id: brief.opportunityId }, data: { updatedAt: new Date() } });
  return ok({ brief: serialize(updated) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Ronde 27: identitas aktor diambil dari sesi (cookie).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const { id } = await params;
  const brief = await db.clientBrief.findUnique({ where: { id } });
  if (!brief) return fail("Brief tidak ditemukan", 404);
  if (brief.status !== "draft") {
    return fail("Hanya brief berstatus draft yang boleh dihapus", 422);
  }

  await db.clientBrief.delete({ where: { id } });
  await logAudit({
    actorName: actor.name,
    actorRole: "marketing",
    action: "delete",
    entity: "brief",
    entityId: id,
    entityLabel: `hapus brief (${brief.code} · ${brief.title})`,
    oldValue: { code: brief.code, title: brief.title },
    req,
  });
  return ok({ ok: true });
}
