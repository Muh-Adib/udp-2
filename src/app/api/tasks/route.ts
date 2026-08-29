import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

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
  const title = String(body.title ?? "").trim();
  if (!title) return fail("Judul task wajib diisi");

  const task = await db.task.create({
    data: {
      title,
      description: body.description ? String(body.description) : null,
      type: body.type ? String(body.type) : "follow_up",
      priority: body.priority ? String(body.priority) : "medium",
      status: "open",
      assigneeName: body.assigneeName ? String(body.assigneeName) : null,
      dueDate: body.dueDate ? new Date(String(body.dueDate)) : null,
      opportunityId: body.opportunityId ? String(body.opportunityId) : null,
    },
    include: { opportunity: { include: { brand: true } } },
  });

  await logAudit({
    actorName: String(body.actorName ?? "System"), actorRole: String(body.actorRole ?? "system"),
    action: "create", entity: "task", entityId: task.id, entityLabel: task.title, req,
  });
  return ok({ task }, 201);
}
