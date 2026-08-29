import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const approvals = await db.approvalRequest.findMany({
    where: status && status !== "all" ? { status } : {},
    include: { opportunity: { include: { brand: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  const pendingCount = await db.approvalRequest.count({ where: { status: "pending" } });
  return ok({ approvals, pendingCount });
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  const id = String(body.id ?? "");
  const decision = String(body.decision ?? "");
  const actorName = String(body.actorName ?? "System");
  const actorRole = String(body.actorRole ?? "director");
  const decisionNote = body.decisionNote ? String(body.decisionNote) : null;

  if (!id || !["approve", "reject"].includes(decision)) {
    return fail("id dan decision (approve/reject) wajib");
  }
  // Hanya direktur & super admin yang boleh memutuskan (sesuai matriks role)
  if (!["director", "super_admin"].includes(actorRole)) {
    return fail("Hanya Direktur atau Super Admin yang dapat memutuskan approval", 403);
  }

  const approval = await db.approvalRequest.findUnique({ where: { id } });
  if (!approval) return fail("Approval tidak ditemukan", 404);
  if (approval.status !== "pending") return fail(`Approval sudah diputuskan (${approval.status})`);

  const newStatus = decision === "approve" ? "approved" : "rejected";
  const updated = await db.approvalRequest.update({
    where: { id },
    data: { status: newStatus, decidedBy: actorName, decidedAt: new Date(), decisionNote },
  });

  // Terapkan ke entitas terkait
  if (approval.entityType === "estimation" && decision === "approve") {
    await db.estimation.update({
      where: { id: approval.entityId },
      data: { status: "approved", approvedBy: actorName, approvedAt: new Date() },
    });
  } else if (approval.entityType === "estimation") {
    await db.estimation.update({ where: { id: approval.entityId }, data: { status: "rejected" } });
  }

  await logAudit({
    actorName, actorRole, action: decision === "approve" ? "approve" : "reject",
    entity: "approval", entityId: id, entityLabel: approval.entityLabel,
    field: "status", oldValue: "pending", newValue: newStatus,
    metadata: decisionNote ?? undefined, req,
  });

  return ok({ approval: updated });
}
