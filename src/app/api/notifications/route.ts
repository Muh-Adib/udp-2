import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody } from "@/lib/crm/server";
import type { Prisma } from "@prisma/client";
import type { NotificationDTO, NotificationSeverity } from "@/lib/crm/types";

/**
 * Notifikasi in-app (Fase 3) — komputasi dari data operasional:
 *  - sla      : lead inbound belum dikonversi melewati SLA brand (marketing/direktur)
 *  - approval : ApprovalRequest menunggu keputusan (direktur/keuangan)
 *  - cr       : ChangeRequest menunggu keputusan (direktur; produksi lihat info)
 *  - task     : Task overdue milik pengguna (atau semua utk direktur/super admin)
 *  - deadline : deadline project ≤7 hari / terlampaui (direktur/produksi)
 *  - invoice  : invoice jatuh tempo terlewat & belum lunas (keuangan/direktur)
 * State baca/dismiss per pengguna persist di tabel NotificationState.
 */

const SEVERITY_RANK: Record<NotificationSeverity, number> = { danger: 0, warning: 1, info: 2 };

const DECIDER_ROLES = new Set(["director", "super_admin"]);
const OPS_ROLES = new Set(["director", "super_admin", "production"]);
const FINANCE_ROLES = new Set(["director", "super_admin", "finance"]);
const MARKETING_ROLES = new Set(["director", "super_admin", "marketing"]);

