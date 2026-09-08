import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { parseTaskAssignees, parseTaskAttachments } from "@/lib/crm/task-parse";

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
  // Ronde 40 — multi-assignee: assignee utama ikut assignees[0]; fallback legacy assigneeName
  if ("assignees" in body) {
    const assignees = parseTaskAssignees(body.assignees ?? []);
    data.assignees = JSON.stringify(assignees);
    data.assigneeName = assignees[0] ?? ("assigneeName" in body && body.assigneeName ? String(body.assigneeName) : null);
  }
  if (!("assignees" in body) && "assigneeName" in body) {
    data.assigneeName = body.assigneeName ? String(body.assigneeName) : null;
  }
  // Ronde 40 — lampiran: tautan http(s) / file data URL ≤5MB, maks 5 (validasi ketat)
  if ("attachments" in body) {
    try {
      data.attachments = JSON.stringify(parseTaskAttachments(body.attachments ?? []));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Lampiran tidak valid", 400);
    }
  }
  // Ronde 40 — opportunityId boleh diubah; harus ada bila dikirim (null = lepas)
  if ("opportunityId" in body) {
    const oppId = body.opportunityId ? String(body.opportunityId) : null;
    if (oppId) {
      const opp = await db.opportunity.findUnique({ where: { id: oppId }, select: { id: true } });
      if (!opp) return fail("Opportunity tidak ditemukan", 400);
    }
    data.opportunityId = oppId;
  }
  // Ronde 36 (audit): dateOrNull — tanggal "garbage" kini null (sebelumnya 500)
  if ("dueDate" in body) data.dueDate = dateOrNull(body.dueDate);

  const task = await db.task.update({ where: { id }, data, include: { opportunity: { include: { brand: true } } } });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "task", entityId: id, entityLabel: task.title,
    field: body.status ? "status" : "task", oldValue: current.status, newValue: String(data.status ?? current.status), req,
  });
  return ok({ task });
}
