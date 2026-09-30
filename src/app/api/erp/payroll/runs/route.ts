import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, isUniqueViolation } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Fase 6 — Run payroll.
 * GET  ?periodId= → run periode tsb (desc revisi) dgn slips + items + employee.
 * POST { periodId } → KALKULASI run baru (aturan blueprint Bab 30):
 *   - Employee aktif non-intern: gaji pokok dari payslip FINALIZED terakhir (item
 *     base_salary, fallback 0) + lembur verified dlm periode (rate = base/173/jam ×
 *     realisasi jam, dibulatkan) + insentif approved belum dibayar (proposedAmount).
 *   - Intern: TANPA gaji pokok — stipend dari akumulasi InternAccrual verified dlm periode.
 *   - Potongan sementara 5% dari total earning (placeholder formula resmi).
 *   - Pencairan poin TIDAK masuk run — dibayar via reservasi poin (endpoint terpisah).
 * Idempoten: bila sudah ada run draft/calculated di periode → 409.
 */

const PAYROLL_ROLES = ["hr", "finance", "director", "super_admin"];
/** Kalkulasi = HR (finance review, director finalize). */
const CALC_ROLES = ["hr", "director", "super_admin"];

type ItemDraft = {
  componentCode: string;
  label: string;
  classification: "earning" | "deduction" | "reimbursement";
  quantity: number;
  rate: number;
  amount: number;
  sourceRef?: string;
};

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, PAYROLL_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const periodId = req.nextUrl.searchParams.get("periodId");
  if (!periodId) return fail("parameter periodId wajib diisi");

  const runs = await db.payrollRun.findMany({
    where: { periodId },
    orderBy: { revision: "desc" },
    include: {
      slips: {
        orderBy: { createdAt: "asc" },
        include: {
          employee: { select: { id: true, employeeNumber: true, preferredName: true, employmentStatus: true } },
          items: { orderBy: { id: "asc" } },
        },
      },
    },
  });
  return ok({ runs });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, CALC_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const periodId = String(body.periodId ?? "");
  if (!periodId) return fail("periodId wajib diisi");
  const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) return fail("Periode payroll tidak ditemukan", 404);
  if (period.status !== "open") {
    return fail(`Periode ${period.name} berstatus ${period.status} — run hanya bisa dibuat di periode open`, 409);
  }

  // Idempotensi: run draft/calculated yang belum selesai → jangan buat duplikat.
  const activeRun = await db.payrollRun.findFirst({
    where: { periodId, status: { in: ["draft", "calculated"] } },
    orderBy: { revision: "desc" },
  });
  if (activeRun) {
    return fail(
      `Periode ${period.name} masih punya run revisi ${activeRun.revision} berstatus "${activeRun.status}" — selesaikan (setujui/tolak) sebelum menghitung run baru`,
      409,
    );
  }

  // ===== Snapshot data kalkulasi =====
  const employees = await db.employee.findMany({
    where: { active: true },
    orderBy: { employeeNumber: "asc" },
  });
  if (employees.length === 0) return fail("Tidak ada karyawan aktif", 409);

  const finalizedSlips = await db.payslip.findMany({
    where: { status: "finalized", run: { status: "finalized" } },
    orderBy: { createdAt: "desc" },
    include: { items: { where: { componentCode: "base_salary" } } },
  });
  const baseSalaryByEmp = new Map<string, number>();
  for (const slip of finalizedSlips) {
    if (!baseSalaryByEmp.has(slip.employeeId) && slip.items.length > 0) {
      baseSalaryByEmp.set(slip.employeeId, slip.items[0].amount);
    }
  }

  const overtimes = await db.overtimeRequest.findMany({
    where: { status: "verified", date: { gte: period.startDate, lte: period.endDate } },
    orderBy: { date: "asc" },
  });

  const incentives = await db.incentiveProposal.findMany({
    where: { status: "approved", paidAt: null },
    orderBy: { createdAt: "asc" },
  });

  const accruals = await db.internAccrual.findMany({
    where: { status: "verified", businessDate: { gte: period.startDate, lte: period.endDate } },
  });
  const stipendByEmp = new Map<string, { total: number; days: number; rate: number }>();
  for (const a of accruals) {
    const cur = stipendByEmp.get(a.employeeId) ?? { total: 0, days: 0, rate: a.rate };
    cur.total += a.amount;
    cur.days += 1;
    cur.rate = a.rate;
    stipendByEmp.set(a.employeeId, cur);
  }

  // ===== Susun slip per karyawan =====
  const slipDrafts: {
    employeeId: string;
    gross: number;
    deduction: number;
    reimbursement: number;
    net: number;
    items: ItemDraft[];
  }[] = [];
  const incentiveIdsUsed = new Set<string>();

  for (const emp of employees) {
    const items: ItemDraft[] = [];
    const isIntern = emp.employmentStatus === "intern";

    if (isIntern) {
      // Intern: stipend dari akumulasi uang saku hari hadir terverifikasi.
      const st = stipendByEmp.get(emp.id);
      if (st && st.total > 0) {
        items.push({
          componentCode: "stipend",
          label: `Uang saku magang (${st.days} hari hadir terverifikasi)`,
          classification: "earning",
          quantity: st.days,
          rate: st.days > 0 ? Math.round(st.total / st.days) : 0,
          amount: Math.round(st.total),
        });
      }
    } else {
      const base = baseSalaryByEmp.get(emp.id) ?? 0;
      if (base > 0) {
        items.push({
          componentCode: "base_salary",
          label: "Gaji Pokok",
          classification: "earning",
          quantity: 1,
          rate: base,
          amount: base,
        });
      }
      for (const ot of overtimes.filter((o) => o.employeeId === emp.id)) {
        if (base <= 0) break; // tanpa gaji pokok, rate lembur tak terdefinisi
        const hours = Math.round(((ot.realizedMinutes ?? 0) / 60) * 100) / 100;
        if (hours <= 0) continue;
        const hourRate = Math.round(base / 173);
        items.push({
          componentCode: "overtime",
          label: `Lembur terverifikasi (${hours} jam · ${ot.date.toISOString().slice(0, 10)})`,
          classification: "earning",
          quantity: hours,
          rate: hourRate,
          amount: Math.round(hourRate * hours),
          sourceRef: ot.id,
        });
      }
      for (const inc of incentives.filter((i) => i.employeeId === emp.id)) {
        if (inc.proposedAmount > 0) {
          items.push({
            componentCode: "incentive",
            label: `Insentif (${inc.sourceType})${inc.reason ? ` — ${inc.reason.slice(0, 80)}` : ""}`,
            classification: "earning",
            quantity: 1,
            rate: inc.proposedAmount,
            amount: Math.round(inc.proposedAmount),
            sourceRef: `incentive-${inc.id}`,
          });
          incentiveIdsUsed.add(inc.id);
        }
      }
    }

    const gross = Math.round(
      items.filter((i) => i.classification === "earning").reduce((s, i) => s + i.amount, 0),
    );
    if (gross > 0) {
      const ded = Math.round(gross * 0.05);
      items.push({
        componentCode: "deduction",
        label: "Potongan sementara 5% (placeholder — formula resmi menyusul)",
        classification: "deduction",
        quantity: 1,
        rate: ded,
        amount: -ded,
      });
      const deduction = ded;
      slipDrafts.push({
        employeeId: emp.id,
        gross,
        deduction,
        reimbursement: 0,
        net: gross - deduction,
        items,
      });
    } else if (items.length > 0) {
      // Ada item bernilai 0 (mis. gaji pokok 0) — tetap catat tanpa potongan.
      slipDrafts.push({ employeeId: emp.id, gross: 0, deduction: 0, reimbursement: 0, net: 0, items });
    }
  }

  const revision =
    (await db.payrollRun.aggregate({ where: { periodId }, _max: { revision: true } }))._max.revision ?? 0;

  try {
    const run = await db.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: {
          periodId,
          revision: revision + 1,
          status: "calculated",
          createdBy: actor.name,
          note: `Kalkulasi otomatis: ${slipDrafts.length} slip (gaji pokok dari slip terakhir + lembur verified + insentif approved)`,
        },
      });
      for (const s of slipDrafts) {
        await tx.payslip.create({
          data: {
            runId: created.id,
            employeeId: s.employeeId,
            gross: s.gross,
            deduction: s.deduction,
            reimbursement: s.reimbursement,
            net: s.net,
            currency: "IDR",
            status: "draft",
            items: { create: s.items.map((i) => ({ ...i })) },
          },
        });
      }
      return tx.payrollRun.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          slips: {
            orderBy: { createdAt: "asc" },
            include: {
              employee: { select: { id: true, employeeNumber: true, preferredName: true, employmentStatus: true } },
              items: { orderBy: { id: "asc" } },
            },
          },
        },
      });
    });

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "create", entity: "payroll_run", entityId: run.id, entityLabel: `${period.name} · revisi ${run.revision}`,
      field: "status", newValue: "calculated",
      metadata: `${slipDrafts.length} slip · total net Rp ${run.slips.reduce((s, x) => s + x.net, 0).toLocaleString("id-ID")}`,
      req,
    });
    return ok({ run, incentiveCount: incentiveIdsUsed.size }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail("Run untuk periode ini sudah ada — muat ulang halaman", 409);
    }
    throw err;
  }
}
