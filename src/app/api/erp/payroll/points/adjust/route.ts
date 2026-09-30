import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Jurnal penyesuaian poin (kind "adjust", APPEND-ONLY).
 * POST { employeeId, points (bernilai tanda), note (wajib) } — hr/director/super_admin.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["hr", "director", "super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeId = String(body.employeeId ?? "");
  if (!employeeId) return fail("employeeId wajib diisi");
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, preferredName: true, employeeNumber: true },
  });
  if (!employee) return fail("Karyawan tidak ditemukan", 404);

  const points = Number(body.points);
  if (!Number.isFinite(points) || points === 0) {
    return fail("Poin penyesuaian wajib angka tidak nol (boleh negatif)", 400);
  }
  const note = String(body.note ?? "").trim();
  if (!note) return fail("Catatan penyesuaian wajib diisi (jejak audit)");

  const entry = await db.$transaction(async (tx) => {
    await tx.pointAccount.upsert({ where: { employeeId }, create: { employeeId }, update: {} });
    return tx.pointLedgerEntry.create({
      data: {
        employeeId,
        kind: "adjust",
        points: Math.round(points),
        sourceType: "manual",
        sourceRef: null,
        note,
        createdBy: actor.name,
      },
    });
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "point_ledger", entityId: entry.id,
    entityLabel: `${employee.employeeNumber} · ${employee.preferredName}`,
    field: "points", newValue: entry.points,
    metadata: `Penyesuaian poin: ${note}`, req,
  });
  return ok({ entry }, 201);
}
