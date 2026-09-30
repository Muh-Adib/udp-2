import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, readBody, logAudit } from "@/lib/crm/server";
import { authWork, requireRole, MANAGER_ROLES, BRAND_SELECT } from "../../_shared";

/**
 * Task 2-d — Work Engine: siklus hidup WorkPeriod (aturan #3).
 * PATCH /api/erp/work/periods/[id] { action: "activate"|"close", contractRef? } (manager+).
 * - activate: planned → active (bukan planned → 400).
 * - close: → closed; DITOLAK 400 bila masih ada instance aktif di periode
 *   (pesan menyebut jumlahnya) — kerjaan harus tuntas/dipindah dulu.
 */

const PERIOD_INCLUDE = {
  brand: BRAND_SELECT,
  project: { select: { id: true, code: true, name: true, brandId: true } },
  _count: { select: { instances: true } },
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const g = await authWork(req, body, "write");
  if (!g.ok) return g.err;
  const actor = g.actor;
  const roleGate = requireRole(actor, MANAGER_ROLES);
  if (roleGate) return roleGate;

  const period = await db.workPeriod.findUnique({ where: { id } });
  if (!period) return fail("Periode kerja tidak ditemukan", 404);

  // Opsional: perbarui referensi kontrak kapan saja selama aksi.
  if ("contractRef" in body) {
    await db.workPeriod.update({
      where: { id },
      data: { contractRef: body.contractRef ? String(body.contractRef).trim().slice(0, 120) : null },
    });
  }

  const action = String(body.action ?? "").trim();

  if (action === "activate") {
    if (period.status === "active") return fail("Periode sudah aktif", 400);
    if (period.status === "closed") return fail("Periode sudah ditutup — tidak bisa diaktifkan lagi", 400);
    await db.workPeriod.update({ where: { id }, data: { status: "active" } });

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "activate", entity: "work_period", entityId: id, entityLabel: period.name,
      field: "status", oldValue: period.status, newValue: "active", req,
    });
    const fresh = await db.workPeriod.findUnique({ where: { id }, include: PERIOD_INCLUDE });
    return ok({ period: fresh });
  }

  if (action === "close") {
    if (period.status === "closed") return fail("Periode sudah ditutup", 400);
    const activeInstances = await db.workflowInstance.count({
      where: { workPeriodId: id, status: "active" },
    });
    if (activeInstances > 0) {
      return fail(
        `Tidak bisa menutup periode — masih ada ${activeInstances} instance aktif di periode ini. Selesaikan atau batalkan dulu.`,
        400,
      );
    }
    await db.workPeriod.update({ where: { id }, data: { status: "closed" } });

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "close", entity: "work_period", entityId: id, entityLabel: period.name,
      field: "status", oldValue: period.status, newValue: "closed", req,
    });
    const fresh = await db.workPeriod.findUnique({ where: { id }, include: PERIOD_INCLUDE });
    return ok({ period: fresh });
  }

  if (!action) {
    // Hanya update contractRef (tanpa aksi status) → kembalikan periode terbaru.
    if (!("contractRef" in body)) return fail("Aksi wajib diisi (activate/close)", 400);
    const fresh = await db.workPeriod.findUnique({ where: { id }, include: PERIOD_INCLUDE });
    return ok({ period: fresh });
  }

  return fail("Aksi tidak dikenal (activate/close)", 400);
}
