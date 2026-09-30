import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Proposal insentif (poin dan/atau uang).
 * GET   ?status= → daftar proposal (desc) dgn employee.
 * POST  { employeeId, sourceType, proposedPoints?, proposedAmount?, reason, sourceRef? }
 *       — manager/director/super_admin (pelapor kerja/lembur/dinas).
 *       Keputusan approve/reject ada di PATCH /incentives/[id] (no self-decide).
 */

const SOURCE_TYPES = ["task", "overtime", "travel", "project", "manual"];

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const status = req.nextUrl.searchParams.get("status");
  const proposals = await db.incentiveProposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      employee: { select: { id: true, employeeNumber: true, preferredName: true, employmentStatus: true } },
    },
  });
  return ok({ proposals });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["manager", "director", "super_admin"]);
  if (!gate.ok) return fail("Hanya Manager, Direktur, atau Super Admin yang dapat mengusulkan insentif", 403);

  const employeeId = String(body.employeeId ?? "");
  if (!employeeId) return fail("employeeId wajib diisi");
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, preferredName: true, employeeNumber: true, active: true },
  });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);
  if (!employee.active) return fail("Karyawan tidak aktif", 400);

  const sourceType = String(body.sourceType ?? "");
  if (!SOURCE_TYPES.includes(sourceType)) {
    return fail(`Sumber insentif harus salah satu dari: ${SOURCE_TYPES.join(", ")}`);
  }
  const proposedPoints = numOrNull(body.proposedPoints) ?? 0;
  const proposedAmount = numOrNull(body.proposedAmount) ?? 0;
  if (proposedPoints < 0 || proposedAmount < 0) return fail("Poin/uang insentif tidak boleh negatif");
  if (proposedPoints === 0 && proposedAmount === 0) {
    return fail("Isi minimal satu: poin insentif atau uang insentif");
  }
  const reason = String(body.reason ?? "").trim();
  if (!reason) return fail("Alasan/justifikasi insentif wajib diisi");
  const sourceRef = body.sourceRef ? String(body.sourceRef).slice(0, 120) : null;

  const proposal = await db.incentiveProposal.create({
    data: {
      employeeId,
      sourceType,
      sourceRef,
      proposedPoints: Math.round(proposedPoints),
      proposedAmount: Math.round(proposedAmount),
      reason: reason.slice(0, 500),
      status: "pending",
      proposedBy: actor.name,
    },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "incentive_proposal", entityId: proposal.id,
    entityLabel: `${employee.employeeNumber} · ${employee.preferredName}`,
    field: "status", newValue: "pending",
    metadata: `Usulan ${sourceType}: ${proposedPoints} poin${proposedAmount > 0 ? ` + Rp ${proposedAmount.toLocaleString("id-ID")}` : ""} — ${reason.slice(0, 120)}`,
    req,
  });
  return ok({ proposal }, 201);
}
