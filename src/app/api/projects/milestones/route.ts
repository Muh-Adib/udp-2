import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { sendPushToRoles } from "@/lib/crm/push";
import { achievementFor } from "@/lib/crm/constants";

/**
 * Fase 3 — Update milestone (drag-reschedule deadline di kalender
 * Projects & perubahan status manual). Field opsional: dueDate, status, name.
 * Ronde 35 — PATCH juga menerima `achievement` (apa yang dicapai di milestone ini)
 * dan POST membuat milestone baru (tambah tahap produksi dari sheet project).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const projectId = String(body.projectId ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!projectId) return fail("projectId wajib diisi", 400);
  if (!name) return fail("Nama milestone wajib diisi", 400);

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, name: true, milestones: { orderBy: { order: "desc" }, take: 1 } },
  });
  if (!project) return fail("Project tidak ditemukan", 404);

  let dueDate: Date | null = null;
  if (body.dueDate) {
    const d = new Date(String(body.dueDate));
    if (Number.isNaN(d.getTime())) return fail("Tanggal tidak valid");
    dueDate = d;
  }

  const last = project.milestones[0];
  const order = (last?.order ?? -1) + 1;
  // Capaian default dari template — user tetap bisa override lewat body.achievement.
  const achievement = body.achievement ? String(body.achievement).trim() : achievementFor(name);

  const milestone = await db.milestone.create({
    data: {
      projectId,
      name,
      order,
      status: "pending",
      dueDate,
      achievement,
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "milestone",
    entityId: milestone.id,
    entityLabel: `${project.code} — ${milestone.name}`,
    newValue: JSON.stringify({ name, order, dueDate: dueDate?.toISOString() ?? null, achievement }),
    req,
  });

  return ok({ milestone }, 201);
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const milestoneId = body.milestoneId ? String(body.milestoneId) : "";
  if (!milestoneId) return fail("Milestone tidak ditemukan", 404);

  const existing = await db.milestone.findUnique({
    where: { id: milestoneId },
    include: { project: { include: { brand: true } } },
  });
  if (!existing) return fail("Milestone tidak ditemukan", 404);

  const data: { dueDate?: Date | null; status?: string; name?: string; achievement?: string | null } = {};
  const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];

  if (body.dueDate !== undefined) {
    const next = body.dueDate ? new Date(String(body.dueDate)) : null;
    if (next && Number.isNaN(next.getTime())) return fail("Tanggal tidak valid");
    data.dueDate = next;
    changes.push({
      field: "dueDate",
      oldValue: existing.dueDate?.toISOString() ?? null,
      newValue: next?.toISOString() ?? null,
    });
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["pending", "in_progress", "done"].includes(status)) return fail("Status milestone tidak valid");
    data.status = status;
    changes.push({ field: "status", oldValue: existing.status, newValue: status });
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return fail("Nama milestone wajib diisi");
    data.name = name;
    changes.push({ field: "name", oldValue: existing.name, newValue: name });
  }
  if (body.achievement !== undefined) {
    // Ronde 35 — capaian milestone bisa diisi/diubah (apa yang dicapai di tahap ini).
    const achievement = body.achievement ? String(body.achievement).trim() : null;
    data.achievement = achievement || null;
    changes.push({ field: "achievement", oldValue: existing.achievement, newValue: data.achievement });
  }

  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan");

  const milestone = await db.milestone.update({
    where: { id: milestoneId },
    data,
    include: { project: { include: { brand: true } } },
  });

  // Ronde 39 — push VAPID: milestone selesai → tim produksi & pimpinan
  if ((data as { status?: string }).status === "done") {
    void sendPushToRoles(
      ["production", "director", "super_admin"],
      {
        title: "Milestone selesai",
        body: `${milestone.name} — ${milestone.project.code} (${milestone.project.name})`,
        url: "/?modul=projects",
        tag: `ms-${milestone.id}`,
        type: "deadline",
      },
      actor.email
    ).catch(() => {});
  }

  const actorName = actor.name;
  await logAudit({
    actorName,
    actorRole: actor.role,
    action: "update",
    entity: "milestone",
    entityId: milestone.id,
    entityLabel: `${existing.project.code} — ${milestone.name}`,
    field: changes.map((c) => c.field).join(","),
    oldValue: JSON.stringify(Object.fromEntries(changes.map((c) => [c.field, c.oldValue]))),
    newValue: JSON.stringify(Object.fromEntries(changes.map((c) => [c.field, c.newValue]))),
    req,
  });

  return ok({ milestone });
}
