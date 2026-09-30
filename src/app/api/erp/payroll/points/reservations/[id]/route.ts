import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Aksi reservasi poin: release / settle (hr/finance/director/super_admin).
 * - release : hold dilepas → saldo kembali (ledger tetap, tanpa redeem).
 * - settle  : hold jadi redeem posting (ledger append-only) + FinancialObligation
 *             sourceType "point_redemption", amount = (points/10) × conversionValue.
 *             Nilai konversi default Rp50.000/10 poin (OPEN blueprint — sementara),
 *             bisa dioverride via ?conversionValue=.
 */

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "finance", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const action = String(body.action ?? "");
  if (action !== "release" && action !== "settle") {
    return fail("action harus release | settle");
  }

  const reservation = await db.pointReservation.findUnique({
    where: { id },
    include: { employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
  });
  if (!reservation) return fail("Reservasi poin tidak ditemukan", 404);
  if (reservation.status !== "reserved") {
    return fail(`Reservasi sudah berstatus ${reservation.status} — tidak bisa di-${action}`, 409);
  }

  if (action === "release") {
    const updated = await db.pointReservation.update({
      where: { id },
      data: { status: "released" },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "point_reservation", entityId: id,
      entityLabel: `${reservation.employee.employeeNumber} · ${reservation.employee.preferredName}`,
      field: "status", oldValue: "reserved", newValue: "released",
      metadata: `${reservation.points} poin kembali ke saldo (pencairan dibatalkan)`, req,
    });
    return ok({ reservation: updated });
  }

  // ===== settle =====
  const convParam = numOrNull(req.nextUrl.searchParams.get("conversionValue"));
  const conversionValue = convParam && convParam > 0 ? convParam : 50000;
  const amount = Math.round((reservation.points / 10) * conversionValue);
  const settledAt = new Date();

  try {
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.pointReservation.update({
        where: { id },
        data: { status: "settled", settledAt },
      });
      const entry = await tx.pointLedgerEntry.create({
        data: {
          employeeId: reservation.employeeId,
          kind: "redeem",
          points: -reservation.points,
          sourceType: "manual",
          sourceRef: reservation.id,
          note: `Pencairan poin (settle reservasi ${reservation.requestId})`,
          createdBy: actor.name,
        },
      });
      const obligation = await tx.financialObligation.create({
        data: {
          payeeType: "employee",
          payeeEmployeeId: reservation.employeeId,
          payeeName: reservation.employee.preferredName,
          amount,
          currency: "IDR",
          sourceType: "point_redemption",
          sourceId: reservation.id,
          status: "open",
        },
      });
      return { updated, entry, obligation };
    });

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "settle", entity: "point_reservation", entityId: id,
      entityLabel: `${reservation.employee.employeeNumber} · ${reservation.employee.preferredName}`,
      field: "status", oldValue: "reserved", newValue: "settled",
      metadata: `${reservation.points} poin → kewajiban Rp ${amount.toLocaleString("id-ID")} (konversi sementara Rp ${conversionValue.toLocaleString("id-ID")}/10 poin)`,
      req,
    });
    return ok({ reservation: result.updated, entry: result.entry, obligation: result.obligation });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail("Kewajiban pembayaran poin ini sudah ada (anti double-pay)", 409);
    }
    throw err;
  }
}
