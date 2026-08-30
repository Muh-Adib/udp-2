import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";

/**
 * GET /api/reports?brandId=all|<id>&days=30|90|365 (default 90)
 *
 * Modul Laporan (ronde 17-b) — laporan kinerja period-bounded & ekspor:
 *  - revenuePerBrand   : opportunity won pada periode (won-date = updatedAt) per brand
 *  - winRatePerService : kohort opportunity dibuat pada periode, dikelompokkan serviceCategory
 *  - slaCompliance     : lead inbound dibuat pada periode, respons & breach per brand (slaHours)
 *  - invoiceAging      : outstanding invoice (sent/partial/overdue) jatuh tempo lewat, per bucket hari
 *  - pipelinePerOwner  : opportunity open (bukan won/lost) per owner + weighted
 * Semua query dibatasi take ≤ 500 — correctness over cleverness.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_ROWS = 500;
const ALLOWED_DAYS = [30, 90, 365];

const AGING_BUCKETS = ["0-30 hari", "31-60 hari", "61-90 hari", "90+ hari"] as const;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brandId = sp.get("brandId");
  const days = Number(sp.get("days") ?? 90);
  if (!ALLOWED_DAYS.includes(days)) {
    return fail("Parameter days harus 30, 90, atau 365", 400);
  }

  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const brandFilter = brandId && brandId !== "all" ? { brandId } : {};

  const [wonOpps, cohortOpps, lostCount, invoices, leads, openOpps] = await Promise.all([
    // 1) Won pada periode (won-date = updatedAt)
    db.opportunity.findMany({
      where: { deletedAt: null, stage: "won", updatedAt: { gte: since }, ...brandFilter },
      include: { brand: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_ROWS,
    }),
    // 2) Kohort opportunity dibuat pada periode (untuk win rate per layanan)
    db.opportunity.findMany({
      where: { deletedAt: null, createdAt: { gte: since }, ...brandFilter },
      select: { serviceCategory: true, stage: true, estimatedValue: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
    db.opportunity.count({
      where: { deletedAt: null, stage: "lost", updatedAt: { gte: since }, ...brandFilter },
    }),
    // 3) Outstanding invoice (dasar aging + KPI outstanding)
    db.invoice.findMany({
      where: { status: { in: ["sent", "partial", "overdue"] }, ...brandFilter },
      include: { payments: true },
      orderBy: { issueDate: "desc" },
      take: MAX_ROWS,
    }),
    // 4) Lead inbound pada periode — hanya yang berasosiasi brand agar bisa dipetakan ke SLA brand
    db.interaction.findMany({
      where: {
        direction: "inbound",
        createdAt: { gte: since },
        ...(brandId && brandId !== "all" ? { brandId } : { brandId: { not: null } }),
      },
      include: { brand: { select: { id: true, name: true, color: true, slaHours: true } } },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    }),
    // 5) Pipeline open (bukan won/lost) per owner
    db.opportunity.findMany({
      where: { deletedAt: null, stage: { notIn: ["won", "lost"] }, ...brandFilter },
      select: { ownerName: true, estimatedValue: true, probability: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_ROWS,
    }),
  ]);

  // ---- Revenue per brand ----
  const revMap = new Map<string, { brandId: string; name: string; color: string; count: number; value: number }>();
  for (const o of wonOpps) {
    const row = revMap.get(o.brandId) ?? {
      brandId: o.brandId, name: o.brand.name, color: o.brand.color, count: 0, value: 0,
    };
    row.count += 1;
    row.value += o.estimatedValue ?? 0;
    revMap.set(o.brandId, row);
  }
  const revenuePerBrand = [...revMap.values()]
    .map((r) => ({ ...r, value: Math.round(r.value) }))
    .sort((a, b) => b.value - a.value);

  // ---- Win rate per layanan (kohort dibuat pada periode) ----
  const svcMap = new Map<string, { category: string; created: number; won: number; lost: number; valueWon: number }>();
  for (const o of cohortOpps) {
    const key = o.serviceCategory ?? "tanpa_kategori";
    const row = svcMap.get(key) ?? { category: key, created: 0, won: 0, lost: 0, valueWon: 0 };
    row.created += 1;
    if (o.stage === "won") {
      row.won += 1;
      row.valueWon += o.estimatedValue ?? 0;
    } else if (o.stage === "lost") {
      row.lost += 1;
    }
    svcMap.set(key, row);
  }
  const winRatePerService = [...svcMap.values()]
    .map((r) => ({
      ...r,
      valueWon: Math.round(r.valueWon),
      winRatePct: r.won + r.lost > 0 ? Math.round((r.won / (r.won + r.lost)) * 100) : 0,
    }))
    .sort((a, b) => b.created - a.created || b.valueWon - a.valueWon);

  // ---- SLA compliance per brand ----
  const slaMap = new Map<string, {
    brandId: string; name: string; color: string; slaHours: number;
    total: number; responded: number; lateOrOpen: number; respSumMs: number;
  }>();
  for (const l of leads) {
    if (!l.brand) continue;
    const row = slaMap.get(l.brand.id) ?? {
      brandId: l.brand.id, name: l.brand.name, color: l.brand.color,
      slaHours: l.brand.slaHours, total: 0, responded: 0, lateOrOpen: 0, respSumMs: 0,
    };
    row.total += 1;
    const slaMs = (l.brand.slaHours > 0 ? l.brand.slaHours : 4) * HOUR;
    if (l.respondedAt) {
      row.responded += 1;
      const dur = l.respondedAt.getTime() - l.createdAt.getTime();
      row.respSumMs += dur;
      if (dur > slaMs) row.lateOrOpen += 1;
    } else if (now.getTime() - l.createdAt.getTime() > slaMs) {
      row.lateOrOpen += 1; // belum direspons melewati SLA
    }
    slaMap.set(l.brand.id, row);
  }
  const slaCompliance = [...slaMap.values()]
    .map((r) => ({
      brandId: r.brandId,
      name: r.name,
      color: r.color,
      slaHours: r.slaHours,
      total: r.total,
      responded: r.responded,
      respondedPct: r.total > 0 ? Math.round((r.responded / r.total) * 100) : 0,
      avgResponseHours: r.responded > 0 ? Math.round((r.respSumMs / r.responded / HOUR) * 10) / 10 : 0,
      breachPct: r.total > 0 ? Math.round((r.lateOrOpen / r.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- Invoice aging (outstanding & jatuh tempo terlewat) ----
  const agingRows = AGING_BUCKETS.map((bucket) => ({ bucket, count: 0, amount: 0 }));
  let outstandingTotal = 0;
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, inv.total - paid);
    outstandingTotal += remaining;
    if (!inv.dueDate) continue;
    const overdueDays = Math.floor((now.getTime() - inv.dueDate.getTime()) / DAY);
    if (overdueDays <= 0) continue; // belum jatuh tempo
    const idx = overdueDays <= 30 ? 0 : overdueDays <= 60 ? 1 : overdueDays <= 90 ? 2 : 3;
    agingRows[idx].count += 1;
    agingRows[idx].amount += remaining;
  }
  const invoiceAging = agingRows.map((r) => ({ ...r, amount: Math.round(r.amount) }));

  // ---- Pipeline per owner (open, bukan won/lost) ----
  const ownerMap = new Map<string, { owner: string; count: number; value: number; weighted: number }>();
  for (const o of openOpps) {
    const key = o.ownerName ?? "Belum ditugaskan";
    const row = ownerMap.get(key) ?? { owner: key, count: 0, value: 0, weighted: 0 };
    row.count += 1;
    row.value += o.estimatedValue ?? 0;
    row.weighted += ((o.estimatedValue ?? 0) * o.probability) / 100;
    ownerMap.set(key, row);
  }
  const pipelinePerOwner = [...ownerMap.values()]
    .map((r) => ({ ...r, value: Math.round(r.value), weighted: Math.round(r.weighted) }))
    .sort((a, b) => b.value - a.value);

  // ---- KPI ringkas periode ----
  const wonValue = wonOpps.reduce((s, o) => s + (o.estimatedValue ?? 0), 0);
  const respondedLeads = leads.filter((l) => l.respondedAt);
  const avgRespMs = respondedLeads.reduce(
    (s, l) => s + (l.respondedAt!.getTime() - l.createdAt.getTime()), 0
  );

  return ok({
    period: { days, since: since.toISOString(), until: now.toISOString() },
    totals: {
      wonValue: Math.round(wonValue),
      wonCount: wonOpps.length,
      lostCount,
      winRatePct: wonOpps.length + lostCount > 0
        ? Math.round((wonOpps.length / (wonOpps.length + lostCount)) * 100)
        : 0,
      outstanding: Math.round(outstandingTotal),
      avgResponseHours: respondedLeads.length > 0
        ? Math.round((avgRespMs / respondedLeads.length / HOUR) * 10) / 10
        : 0,
    },
    revenuePerBrand,
    winRatePerService,
    slaCompliance,
    invoiceAging,
    pipelinePerOwner,
  });
}
