import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { authWork } from "../_shared";

/**
 * Task 2-d — Work Engine: daftar ProjectDeliverable + semua versi (desc).
 * GET /api/erp/work/deliverables?projectId=&status= → deliverables + versions desc + project.
 */

export async function GET(req: NextRequest) {
  const g = await authWork(req);
  if (!g.ok) return g.err;
  const actor = g.actor;
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const status = sp.get("status");

  const deliverables = await db.projectDeliverable.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(status && status !== "all" ? { status } : {}),
    },
    include: {
      project: {
        select: {
          id: true, code: true, name: true, brandId: true,
          brand: { select: { id: true, name: true, color: true } },
        },
      },
      versions: { orderBy: { version: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok({ deliverables });
}
