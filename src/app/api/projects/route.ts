import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody, clampNum } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import { workflowFor, achievementFor } from "@/lib/crm/constants";
import { sendPushToRoles } from "@/lib/crm/push";

const PROJECT_INCLUDE: Prisma.ProjectInclude = {
  brand: true, company: true, milestones: { orderBy: { order: "asc" } }, opportunity: true,
  changeRequests: { orderBy: { createdAt: "desc" } },
  // Ronde 48 — brief klien ter-link (alur Won) untuk tim produksi di detail project.
  brief: true,
  // Ronde 52 — tugas produksi project (bisa menempel milestone timeline).
  tasks: { orderBy: [{ status: "asc" }, { dueDate: "asc" }] },
};

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
    include: PROJECT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return ok({ projects });
}

/**
 * Task 22-4 — POST: pembuatan project MANUAL (bukan dari opportunity Won).
 * Kode project dibuat dengan pola yang sama persis dengan handleWonTransition
 * (src/lib/crm/server.ts): PREFIX dari slug brand (3 char pertama, uppercase,
 * underscore di-strip) + tahun + counter 3 digit, dengan retry bila code sudah dipakai.
 * Ronde 38 — milestone kini OTOMATIS dibuat dari template workflow layanan
 * (workflowFor) seperti alur Won, sehingga project manual punya Alur Produksi;
 * project + milestone ditulis dalam SATU transaksi (atomic).
 * Invoice DP TETAP hanya untuk alur Won.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
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
  const safeStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;
  const safeDue = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;

  // Ronde 52 — project bisa lahir langsung dari opportunity (lead/peluang) + membawa
  // BREAKDOWN pekerjaan: daftar milestone {name, achievement, picName, durationDays, parallel}
  // sehingga "apa saja pekerjaannya, siapa yang bertanggung jawab, estimasi waktu, dan
  // paralel" langsung terlihat di timeline produksi.
  let opportunityId: string | null = null;
  if (body.opportunityId) {
    const opp = await db.opportunity.findUnique({
      where: { id: String(body.opportunityId) },
      select: { id: true, serviceCategory: true, estimatedValue: true },
    });
    if (!opp) return fail("Opportunity tidak ditemukan", 404);
    const taken = await db.project.findUnique({ where: { opportunityId: opp.id }, select: { id: true } });
    if (taken) return fail("Opportunity ini sudah punya project", 409);
    opportunityId = opp.id;
    if (!serviceCategory && opp.serviceCategory) body.serviceCategory = opp.serviceCategory;
  }

  // Ronde 52 — validasi breakdown milestone dari body (semua opsional kecuali name).
  interface BreakdownMs { name: string; achievement: string | null; picName: string | null; durationDays: number | null; parallel: boolean; dueDate: Date | null }
  let breakdown: BreakdownMs[] | null = null;
  if (Array.isArray(body.milestones) && body.milestones.length > 0) {
    if (body.milestones.length > 30) return fail("Maksimal 30 milestone");
    breakdown = [];
    for (const rawMs of body.milestones) {
      const m = (rawMs ?? {}) as Record<string, unknown>;
      const mName = String(m.name ?? "").trim();
      if (!mName) return fail("Nama milestone pada breakdown wajib diisi");
      let msDue: Date | null = null;
      if (m.dueDate) {
        const d = new Date(String(m.dueDate));
        if (!Number.isNaN(d.getTime())) msDue = d;
      }
      let dur: number | null = null;
      if (m.durationDays !== undefined && m.durationDays !== null && String(m.durationDays).trim() !== "") {
        const n = Number(m.durationDays);
        if (!Number.isFinite(n) || n < 0 || n > 3650) return fail(`Estimasi waktu milestone "${mName}" tidak valid`);
        dur = Math.round(n);
      }
      breakdown.push({
        name: mName.slice(0, 160),
        achievement: m.achievement ? String(m.achievement).trim().slice(0, 500) : null,
        picName: m.picName ? String(m.picName).trim().slice(0, 120) : null,
        durationDays: dur,
        parallel: m.parallel === true,
        dueDate: msDue,
      });
    }
  }

  // Ronde 38 — project + milestone dalam satu transaksi (atomic, pola handleWonTransition).
  const project = await db.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        code,
        name,
        brandId,
        companyId,
        opportunityId,
        serviceCategory: body.serviceCategory ? String(body.serviceCategory) : serviceCategory,
        status,
        progress: 0,
        pmName,
        startDate: safeStart,
        dueDate: safeDue,
        budgetInternal: Number(body.budgetInternal) || 0,
        contractValue: Number(body.contractValue) || 0,
      },
    });

    if (breakdown && breakdown.length > 0) {
      // Ronde 52 — milestone dari BREAKDOWN: due date dihitung berantai dari
      // durationDays (tahap paralel mulai bersamaan dgn tahap sebelumnya).
      const startMs = safeStart?.getTime() ?? Date.now();
      let cursor = startMs; // akhir tahap berurutan terakhir
      await tx.milestone.createMany({
        data: breakdown.map((m, i) => {
          let msStart = cursor;
          if (m.parallel) msStart = cursor; // paralel: mulai bersamaan dgn posisi kursor
          let msDue = m.dueDate;
          if (!msDue && m.durationDays != null) msDue = new Date(msStart + m.durationDays * 24 * 60 * 60 * 1000);
          if (!m.parallel && msDue) cursor = Math.max(cursor, msDue.getTime());
          return {
            projectId: created.id,
            name: m.name,
            order: i,
            status: i === 0 ? "in_progress" : "pending",
            dueDate: msDue,
            achievement: m.achievement ?? achievementFor(m.name),
            picName: m.picName,
            durationDays: m.durationDays,
            parallel: m.parallel,
          };
        }),
      });
    } else {
      // Milestone dari template workflow layanan — bila layanan dikenal.
      const flow = workflowFor(serviceCategory);
      if (flow.length > 0) {
        const startMs = safeStart?.getTime() ?? Date.now();
        const span = safeDue ? safeDue.getTime() - startMs : 60 * 24 * 60 * 60 * 1000;
        await tx.milestone.createMany({
          data: flow.map((mName, i) => ({
            projectId: created.id,
            name: mName,
            order: i,
            status: i === 0 ? "in_progress" : "pending",
            dueDate: new Date(startMs + ((i + 1) * span) / flow.length),
            achievement: achievementFor(mName),
          })),
        });
      }
    }

    // Ronde 52 — task yang sudah dibuat pada opportunity ikut pindah ke project
    // (terlihat di timeline produksi, bukan hilang setelah deal won).
    if (opportunityId) {
      await tx.task.updateMany({ where: { opportunityId, projectId: null }, data: { projectId: created.id } });
    }
    return created;
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "project",
    entityId: project.id,
    entityLabel: name,
    newValue: JSON.stringify({ code: project.code, brand: brand.name, company: company.name, status, milestones: breakdown?.length ?? workflowFor(serviceCategory).length }),
    req,
  });

  // Include paritas dengan GET agar UI bisa langsung membuka detail tanpa fetch ulang.
  const full = await db.project.findUnique({
    where: { id: project.id },
    include: PROJECT_INCLUDE,
  });
  return ok({ project: full }, 201);
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
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
      actorName: actor.name,
      actorRole: actor.role,
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
    // Ronde 48 — milestone selesai kini memberi notifikasi nyata lintas jalur:
    // produksi & pimpinan tahu tahapan beres, klien melihat progress di portal.
    if (String(body.milestoneStatus ?? "done") === "done") {
      const milestone = await db.milestone.findUnique({ where: { id: String(body.milestoneId) }, select: { name: true } });
      void sendPushToRoles(
        ["production", "manager", "director", "super_admin"],
        {
          title: "Milestone selesai ✅",
          body: `${project.code} — ${milestone?.name ?? "Milestone"} selesai (${progress}% keseluruhan)`,
          url: `/?modul=projects`,
          tag: `milestone:${body.milestoneId}`,
          type: "project",
        },
        actor.email
      ).catch(() => {});
    }
  }
  return ok({ project });
}
