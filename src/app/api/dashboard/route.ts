import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { OPEN_STAGES } from "@/lib/crm/constants";
import { runSlaSweep } from "@/lib/crm/sla-sweep";
import { getSessionUser } from "@/lib/crm/session";
import type { DashboardMineView, DashboardProductionView, DashboardTeamView, DashboardFinanceView, DashboardRoleView as DashboardRoleViewType } from "@/lib/crm/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function GET(req: NextRequest) {
  // Fase 3 — SLA auto-sweep: berjalan periodik selama dashboard terbuka
  // (polling 60 dtk, throttle 5 menit di lib). Kegagalan sweep diabaikan.
  let autoEscalated = 0;
  try {
    autoEscalated = await runSlaSweep();
  } catch {
    autoEscalated = 0;
  }

  // Ronde 31 — dashboard per-role: identitas dari sesi (best-effort, GET terbuka —
  // tanpa sesi → roleView guest → UI menampilkan view eksekutif bawaan).
  const session = await getSessionUser(req);

  const [
    opportunities, interactions, tasks, invoices, projects, recentAudit, brands, pendingApprovals,
    unresolvedInbound, pendingChangeRequests,
  ] = await Promise.all([
    db.opportunity.findMany({ where: { deletedAt: null }, include: { brand: true, contact: true, company: true }, take: 2000 }),
    db.interaction.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    db.task.findMany({ where: { status: "open" }, take: 2000 }),
    db.invoice.findMany({ include: { payments: true, company: { select: { name: true } } }, take: 2000 }),
    db.project.findMany({ include: { brand: { select: { name: true, color: true } }, company: { select: { name: true } } }, take: 2000 }),
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

  // ==== Ronde 31 — ROLE VIEW (data terpersonalisasi per peran) ====
  let roleView: DashboardRoleViewType | undefined;
  if (session) {
    const role = session.role;
    const userName = session.name;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + DAY);
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

    const needsMine = role === "marketing" || role === "manager" || role === "super_admin" || role === "director";
    const needsFinance = role === "finance" || role === "super_admin" || role === "director";
    const needsProduction = role === "production" || role === "manager" || role === "super_admin" || role === "director";
    const needsTeam = role === "hr" || role === "manager" || role === "super_admin" || role === "director";

    const [usersAgg, milestonesSoon, deliverablesPending] = await Promise.all([
      needsTeam
        ? db.user.findMany({ select: { role: true, active: true } })
        : Promise.resolve([]),
      needsProduction
        ? db.milestone.findMany({
            where: { status: { not: "done" }, dueDate: { not: null, lte: new Date(now + 7 * DAY) } },
            include: { project: { select: { name: true, code: true } } },
            orderBy: { dueDate: "asc" },
            take: 8,
          })
        : Promise.resolve([]),
      needsProduction
        ? db.projectDeliverable.count({ where: { status: "pending" } })
        : Promise.resolve(0),
    ]);

    // MARKETING — cockpit personal (ownerName = nama user)
    if (needsMine) {
      const mine = opportunities.filter((o) => o.ownerName === userName);
      const myOpen = mine.filter((o) => (OPEN_STAGES as string[]).includes(o.stage));
      const myWon = mine.filter((o) => o.stage === "won");
      const myTasks = tasks.filter((t) => t.assigneeName === userName);
      const mineView: DashboardMineView = {
        openLeads: myOpen.length,
        pipelineValue: myOpen.reduce((s, o) => s + (o.estimatedValue ?? 0), 0),
        wonCount: myWon.length,
        wonValue: myWon.reduce((s, o) => s + (o.estimatedValue ?? 0), 0),
        tasksOpen: myTasks.length,
        tasksDueToday: myTasks.filter((t) => t.dueDate && t.dueDate >= startOfDay && t.dueDate < endOfDay).length,
        tasksOverdue: myTasks.filter((t) => t.dueDate && t.dueDate < startOfDay).length,
        topDeals: [...myOpen]
          .sort((a, b) => (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0))
          .slice(0, 5)
          .map((o) => ({
            id: o.id,
            title: o.title,
            stage: o.stage,
            value: o.estimatedValue,
            brandName: o.brand.name,
            brandColor: o.brand.color,
            companyName: o.company?.name ?? null,
          })),
        myTasks: myTasks
          .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
          .slice(0, 6)
          .map((t) => ({
            id: t.id,
            title: t.title,
            dueDate: t.dueDate?.toISOString() ?? null,
            priority: t.priority,
            overdue: Boolean(t.dueDate && t.dueDate < startOfDay),
            dueToday: Boolean(t.dueDate && t.dueDate >= startOfDay && t.dueDate < endOfDay),
            opportunityTitle: t.opportunityId ? (opportunities.find((o) => o.id === t.opportunityId)?.title ?? null) : null,
          })),
        funnel: stageOrder.map((stage) => {
          const items = mine.filter((o) => o.stage === stage);
          return { stage, count: items.length, value: items.reduce((s, o) => s + (o.estimatedValue ?? 0), 0) };
        }),
      };
      roleView = { ...(roleView ?? { role, userName }), role, userName, mine: mineView };
    }

    // FINANCE — arus kas & tagihan
    if (needsFinance) {
      const live = invoices.filter((i) => i.status !== "draft" && i.status !== "cancelled");
      const outstandingOf = (i: (typeof live)[number]) => i.total - i.payments.reduce((p, pay) => p + pay.amount, 0);
      const statusKeys = ["sent", "partial", "overdue", "paid"];
      const financeView: DashboardFinanceView = {
        outstanding: live.reduce((s, i) => s + Math.max(outstandingOf(i), 0), 0),
        overdueCount: live.filter((i) => i.status === "overdue" || (i.dueDate && i.dueDate.getTime() < now && outstandingOf(i) > 0)).length,
        collectedThisMonth: Math.round(live.reduce((s, i) => s + i.payments.filter((p) => p.paidAt >= startOfMonth).reduce((p, pay) => p + pay.amount, 0), 0)),
        billedThisMonth: Math.round(live.filter((i) => i.issueDate >= startOfMonth).reduce((s, i) => s + i.total, 0)),
        byStatus: statusKeys.map((status) => {
          const items = live.filter((i) => i.status === status);
          return { status, count: items.length, total: Math.round(items.reduce((s, i) => s + i.total, 0)) };
        }),
        overdueList: live
          .filter((i) => i.status === "overdue" || (i.dueDate && i.dueDate.getTime() < now && outstandingOf(i) > 0))
          .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
          .slice(0, 5)
          .map((i) => ({
            id: i.id,
            number: i.number,
            company: i.company?.name ?? "—",
            total: Math.round(outstandingOf(i)),
            dueDate: i.dueDate?.toISOString() ?? null,
            status: i.status,
          })),
        byBrand: brands.map((b) => {
          const items = live.filter((i) => i.brandId === b.id);
          return {
            name: b.name,
            color: b.color,
            outstanding: Math.round(items.reduce((s, i) => s + Math.max(outstandingOf(i), 0), 0)),
            count: items.length,
          };
        }).filter((b) => b.count > 0),
      };
      roleView = { ...(roleView ?? { role, userName }), role, userName, finance: financeView };
    }

    // PRODUCTION — antrian produksi
    if (needsProduction) {
      const activeProjects = projects.filter((p) => p.status === "in_progress" || p.status === "planning" || p.status === "review");
      const productionView: DashboardProductionView = {
        activeProjects: activeProjects.length,
        atRisk: projects.filter((p) => p.dueDate && p.dueDate.getTime() < now + 7 * DAY && p.status !== "completed" && p.status !== "cancelled").length,
        inReview: projects.filter((p) => p.status === "review").length,
        pendingCRs: pendingChangeRequests,
        deliverablesPending,
        milestonesDueSoon: milestonesSoon.map((m) => ({
          projectCode: m.project.code,
          projectName: m.project.name,
          name: m.name,
          dueDate: m.dueDate?.toISOString() ?? null,
          status: m.status,
        })),
        queue: activeProjects
          .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
          .slice(0, 6)
          .map((p) => ({
            code: p.code,
            name: p.name,
            brandName: p.brand.name,
            brandColor: p.brand.color,
            progress: p.progress,
            status: p.status,
            dueDate: p.dueDate?.toISOString() ?? null,
            companyName: p.company.name,
          })),
      };
      roleView = { ...(roleView ?? { role, userName }), role, userName, production: productionView };
    }

    // TEAM (HR/manager) — orang & beban kerja
    if (needsTeam) {
      const byRole = new Map<string, { count: number; active: number }>();
      for (const u of usersAgg) {
        const cur = byRole.get(u.role) ?? { count: 0, active: 0 };
        cur.count += 1;
        if (u.active) cur.active += 1;
        byRole.set(u.role, cur);
      }
      const teamView: DashboardTeamView = {
        totalUsers: usersAgg.length,
        activeUsers: usersAgg.filter((u) => u.active).length,
        usersByRole: [...byRole.entries()].map(([r, v]) => ({ role: r, count: v.count, active: v.active })).sort((a, b) => b.count - a.count),
        tasksOpen: tasks.length,
        tasksDueToday: tasks.filter((t) => t.dueDate && t.dueDate >= startOfDay && t.dueDate < endOfDay).length,
        tasksOverdue: tasks.filter((t) => t.dueDate && t.dueDate.getTime() < now).length,
      };
      roleView = { ...(roleView ?? { role, userName }), role, userName, team: teamView };
    }

    if (!roleView) roleView = { role, userName };
  }

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
    roleView,
  });
}
