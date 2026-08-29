import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/crm/server";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const companyId = sp.get("companyId");
  const brandId = sp.get("brandId");

  const projects = await db.project.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(companyId ? { companyId } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
    },
    include: {
      brand: true, company: true, milestones: { orderBy: { order: "asc" } }, opportunity: true,
      changeRequests: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok({ projects });
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  const id = String(body.id ?? "");
  if (!id) return ok({ error: "id wajib" }, 400);
  const data: Record<string, unknown> = {};
  if ("progress" in body) data.progress = Number(body.progress);
  if ("status" in body) data.status = String(body.status);
  if ("pmName" in body) data.pmName = body.pmName ? String(body.pmName) : null;
  if ("budgetInternal" in body) data.budgetInternal = Number(body.budgetInternal);
  const project = await db.project.update({ where: { id }, data, include: { milestones: { orderBy: { order: "asc" } } } });
  // Rekomputasi progress dari milestones jika status milestone diubah
  if ("milestoneId" in body && body.milestoneId) {
    await db.milestone.update({ where: { id: String(body.milestoneId) }, data: { status: String(body.milestoneStatus ?? "done") } });
    const ms = await db.milestone.findMany({ where: { projectId: id } });
    const done = ms.filter((m) => m.status === "done").length;
    const progress = Math.round((done / ms.length) * 100);
    await db.project.update({ where: { id }, data: { progress, status: progress === 100 ? "review" : undefined } });
  }
  return ok({ project });
}
