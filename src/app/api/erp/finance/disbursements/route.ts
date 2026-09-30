import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { gate, FINANCE_WRITE_ROLES, isDisbursementMethod, strOrNull } from "../_lib";

/**
 * FASE 7 — Catat pencairan dana (aturan #6 blueprint):
 * POST {obligationId, method, bankRef?, note?} — finance/director.
 * amount = obligation.amount (TIDAK dari body — tidak bisa dibelokkan).
 * Satu transaksi: buat CashDisbursement + FinancialObligation.status = "paid".
 * Validasi obligation masih OPEN di dalam transaksi (anti double-pay: klik ganda
 * / dua kasir bersamaan → yang kedua gagal dgn 400).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const obligationId = strOrNull(body.obligationId);
  if (!obligationId) return fail("obligationId wajib diisi");
  const method = strOrNull(body.method);
  if (!method || !isDisbursementMethod(method)) return fail("Metode pencairan wajib transfer atau cash");
  const bankRef = strOrNull(body.bankRef);
  const note = strOrNull(body.note);

  const disbursedAt = new Date();
  let result: Awaited<ReturnType<typeof runDisbursement>>;
  try {
    result = await runDisbursement(obligationId, method, bankRef, note, disbursedAt, g.actor.name);
  } catch (err) {
    if (err instanceof ObligationError) return fail(err.message, err.status);
    throw err;
  }

  await logAudit({
    actorName: g.actor.name, actorRole: g.actor.role,
    action: "disburse", entity: "financial_obligation", entityId: result.obligation.id,
    entityLabel: `${result.obligation.payeeName} (${result.obligation.sourceType})`,
    field: "status", oldValue: "open", newValue: "paid",
    metadata: `Pencairan ${method}${bankRef ? ` — ref ${bankRef}` : ""}`, req,
  });
  return ok({ disbursement: result.disbursement, obligation: { ...result.obligation, status: "paid" } }, 201);
}

/** Error bermuatan HTTP agar $transaction membatalkan semua & route membalas kode tepat. */
class ObligationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function runDisbursement(
  obligationId: string,
  method: string,
  bankRef: string | null,
  note: string | null,
  disbursedAt: Date,
  actorName: string,
) {
  return db.$transaction(async (tx) => {
    // Cek status DI DALAM transaksi — dua pencairan bersamaan: satu lolos, satu ditolak.
    const obligation = await tx.financialObligation.findUnique({ where: { id: obligationId } });
    if (!obligation) throw new ObligationError("Kewajiban tidak ditemukan", 404);
    if (obligation.status !== "open") {
      throw new ObligationError("Kewajiban ini sudah dibayar — pencairan ganda ditolak", 400);
    }

    const disbursement = await tx.cashDisbursement.create({
      data: {
        obligationId: obligation.id,
        payeeName: obligation.payeeName,
        amount: obligation.amount,
        method,
        bankRef: bankRef ?? null,
        disbursedAt,
        createdBy: actorName,
        note: note ?? null,
      },
    });
    await tx.financialObligation.update({
      where: { id: obligation.id },
      data: { status: "paid" },
    });
    return { disbursement, obligation };
  });
}
