import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

/**
 * Fase 3 — Update milestone (digunakan drag-reschedule deadline di kalender
 * Projects & perubahan status manual). Field opsional: dueDate, status, name.
 */
export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  const milestoneId = body.milestoneId ? String(body.milestoneId) : "";
  if (!milestoneId) return fail("Milestone tidak ditemukan", 404);

  const existing = await db.milestone.findUnique({
    where: { id: milestoneId },
    include: { project: { include: { brand: true } } },
  });
  if (!existing) return fail("Milestone tidak ditemukan", 404);

  const data: { dueDate?: Date | null; status?: string; name?: string } = {};
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

  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan");

  const milestone = await db.milestone.update({
    where: { id: milestoneId },
    data,
    include: { project: { include: { brand: true } } },
  });

  const actorName = String(body.actorName ?? "Produksi");
  await logAudit({
    actorName,
    actorRole: String(body.actorRole ?? "production"),
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
