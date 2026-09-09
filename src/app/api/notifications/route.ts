import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody } from "@/lib/crm/server";
import { parseTaskAssignees } from "@/lib/crm/task-parse";
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

/** Ronde 46 — entitas audit → modul tujuan navigasi saat notifikasi diklik. */
const ACTIVITY_MODULE: Record<string, string> = {
  opportunity: "pipeline", brief: "pipeline", quotation: "finance", invoice: "finance",
  estimation: "pipeline", payment: "finance", approval: "dashboard",
  project: "projects", milestone: "projects", change_request: "projects",
  task: "followups", contact: "contacts", company: "contacts", interaction: "inbox",
  user: "users", brand: "brands",
};

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

  // 1b. Ronde 32 — PESAN BARU dari lead (inbound belum direspons ≤24 jam):
  //     memastikan marketing TAHU saat lead/klien membalas, bahkan saat tidak
  //     sedang membuka Lead Inbox. Mencakup DUA kasus:
  //     (a) lead belum dikonversi — jalur prospek baru;
  //     (b) balasan dari klien yang SUDAH terkonversi opportunity (thread lanjutan).
  //     SLA (di atas) mengambil alih saat tunggu >slaHours (severity danger) —
  //     section ini menutup celah "jam-jam pertama".
  if (MARKETING_ROLES.has(role)) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const fresh = await db.interaction.findMany({
      where: {
        direction: "inbound",
        respondedAt: null,
        createdAt: { gte: dayAgo },
        ...(brandWhere ? { brand: brandWhere } : {}),
      },
      include: {
        brand: true,
        contact: true,
        opportunity: { select: { id: true, title: true, stage: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    for (const msg of fresh) {
      const sender = msg.contact?.fullName ?? msg.senderName ?? "Lead baru";
      push({
        key: `msg:${msg.id}`,
        type: "message",
        severity: "info",
        title: msg.opportunity
          ? `Balasan dari ${sender} — ${msg.opportunity.title}`
          : `Pesan baru dari ${sender}`,
        description: `${msg.channel}${msg.brand ? ` · ${msg.brand.name}` : ""} · "${msg.content.slice(0, 90)}${msg.content.length > 90 ? "…" : ""}"`,
        module: "inbox",
        brandName: msg.brand?.name ?? null,
        brandColor: msg.brand?.color ?? null,
        entityLabel: null,
        at: msg.createdAt.toISOString(),
        ageHours: ageHours(msg.createdAt),
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
  //    Ronde 40 — "milik pengguna" juga mencakup multi-assignee (JSON assignees)
  const taskWhere: Prisma.TaskWhereInput = {
    status: "open",
    dueDate: { lt: new Date() },
    ...(DECIDER_ROLES.has(role)
      ? {}
      : {
          // Pre-filter longgar (contains), dipresisi di bawah via parseTaskAssignees
          OR: [{ assigneeName: user.name }, { assignees: { contains: user.name } }],
        }),
  };
  const tasks = (await db.task.findMany({
    where: taskWhere,
    include: { opportunity: { include: { brand: true } } },
    orderBy: { dueDate: "asc" },
    take: 30,
  }))
    .filter((t) =>
      DECIDER_ROLES.has(role) ||
      t.assigneeName === user.name ||
      parseTaskAssignees(t.assignees).includes(user.name)
    )
    .slice(0, 15);
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

  // 4b. Ronde 42 — REMINDER MEETING: task tipe "meeting" yang dimulai ≤60 menit lagi
  //     (atau baru saja mulai ≤30 menit lewat) — menginformasikan SEMUA assignee-nya,
  //     dengan jam mulai eksplisit (tanggal + JAM, bukan hanya tanggal).
  {
    const now = Date.now();
    const from = new Date(now - 30 * 60 * 1000); // sudah mulai ≤30 menit — tetap ditampilkan
    const until = new Date(now + 60 * 60 * 1000); // mulai ≤60 menit lagi
    const meetings = await db.task.findMany({
      where: {
        type: "meeting",
        status: "open",
        dueDate: { gte: from, lte: until },
        ...(DECIDER_ROLES.has(role)
          ? {}
          : { OR: [{ assigneeName: user.name }, { assignees: { contains: user.name } }] }),
      },
      include: { opportunity: { include: { brand: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    });
    for (const t of meetings) {
      if (
        !DECIDER_ROLES.has(role) &&
        t.assigneeName !== user.name &&
        !parseTaskAssignees(t.assignees).includes(user.name)
      ) {
        continue;
      }
      if (brandWhere && t.opportunity?.brandId !== brandFilter) continue;
      const start = t.dueDate ?? from;
      const diffMin = Math.round((start.getTime() - now) / 60000);
      const hhmm = start.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      const when =
        diffMin > 0
          ? diffMin >= 55
            ? `dimulai ${hhmm} (±1 jam lagi)`
            : `dimulai ${hhmm} (${diffMin} menit lagi)`
          : diffMin >= -5
            ? `sedang berlangsung — mulai ${hhmm}`
            : `mulai ${hhmm} (${Math.abs(diffMin)} menit lalu)`;
      push({
        key: `meeting:${t.id}`,
        type: "meeting",
        severity: "warning",
        title: `Meeting ${when}: ${t.title}`,
        description: `${t.opportunity ? `${t.opportunity.title} · ` : ""}Assignee ${parseTaskAssignees(t.assignees).join(", ") || t.assigneeName || "-"}.`,
        module: "followups",
        brandName: t.opportunity?.brand?.name ?? null,
        brandColor: t.opportunity?.brand?.color ?? null,
        entityLabel: null,
        at: start.toISOString(),
        ageHours: 0,
      });
    }
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

  // 7. Ronde 46 — AKTIVITAS ANTAR PENGGUNA dari audit log:
  //    "rekan saya barusan melakukan apa" — brief dikirim/disetujui, invoice
  //    diterbitkan/dikirim, approval diajukan/diputuskan, task dibuat, lead
  //    dikonversi, dsb. Sumber kebenaran = AuditLog (immutable, sudah mencatat
  //    setiap mutasi). Difilter: bukan aksi sendiri, bukan noise login, dan
  //    entitas yang relevan dgn role pembaca.
  {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Entitas yang menarik per role (pimpinan melihat semuanya).
    const INTEREST: Record<string, string[]> = {
      marketing: ["opportunity", "brief", "quotation", "contact", "company", "task", "interaction", "user"],
      finance: ["invoice", "quotation", "approval", "estimation", "payment", "project"],
      production: ["project", "task", "change_request", "brief", "milestone", "opportunity"],
    };
    const interesting = DECIDER_ROLES.has(role)
      ? null // semua entitas
      : (INTEREST[role] ?? null);
    // Aksi bernilai informasi (exclude noise sesi & pembacaan).
    const SKIP_ACTIONS = new Set(["login", "login_failed", "logout", "session_lock", "session_unlock", "session_unlock_failed", "read"]);
    const audits = await db.auditLog.findMany({
      where: { createdAt: { gte: dayAgo } },
      orderBy: { createdAt: "desc" },
      take: 120,
    });
    let activityCount = 0;
    for (const a of audits) {
      if (activityCount >= 15) break;
      if (a.actorName === user.name) continue; // bukan aksi sendiri
      if (SKIP_ACTIONS.has(a.action)) continue;
      if (interesting && !interesting.includes(a.entity)) continue;
      const entityName: Record<string, string> = {
        opportunity: "peluang", brief: "brief", quotation: "penawaran", invoice: "invoice",
        approval: "approval", estimation: "estimasi", project: "project", task: "tugas",
        change_request: "change request", contact: "kontak", company: "perusahaan",
        interaction: "lead", user: "pengguna", brand: "brand", payment: "pembayaran",
        milestone: "milestone", "client_document": "dokumen",
      };
      const actionText: Record<string, string> = {
        create: "menambahkan", update: "memperbarui", delete: "menghapus",
        convert: "mengonversi", stage_change: "memindahkan tahap", approve: "menyetujui",
        merge: "menggabungkan", send: "mengirim",
      };
      const verb = actionText[a.action] ?? a.action;
      const label = a.entityLabel ?? a.entityId;
      // Ronde 46 — metadata teknis (JSON payload) tidak ditampilkan mentah:
      // hanya metadata naratif (mis. "Pengguna baru X dibuat") yang ikut.
      const metaText =
        a.metadata && !a.metadata.trim().startsWith("{")
          ? ` — ${a.metadata.slice(0, 90)}`
          : "";
      push({
        key: `activity:${a.id}`,
        type: "activity",
        severity: "info",
        title: `${a.actorName} ${verb} ${entityName[a.entity] ?? a.entity}`,
        description: `${label}${metaText}`,
        module: ACTIVITY_MODULE[a.entity] ?? "dashboard",
        brandName: null,
        brandColor: null,
        entityLabel: label.slice(0, 60),
        at: a.createdAt.toISOString(),
        ageHours: ageHours(a.createdAt),
      });
      activityCount += 1;
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
