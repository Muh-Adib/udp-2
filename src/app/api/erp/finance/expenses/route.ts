import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { selfEmployee, parseExpenseItem, ParsedExpenseItem, FINANCE_READ_ROLES, strOrNull } from "../_lib";

/**
 * FASE 7 — Klaim reimbursement (aturan #3 blueprint).
 * GET  ?status=&mine=1&employeeId=
 *      : mine=1 → klaim milik aktor (semua role yang punya Employee) + info `me`.
 *        tanpa mine → finance/director/super_admin (semua klaim).
 * POST {title, brandId?, projectId?, items[{purchaseDate,description,category,amount,receiptRef?}], submitNow?}
 *      : klaim milik AKTOR sendiri (Employee ter-link ke user) — totalAmount dihitung
 *        server-side dari items; status draft, atau submitted bila submitNow=true.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);

  const sp = req.nextUrl.searchParams;
  const mine = sp.get("mine") === "1";
  const status = sp.get("status")?.trim();

  if (mine) {
    // Klaim milik sendiri — setiap role yang punya Employee boleh melihat.
    const emp = await selfEmployee(actor);
    if (!emp) return ok({ claims: [], me: null });
    const claims = await db.expenseClaim.findMany({
      where: { employeeId: emp.id, ...(status && status !== "all" ? { status } : {}) },
      include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok({ claims, me: { id: emp.id, preferredName: emp.preferredName } });
  }

  const gate = assertRole(actor, FINANCE_READ_ROLES);
  if (!gate.ok) return fail(gate.reason, 403);

  const employeeId = sp.get("employeeId")?.trim();
  const claims = await db.expenseClaim.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
    include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok({ claims });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const emp = await selfEmployee(actor);
  if (!emp) return fail("Akun Anda tidak terhubung ke data karyawan — klaim hanya untuk karyawan aktif", 403);

  const title = strOrNull(body.title);
  if (!title) return fail("Judul klaim wajib diisi");

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

  const submitNow = body.submitNow === true;
  const claim = await db.expenseClaim.create({
    data: {
      employeeId: emp.id,
      title: title.slice(0, 160),
      brandId: strOrNull(body.brandId),
      projectId: strOrNull(body.projectId),
      totalAmount,
      status: submitNow ? "submitted" : "draft",
      submittedAt: submitNow ? new Date() : null,
      items: { create: items },
    },
    include: { items: true, employee: { select: { id: true, employeeNumber: true, preferredName: true } } },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: submitNow ? "submit" : "create", entity: "expense_claim", entityId: claim.id,
    entityLabel: claim.title.slice(0, 80),
    field: "status", newValue: claim.status,
    metadata: submitNow ? "Klaim dibuat & langsung diajukan" : "Klaim draft dibuat", req,
  });
  return ok({ claim }, 201);
}
