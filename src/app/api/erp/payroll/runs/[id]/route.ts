import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Aksi run payroll: approve / reject / finalize.
 * - approve  : finance/director/super_admin — calculated → approved (review Finance).
 * - reject   : hr/finance/director/super_admin — kembali ke draft utk dihitung ulang.
 * - finalize : director/super_admin — approved → finalized (ATOMIK):
 *     semua slip "finalized", run finalized + inputHash sha256(items),
 *     FinancialObligation per slip (sourceType "payroll", sourceId slip.id),
 *     proposal insentif yang ikut run ditandai paid (anti double-pay).
 * Slip immutable setelah finalize — koreksi lewat run revisi baru.
 */

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const action = String(body.action ?? "");
  const run0 = await db.payrollRun.findUnique({
    where: { id },
    include: { period: true },
  });
  if (!run0) return fail("Run payroll tidak ditemukan", 404);

  if (action === "approve") {
    const gate = assertRole(actor, ["finance", "director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (run0.status !== "calculated") {
      return fail(`Hanya run berstatus calculated yang bisa disetujui (status: ${run0.status})`, 409);
    }
    const run = await db.payrollRun.update({ where: { id }, data: { status: "approved" } });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "approve", entity: "payroll_run", entityId: run.id, entityLabel: `${run0.period.name} · revisi ${run.revision}`,
      field: "status", oldValue: "calculated", newValue: "approved", req,
    });
    return ok({ run });
  }

  if (action === "reject") {
    const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (run0.status !== "calculated" && run0.status !== "approved") {
      return fail(`Hanya run calculated/approved yang bisa ditolak (status: ${run0.status})`, 409);
    }
    const run = await db.payrollRun.update({
      where: { id },
      data: { status: "draft", note: `Ditolak oleh ${actor.name} — hitung ulang utk revisi berikutnya` },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "payroll_run", entityId: run.id, entityLabel: `${run0.period.name} · revisi ${run.revision}`,
      field: "status", oldValue: run0.status, newValue: "draft", req,
    });
    return ok({ run });
  }

  if (action === "finalize") {
    const gate = assertRole(actor, ["director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);

    let result: {
      runId: string; label: string; slipCount: number; totalNet: number; inputHash: string; incentiveIds: string[];
    };
    try {
      result = await db.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({
        where: { id },
        include: {
          period: true,
          slips: { include: { items: { orderBy: { id: "asc" } }, employee: true } },
        },
      });
      if (!run) throw new HttpError(404, "Run payroll tidak ditemukan");
      if (run.status !== "approved") {
        throw new HttpError(409, `Run harus berstatus approved sebelum difinalisasi (status: ${run.status})`);
      }

      // inputHash = sha256 sederhana dari JSON seluruh item (snapshot immutable).
      const canonical = run.slips
        .slice()
        .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
        .flatMap((s) =>
          s.items.map((i) => ({
            employeeId: s.employeeId,
            componentCode: i.componentCode,
            label: i.label,
            classification: i.classification,
            quantity: i.quantity,
            rate: i.rate,
            amount: i.amount,
            sourceRef: i.sourceRef,
          })),
        );
      const inputHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");

      await tx.payslip.updateMany({ where: { runId: run.id }, data: { status: "finalized" } });
      await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "finalized", finalizedAt: new Date(), inputHash },
      });

      // Kewajiban finansial per slip (sourceId unik per slip — anti double-pay).
      for (const slip of run.slips) {
        await tx.financialObligation.create({
          data: {
            payeeType: "employee",
            payeeEmployeeId: slip.employeeId,
            payeeName: slip.employee.preferredName,
            amount: slip.net,
            currency: slip.currency,
            sourceType: "payroll",
            sourceId: slip.id,
            status: "open",
          },
        });
      }

      // Insentif yang ikut dibayar via run ini → paid (jangan diambil run berikutnya).
      const incentiveIds = run.slips
        .flatMap((s) => s.items.map((i) => i.sourceRef))
        .filter((ref): ref is string => !!ref && ref.startsWith("incentive-"))
        .map((ref) => ref.replace("incentive-", ""));
      if (incentiveIds.length > 0) {
        await tx.incentiveProposal.updateMany({
          where: { id: { in: incentiveIds }, status: "approved" },
          data: { status: "paid", paidAt: new Date() },
        });
      }

      return {
        runId: run.id,
        label: `${run.period.name} · revisi ${run.revision}`,
        slipCount: run.slips.length,
        totalNet: run.slips.reduce((s, x) => s + x.net, 0),
        inputHash,
        incentiveIds,
      };
      });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.message, err.status);
      throw err;
    }

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "finalize", entity: "payroll_run", entityId: result.runId, entityLabel: result.label,
      field: "status", oldValue: "approved", newValue: "finalized",
      metadata: `${result.slipCount} slip finalized · kewajiban Rp ${result.totalNet.toLocaleString("id-ID")} · hash ${result.inputHash.slice(0, 12)}…`,
      req,
    });
    return ok({ finalized: true, inputHash: result.inputHash, slipCount: result.slipCount, totalNet: result.totalNet });
  }

  return fail("action harus approve | reject | finalize");
}