function ageHours(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / (60 * 60 * 1000)));
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function money(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const email = sp.get("user")?.trim().toLowerCase();
  if (!email) return fail("Parameter user wajib diisi", 400);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return fail("Pengguna tidak ditemukan", 404);
  const role = user.role;
  const brandFilter = sp.get("brandId");
  const brandWhere: Prisma.BrandWhereInput | undefined =
    brandFilter && brandFilter !== "all" ? { id: brandFilter } : undefined;

  type Draft = Omit<NotificationDTO, "read">;
  const drafts: Draft[] = [];
  const push = (d: Draft) => {
    if (drafts.length < 60) drafts.push(d);
  };

  // 1. SLA breach — lead inbound BELUM direspons & belum dikonversi melewati slaHours brand
  //    Fix ronde 16: filter respondedAt:null (lead terrespons tak boleh menggantung),
  //    ambil 150 terbaru (desc) agar breach baru SELALU masuk walau backlog besar,
  //    lalu urutkan breach dgn jam-tunggu terbesar dulu (paling kritis di atas).
  if (MARKETING_ROLES.has(role)) {
    const leads = await db.interaction.findMany({
      where: {
        direction: "inbound",
        opportunityId: null,
        respondedAt: null,
        ...(brandWhere ? { brand: brandWhere } : {}),
      },
      include: { brand: true, contact: true },
      orderBy: { createdAt: "desc" },
      take: 150,
    });
    const breached = leads
      .map((lead) => ({ lead, sla: lead.brand?.slaHours ?? 4, waited: ageHours(lead.createdAt) }))
      .filter((x) => x.waited > x.sla)
      .sort((a, b) => b.waited - a.waited);
    for (const { lead, sla, waited } of breached) {
      push({
        key: `sla:${lead.id}`,
        type: "sla",
        severity: "danger",
        title: `SLA terlampaui: ${lead.contact?.fullName ?? lead.senderName ?? "Lead baru"}`,
        description: `Menunggu respons ${waited} jam (SLA ${sla} jam) via ${lead.channel}.`,
        module: "inbox",
        brandName: lead.brand?.name ?? null,
        brandColor: lead.brand?.color ?? null,
        entityLabel: null,
        at: lead.createdAt.toISOString(),
        ageHours: waited,
      });
    }
  }

  // 2. Approval pending — estimasi/diskon menunggu keputusan
  if (FINANCE_ROLES.has(role)) {
    const approvals = await db.approvalRequest.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 15,
    });
    for (const a of approvals) {
      const opp = a.opportunityId
        ? await db.opportunity.findUnique({ where: { id: a.opportunityId }, include: { brand: true } })
        : null;
      if (brandWhere && opp?.brandId !== brandFilter) continue;
      push({
        key: `approval:${a.id}`,
        type: "approval",
        severity: "warning",
        title: `Approval ${a.entityType} menunggu keputusan`,
        description: `${a.entityLabel ?? a.entityType}${a.amount ? ` · ${money(a.amount)}` : ""} diajukan ${a.requestedBy}.`,
        module: "dashboard",
        brandName: opp?.brand?.name ?? null,
        brandColor: opp?.brand?.color ?? null,
        entityLabel: a.entityLabel ?? null,
        at: a.createdAt.toISOString(),
        ageHours: ageHours(a.createdAt),
      });
    }
  }

  // 3. Change request pending — menunggu keputusan internal/klien
  if (OPS_ROLES.has(role)) {
    const crs = await db.changeRequest.findMany({
      where: { status: "pending" },
      include: { project: { include: { brand: true, company: true } } },
      orderBy: { createdAt: "asc" },
      take: 15,
    });
    for (const cr of crs) {
      if (brandWhere && cr.project.brandId !== brandFilter) continue;
      push({
        key: `cr:${cr.id}`,
        type: "cr",
        severity: DECIDER_ROLES.has(role) ? "warning" : "info",
        title: DECIDER_ROLES.has(role) ? `CR ${cr.number} menunggu keputusan Anda` : `CR ${cr.number} menunggu persetujuan klien`,
        description: `${cr.project.name} · tambahan ${money(cr.additionalCost)}${cr.additionalDays > 0 ? ` · +${cr.additionalDays} hari` : ""}.`,
        module: "projects",
        brandName: cr.project.brand?.name ?? null,
        brandColor: cr.project.brand?.color ?? null,
        entityLabel: cr.number,
        at: cr.createdAt.toISOString(),
        ageHours: ageHours(cr.createdAt),
      });
    }
  }

  // 4. Task overdue — milik pengguna; direktur/super admin melihat semua
  const taskWhere: Prisma.TaskWhereInput = {
    status: "open",
    dueDate: { lt: new Date() },
    ...(DECIDER_ROLES.has(role) ? {} : { assigneeName: user.name }),
  };
  const tasks = await db.task.findMany({
    where: taskWhere,
    include: { opportunity: { include: { brand: true } } },
    orderBy: { dueDate: "asc" },
    take: 15,
  });
  for (const t of tasks) {
    if (brandWhere && t.opportunity?.brandId !== brandFilter) continue;
    const overdueDays = Math.max(1, Math.floor((Date.now() - (t.dueDate?.getTime() ?? Date.now())) / (24 * 60 * 60 * 1000)));
    push({
      key: `task:${t.id}`,
      type: "task",
      severity: overdueDays >= 3 ? "danger" : "warning",
      title: `Task terlambat ${overdueDays} hari: ${t.title}`,
      description: `Assignee ${t.assigneeName ?? "-"} · tenggat ${t.dueDate ? shortDate(t.dueDate) : "-"}.`,
      module: "followups",
      brandName: t.opportunity?.brand?.name ?? null,
      brandColor: t.opportunity?.brand?.color ?? null,
      entityLabel: null,
      at: (t.dueDate ?? t.createdAt).toISOString(),
      ageHours: ageHours(t.dueDate ?? t.createdAt),
    });
  }

  // 5. Deadline project dekat (≤7 hari) atau terlampaui
  if (OPS_ROLES.has(role)) {
    const now = new Date();
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const projects = await db.project.findMany({
      where: { status: { notIn: ["completed", "cancelled"] }, dueDate: { lte: soon }, ...(brandWhere ? { brand: brandWhere } : {}) },
      include: { brand: true, company: true },
      orderBy: { dueDate: "asc" },
      take: 15,
    });
    for (const p of projects) {
      if (!p.dueDate) continue;
      const overdue = p.dueDate.getTime() < now.getTime();
      const days = Math.max(1, Math.floor(Math.abs(now.getTime() - p.dueDate.getTime()) / (24 * 60 * 60 * 1000)));
      push({
        key: `deadline:${p.id}`,
        type: "deadline",
        severity: overdue ? "danger" : "warning",
        title: overdue
          ? `Deadline project terlewat ${days} hari: ${p.name}`
          : `Deadline project ${days} hari lagi: ${p.name}`,
        description: `${p.code} · ${p.company.name} · tenggat ${shortDate(p.dueDate)} · progress ${p.progress}%.`,
        module: "projects",
        brandName: p.brand?.name ?? null,
        brandColor: p.brand?.color ?? null,
        entityLabel: p.code,
        at: p.dueDate.toISOString(),
        ageHours: ageHours(p.dueDate),
      });
    }
  }

  // 6. Invoice jatuh tempo terlewat & belum lunas
  if (FINANCE_ROLES.has(role)) {
    const invoices = await db.invoice.findMany({
      where: { status: { in: ["sent", "partial", "overdue"] }, dueDate: { lt: new Date() }, ...(brandWhere ? { brand: brandWhere } : {}) },
      include: { brand: true, company: true },
      orderBy: { dueDate: "asc" },
      take: 15,
    });
    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const days = Math.max(1, Math.floor((Date.now() - inv.dueDate.getTime()) / (24 * 60 * 60 * 1000)));
      push({
        key: `invoice:${inv.id}`,
        type: "invoice",
        severity: days >= 14 ? "danger" : "warning",
        title: `Invoice ${inv.number} jatuh tempo ${days} hari lalu`,
        description: `${inv.company.name} · sisa ${money(inv.total)} · status ${inv.status}.`,
        module: "finance",
        brandName: inv.brand?.name ?? null,
        brandColor: inv.brand?.color ?? null,
        entityLabel: inv.number,
        at: inv.dueDate.toISOString(),
        ageHours: ageHours(inv.dueDate),
      });
    }
  }

  // Gabungkan state baca/dismiss per pengguna
  const keys = drafts.map((d) => d.key);
  const states = keys.length
    ? await db.notificationState.findMany({ where: { userKey: email, notifKey: { in: keys } } })
    : [];
  const stateMap = new Map(states.map((s) => [s.notifKey, s]));

  const items: NotificationDTO[] = drafts
    .filter((d) => !stateMap.get(d.key)?.dismissedAt)
    .map((d) => ({ ...d, read: !!stateMap.get(d.key)?.readAt }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.at.localeCompare(b.at));

  return ok({ items, unread: items.filter((i) => !i.read).length });
}

/** Tandai baca/belum dibaca/dismiss — state persist per pengguna. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const email = typeof body.user === "string" ? body.user.trim().toLowerCase() : "";
  const action = typeof body.action === "string" ? body.action : "";
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : [];

  if (!email) return fail("Parameter user wajib diisi", 400);
  if (!["read", "unread", "dismiss"].includes(action)) return fail("Aksi tidak dikenal", 400);
  if (keys.length === 0) return fail("Daftar keys wajib diisi", 400);
  if (keys.length > 200) return fail("Maksimal 200 keys per permintaan", 400);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return fail("Pengguna tidak ditemukan", 404);

  const readAt = action === "read" ? new Date() : null;
  const dismissedAt = action === "dismiss" ? new Date() : null;

  await Promise.all(
    keys.map((notifKey) =>
      db.notificationState.upsert({
        where: { userKey_notifKey: { userKey: email, notifKey } },
        create: { userKey: email, notifKey, readAt, dismissedAt },
        update: { readAt, dismissedAt },
      })
    )
  );

  return ok({ ok: true, updated: keys.length });
}
