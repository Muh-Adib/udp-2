import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  gate, selfEmployee, parseExpenseItem, ParsedExpenseItem, checkPeriodForDate, CASH_ACCOUNT_CODE,
  FINANCE_WRITE_ROLES, strOrNull, isDisbursementMethod, accountForCategory,
} from "../../_lib";

/**
 * FASE 7 — Aksi klaim reimbursement (aturan #3 blueprint):
 * PATCH {action: "submit"|"approve"|"reject"|"pay", decisionNote?, method?, bankRef?}
 *   submit  : HANYA pemilik klaim (draft → submitted, submittedAt).
 *   approve : finance/director/super_admin, BUKAN pemilik (no self-approve) →
 *             approvedBy + decidedAt (+ decisionNote).
 *   reject  : idem approve → rejected + decisionNote.
 *   pay     : finance/director → payoutAt + status paid + DALAM SATU $transaction:
 *             FinancialObligation (sourceType "expense", status paid) + CashDisbursement
 *             + AUTO-POST jurnal (debit akun beban, credit 1-1000 Kas & Bank).
 *             Idempoten: obligation/jurnal existing (by sourceType+sourceId) tidak dibuat ulang.
 * PUT   {items:[...]} — ganti item HANYA saat draft (totalAmount dihitung ulang server-side).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const action = strOrNull(body.action);
  const claim = await db.expenseClaim.findUnique({
    where: { id },
    include: { employee: { select: { id: true, preferredName: true, employeeNumber: true } }, items: true },
  });
  if (!claim) return fail("Klaim tidak ditemukan", 404);

  const actorEmployee = await selfEmployee(actor);
  const isOwner = !!actorEmployee && actorEmployee.id === claim.employeeId;

  // ===== SUBMIT (pemilik) =====
  if (action === "submit") {
    if (!isOwner) return fail("Hanya pemilik klaim yang bisa mengajukan klaim ini", 403);
    if (claim.status !== "draft") return fail("Hanya klaim berstatus draft yang bisa diajukan");
    const updated = await db.expenseClaim.update({
      where: { id: claim.id },
      data: { status: "submitted", submittedAt: new Date() },
      include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "submit", entity: "expense_claim", entityId: claim.id, entityLabel: claim.title.slice(0, 80),
      field: "status", oldValue: "draft", newValue: "submitted", req,
    });
    return ok({ claim: updated });
  }

  // ===== APPROVE / REJECT (finance team, bukan pemilik) =====
  if (action === "approve" || action === "reject") {
    const gate = assertRole(actor, ["finance", "director", "super_admin"]);
    if (!gate.ok) return fail(gate.reason, 403);
    if (isOwner) return fail("Tidak boleh menyetujui/menolak klaim sendiri — tunggu keuangan lain", 403);
    if (claim.status !== "submitted") return fail("Hanya klaim berstatus diajukan (submitted) yang bisa diputuskan");

    const decisionNote = strOrNull(body.decisionNote);
    const updated = await db.expenseClaim.update({
      where: { id: claim.id },
      data: {
        status: action === "approve" ? "approved" : "rejected",
        approvedBy: actor.name,
        decidedAt: new Date(),
        decisionNote: decisionNote ?? null,
      },
      include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
    });
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: action === "approve" ? "approve" : "reject", entity: "expense_claim", entityId: claim.id,
      entityLabel: claim.title.slice(0, 80),
      field: "status", oldValue: "submitted",
      newValue: action === "approve" ? "approved" : "rejected",
      metadata: decisionNote ?? undefined, req,
    });
    return ok({ claim: updated });
  }

  // ===== PAY (finance/director) — obligation + disbursement + jurnal, satu transaksi =====
  if (action === "pay") {
    const gate = assertRole(actor, FINANCE_WRITE_ROLES);
    if (!gate.ok) return fail(gate.reason, 403);
    if (claim.status !== "approved") return fail("Hanya klaim berstatus disetujui (approved) yang bisa dibayar");
    const method = strOrNull(body.method);
    if (!method || !isDisbursementMethod(method)) {
      return fail("Metode pembayaran wajib transfer atau cash");
    }
    const bankRef = strOrNull(body.bankRef);

    // Jurnal otomatis diposting ke periode berjalan — wajib open (aturan #1).
    const now = new Date();
    const period = await checkPeriodForDate(now);
    if (!period.ok) return fail(`Tidak bisa membayar klaim: ${period.error}`);

    const total = claim.totalAmount;
    if (!(total > 0)) return fail("Total klaim nol — tidak ada yang perlu dibayar");

    // Idempoten: jurnal reimbursement utk claim ini sudah pernah dibuat?
    const existingJournal = await db.journalEntry.findFirst({
      where: { sourceType: "expense", sourceId: claim.id, status: "posted" },
      select: { id: true },
    });

    const paid = await db.$transaction(async (tx) => {
      // Cek ulang status DI DALAM transaksi (anti double-pay dua klik bersamaan).
      const fresh = await tx.expenseClaim.findUnique({ where: { id: claim.id }, select: { status: true, totalAmount: true } });
      if (!fresh || fresh.status !== "approved") {
        throw new Error("Klaim sudah diproses oleh keuangan lain — muat ulang data");
      }

      // Idempoten: obligation existing tidak dibuat ulang (unique sourceType+sourceId).
      let obligation = await tx.financialObligation.findFirst({
        where: { sourceType: "expense", sourceId: claim.id },
      });
      if (!obligation) {
        obligation = await tx.financialObligation.create({
          data: {
            payeeType: "employee",
            payeeEmployeeId: claim.employeeId,
            payeeName: claim.employee.preferredName,
            amount: total,
            currency: "IDR",
            sourceType: "expense",
            sourceId: claim.id,
            status: "paid",
          },
        });
      }

      await tx.cashDisbursement.create({
        data: {
          obligationId: obligation.id,
          payeeName: claim.employee.preferredName,
          amount: total,
          method,
          bankRef: bankRef ?? null,
          disbursedAt: now,
          createdBy: actor.name,
          note: `Pembayaran reimbursement: ${claim.title.slice(0, 100)}`,
        },
      });

      // AUTO-POST jurnal reimbursement (idempoten — sekali per claim).
      if (!existingJournal) {
        // Mapping kategori → akun beban (blueprint: semua kategori → 5-2000).
        const uniqueCodes = [...new Set(claim.items.map((i) => accountForCategory(i.category)))];
        const accounts = await tx.account.findMany({ where: { code: { in: [...new Set([...uniqueCodes, CASH_ACCOUNT_CODE])] } } });
        const kas = accounts.find((a) => a.code === CASH_ACCOUNT_CODE);
        if (!kas) throw new Error(`Akun ${CASH_ACCOUNT_CODE} (Kas & Bank) tidak ditemukan`);
        for (const code of uniqueCodes) {
          if (!accounts.some((a) => a.code === code)) {
            throw new Error(`Akun beban ${code} tidak ditemukan — periksa bagan akun`);
          }
        }
        // Satu jurnal: debit beban per kelompok akun, credit Kas & Bank total.
        await tx.journalEntry.create({
          data: {
            date: now,
            memo: `Reimbursement ${claim.title.slice(0, 150)}`,
            sourceType: "expense",
            sourceId: claim.id,
            status: "posted",
            postedAt: now,
            createdBy: actor.name,
            periodId: period.period.id,
            lines: {
              create: [
                ...uniqueCodes.map((code) => {
                  const acc = accounts.find((a) => a.code === code)!;
                  const amount = claim.items
                    .filter((i) => accountForCategory(i.category) === code)
                    .reduce((s, i) => s + i.amount, 0);
                  return { accountId: acc.id, debit: amount, credit: 0 };
                }),
                { accountId: kas.id, debit: 0, credit: total },
              ],
            },
          },
        });
      }

      return tx.expenseClaim.update({
        where: { id: claim.id },
        data: { status: "paid", payoutAt: now },
        include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
      });
    });

    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "pay", entity: "expense_claim", entityId: claim.id, entityLabel: claim.title.slice(0, 80),
      field: "status", oldValue: "approved", newValue: "paid",
      metadata: `Kewajiban + pencairan (${method}) + jurnal otomatis tercatat`, req,
    });
    return ok({ claim: paid });
  }

  return fail("Aksi tidak dikenal — gunakan action: submit/approve/reject/pay");
}

/** PUT — ganti seluruh item klaim HANYA saat draft (pemilik). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const claim = await db.expenseClaim.findUnique({ where: { id }, include: { items: true } });
  if (!claim) return fail("Klaim tidak ditemukan", 404);

  const emp = await selfEmployee(actor);
  if (!emp || emp.id !== claim.employeeId) {
    return fail("Hanya pemilik klaim yang bisa mengubah item klaim", 403);
  }
  if (claim.status !== "draft") return fail("Hanya klaim berstatus draft yang bisa diedit");

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return fail("Klaim minimal memiliki satu item pengeluaran");
  }
  const items: ParsedExpenseItem[] = [];
  for (const raw of body.items) {
    const parsed = parseExpenseItem(raw);
    if (!parsed.ok) return fail(parsed.error);
    items.push(parsed.item);
  }
  const totalAmount = items.reduce((s, i) => s + i.amount, 0);

  const updated = await db.$transaction(async (tx) => {
    await tx.expenseItem.deleteMany({ where: { claimId: claim.id } });
    await tx.expenseItem.createMany({
      data: items.map((i) => ({ claimId: claim.id, ...i })),
    });
    return tx.expenseClaim.update({
      where: { id: claim.id },
      data: { totalAmount },
      include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
    });
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "expense_claim", entityId: claim.id, entityLabel: claim.title.slice(0, 80),
    field: "items, totalAmount", oldValue: String(claim.totalAmount), newValue: String(totalAmount),
    metadata: `Item klaim diganti (${items.length} item, draft)`, req,
  });
  return ok({ claim: updated });
}
