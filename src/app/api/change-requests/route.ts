import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, fail, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

const DAY = 24 * 60 * 60 * 1000;

/** Roles yang boleh memutuskan (menyetujui/menolak) change request. */
function canDecide(role: string) {
  return ["director", "super_admin", "client"].includes(role);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const companyId = sp.get("companyId");
  const status = sp.get("status");

  const crs = await db.changeRequest.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(companyId ? { project: { companyId } } : {}),
      ...(status && status !== "all" ? { status } : {}),
    },
    include: {
      project: { select: { id: true, code: true, name: true, status: true, dueDate: true, brand: true, company: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok({ changeRequests: crs });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const projectId = String(body.projectId ?? "");
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const additionalCost = Number(body.additionalCost ?? 0);
  const additionalDays = Math.max(0, Math.round(Number(body.additionalDays ?? 0)));
  const requestedBy = String(body.requestedBy ?? "Unknown");

  if (!projectId) return fail("projectId wajib diisi", 400);
  if (!title) return fail("Judul change request wajib diisi", 400);
  if (!description) return fail("Deskripsi perubahan scope wajib diisi", 400);
  if (!Number.isFinite(additionalCost) || additionalCost < 0) return fail("Biaya tambahan tidak valid", 400);

  const project = await db.project.findUnique({ where: { id: projectId }, include: { brand: true, company: true } });
  if (!project) return fail("Project tidak ditemukan", 404);
  if (project.status === "completed" || project.status === "cancelled") {
    return fail("Change request hanya bisa dibuat untuk project yang masih berjalan", 400);
  }

  // Nomor CR berurutan per tahun: CR-2026-0001
  const year = new Date().getFullYear();
  const count = await db.changeRequest.count();
  let number = `CR-${year}-${String(count + 1).padStart(4, "0")}`;
  // Tahan tabrakan nomor (unique) hingga 5 percobaan
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await db.changeRequest.findUnique({ where: { number } });
    if (!exists) break;
    number = `CR-${year}-${String(count + attempt + 2).padStart(4, "0")}`;
  }

  const cr = await db.changeRequest.create({
    data: {
      number, projectId, title, description,
      additionalCost: Math.round(additionalCost),
      additionalDays,
      status: "pending",
      requestedBy,
    },
    include: {
      project: { select: { id: true, code: true, name: true, status: true, dueDate: true, brand: true, company: true } },
    },
  });

  await logAudit({
    actorName: requestedBy,
    actorRole: actor.role,
    action: "create",
    entity: "change_request",
    entityId: cr.id,
    entityLabel: `${cr.number} — ${cr.title}`,
    metadata: `Change request diajukan untuk project ${project.code}: +Rp ${cr.additionalCost.toLocaleString("id-ID")}, +${cr.additionalDays} hari`,
    req,
  });

  return ok({ changeRequest: cr }, 201);
}

export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const id = String(body.id ?? "");
  const decision = String(body.decision ?? ""); // approve | reject | cancel
  const actorName = actor.name;
  const actorRole = actor.role;
  const decisionNote = body.decisionNote ? String(body.decisionNote) : null;

  if (!id) return fail("id wajib diisi", 400);
  if (!["approve", "reject", "cancel"].includes(decision)) return fail("decision harus approve/reject/cancel", 400);

  const cr = await db.changeRequest.findUnique({
    where: { id },
    include: { project: { include: { brand: true, company: true } } },
  });
  if (!cr) return fail("Change request tidak ditemukan", 404);

  // Cancel boleh oleh pengaju mana pun; approve/reject hanya role berwenang
  if (decision !== "cancel" && (!actorRole || !canDecide(actorRole))) {
    return fail("Hanya Direktur, Super Admin, atau klien yang bisa memutuskan change request", 403);
  }
  if (cr.status !== "pending") {
    return fail(`Change request sudah diputuskan (status: ${cr.status})`, 400);
  }

  // ============ REJECT / CANCEL ============
  if (decision !== "approve") {
    const newStatus = decision === "reject" ? "rejected" : "cancelled";
    const updated = await db.changeRequest.update({
      where: { id },
      data: { status: newStatus, decidedBy: actorName, decidedAt: new Date(), decisionNote },
      include: { project: { select: { id: true, code: true, name: true, status: true, dueDate: true, brand: true, company: true } } },
    });
    await logAudit({
      actorName, actorRole, action: "update", entity: "change_request", entityId: cr.id,
      entityLabel: `${cr.number} — ${cr.title}`, field: "status",
      oldValue: "pending", newValue: newStatus, metadata: decisionNote ?? undefined, req,
    });
    return ok({ changeRequest: updated });
  }

  // ============ APPROVE: naikkan nilai kontrak + geser deadline + buat invoice tambahan ============
  const project = cr.project;
  const newDue = cr.additionalDays > 0 && project.dueDate
    ? new Date(new Date(project.dueDate).getTime() + cr.additionalDays * DAY)
    : undefined;

  const result = await db.$transaction(async (tx) => {
    const u = await tx.changeRequest.update({
      where: { id },
      data: { status: "approved", decidedBy: actorName, decidedAt: new Date(), decisionNote },
      include: { project: { select: { id: true, code: true, name: true, status: true, dueDate: true, brand: true, company: true } } },
    });

    await tx.project.update({
      where: { id: cr.projectId },
      data: {
        contractValue: { increment: cr.additionalCost },
        ...(newDue ? { dueDate: newDue } : {}),
      },
    });

    // Invoice tambahan (draft) — nomor mengikuti counter invoice brand
    let invNumber = "";
    let created: { id: string; number: string } | null = null;
    if (cr.additionalCost > 0) {
      const year = new Date().getFullYear();
      const invCount = await tx.invoice.count({ where: { brandId: project.brandId } });
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = `${project.brand.invoicePrefix}-${year}-INV-${String(invCount + attempt + 1).padStart(3, "0")}`;
        const exists = await tx.invoice.findUnique({ where: { number: candidate } });
        if (!exists) { invNumber = candidate; break; }
      }
      if (invNumber) {
        const taxRate = 11;
        const taxAmount = Math.round(cr.additionalCost * (taxRate / 100));
        created = await tx.invoice.create({
          data: {
            number: invNumber,
            brandId: project.brandId,
            companyId: project.companyId,
            projectId: project.id,
            opportunityId: project.opportunityId,
            description: `Invoice tambahan — Change Request ${cr.number}: ${cr.title}`,
            amount: cr.additionalCost,
            taxRate, taxAmount,
            total: cr.additionalCost + taxAmount,
            currency: "IDR",
            status: "draft",
            issueDate: new Date(),
            dueDate: new Date(Date.now() + 14 * DAY),
            notes: `Dibuat otomatis dari change request ${cr.number} (disetujui oleh ${actorName})`,
          },
        });
        await tx.changeRequest.update({ where: { id }, data: { invoiceId: created.id } });
      }
    }
    return { updated: u, invoice: created };
  });

  await logAudit({
    actorName, actorRole, action: "update", entity: "change_request", entityId: cr.id,
    entityLabel: `${cr.number} — ${cr.title}`, field: "status",
    oldValue: "pending", newValue: "approved",
    metadata: `Kontrak +Rp ${cr.additionalCost.toLocaleString("id-ID")}, deadline +${cr.additionalDays} hari${result.invoice ? `, invoice ${result.invoice.number} dibuat` : ""}`,
    req,
  });
  if (result.invoice) {
    await logAudit({
      actorName, actorRole, action: "create", entity: "invoice", entityId: result.invoice.id,
      entityLabel: result.invoice.number, metadata: `Invoice tambahan dari change request ${cr.number}`, req,
    });
  }

  return ok({ changeRequest: { ...result.updated, invoiceId: result.invoice?.id ?? result.updated.invoiceId }, invoice: result.invoice });
}
