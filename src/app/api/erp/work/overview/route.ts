import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { authWork } from "../_shared";

/**
 * Task 2-d — Work Engine: ringkasan KPI modul kerja.
 * GET /api/erp/work/overview → { templates, activeInstances, doneInstances,
 * activePeriods, pendingReviews, publishedThisMonth }.
 */

export async function GET(req: NextRequest) {
  const g = await authWork(req);
  if (!g.ok) return g.err;
  const actor = g.actor;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    templates,
    activeInstances,
    doneInstances,
    cancelledInstances,
    activePeriods,
    pendingReviews,
    publishedThisMonth,
  ] = await Promise.all([
    // KPI "Template aktif" di UI — hanya template yang masih aktif.
    db.workflowTemplate.count({ where: { active: true } }),
    db.workflowInstance.count({ where: { status: "active" } }),
    db.workflowInstance.count({ where: { status: "done" } }),
    db.workflowInstance.count({ where: { status: "cancelled" } }),
    db.workPeriod.count({ where: { status: "active" } }),
    db.deliverableVersion.count({ where: { status: { in: ["internal_review", "client_review"] } } }),
    db.deliverableVersion.count({ where: { status: "published", publishedAt: { gte: monthStart } } }),
  ]);

  return ok({
    templates,
    activeInstances,
    doneInstances,
    cancelledInstances,
    activePeriods,
    pendingReviews,
    publishedThisMonth,
  });
}
