import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { OPEN_STAGES } from "@/lib/crm/constants";
import { runSlaSweep } from "@/lib/crm/sla-sweep";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function GET() {
  // Fase 3 — SLA auto-sweep: berjalan periodik selama dashboard terbuka
  // (polling 60 dtk, throttle 5 menit di lib). Kegagalan sweep diabaikan.
  let autoEscalated = 0;
  try {
    autoEscalated = await runSlaSweep();
  } catch {
    autoEscalated = 0;
  }

  const [
    opportunities, interactions, tasks, invoices, projects, recentAudit, brands, pendingApprovals,
    unresolvedInbound, pendingChangeRequests,
  ] = await Promise.all([
    db.opportunity.findMany({ where: { deletedAt: null }, include: { brand: true, contact: true, company: true } }),
    db.interaction.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    db.task.findMany({ where: { status: "open" } }),
    db.invoice.findMany({ include: { payments: true } }),
    db.project.findMany(),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.brand.findMany(),
    db.approvalRequest.findMany({
      where: { status: "pending" },
      include: { opportunity: { include: { brand: true } } },
      orderBy: { createdAt: "asc" },
      take: 10,
    }),
    // Fase 3 — SLA monitoring: lead inbound belum direspons (satu query, dihitung di memori)
    db.interaction.findMany({
      where: { direction: "inbound", opportunityId: null, respondedAt: null },
      select: { createdAt: true, brandId: true, brand: { select: { slaHours: true } } },
    }),
    // CR menunggu persetujuan klien (Fase 2 — Produksi)
    db.changeRequest.count({ where: { status: "pending" } }),
  ]);

  const open = opportunities.filter((o) => (OPEN_STAGES as string[]).includes(o.stage));
  const won = opportunities.filter((o) => o.stage === "won");
  const lost = opportunities.filter((o) => o.stage === "lost");

  const pipelineValue = open.reduce((s, o) => s + (o.estimatedValue ?? 0), 0);
  const weightedPipeline = open.reduce((s, o) => s + ((o.estimatedValue ?? 0) * o.probability) / 100, 0);
  const wonValue = won.reduce((s, o) => s + (o.estimatedValue ?? 0), 0);
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

  // Average response time (inbound -> outbound reply per opportunity)
  let totalResp = 0, respCount = 0;
  const byOpp = new Map<string, typeof interactions>();
  interactions.forEach((i) => {
    if (!i.opportunityId) return;
    const arr = byOpp.get(i.opportunityId) ?? [];
    arr.push(i);
    byOpp.set(i.opportunityId, arr);
  });
  byOpp.forEach((arr) => {
    arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let lastInbound: Date | null = null;
    for (const i of arr) {
      if (i.direction === "inbound") lastInbound = i.createdAt;
      else if (lastInbound && i.respondedBy) {
        const h = (i.createdAt.getTime() - lastInbound.getTime()) / HOUR;
        if (h < 72) { totalResp += h; respCount++; }
        lastInbound = null;
      }
    }
  });
  const avgResponseHours = respCount > 0 ? Math.round((totalResp / respCount) * 10) / 10 : 0;

  const nowMs = Date.now();
  const slaBreaches = unresolvedInbound.filter((i) => {
    const slaHours = i.brand?.slaHours ?? 0;
    if (slaHours <= 0) return false;
    return (nowMs - i.createdAt.getTime()) / HOUR > slaHours;
  }).length;

  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate.getTime() < Date.now()).length;
  const unassignedLeads = opportunities.filter((o) => o.stage === "new" && !o.ownerName).length;

  const outstanding = invoices
    .filter((i) => ["sent", "partial", "overdue"].includes(i.status))
    .reduce((s, i) => {
      const paid = i.payments.reduce((p, pay) => p + pay.amount, 0);
      return s + (i.total - paid);
    }, 0);

  // Funnel
  const stageOrder = [...OPEN_STAGES, "won", "lost", "nurture"];
  const funnel = stageOrder.map((stage) => {
    const items = opportunities.filter((o) => o.stage === stage);
    return {
      stage,
      count: items.length,
      value: items.reduce((s, o) => s + (o.estimatedValue ?? 0), 0),
    };
  });

  // By brand
  const byBrand = brands.map((b) => {
    const items = opportunities.filter((o) => o.brandId === b.id);
    return {
      brandId: b.id,
      name: b.name,
      color: b.color,
      leads: items.length,
      won: items.filter((o) => o.stage === "won").length,
      value: items.filter((o) => (OPEN_STAGES as string[]).includes(o.stage)).reduce((s, o) => s + (o.estimatedValue ?? 0), 0),
    };
  });

  // By channel (leadSource)
  const channelMap = new Map<string, number>();
  opportunities.forEach((o) => {
    const src = o.leadSource ?? "unknown";
    channelMap.set(src, (channelMap.get(src) ?? 0) + 1);
  });
  const byChannel = [...channelMap.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);

  // By country
  const countryMap = new Map<string, number>();
  opportunities.forEach((o) => {
    const c = o.company?.country ?? o.contact.country ?? "Tidak diketahui";
    countryMap.set(c, (countryMap.get(c) ?? 0) + 1);
  });
  const byCountry = [...countryMap.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count);

  // Forecast 30/60/90 (weighted, open deals by expected close date)
  const now = Date.now();
  const forecast = [
    { bucket: "0-30 hari", value: 0 },
    { bucket: "31-60 hari", value: 0 },
    { bucket: "61-90 hari", value: 0 },
  ];
  open.forEach((o) => {
    if (!o.expectedCloseDate) return;
    const d = o.expectedCloseDate.getTime() - now;
    const w = ((o.estimatedValue ?? 0) * o.probability) / 100;
    if (d <= 30 * DAY) forecast[0].value += w;
    else if (d <= 60 * DAY) forecast[1].value += w;
    else if (d <= 90 * DAY) forecast[2].value += w;
  });

  // Lost reasons
  const lostMap = new Map<string, number>();
  lost.forEach((o) => {
    if (!o.lostReason) return;
    lostMap.set(o.lostReason, (lostMap.get(o.lostReason) ?? 0) + 1);
  });
  const lostReasons = [...lostMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  // Marketing performance
  const mktMap = new Map<string, { leads: number; won: number; resp: number; respCount: number }>();
  opportunities.forEach((o) => {
    if (!o.ownerName) return;
    const m = mktMap.get(o.ownerName) ?? { leads: 0, won: 0, resp: 0, respCount: 0 };
    m.leads++;
    if (o.stage === "won") m.won++;
    mktMap.set(o.ownerName, m);
  });
  byOpp.forEach((arr, oppId) => {
    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp?.ownerName) return;
    arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let lastInbound: Date | null = null;
    for (const i of arr) {
      if (i.direction === "inbound") lastInbound = i.createdAt;
      else if (lastInbound && i.respondedBy) {
        const m = mktMap.get(opp.ownerName);
        if (m) {
          const h = (i.createdAt.getTime() - lastInbound.getTime()) / HOUR;
          if (h < 72) { m.resp += h; m.respCount++; }
        }
        lastInbound = null;
      }
    }
  });
  const marketingPerf = [...mktMap.entries()].map(([name, m]) => ({
    name, leads: m.leads, won: m.won,
    avgResponseHours: m.respCount ? Math.round((m.resp / m.respCount) * 10) / 10 : 0,
  })).sort((a, b) => b.leads - a.leads);

  // Pipeline trend (last 6 weeks created vs won)
  const pipelineTrend: { label: string; created: number; won: number }[] = [];
  for (let w = 5; w >= 0; w--) {
    const start = now - (w + 1) * 7 * DAY;
    const end = now - w * 7 * DAY;
    pipelineTrend.push({
      label: w === 0 ? "Minggu ini" : `-${w} mgg`,
      created: opportunities.filter((o) => o.createdAt >= new Date(start) && o.createdAt < new Date(end)).length,
      won: opportunities.filter((o) => o.stage === "won" && o.updatedAt >= new Date(start) && o.updatedAt < new Date(end)).length,
    });
  }

  return ok({
    kpi: {
      totalLeads: opportunities.length,
      openLeads: open.length,
      pipelineValue,
      weightedPipeline: Math.round(weightedPipeline),
      winRate,
      wonValue,
      avgResponseHours,
      overdueTasks,
      unassignedLeads,
      outstandingInvoices: Math.round(outstanding),
    },
    funnel, byBrand, byChannel, byCountry, forecast, lostReasons, marketingPerf,
    recentAudit, pipelineTrend, pendingApprovals,
    projectsAtRisk: projects.filter((p) => p.dueDate && p.dueDate.getTime() < now + 7 * DAY && p.status !== "completed").length,
    productionCapacity: projects.filter((p) => p.status === "in_progress" || p.status === "planning").length,
    slaBreaches,
    pendingChangeRequests,
    autoEscalated,
  });
}
