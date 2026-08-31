import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

const COST_FIELDS = [
  "laborInternal", "vendorFreelance", "equipment", "transport", "accommodation",
  "talent", "locationFee", "softwareLicense", "hostingDomain",
] as const;

const PCT_FIELDS = [
  "contingencyPct", "managementFeePct", "discountPct", "taxPct", "targetMarginPct",
] as const;

function compute(input: Record<string, number>) {
  const totalCost = COST_FIELDS.reduce((s, f) => s + (input[f] ?? 0), 0);
  const contingency = Math.round((totalCost * (input.contingencyPct ?? 0)) / 100);
  const managementFee = Math.round((totalCost * (input.managementFeePct ?? 0)) / 100);
  const costWithFees = totalCost + contingency + managementFee;
  const revenue = input.revenue ?? 0;
  const discountAmount = Math.round((revenue * (input.discountPct ?? 0)) / 100);
  const netRevenue = revenue - discountAmount;
  const taxAmount = Math.round((netRevenue * (input.taxPct ?? 0)) / 100);
  const grandTotal = netRevenue + taxAmount;
  const margin = netRevenue - costWithFees;
  const marginPct = netRevenue > 0 ? Math.round((margin / netRevenue) * 1000) / 10 : 0;
  return { totalCost, contingency, managementFee, discountAmount, netRevenue, taxAmount, grandTotal, margin, marginPct };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let estimation = await db.estimation.findUnique({ where: { opportunityId: id } });
  if (!estimation) {
    // Auto-create draft kosong agar UI bisa langsung edit
    const opp = await db.opportunity.findUnique({ where: { id }, include: { brand: true } });
    if (!opp) return fail("Opportunity tidak ditemukan", 404);
    estimation = await db.estimation.create({
      data: {
        opportunityId: id,
        revenue: opp.estimatedValue ?? 0,
        createdBy: "System",
      },
    });
  }
  return ok({ estimation });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const actorName = actor.name;
  const actorRole = actor.role;

  const opp = await db.opportunity.findUnique({ where: { id }, include: { brand: true } });
  if (!opp) return fail("Opportunity tidak ditemukan", 404);

  const current = await db.estimation.findUnique({ where: { opportunityId: id } });
  if (current && !["draft", "rejected"].includes(current.status)) {
    return fail(`Estimasi berstatus ${current.status} — tidak dapat diubah.`);
  }

  const input: Record<string, number> = {};
  for (const f of COST_FIELDS) input[f] = Number(body[f] ?? current?.[f] ?? 0);
  for (const f of PCT_FIELDS) input[f] = Number(body[f] ?? current?.[f] ?? 0);
  input.revenue = body.revenue !== undefined ? Number(body.revenue) : (current?.revenue ?? opp.estimatedValue ?? 0);

  const calc = compute(input);

  const data = {
    ...input,
    ...calc,
    notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : (current?.notes ?? null),
    createdBy: current?.createdBy ?? actorName,
    updatedAt: new Date(),
  };

  let estimation;
  if (current) {
    estimation = await db.estimation.update({ where: { id: current.id }, data });
  } else {
    estimation = await db.estimation.create({ data: { ...data, opportunityId: id } });
  }

  // Simpan revenue juga ke opportunity agar kanban/table konsisten
  if (body.syncOppValue !== false && input.revenue > 0) {
    await db.opportunity.update({ where: { id }, data: { estimatedValue: input.revenue } });
  }

  await logAudit({
    actorName, actorRole, action: "update", entity: "estimation", entityId: estimation.id,
    entityLabel: `Estimasi — ${opp.title}`,
    newValue: `Revenue ${input.revenue} · Margin ${calc.marginPct}% (${calc.margin})`,
    req,
  });

  // Submit → buat approval request
  if (body.submit === true) {
    await db.estimation.update({ where: { id: estimation.id }, data: { status: "pending_approval" } });
    const approval = await db.approvalRequest.create({
      data: {
        entityType: "estimation",
        entityId: estimation.id,
        entityLabel: `Estimasi — ${opp.title}`,
        opportunityId: id,
        requestedBy: actorName,
        amount: calc.grandTotal,
        discountPct: input.discountPct,
        note: body.notes ? String(body.notes) : `Margin ${calc.marginPct}% · Cost ${calc.totalCost}`,
      },
    });
    await logAudit({
      actorName, actorRole, action: "create", entity: "approval", entityId: approval.id,
      entityLabel: approval.entityLabel, metadata: "Pengajuan approval estimasi ke Direktur", req,
    });
    estimation = await db.estimation.findUnique({ where: { opportunityId: id } });
    return ok({ estimation, approval });
  }

  return ok({ estimation });
}
