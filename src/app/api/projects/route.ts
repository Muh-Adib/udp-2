import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody, clampNum } from "@/lib/crm/server";

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

/**
 * Task 22-4 — POST: pembuatan project MANUAL (bukan dari opportunity Won).
 * Kode project dibuat dengan pola yang sama persis dengan handleWonTransition
 * (src/lib/crm/server.ts): PREFIX dari slug brand (3 char pertama, uppercase,
 * underscore di-strip) + tahun + counter 3 digit, dengan retry bila code sudah dipakai.
 * Milestone/invoice TIDAK dibuat otomatis (hanya alur Won).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const name = String(body.name ?? "").trim();
  const brandId = String(body.brandId ?? "").trim();
  const companyId = String(body.companyId ?? "").trim();
  if (!name) return fail("Nama project wajib diisi", 400);
  if (!brandId || !companyId) return fail("Brand dan perusahaan wajib dipilih", 400);

  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand) return fail("Brand tidak ditemukan", 404);
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return fail("Perusahaan tidak ditemukan", 404);

  // Kode project: pola identik dengan handleWonTransition + jaminan unik (retry counter).
  const year = new Date().getFullYear();
  const prefix = brand.slug.slice(0, 3).toUpperCase().replace("_", "");
  let counter = (await db.project.count()) + 1;
  let code = `${prefix}-${year}-${String(counter).padStart(3, "0")}`;
  while (await db.project.findUnique({ where: { code } })) {
    counter += 1;
    code = `${prefix}-${year}-${String(counter).padStart(3, "0")}`;
  }

  const status = body.status ? String(body.status) : "planning";
  const pmName = body.pmName ? String(body.pmName).trim() : null;
  const serviceCategory = body.serviceCategory ? String(body.serviceCategory) : null;
  const startDate = body.startDate ? new Date(String(body.startDate)) : null;
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;

  const project = await db.project.create({
    data: {
      code,
      name,
      brandId,
      companyId,
      serviceCategory,
      status,
      progress: 0,
      pmName,
      startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
      dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
      budgetInternal: Number(body.budgetInternal) || 0,
      contractValue: Number(body.contractValue) || 0,
    },
    include: { brand: true, company: true },
  });

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: body.actorRole ? String(body.actorRole) : "system",
    action: "create",
    entity: "project",
    entityId: project.id,
    entityLabel: name,
    newValue: JSON.stringify({ code: project.code, brand: brand.name, company: company.name, status }),
    req,
  });

  return ok({ project }, 201);
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  const id = String(body.id ?? "");
  if (!id) return ok({ error: "id wajib" }, 400);
  // Snapshot data lama untuk audit log perubahan deadline (pola sama dengan milestone reschedule)
  const existing = await db.project.findUnique({ where: { id }, select: { id: true, code: true, name: true, dueDate: true } });
  if (!existing) return fail("Project tidak ditemukan", 404);
  const data: Record<string, unknown> = {};
  // FIX r26: progress dipastikan angka 0–100 (dulu NaN/negatif/1000 lolos ke Prisma)
  if ("progress" in body) data.progress = clampNum(body.progress, 0, 100, 0);
  if ("status" in body) data.status = String(body.status);
  if ("pmName" in body) data.pmName = body.pmName ? String(body.pmName) : null;
  if ("budgetInternal" in body) data.budgetInternal = Number(body.budgetInternal);
  // Jadwalkan ulang deadline project (drag / dialog kalender) — ISO date string atau null
  if (body.dueDate !== undefined) {
    const next = body.dueDate ? new Date(String(body.dueDate)) : null;
    if (!next || Number.isNaN(next.getTime())) return fail("Tanggal deadline tidak valid");
    data.dueDate = next;
  }
  const project = await db.project.update({ where: { id }, data, include: { milestones: { orderBy: { order: "asc" } } } });
  if ("dueDate" in data) {
    await logAudit({
      actorName: String(body.actorName ?? "Produksi"),
      actorRole: String(body.actorRole ?? "production"),
      action: "update",
      entity: "project",
      entityId: project.id,
      entityLabel: `update project deadline (${existing.code} · ${existing.name})`,
      field: "dueDate",
      oldValue: JSON.stringify({ dueDate: existing.dueDate?.toISOString() ?? null }),
      newValue: JSON.stringify({ dueDate: (data.dueDate as Date).toISOString() }),
      req,
    });
  }
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
