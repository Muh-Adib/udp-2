import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, dateOrNull } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { parseTaskAssignees, parseTaskAttachments } from "@/lib/crm/task-parse";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const assignee = sp.get("assignee");
  const overdue = sp.get("overdue");

  const tasks = await db.task.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(assignee && assignee !== "all" ? { assigneeName: assignee } : {}),
      ...(overdue === "true" ? { dueDate: { lt: new Date() } } : {}),
    },
    include: { opportunity: { include: { brand: true, contact: true } } },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    take: 300,
  });
  return ok({ tasks });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const title = String(body.title ?? "").trim();
  if (!title) return fail("Judul task wajib diisi");

  // Ronde 40 — multi-assignee + lampiran: array | JSON string, divalidasi ketat.
  const assignees = parseTaskAssignees(body.assignees ?? []);
  let attachments: ReturnType<typeof parseTaskAttachments> = [];
  try {
    attachments = parseTaskAttachments(body.attachments ?? []);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Lampiran tidak valid", 400);
  }

  // Ronde 40 — opportunityId opsional TAPI harus ada bila dikirim.
  let opportunityId: string | null = null;
  if (body.opportunityId) {
    const opp = await db.opportunity.findUnique({
      where: { id: String(body.opportunityId) },
      select: { id: true },
    });
    if (!opp) return fail("Opportunity tidak ditemukan", 400);
    opportunityId = String(body.opportunityId);
  }

  const task = await db.task.create({
    data: {
      title,
      description: body.description ? String(body.description) : null,
      type: body.type ? String(body.type) : "follow_up",
      priority: body.priority ? String(body.priority) : "medium",
      status: "open",
      // Ronde 40 — assignee utama = assignees[0]; fallback legacy body.assigneeName
      assigneeName: assignees[0] ?? (body.assigneeName ? String(body.assigneeName) : null),
      assignees: JSON.stringify(assignees),
      attachments: JSON.stringify(attachments),
      // Ronde 36 (audit): dateOrNull — tanggal "garbage" kini null (sebelumnya 500)
      dueDate: dateOrNull(body.dueDate),
      opportunityId,
    },
    include: { opportunity: { include: { brand: true } } },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "task", entityId: task.id, entityLabel: task.title, req,
  });
  return ok({ task }, 201);
}
