import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const current = await db.task.findUnique({ where: { id } });
  if (!current) return fail("Task tidak ditemukan", 404);

  const data: Record<string, unknown> = {};
  if ("title" in body) data.title = String(body.title);
  if ("description" in body) data.description = body.description ? String(body.description) : null;
  if ("priority" in body) data.priority = String(body.priority);
  if ("status" in body) {
    data.status = String(body.status);
    data.completedAt = body.status === "done" ? new Date() : null;
  }
  if ("assigneeName" in body) data.assigneeName = body.assigneeName ? String(body.assigneeName) : null;
  if ("dueDate" in body) data.dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;

  const task = await db.task.update({ where: { id }, data, include: { opportunity: { include: { brand: true } } } });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "task", entityId: id, entityLabel: task.title,
    field: body.status ? "status" : "task", oldValue: current.status, newValue: String(data.status ?? current.status), req,
  });
  return ok({ task });
}
