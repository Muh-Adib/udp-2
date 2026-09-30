import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { gate, FINANCE_READ_ROLES } from "../_lib";

/**
 * FASE 7 — Kewajiban finansial terpadu (payroll/expense/intern_settlement/
 * point_redemption/travel_settlement) — anti double-pay via unique
 * [sourceType, sourceId] + status.
 * GET ?status=&sourceType= : finance/director/super_admin — dgn info payee + riwayat disbursement.
 */
export async function GET(req: NextRequest) {
  const g = await gate(req, FINANCE_READ_ROLES);
  if (g.res) return g.res;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status")?.trim();
  const sourceType = sp.get("sourceType")?.trim();

  const obligations = await db.financialObligation.findMany({
    where: {
      ...(status && status !== "all" ? { status } : {}),
      ...(sourceType && sourceType !== "all" ? { sourceType } : {}),
    },
    include: {
      payee: { select: { id: true, employeeNumber: true, preferredName: true } },
      disbursements: { orderBy: { disbursedAt: "desc" } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  return ok({ obligations });
}
