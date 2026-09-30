import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Keputusan proposal insentif.
 * - approve : director/super_admin, ATAU hr (pemeriksaan formula). DILARANG utk diri
 *             sendiri (no self-decide). Bila proposedPoints > 0 → PointLedgerEntry
 *             "earn" (sourceRef proposal.id) otomatis. UANG insentif dibayar lewat
 *             run payroll berikutnya (item incentive) — TIDAK membuat kewajiban di sini.
 * - reject  : sama dgn approve → status rejected.
 * - pay     : finance/director/super_admin — pembayaran LANGSUNG di luar payroll
 *             (tanpa disbursement di slice ini): status paid + paidAt.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const proposal = await db.incentiveProposal.findUnique({
    where: { id },
    include: { employee: { select: { id: true, userId: true, employeeNumber: true, preferredName: true } } },
  });
  if (!proposal) return fail("Proposal insentif tidak ditemukan", 404);

  const label = `${proposal.employee.employeeNumber} · ${proposal.employee.preferredName}`;
  const action = String(body.action ?? "");

  if (action === "approve" || action === "reject") {
    const gate = assertRole(actor, ["director", "super_admin", "hr"]);
    if (!gate.ok) return fail(gate.reason, 403);
    // No self-decide: blokir bila proposal untuk karyawan milik akun sendiri.
    if (proposal.employee.userId && proposal.employee.userId === actor.id) {
      return fail("Tidak dapat memutuskan proposal insentif untuk diri sendiri", 403);
    }
    if (proposal.status !== "pending") {
      return fail(`Proposal sudah diputuskan (status: ${proposal.status})`, 409);
    }

    const decidedAt = new Date();
    if (action === "reject") {
      const updated = await db.incentiveProposal.update({
        where: { id },
        data: { status: "rejected", decidedBy: actor.name, decidedAt },
      });
      await logAudit({
        actorName: actor.name, actorRole: actor.role,
        action: "reject", entity: "incentive_proposal", entityId: id, entityLabel: label,
        field: "status", oldValue: "pending", newValue: "rejected",
        metadata: proposal.reason.slice(0, 160), req,
      });
      return ok({ proposal: updated });
    }

    const updated = await db.$transaction(async (tx) => {
      const p = await tx.incentiveProposal.update({
        where: { id },
        data: { status: "approved", decidedBy: actor.name, decidedAt },
      });
      let entry: Awaited<ReturnType<typeof db.pointLedgerEntry.create>> | null = null;
      if (p.proposedPoints > 0) {
        await tx.pointAccount.upsert({
          where: { employeeId: p.employeeId },
          create: { employeeId: p.employeeId },
          update: {},
        });
        entry = await tx.pointLedgerEntry.create({
          data: {
            employeeId: p.employeeId,
            kind: "earn",
            points: p.proposedPoints,
            sourceType: p.sourceType,
            sourceRef: p.id,
            note: `Insentif disetujui — ${p.reason.slice(0, 160)}`,
            createdBy: actor.name,
          },
        });
      }
      return { proposal: p, entry };
    });

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "approve", entity: "incentive_proposal", entityId: id, entityLabel: label,
      field: "status", oldValue: "pending", newValue: "approved",
      metadata: `${updated.proposal.proposedPoints > 0 ? `${updated.proposal.proposedPoints} poin masuk ledger` : "tanpa poin"}${updated.proposal.proposedAmount > 0 ? ` · Rp ${updated.proposal.proposedAmount.toLocaleString("id-ID")} via payroll` : ""}`,
      req,
    });
    return ok({ proposal: updated.proposal, pointEntry: updated.entry });
  }

  if (action === "pay") {
    const gate = assertRole(actor, ["finance", "director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (proposal.status !== "approved") {
      return fail(`Hanya proposal approved yang bisa ditandai dibayar (status: ${proposal.status})`, 409);
    }
    const updated = await db.incentiveProposal.update({
      where: { id },
      data: { status: "paid", paidAt: new Date() },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "pay", entity: "incentive_proposal", entityId: id, entityLabel: label,
      field: "status", oldValue: "approved", newValue: "paid",
      metadata: updated.proposedAmount > 0
        ? `Dibayar langsung Rp ${updated.proposedAmount.toLocaleString("id-ID")} (di luar payroll)`
        : "Ditandai dibayar (insentif poin)", req,
    });
    return ok({ proposal: updated });
  }

  return fail("action harus approve | reject | pay");
}
