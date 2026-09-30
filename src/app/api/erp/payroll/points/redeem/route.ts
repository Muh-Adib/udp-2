import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Pencairan poin (kelipatan 10) via RESERVASI (anti double-pay):
 * - Karyawan boleh mencairkan utk DIRINYA SENDIRI; hr/director/super_admin utk siapa pun.
 * - points harus > 0 dan kelipatan 10.
 * - Transaksi interaktif: baca ulang saldo (Σpositif + Σnegatif − reservasi aktif),
 *   baru buat PointReservation (hold) + requestId unik `red-<ts>-<random>`.
 * - Ledger redeem hanya DIBUKUKAN saat reservasi di-settle-kan (append-only tetap konsisten);
 *   release → hold hilang, saldo kembali tanpa jejak redeem.
 */

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  // Target: body.employeeId (atau diri sendiri bila kosong).
  let targetId = body.employeeId ? String(body.employeeId) : "";
  if (!targetId) {
    const self = await db.employee.findUnique({ where: { userId: actor.id ?? "" }, select: { id: true } });
    if (!self) return fail("employeeId wajib diisi (akun Anda tidak terhubung karyawan)", 400);
    targetId = self.id;
  } else {
    const self = await db.employee.findUnique({ where: { userId: actor.id ?? "" }, select: { id: true } });
    const isSelf = self?.id === targetId;
    if (!isSelf) {
      const gate = assertRole(actor, ["hr", "director", "super_admin"]);
      if (!gate.ok) return fail("Karyawan hanya boleh mencairkan poin miliknya sendiri", 403);
    }
  }

  const points = Number(body.points);
  if (!Number.isFinite(points) || points <= 0 || points % 10 !== 0) {
    return fail("Poin pencairan harus lebih dari 0 dan kelipatan 10", 400);
  }

  const employee = await db.employee.findUnique({
    where: { id: targetId },
    select: { id: true, preferredName: true, employeeNumber: true },
  });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);

  const requestId = `red-${Date.now()}-${randomBytes(4).toString("hex")}`;

  let result: { reservation: Awaited<ReturnType<typeof db.pointReservation.create>>; available: number };
  try {
    result = await db.$transaction(async (tx) => {
      // Re-read ledger di dalam transaksi (anti double-pay / race pencairan).
      const [pos, neg, reserved] = await Promise.all([
        tx.pointLedgerEntry.aggregate({ where: { employeeId: targetId, points: { gt: 0 } }, _sum: { points: true } }),
        tx.pointLedgerEntry.aggregate({ where: { employeeId: targetId, points: { lt: 0 } }, _sum: { points: true } }),
        tx.pointReservation.aggregate({ where: { employeeId: targetId, status: "reserved" }, _sum: { points: true } }),
      ]);
      const available = (pos._sum.points ?? 0) + (neg._sum.points ?? 0) - (reserved._sum.points ?? 0);
      if (available < points) {
        throw new Error(`__NS__Saldo poin tidak cukup (tersedia ${available}, minta ${points})`);
      }
      await tx.pointAccount.upsert({ where: { employeeId: targetId }, create: { employeeId: targetId }, update: {} });
      const reservation = await tx.pointReservation.create({
        data: {
          employeeId: targetId,
          points,
          status: "reserved",
          requestId,
        },
      });
      return { reservation, available };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gagal membuat reservasi poin";
    if (msg.startsWith("__NS__")) return fail(msg.replace("__NS__", ""), 400);
    throw err;
  }

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "point_reservation", entityId: result.reservation.id,
    entityLabel: `${employee.employeeNumber} · ${employee.preferredName}`,
    field: "points", newValue: points,
    metadata: `Pencairan ${points} poin ditahan (requestId ${requestId}) — menunggu settle/release`,
    req,
  });

  return ok({ reservation: result.reservation, available: result.available - points }, 201);
}
