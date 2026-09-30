import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Settlement uang saku magang.
 * GET  : daftar settlement (desc) dgn employee.
 * POST { employeeId } (hr/director/super_admin): hitung total accrual VERIFIED −
 * yang sudah masuk settlement non-open sebelumnya → buat settlement "open"
 * dgn dueDate = sekarang + 30 hari. Early termination diperbolehkan
 * (leftOn terisi tetap boleh settle). Anti dobel: satu settlement aktif per karyawan.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const settlements = await db.internSettlement.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      employee: { select: { id: true, employeeNumber: true, preferredName: true, internProgram: true, active: true, leftOn: true } },
    },
  });
  return ok({ settlements });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeId = String(body.employeeId ?? "");
  if (!employeeId) return fail("employeeId wajib diisi");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);
  if (employee.employmentStatus !== "intern") {
    return fail(`${employee.preferredName} bukan karyawan magang`, 400);
  }

  const activeSettlement = await db.internSettlement.findFirst({
    where: { employeeId, status: { in: ["open", "submitted", "approved"] } },
  });
  if (activeSettlement) {
    return fail(
      `${employee.preferredName} masih punya settlement berstatus "${activeSettlement.status}" — selesaikan dulu (anti dobel pembayaran)`,
      409,
    );
  }

  const agg = await db.internAccrual.aggregate({
    where: { employeeId, status: "verified" },
    _sum: { amount: true },
  });
  const priorSettled = await db.internSettlement.aggregate({
    where: { employeeId, status: { not: "open" } },
    _sum: { totalAccrued: true },
  });
  const totalAccrued = Math.round((agg._sum.amount ?? 0) - (priorSettled._sum.totalAccrued ?? 0));
  if (totalAccrued <= 0) {
    return fail(`Tidak ada sisa akumulasi verified yang belum diselesaikan untuk ${employee.preferredName}`, 409);
  }

  const settlement = await db.internSettlement.create({
    data: {
      employeeId,
      totalAccrued,
      paidTotal: 0,
      status: "open",
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "intern_settlement", entityId: settlement.id,
    entityLabel: `${employee.employeeNumber} · ${employee.preferredName}`,
    field: "status", newValue: "open",
    metadata: `Pengajuan settlement uang saku Rp ${totalAccrued.toLocaleString("id-ID")} · jatuh tempo ${settlement.dueDate?.toISOString().slice(0, 10)}`,
    req,
  });
  return ok({ settlement }, 201);
}
