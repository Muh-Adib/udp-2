"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlarmClockOff, AlertTriangle, ArrowRight, Banknote, Bell, CalendarClock, Check, CheckCircle2, ClipboardList, Clock3, Coins, Factory, GitPullRequestArrow, Globe, Handshake, ListTodo, Minus, ReceiptText,
  RefreshCw, Rocket, ShieldAlert, Stamp, Target, Timer, TrendingDown, TrendingUp, Trophy, UserCheck, Users, Wallet, X, type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import { CHANNELS, PIPELINE_STAGES, ROLES, stageColor, stageLabel } from "@/lib/crm/constants";
import { applyNotifPrefs, useNotifPrefs } from "@/lib/crm/notif-prefs";
import { canAccess, useCrmStore, type ModuleKey } from "@/lib/crm/store";
import type { ApprovalRequestDTO, AuditLogDTO, DashboardData, DashboardFinanceView, DashboardMineView, DashboardProductionView, DashboardTeamView, NotificationDTO, NotificationSeverity } from "@/lib/crm/types";
import { formatCurrency, initials, timeAgo } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";
import { NOTIF_CHANGED_EVENT, OPEN_NOTIF_EVENT } from "@/components/crm/notification-center";

// ============ Tipe lokal ============

type KpiTrendKey =
  | "pipelineValue" | "weightedPipeline" | "winRate"
  | "wonValue" | "avgResponseHours" | "outstandingInvoices";
type KpiTrendMap = Partial<Record<KpiTrendKey, number | null>>;

/** DashboardData + field produksi/risko (sudah dikirim API, belum ada di tipe bersama). */
interface DashboardFullData extends DashboardData {
  projectsAtRisk: number;
  productionCapacity: number;
}

/** State dialog konfirmasi keputusan approval (Direktur). */
interface ApprovalConfirmState {
  approval: ApprovalRequestDTO;
  decision: "approve" | "reject";
}

const APPROVAL_ENTITY_LABEL: Record<string, string> = {
  estimation: "Estimasi",
  discount: "Diskon",
  budget: "Budget",
};

function approvalEntityLabel(type: string): string {
  return APPROVAL_ENTITY_LABEL[type] ?? type;
}

/** Normalisasi defensif field produksi/risko tanpa mengubah tipe bersama milik main agent. */
function normalizeDashboard(res: DashboardData): DashboardFullData {
  const raw = res as Partial<DashboardFullData>;
  return {
    ...res,
    projectsAtRisk: typeof raw.projectsAtRisk === "number" ? raw.projectsAtRisk : 0,
    productionCapacity: typeof raw.productionCapacity === "number" ? raw.productionCapacity : 0,
  };
}

interface KpiDef {
  key: KpiTrendKey;
  label: string;
  value: string;
  icon: LucideIcon;
  hint: string;
  accent: boolean;
  goodWhen: "up" | "down";
  badge?: ReactNode;
}

const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 10,
  border: "1px solid #e4e4e7",
  background: "#ffffff",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  fontSize: 12,
  color: "#18181b",
};

const TREND_KEYS: KpiTrendKey[] = [
  "pipelineValue", "weightedPipeline", "winRate", "wonValue", "avgResponseHours", "outstandingInvoices",
];

const ACTION_BADGE_CLASS: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-amber-100 text-amber-700",
  delete: "bg-rose-100 text-rose-700",
  convert: "bg-violet-100 text-violet-700",
  stage_change: "bg-cyan-100 text-cyan-700",
  payment: "bg-emerald-100 text-emerald-700",
  login: "bg-zinc-100 text-zinc-600",
};

// ============ Helper ============

function deltaPct(cur: number, prev?: number): number | null {
  if (prev === undefined || prev === 0) return null;
  const d = ((cur - prev) / prev) * 100;
  return Number.isFinite(d) ? d : null;
}

function computeTrends(prev: DashboardData["kpi"] | null, cur: DashboardData["kpi"]): KpiTrendMap {
  const out: KpiTrendMap = {};
  for (const key of TREND_KEYS) {
    out[key] = deltaPct(cur[key], prev?.[key]);
  }
  return out;
}

function trendNode(delta: number | null, goodWhen: "up" | "down"): ReactNode {
  if (delta === null) return null;
  if (Math.abs(delta) < 0.1) {
    return (
      <span className="inline-flex items-center gap-1 text-zinc-400">
        <Minus className="h-3 w-3" aria-hidden /> stabil
      </span>
    );
  }
  const up = delta > 0;
  const good = up ? goodWhen === "up" : goodWhen === "down";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${good ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {up ? "+" : ""}{delta.toFixed(1)}%
    </span>
  );
}

function slaBadgeClass(hours: number): string {
  if (hours <= 8) return "bg-emerald-100 text-emerald-700";
  if (hours > 24) return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
}

function formatHours(h: number): string {
  if (h <= 0) return "< 1 jam";
  if (h < 1) return `${Math.round(h * 60)} mnt`;
  return `${Math.round(h)} jam`;
}

function channelLabel(key: string): string {
  const found = CHANNELS.find((c) => c.key === key);
  if (found) return found.label;
  return key
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function actionBadgeClass(action: string): string {
  return ACTION_BADGE_CLASS[action] ?? "bg-zinc-100 text-zinc-600";
}

// ============ Sub-komponen ============

function KpiCard({
  label, value, icon: Icon, hint, trend, badge, accentColor, tone = "default",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint: string;
  trend?: ReactNode;
  badge?: ReactNode;
  accentColor?: string;
  /** Fase 3 — tone semantik: danger (rose/red), ok (emerald), default (zinc). */
  tone?: "default" | "danger" | "ok";
}) {
  const valueClass = tone === "danger" ? "text-red-600" : tone === "ok" ? "text-emerald-600" : "text-zinc-900";
  const chipClass = tone === "danger" ? "bg-rose-100 text-rose-600" : tone === "ok" ? "bg-emerald-100 text-emerald-600" : "bg-zinc-100 text-zinc-600";
  return (
    <div className="relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md">
      {accentColor ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accentColor }} />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
        </div>
        <span className={`shrink-0 rounded-lg p-2 ${chipClass}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        {trend}
        {badge}
        <span className="truncate">{hint}</span>
      </div>
    </div>
  );
}

function SectionCard({
  title, subtitle, overline, children, ariaLabel, className = "",
}: {
  title: string;
  subtitle?: string;
  overline?: string;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <section aria-label={ariaLabel} className={`rounded-xl border bg-white p-4 shadow-sm sm:p-6 ${className}`}>
      <div className="mb-4">
        {overline ? (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{overline}</p>
        ) : null}
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {subtitle ? <p className="text-xs text-zinc-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
      {text}
    </div>
  );
}

/** Baris pengajuan approval: kartu kecil dengan aksi Setujui/Tolak. */
function ApprovalRow({
  item, priority, busy, onDecide,
}: {
  item: ApprovalRequestDTO;
  priority: boolean;
  busy: boolean;
  onDecide: (approval: ApprovalRequestDTO, decision: "approve" | "reject") => void;
}) {
  const brand = item.opportunity?.brand ?? null;
  const label = item.entityLabel ?? item.entityId;
  return (
    <li className={`rounded-xl border bg-white p-3 shadow-sm transition-all hover:border-zinc-300 sm:p-4 ${priority ? "ring-1 ring-amber-300" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-zinc-900" title={label}>{label}</span>
            {priority ? (
              <Badge className="border-transparent bg-amber-100 text-amber-700">Prioritas</Badge>
            ) : null}
            {item.discountPct ? (
              <Badge className="border-transparent bg-amber-100 text-amber-700">Diskon {item.discountPct}%</Badge>
            ) : null}
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-zinc-500">
              {approvalEntityLabel(item.entityType)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-700"
              title={item.requestedBy}
              aria-hidden
            >
              {initials(item.requestedBy)}
            </span>
            <span className="font-medium text-zinc-700">{item.requestedBy}</span>
            <span aria-hidden>·</span>
            <span>diajukan {timeAgo(item.createdAt)}</span>
            {brand ? (
              <span className="inline-flex items-center gap-1 text-zinc-600">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: brand.color }} aria-hidden />
                {brand.name}
              </span>
            ) : null}
          </div>
          {item.note ? (
            <p className="line-clamp-1 text-xs italic text-zinc-500" title={item.note}>{item.note}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
          <span className="text-sm font-bold tabular-nums text-zinc-900">
            {item.amount != null ? formatCurrency(item.amount) : "-"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy}
              onClick={() => onDecide(item, "approve")}
              aria-label={`Setujui pengajuan ${label}`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Setujui
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              disabled={busy}
              onClick={() => onDecide(item, "reject")}
              aria-label={`Tolak pengajuan ${label}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Tolak
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

// ============ Widget Notifikasi Ringkas (Fase 3): 5 teratas di Command Center ============

const NOTIF_SEVERITY_DOT: Record<NotificationSeverity, string> = {
  danger: "bg-rose-600",
  warning: "bg-amber-500",
  info: "bg-zinc-400",
};

/** Modul tujuan navigasi valid dari notifikasi. */
const NOTIF_NAV_MODULES = new Set<string>(["dashboard", "inbox", "pipeline", "followups", "finance", "projects"]);

/** Baris ringkas notifikasi pada widget dashboard. */
function NotifBriefRow({ n, onOpen }: { n: NotificationDTO; onOpen: (n: NotificationDTO) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-zinc-100/70 focus-visible:bg-zinc-100/70 focus-visible:outline-none"
        aria-label={`${n.title} — buka modul tujuan`}
      >
        <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", NOTIF_SEVERITY_DOT[n.severity])} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-[13px]", n.read ? "font-normal text-zinc-500" : "font-semibold text-zinc-900")}>
              {n.title}
            </span>
            {!n.read ? <span className="shrink-0 rounded-full bg-rose-100 px-1.5 text-[9px] font-bold uppercase text-rose-600">baru</span> : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-zinc-400">
            {n.brandColor ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: n.brandColor }} /> : null}
            {n.brandName ? <span className="font-medium text-zinc-500">{n.brandName}</span> : null}
            {n.entityLabel ? <span className="font-mono">{n.entityLabel}</span> : null}
            <span>{timeAgo(n.at)}</span>
          </span>
        </span>
        <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-600" aria-hidden />
      </button>
    </li>
  );
}

/** Widget ringkas notifikasi (5 teratas) — respek preferensi mute per tipe. */
function NotificationBriefWidget() {
  const user = useCrmStore((s) => s.user);
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  const { prefs } = useNotifPrefs(user?.email);
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const res = await api.notifications(user.email, activeBrandFilter);
      const applied = applyNotifPrefs(res.items, prefs);
      // Urut: belum dibaca dulu, lalu terbaru
      const sorted = [...applied.items].sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return new Date(b.at).getTime() - new Date(a.at).getTime();
      });
      setHidden(sorted.length - Math.min(sorted.length, 5));
      setItems(sorted.slice(0, 5));
    } catch {
      // Widget ringkas gagal muat tidak perlu toast — bell header tetap berfungsi
    } finally {
      setLoading(false);
    }
  }, [user, activeBrandFilter, prefs]);

  useEffect(() => {
    void load(false);
    const id = setInterval(() => {
      if (!document.hidden) void load(true);
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Realtime (Task 15-b): NotificationCenter men-dispatch event saat socket "notif:changed" — widget ikut segar.
  useEffect(() => {
    const onNotifChanged = () => {
      if (!document.hidden) void load(true);
    };
    window.addEventListener(NOTIF_CHANGED_EVENT, onNotifChanged);
    return () => window.removeEventListener(NOTIF_CHANGED_EVENT, onNotifChanged);
  }, [load]);

  function openItem(n: NotificationDTO) {
    if (!user) return;
    if (!n.read) {
      setItems((prev) => prev.map((i) => (i.key === n.key ? { ...i, read: true } : i)));
      // Ronde 36 (audit FIX): revert optimistic read bila gagal (sinkron dgn notification-center).
      api.markNotifications({ user: user.email, action: "read", keys: [n.key] }).catch(() => {
        setItems((prev) => prev.map((i) => (i.key === n.key ? { ...i, read: false } : i)));
      });
    }
    if (NOTIF_NAV_MODULES.has(n.module)) setActiveModule(n.module as ModuleKey);
  }

  if (!user) return null;

  return (
    <section aria-label="Notifikasi ringkas" className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600" aria-hidden>
            <Bell className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Notifikasi Ringkas</h2>
            <p className="text-[11px] text-zinc-500">5 hal teratas yang butuh perhatian Anda</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-lg text-xs"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_NOTIF_EVENT))}
          aria-label="Buka pusat notifikasi lengkap"
        >
          Pusat Notifikasi
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Button>
      </div>
      {loading && items.length === 0 ? (
        <div className="space-y-2 px-1 py-1" aria-hidden>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Semua notifikasi dalam kendali — tidak ada hal yang perlu perhatian.
        </p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {items.map((n) => <NotifBriefRow key={n.key} n={n} onOpen={openItem} />)}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_NOTIF_EVENT))}
              className="mt-1.5 w-full rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-center text-[11px] text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700"
            >
              +{hidden} notifikasi lainnya di pusat notifikasi
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-[480px] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

// ============ Module utama ============

// ============ Ronde 31 — Dashboard per-role ============

/** Subtitle header Command Center sesuai peran. */
const ROLE_DASH_SUBTITLE: Record<string, string> = {
  super_admin: "Ringkasan eksekutif lintas brand",
  director: "Ringkasan eksekutif lintas brand",
  manager: "Pantauan tim, pipeline & SLA",
  marketing: "Cockpit penjualan personal",
  finance: "Kesehatan arus kas & tagihan",
  production: "Antrian produksi & deliverables",
  hr: "Ikhtisar tim & aktivitas",
  client: "Portal klien",
};

/** Meta status invoice utk chip finance. */
function invoiceStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "paid": return { label: "Terbayar", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "overdue": return { label: "Terlambat", cls: "bg-rose-50 text-rose-700 border-rose-200" };
    case "partial": return { label: "Sebagian", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "sent": return { label: "Terkirim", cls: "bg-zinc-50 text-zinc-700 border-zinc-200" };
    default: return { label: status, cls: "bg-zinc-50 text-zinc-700 border-zinc-200" };
  }
}

function projectStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "in_progress": return { label: "Berjalan", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "planning": return { label: "Perencanaan", cls: "bg-zinc-50 text-zinc-600 border-zinc-200" };
    case "review": return { label: "Review", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "completed": return { label: "Selesai", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "cancelled": return { label: "Batal", cls: "bg-rose-50 text-rose-700 border-rose-200" };
    default: return { label: status, cls: "bg-zinc-50 text-zinc-600 border-zinc-200" };
  }
}

function priorityBadge(priority: string) {
  if (priority === "high") return <Badge className="border-transparent bg-rose-100 text-rose-700">Urgent</Badge>;
  if (priority === "low") return <Badge variant="outline" className="bg-zinc-50 text-zinc-500">Rendah</Badge>;
  return <Badge variant="outline" className="bg-amber-50 text-amber-700">Sedang</Badge>;
}

/** Daftar audit ringkas — dipakai kartu Produksi & Risiko dan cockpit HR. */
function RecentAuditList({ items, maxHeight = "max-h-64" }: { items: AuditLogDTO[]; maxHeight?: string }) {
  if (items.length === 0) return <p className="py-2 text-sm text-zinc-400">Belum ada aktivitas tercatat.</p>;
  return (
    <ul className={`crm-scroll ${maxHeight} overflow-y-auto pr-1`}>
      {items.map((a) => (
        <li
          key={a.id}
          className="flex flex-col gap-1 border-b border-zinc-100 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-zinc-900">{a.actorName}</span>
            <Badge className={`border-transparent uppercase ${actionBadgeClass(a.action)}`}>
              {a.action.replace(/_/g, " ")}
            </Badge>
            <span className="truncate text-xs text-zinc-600">{a.entityLabel ?? a.entity}</span>
          </div>
          <span className="shrink-0 text-xs text-zinc-400">{timeAgo(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Cockpit MARKETING — tugas personal + deal terbesar + funnel personal. */
function MarketingCockpit({ view, onOpen }: { view: DashboardMineView; onOpen: (m: ModuleKey) => void }) {
  return (
    <section aria-label="Cockpit penjualan personal" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Tugas saya */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <ListTodo className="h-4 w-4 text-orange-600" aria-hidden /> Tugas Saya
          </h3>
          <div className="flex gap-1.5">
            {view.tasksDueToday > 0 ? (
              <Badge className="border-transparent bg-amber-100 text-amber-700 tabular-nums">{view.tasksDueToday} hari ini</Badge>
            ) : null}
            {view.tasksOverdue > 0 ? (
              <Badge className="border-transparent bg-rose-100 text-rose-700 tabular-nums">{view.tasksOverdue} terlambat</Badge>
            ) : null}
          </div>
        </div>
        {view.myTasks.length === 0 ? (
          <EmptyState text="Tidak ada tugas terbuka — kerja bagus!" />
        ) : (
          <ul className="crm-scroll max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {view.myTasks.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800" title={t.title}>{t.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {t.opportunityTitle ? `${t.opportunityTitle} · ` : ""}
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "tanpa tenggat"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {priorityBadge(t.priority)}
                  {t.overdue ? <span className="text-[10px] font-semibold text-rose-600">TERLAMBAT</span> : null}
                  {!t.overdue && t.dueToday ? <span className="text-[10px] font-semibold text-amber-600">HARI INI</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="mt-2 w-full text-zinc-500" onClick={() => onOpen("followups")} aria-label="Buka Follow-up Center">
          Buka Follow-up Center <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* Deal terbesar saya */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <Target className="h-4 w-4 text-orange-600" aria-hidden /> Deal Terbesar Saya
          </h3>
          <Badge variant="outline" className="bg-zinc-50 tabular-nums">{view.openLeads} terbuka</Badge>
        </div>
        {view.topDeals.length === 0 ? (
          <EmptyState text="Belum ada deal terbuka — mulai dari Lead Inbox." />
        ) : (
          <ul className="space-y-1.5">
            {view.topDeals.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onOpen("pipeline")}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-2 text-left transition-colors hover:border-zinc-300 hover:bg-white"
                  aria-label={`Buka pipeline: ${d.title}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800" title={d.title}>{d.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: d.brandColor }} aria-hidden />
                      {" "}{d.brandName}{d.companyName ? ` · ${d.companyName}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900">{formatCurrency(d.value)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="mt-2 w-full text-zinc-500" onClick={() => onOpen("pipeline")} aria-label="Buka Sales Pipeline">
          Buka Sales Pipeline <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* Funnel personal */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
          <TrendingUp className="h-4 w-4 text-orange-600" aria-hidden /> Pipeline Saya per Tahap
        </h3>
        <div className="space-y-1.5">
          {view.funnel.filter((f) => f.count > 0).length === 0 ? (
            <EmptyState text="Belum ada opportunity." />
          ) : (
            view.funnel.filter((f) => f.count > 0).map((f) => {
              const max = Math.max(...view.funnel.map((x) => x.count), 1);
              return (
                <div key={f.stage} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-xs text-zinc-600" title={stageLabel(f.stage)}>{stageLabel(f.stage)}</span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded bg-zinc-100">
                    <div className="h-full rounded bg-orange-500 transition-all duration-500" style={{ width: `${Math.round((f.count / max) * 100)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-900">{f.count}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-100 pt-3 text-center">
          <div className="rounded-lg bg-zinc-50 p-2">
            <p className="text-lg font-bold tabular-nums text-zinc-900">{formatCurrency(view.pipelineValue)}</p>
            <p className="text-[11px] text-zinc-500">pipeline terbuka</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2">
            <p className="text-lg font-bold tabular-nums text-emerald-700">{formatCurrency(view.wonValue)}</p>
            <p className="text-[11px] text-emerald-700">{view.wonCount} deal won</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Cockpit FINANCE — status invoice, tagihan terlambat, outstanding per brand. */
function FinanceCockpit({ view, onOpen }: { view: DashboardFinanceView; onOpen: (m: ModuleKey) => void }) {
  const maxBrandOutstanding = Math.max(...view.byBrand.map((b) => b.outstanding), 1);
  return (
    <section aria-label="Cockpit keuangan" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Status invoice */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
          <Coins className="h-4 w-4 text-orange-600" aria-hidden /> Status Invoice
        </h3>
        <div className="space-y-1.5">
          {view.byStatus.map((s) => {
            const meta = invoiceStatusMeta(s.status);
            return (
              <div key={s.status} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${meta.cls}`}>
                <span className="text-sm font-medium">{meta.label}</span>
                <span className="text-right">
                  <span className="block text-sm font-bold tabular-nums">{s.count}</span>
                  <span className="block text-[11px] tabular-nums opacity-80">{formatCurrency(s.total)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-100 pt-3 text-center">
          <div className="rounded-lg bg-emerald-50 p-2">
            <p className="text-base font-bold tabular-nums text-emerald-700">{formatCurrency(view.collectedThisMonth)}</p>
            <p className="text-[11px] text-emerald-700">terkumpul bulan ini</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-2">
            <p className="text-base font-bold tabular-nums text-zinc-900">{formatCurrency(view.billedThisMonth)}</p>
            <p className="text-[11px] text-zinc-500">diterbitkan bulan ini</p>
          </div>
        </div>
      </div>

      {/* Tagihan terlambat */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <Banknote className="h-4 w-4 text-rose-600" aria-hidden /> Tagihan Terlambat
          </h3>
          {view.overdueCount > 0 ? (
            <Badge className="border-transparent bg-rose-100 text-rose-700 tabular-nums">{view.overdueCount} invoice</Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">0</Badge>
          )}
        </div>
        {view.overdueList.length === 0 ? (
          <EmptyState text="Tidak ada tagihan terlambat — kesehatan kas terjaga." />
        ) : (
          <ul className="crm-scroll max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {view.overdueList.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => onOpen("finance")}
                  className="w-full rounded-lg border border-rose-100 bg-rose-50/60 px-2.5 py-2 text-left transition-colors hover:bg-rose-50"
                  aria-label={`Buka invoice ${i.number} di modul finance`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-semibold text-zinc-800">{i.number}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-rose-700">{formatCurrency(i.total)}</span>
                  </div>
                  <p className="truncate text-xs text-zinc-500">
                    {i.company} · jatuh tempo{" "}
                    {i.dueDate ? new Date(i.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="mt-2 w-full text-zinc-500" onClick={() => onOpen("finance")} aria-label="Buka modul Finance">
          Buka Finance <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* Outstanding per brand */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
          <ReceiptText className="h-4 w-4 text-orange-600" aria-hidden /> Outstanding per Brand
        </h3>
        {view.byBrand.length === 0 ? (
          <EmptyState text="Belum ada invoice pada brand." />
        ) : (
          <div className="space-y-2.5">
            {view.byBrand.map((b) => (
              <div key={b.name}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-zinc-700">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                    <span className="truncate font-medium">{b.name}</span>
                    <span className="shrink-0 text-zinc-400">· {b.count} inv</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-zinc-900">{formatCurrency(b.outstanding)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((b.outstanding / maxBrandOutstanding) * 100)}%`, backgroundColor: b.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 border-t border-zinc-100 pt-2.5 text-xs text-zinc-500">
          Total outstanding <span className="font-bold text-zinc-900">{formatCurrency(view.outstanding)}</span>
        </p>
      </div>
    </section>
  );
}

/** Cockpit PRODUCTION — antrian proyek + milestone due. */
function ProductionCockpit({ view, onOpen }: { view: DashboardProductionView; onOpen: (m: ModuleKey) => void }) {
  return (
    <section aria-label="Cockpit produksi" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Antrian proyek */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <Rocket className="h-4 w-4 text-orange-600" aria-hidden /> Antrian Produksi
          </h3>
          <Badge variant="outline" className="bg-zinc-50 tabular-nums">{view.activeProjects} aktif</Badge>
        </div>
        {view.queue.length === 0 ? (
          <EmptyState text="Tidak ada proyek aktif — menunggu deal won." />
        ) : (
          <ul className="crm-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
            {view.queue.map((p) => {
              const meta = projectStatusMeta(p.status);
              const overdue = p.dueDate ? new Date(p.dueDate).getTime() < Date.now() : false;
              return (
                <li key={p.code}>
                  <button
                    type="button"
                    onClick={() => onOpen("projects")}
                    className="w-full rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-2 text-left transition-colors hover:border-zinc-300 hover:bg-white"
                    aria-label={`Buka proyek ${p.name}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.brandColor }} aria-hidden />
                        <span className="truncate text-sm font-medium text-zinc-800" title={p.name}>{p.name}</span>
                      </span>
                      <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{p.progress}%</span>
                    </div>
                    <p className={`mt-0.5 truncate text-xs ${overdue ? "font-semibold text-rose-600" : "text-zinc-500"}`}>
                      {p.code} · {p.companyName} · tenggat{" "}
                      {p.dueDate ? new Date(p.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—"}
                      {overdue ? " (terlambat)" : ""}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="mt-2 w-full text-zinc-500" onClick={() => onOpen("projects")} aria-label="Buka modul Projects">
          Buka Projects <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* Milestone due + deliverables */}
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
              <CalendarClock className="h-4 w-4 text-orange-600" aria-hidden /> Milestone ≤ 7 Hari
            </h3>
            <Badge variant="outline" className="bg-zinc-50 tabular-nums">{view.milestonesDueSoon.length}</Badge>
          </div>
          {view.milestonesDueSoon.length === 0 ? (
            <EmptyState text="Tidak ada milestone jatuh tempo 7 hari ke depan." />
          ) : (
            <ul className="crm-scroll max-h-44 space-y-1.5 overflow-y-auto pr-1">
              {view.milestonesDueSoon.map((m, i) => (
                <li key={`${m.projectCode}-${m.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800">{m.name}</p>
                    <p className="truncate text-xs text-zinc-500">{m.projectCode} · {m.projectName}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {m.dueDate ? new Date(m.dueDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className={`rounded-lg border p-3 text-center ${view.deliverablesPending > 0 ? "border-amber-200 bg-amber-50" : "bg-zinc-50"}`}>
            <ClipboardList className={`mx-auto h-4 w-4 ${view.deliverablesPending > 0 ? "text-amber-600" : "text-zinc-400"}`} aria-hidden />
            <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900">{view.deliverablesPending}</p>
            <p className="text-[11px] text-zinc-500">deliverable menunggu review</p>
          </div>
          <div className={`rounded-lg border p-3 text-center ${view.inReview > 0 ? "border-amber-200 bg-amber-50" : "bg-zinc-50"}`}>
            <Factory className={`mx-auto h-4 w-4 ${view.inReview > 0 ? "text-amber-600" : "text-zinc-400"}`} aria-hidden />
            <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900">{view.inReview}</p>
            <p className="text-[11px] text-zinc-500">proyek status review</p>
          </div>
          <div className={`rounded-lg border p-3 text-center ${view.pendingCRs > 0 ? "border-rose-200 bg-rose-50" : "bg-zinc-50"}`}>
            <GitPullRequestArrow className={`mx-auto h-4 w-4 ${view.pendingCRs > 0 ? "text-rose-600" : "text-zinc-400"}`} aria-hidden />
            <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900">{view.pendingCRs}</p>
            <p className="text-[11px] text-zinc-500">CR menunggu klien</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Cockpit TEAM (HR/Manager) — komposisi tim + beban tugas + audit. */
function TeamCockpit({ view, auditItems, onOpen }: { view: DashboardTeamView; auditItems: AuditLogDTO[]; onOpen: (m: ModuleKey) => void }) {
  return (
    <section aria-label="Ikhtisar tim" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <Users className="h-4 w-4 text-orange-600" aria-hidden /> Komposisi Tim
          </h3>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 tabular-nums">{view.activeUsers}/{view.totalUsers} aktif</Badge>
        </div>
        <ul className="divide-y divide-zinc-100">
          {view.usersByRole.map((r) => (
            <li key={r.role} className="flex items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-1.5 text-sm text-zinc-700">
                <UserCheck className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                {ROLES.find((x) => x.key === r.role)?.label ?? r.role}
              </span>
              <span className="text-sm tabular-nums">
                <span className="font-bold text-zinc-900">{r.count}</span>
                {r.active < r.count ? <span className="ml-1 text-xs text-rose-500">({r.count - r.active} nonaktif)</span> : null}
              </span>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="mt-2 w-full text-zinc-500" onClick={() => onOpen("users")} aria-label="Buka User & Access">
          Kelola Pengguna <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
          <ListTodo className="h-4 w-4 text-orange-600" aria-hidden /> Beban Tugas Tim
        </h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-2xl font-bold tabular-nums text-zinc-900">{view.tasksOpen}</p>
            <p className="text-[11px] text-zinc-500">tugas terbuka</p>
          </div>
          <div className={`rounded-lg p-3 ${view.tasksDueToday > 0 ? "bg-amber-50" : "bg-zinc-50"}`}>
            <p className={`text-2xl font-bold tabular-nums ${view.tasksDueToday > 0 ? "text-amber-700" : "text-zinc-900"}`}>{view.tasksDueToday}</p>
            <p className="text-[11px] text-zinc-500">due hari ini</p>
          </div>
          <div className={`rounded-lg p-3 ${view.tasksOverdue > 0 ? "bg-rose-50" : "bg-zinc-50"}`}>
            <p className={`text-2xl font-bold tabular-nums ${view.tasksOverdue > 0 ? "text-rose-600" : "text-zinc-900"}`}>{view.tasksOverdue}</p>
            <p className="text-[11px] text-zinc-500">terlambat</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="mt-3 w-full text-zinc-500" onClick={() => onOpen("followups")} aria-label="Buka Follow-up Center">
          Buka Follow-up Center <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
          <Clock3 className="h-4 w-4 text-orange-600" aria-hidden /> Aktivitas Terbaru
        </h3>
        <RecentAuditList items={auditItems} maxHeight="max-h-64" />
        <Button variant="ghost" size="sm" className="mt-2 w-full text-zinc-500" onClick={() => onOpen("audit")} aria-label="Buka Audit Logs">
          Buka Audit Logs <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </section>
  );
}

/** View minimal untuk role client — arahkan ke portal. */
function ClientWelcome({ onOpen }: { onOpen: (m: ModuleKey) => void }) {
  return (
    <section aria-label="Selamat datang klien" className="rounded-xl border bg-white p-8 text-center shadow-sm">
      <UserCheck className="mx-auto h-10 w-10 text-orange-500" aria-hidden />
      <h2 className="mt-3 text-lg font-bold text-zinc-900">Selamat datang di Grup CRM</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
        Akun klien diproses lewat Portal Klien — di sana Anda bisa meninjau deliverable, memberi persetujuan, dan mengajukan change request.
      </p>
      <Button size="sm" className="mt-4" onClick={() => onOpen("portal")} aria-label="Buka Portal Klien">
        Buka Portal Klien <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </section>
  );
}

export default function DashboardModule() {
  const brands = useCrmStore((s) => s.brands);
  const user = useCrmStore((s) => s.user);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);

  const [data, setData] = useState<DashboardFullData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchTime, setFetchTime] = useState<Date | null>(null);
  const [trends, setTrends] = useState<KpiTrendMap>({});
  const prevKpiRef = useRef<DashboardData["kpi"] | null>(null);
  const [confirmState, setConfirmState] = useState<ApprovalConfirmState | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const res = normalizeDashboard(await api.dashboard());
      setTrends(computeTrends(prevKpiRef.current, res.kpi));
      prevKpiRef.current = res.kpi;
      setData(res);
      setFetchTime(new Date());
      // Fase 3 — sweep SLA berjalan di server saat dashboard dimuat;
      // beri tahu bila ada lead baru yang dieskalasi otomatis.
      if (res.autoEscalated && res.autoEscalated > 0) {
        toast.warning(`${res.autoEscalated} lead dieskalasi otomatis oleh SLA Bot`, {
          description: "Task urgent dibuat untuk Direktur — lihat Follow-up Center.",
        });
      }
    } catch (err) {
      // Ronde 36 (audit FIX): polling senyap (silent=true, tiap 60 dtk) TIDAK
      // lagi memunculkan toast tiap menit saat server down — cukup yang awal.
      if (!silent) {
        toast.error("Gagal memuat data Command Center", {
          description: err instanceof Error ? err.message : "Silakan coba lagi.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const id = setInterval(() => void load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const openConfirm = useCallback((approval: ApprovalRequestDTO, decision: "approve" | "reject") => {
    setDecisionNote("");
    setConfirmState({ approval, decision });
  }, []);

  const closeConfirm = useCallback(() => {
    if (deciding) return;
    setConfirmState(null);
    setDecisionNote("");
  }, [deciding]);

  const submitDecision = useCallback(async () => {
    if (!confirmState || !user || deciding) return;
    const isReject = confirmState.decision === "reject";
    const note = decisionNote.trim();
    if (isReject && !note) {
      toast.error("Catatan keputusan wajib diisi saat menolak pengajuan.");
      return;
    }
    setDeciding(true);
    try {
      await api.decideApproval({
        id: confirmState.approval.id,
        decision: confirmState.decision,
        decisionNote: note || undefined,
        actorName: user.name,
        actorRole: user.role,
      });
      toast.success(isReject ? "Pengajuan ditolak" : "Pengajuan disetujui", {
        description: `${confirmState.approval.entityLabel ?? "Pengajuan"} — keputusan tercatat sebagai ${user.name}.`,
      });
      setConfirmState(null);
      setDecisionNote("");
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Silakan coba lagi.";
      if (/403|direktur|akses|izin/i.test(msg)) {
        toast.error("Akses ditolak", { description: msg });
      } else {
        toast.error("Gagal memutus pengajuan", { description: msg });
      }
    } finally {
      setDeciding(false);
    }
  }, [confirmState, deciding, decisionNote, load, user]);

  if (!data) {
    if (loading) return <DashboardSkeleton />;
    return (
      <section aria-label="Error memuat data" className="rounded-xl border bg-white p-10 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" aria-hidden />
        <p className="mt-3 text-sm font-medium text-zinc-900">Gagal memuat data Command Center</p>
        <p className="mt-1 text-xs text-zinc-500">Periksa koneksi server, lalu coba muat ulang.</p>
        <Button size="sm" className="mt-4" onClick={() => void load(false)}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Coba lagi
        </Button>
      </section>
    );
  }

  const kpi = data.kpi;
  const canDecide = user?.role === "director" || user?.role === "super_admin";
  const pendingApprovals = data.pendingApprovals ?? [];
  // Fase 3 — SLA monitoring
  const slaBreaches = data.slaBreaches ?? 0;
  // Fase 2 Produksi — CR menunggu persetujuan klien
  const pendingCRs = data.pendingChangeRequests ?? 0;
  const canOpenInbox = canAccess("inbox", user?.role);
  const activeBrandCount = brands.length > 0 ? brands.filter((b) => b.active).length : data.byBrand.length;
  const firstBrandColor = brands[0]?.color ?? data.byBrand[0]?.color ?? "#ea580c";
  const funnelMap = new Map(data.funnel.map((f) => [f.stage, f] as const));
  const funnelMax = Math.max(...data.funnel.map((f) => f.count), 1);
  const wonCount = data.funnel.find((f) => f.stage === "won")?.count ?? 0;

  // ==== Ronde 31 — per-role dashboard ====
  const role = user?.role ?? null;
  const roleView = data.roleView;
  const isExec = role === "super_admin" || role === "director";
  const isManager = role === "manager";
  const isMarketing = role === "marketing";
  const isFinance = role === "finance";
  const isProduction = role === "production";
  const isHr = role === "hr";
  const isClient = role === "client";
  // Seksi eksekutif tampil utk owner + manager; marketing/finance/production/hr/client
  // mendapat cockpit khusus sebagai pengganti.
  const showExecSections = isExec || isManager;
  const showSlaStrip = isExec || isManager || isMarketing;

  const bestMarketerIdx = data.marketingPerf.reduce((best, m, i, arr) => {
    const cur = arr[best];
    if (m.won > cur.won || (m.won === cur.won && m.leads > cur.leads)) return i;
    return best;
  }, 0);

  const lostMax = Math.max(...data.lostReasons.map((r) => r.count), 1);

  // ==== Ronde 31 — KPI cards sesuai peran ====
  interface RoleKpi { key?: KpiTrendKey; label: string; value: string; icon: LucideIcon; hint: string; accent?: boolean; goodWhen?: "up" | "down"; badge?: ReactNode; tone?: "default" | "danger" | "ok" }
  const roleKpis: RoleKpi[] = (() => {
    const mv = roleView?.mine;
    const fv = roleView?.finance;
    const pv = roleView?.production;
    if (isMarketing && mv) {
      return [
        { label: "Pipeline Saya", value: formatCurrency(mv.pipelineValue), icon: Wallet, hint: `${mv.openLeads} deal terbuka milik saya`, accent: true },
        { label: "Deal Won Saya", value: formatCurrency(mv.wonValue), icon: Trophy, hint: `${mv.wonCount} deal berhasil ditutup`, accent: true },
        { label: "Tugas Due Hari Ini", value: String(mv.tasksDueToday), icon: CalendarClock, hint: mv.tasksDueToday > 0 ? "selesaikan sebelum hari berakhir" : "tidak ada tenggat hari ini", tone: mv.tasksDueToday > 0 ? "danger" : "ok" },
        { label: "Tugas Terlambat", value: String(mv.tasksOverdue), icon: AlarmClockOff, hint: mv.tasksOverdue > 0 ? "segera follow-up kembali" : "semua tugas dalam kontrol", tone: mv.tasksOverdue > 0 ? "danger" : "ok" },
      ];
    }
    if (isFinance && fv) {
      return [
        { label: "Outstanding", value: formatCurrency(fv.outstanding), icon: ReceiptText, hint: "total tagihan belum lunas", accent: true, goodWhen: "down" },
        { label: "Terkumpul Bulan Ini", value: formatCurrency(fv.collectedThisMonth), icon: Coins, hint: "payment diterima bulan berjalan", accent: true },
        { label: "Diterbitkan Bulan Ini", value: formatCurrency(fv.billedThisMonth), icon: Banknote, hint: "invoice terbit bulan berjalan" },
        { label: "Invoice Terlambat", value: String(fv.overdueCount), icon: AlarmClockOff, hint: fv.overdueCount > 0 ? "perlu penagihan segera" : "semua tagihan lancar", tone: fv.overdueCount > 0 ? "danger" : "ok" },
      ];
    }
    if (isProduction && pv) {
      return [
        { label: "Proyek Aktif", value: String(pv.activeProjects), icon: Rocket, hint: "planning + berjalan + review", accent: true },
        { label: "Proyek Berisiko", value: String(pv.atRisk), icon: AlertTriangle, hint: "tenggat ≤ 7 hari & belum selesai", tone: pv.atRisk > 0 ? "danger" : "ok" },
        { label: "Milestone ≤ 7 Hari", value: String(pv.milestonesDueSoon.length), icon: CalendarClock, hint: "milestone jatuh tempo minggu ini", tone: pv.milestonesDueSoon.length > 0 ? "danger" : "ok" },
        { label: "Deliverable Pending", value: String(pv.deliverablesPending), icon: ClipboardList, hint: "menunggu review internal/klien", tone: pv.deliverablesPending > 0 ? "danger" : "ok" },
      ];
    }
    if (isHr && roleView?.team) {
      const tv = roleView.team;
      return [
        { label: "Total Pengguna", value: String(tv.totalUsers), icon: Users, hint: "seluruh akun terdaftar", accent: true },
        { label: "Pengguna Aktif", value: String(tv.activeUsers), icon: UserCheck, hint: `${tv.totalUsers - tv.activeUsers} akun nonaktif`, tone: tv.activeUsers < tv.totalUsers ? "danger" : "ok" },
        { label: "Tugas Tim Terbuka", value: String(tv.tasksOpen), icon: ListTodo, hint: `${tv.tasksDueToday} due hari ini` },
        { label: "Tugas Tim Terlambat", value: String(tv.tasksOverdue), icon: AlarmClockOff, hint: tv.tasksOverdue > 0 ? "butuh redistribusi beban" : "beban tim terkendali", tone: tv.tasksOverdue > 0 ? "danger" : "ok" },
      ];
    }
    // Eksekutif (super_admin/director/manager) + fallback — KPI bawaan
    return [
      { key: "pipelineValue", label: "Pipeline Value", value: formatCurrency(kpi.pipelineValue), icon: Wallet, hint: `${kpi.openLeads} lead terbuka`, accent: true, goodWhen: "up" },
      { key: "weightedPipeline", label: "Weighted Forecast", value: formatCurrency(kpi.weightedPipeline), icon: Target, hint: "estimasi probabilitas tertimbang", accent: true, goodWhen: "up" },
      { key: "winRate", label: "Win Rate", value: `${kpi.winRate}%`, icon: Trophy, hint: `${wonCount} deal berhasil ditutup`, accent: true, goodWhen: "up" },
      { key: "wonValue", label: "Won Value", value: formatCurrency(kpi.wonValue), icon: Handshake, hint: `${wonCount} deal won`, accent: true, goodWhen: "up" },
      { key: "avgResponseHours", label: "Avg Response", value: formatHours(kpi.avgResponseHours), icon: Timer, hint: "rata-rata waktu respons lead", accent: false, goodWhen: "down", badge: <Badge className={`border-transparent ${slaBadgeClass(kpi.avgResponseHours)}`}>SLA</Badge> },
      { key: "outstandingInvoices", label: "Outstanding Invoice", value: formatCurrency(kpi.outstandingInvoices), icon: ReceiptText, hint: "total tagihan belum lunas", accent: false, goodWhen: "down" },
    ];
  })();

  return (
    <div className="space-y-6">
      {/* ============ Header ============ */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">Command Center</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {role ? (ROLE_DASH_SUBTITLE[role] ?? "Ringkasan eksekutif lintas brand") : "Ringkasan eksekutif lintas brand"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="mr-1 hidden items-center gap-2 md:flex" title={user.email}>
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: user.avatarColor }}
                aria-hidden
              >
                {initials(user.name)}
              </span>
              <div className="text-xs leading-tight">
                <div className="font-semibold text-zinc-900">{user.name}</div>
                <div className="text-zinc-500">{ROLES.find((r) => r.key === user.role)?.label ?? user.role}</div>
              </div>
            </div>
          ) : null}
          <Badge variant="outline" className="gap-1.5 bg-white">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            {activeBrandCount} brand aktif
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(false)}
            disabled={loading}
            aria-label="Muat ulang data dashboard"
            title="Muat ulang data"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            <span className="hidden sm:inline">Muat ulang</span>
          </Button>
        </div>
      </header>

      {/* ============ Alert strip SLA (Fase 3) — hanya peran penjualan ============ */}
      {showSlaStrip && slaBreaches > 0 ? (
        <div
          role="alert"
          aria-label="Peringatan SLA terlambat"
          className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-100" aria-hidden>
              <ShieldAlert className="h-4.5 w-4.5 text-rose-600" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-rose-700">
                {slaBreaches} lead melewati SLA respons
              </p>
              <p className="text-xs text-rose-600">Prioritaskan follow-up hari ini sebelum klien hilang.</p>
            </div>
          </div>
          {canOpenInbox ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-rose-300 bg-white text-rose-600 hover:bg-rose-100 hover:text-rose-700"
              onClick={() => setActiveModule("inbox")}
              aria-label="Buka Lead Inbox"
            >
              Buka Lead Inbox
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ============ KPI (sesuai peran — Ronde 31) ============ */}
      <section aria-label="KPI utama" className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Ringkasan Kinerja</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {roleKpis.map((c) => (
            <KpiCard
              key={c.label}
              label={c.label}
              value={c.value}
              icon={c.icon}
              hint={c.hint}
              badge={c.badge}
              trend={c.key ? trendNode(trends[c.key] ?? null, c.goodWhen ?? "up") : null}
              accentColor={c.accent ? firstBrandColor : undefined}
              tone={c.tone ?? "default"}
            />
          ))}
          {showSlaStrip ? (
            <KpiCard
              label="SLA Terlambat"
              value={String(slaBreaches)}
              icon={AlarmClockOff}
              hint={slaBreaches > 0 ? "lead melewati SLA respons" : "Semua lead dalam SLA"}
              tone={slaBreaches > 0 ? "danger" : "ok"}
            />
          ) : null}
          {showExecSections || isProduction ? (
            <KpiCard
              label="CR Menunggu Klien"
              value={String(pendingCRs)}
              icon={GitPullRequestArrow}
              hint={pendingCRs > 0 ? "change request menunggu persetujuan klien" : "Tidak ada change request pending"}
              tone={pendingCRs > 0 ? "danger" : "ok"}
            />
          ) : null}
        </div>
      </section>

      {/* ============ Cockpit per role (Ronde 31) ============ */}
      {isClient ? <ClientWelcome onOpen={setActiveModule} /> : null}
      {isMarketing && roleView?.mine ? (
        <MarketingCockpit view={roleView.mine} onOpen={setActiveModule} />
      ) : null}
      {isFinance && roleView?.finance ? (
        <FinanceCockpit view={roleView.finance} onOpen={setActiveModule} />
      ) : null}
      {isProduction && roleView?.production ? (
        <ProductionCockpit view={roleView.production} onOpen={setActiveModule} />
      ) : null}
      {isHr && roleView?.team ? (
        <TeamCockpit view={roleView.team} auditItems={data.recentAudit} onOpen={setActiveModule} />
      ) : null}

      {/* ============ Notifikasi Ringkas (Fase 3) ============ */}
      <NotificationBriefWidget />

      {/* ============ Antrean Approval (Direktur & Super Admin) ============ */}
      {canDecide ? (
        <section aria-label="Antrean approval" className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Persetujuan</p>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                <Stamp className="h-4 w-4 text-zinc-500" aria-hidden />
                Antrean Approval
              </h2>
            </div>
            {pendingApprovals.length > 0 ? (
              <Badge className="border-transparent bg-amber-100 text-amber-700 tabular-nums">
                {pendingApprovals.length} pending
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 tabular-nums">
                0 pending
              </Badge>
            )}
          </div>
          {pendingApprovals.length === 0 ? (
            <EmptyState text="Tidak ada pengajuan menunggu persetujuan" />
          ) : (
            <ul className="space-y-2">
              {pendingApprovals.map((a, i) => (
                <ApprovalRow key={a.id} item={a} priority={i === 0} busy={deciding} onDecide={openConfirm} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* ============ Funnel + Charts (eksekutif & manager) ============ */}
      {showExecSections ? (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          ariaLabel="Funnel konversi"
          title="Funnel Konversi"
          subtitle="Jumlah opportunity per tahap pipeline"
          overline="Analisis Pipeline"
        >
          <div className="space-y-2">
            {PIPELINE_STAGES.map((stage) => {
              const entry = funnelMap.get(stage.key) ?? { stage: stage.key, count: 0, value: 0 };
              const pct = Math.round((entry.count / funnelMax) * 100);
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 truncate text-xs text-zinc-600 sm:w-36" title={stageLabel(stage.key)}>
                    {stageLabel(stage.key)}
                  </div>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-zinc-100">
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: stageColor(stage.key) }}
                      role="presentation"
                    />
                  </div>
                  <div className="w-20 shrink-0 text-right text-xs tabular-nums sm:w-28">
                    <div className="font-semibold text-zinc-900">{entry.count} deal</div>
                    <div className="text-zinc-500">{formatCurrency(entry.value)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <SectionCard
            ariaLabel="Forecast weighted"
            title="Forecast Weighted 30/60/90"
            subtitle="Nilai pipeline tertimbang per bucket waktu"
            overline="Proyeksi Pendapatan"
            className="shrink-0"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.forecast} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis
                  width={72}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number) => formatCurrency(value)}
                />
                <Tooltip
                  cursor={{ fill: "rgba(5, 150, 105, 0.06)" }}
                  formatter={(value) => [formatCurrency(Number(value)), "Forecast"]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="value" name="Forecast" fill="#059669" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard
            ariaLabel="Tren pipeline"
            title="Tren Pipeline 6 Minggu"
            subtitle="Lead baru masuk vs deal won per minggu"
            overline="Tren Mingguan"
          >
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.pipelineTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ea580c" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ea580c" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradWon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis
                  allowDecimals={false}
                  width={36}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#52525b" }} />
                <Area
                  type="monotone" dataKey="created" name="Lead dibuat"
                  stroke="#ea580c" strokeWidth={2} fill="url(#gradCreated)"
                />
                <Area
                  type="monotone" dataKey="won" name="Deal won"
                  stroke="#059669" strokeWidth={2} fill="url(#gradWon)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
      </div>
      ) : null}

      {/* ============ Pipeline per Brand (eksekutif, manager & marketing) ============ */}
      {showExecSections || isMarketing ? (
      <section aria-label="Pipeline per brand" className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Perbandingan Brand</p>
          <h2 className="text-sm font-semibold text-zinc-900">Pipeline per Brand</h2>
        </div>
        {data.byBrand.length === 0 ? (
          <EmptyState text="Belum ada data pipeline per brand." />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.byBrand.map((b) => {
              const pct = b.leads > 0 ? Math.round((b.won / b.leads) * 100) : 0;
              return (
                <div
                  key={b.brandId}
                  className="rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                    <span className="truncate text-sm font-semibold text-zinc-900" title={b.name}>{b.name}</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-2xl font-bold tabular-nums text-zinc-900">{b.leads}</div>
                      <div className="text-xs text-zinc-500">leads</div>
                    </div>
                    <div className="text-right">
                      <Badge className="border-transparent bg-emerald-100 text-emerald-700">{b.won} won</Badge>
                      <div className="mt-1 text-xs tabular-nums text-zinc-600">{formatCurrency(b.value)} open</div>
                    </div>
                  </div>
                  <div
                    className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
                    role="progressbar"
                    aria-label={`Progress won ${b.name}`}
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: b.color }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">{b.won} dari {b.leads} leads berhasil ({pct}%)</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {/* ============ Lost Reasons (eksekutif & manager) + Marketing Perf (eksekutif, manager & marketing) ============ */}
      {showExecSections || isMarketing ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {showExecSections ? (
        <SectionCard
          ariaLabel="Alasan lost"
          title="Alasan Lost"
          subtitle="Distribusi alasan kegagalan deal"
          overline="Evaluasi Deal"
        >
          {showExecSections ? (
            data.lostReasons.length === 0 ? (
              <EmptyState text="Tidak ada opportunity lost — bagus, pertahankan!" />
            ) : (
              <div className="space-y-3">
                {data.lostReasons.map((r) => {
                  const pct = Math.round((r.count / lostMax) * 100);
                  return (
                    <div key={r.reason} className="flex items-center gap-3">
                      <div className="w-32 shrink-0 truncate text-xs text-zinc-600 sm:w-44" title={r.reason}>{r.reason}</div>
                      <div className="relative h-4 flex-1 overflow-hidden rounded bg-zinc-100">
                        <div
                          className="h-full rounded transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: "#dc2626" }}
                        />
                      </div>
                      <div className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-900">
                        {r.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </SectionCard>
        ) : null}

        <SectionCard
          ariaLabel="Performa marketing"
          title="Performa Marketing"
          subtitle="Perbandingan hasil antar marketer"
          overline="Tim Sales"
        >
          {data.marketingPerf.length === 0 ? (
            <EmptyState text="Belum ada data performa marketing." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Nama</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Avg Response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.marketingPerf.map((m, i) => {
                  const top = i === bestMarketerIdx;
                  const wr = m.leads > 0 ? Math.round((m.won / m.leads) * 100) : 0;
                  return (
                    <TableRow key={m.name} className={top ? "bg-amber-50/70" : undefined}>
                      <TableCell className="font-medium text-zinc-900">
                        <span className="flex items-center gap-2">
                          {m.name}
                          {top ? <Badge className="border-transparent bg-amber-100 text-amber-700">Top</Badge> : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.leads}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-emerald-600">{m.won}</TableCell>
                      <TableCell className="text-right tabular-nums">{wr}%</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-600">{formatHours(m.avgResponseHours)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
      ) : null}

      {/* ============ Distribusi (eksekutif & manager) + Produksi & Risiko (eksekutif, manager & produksi) ============ */}
      {showExecSections || isProduction ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {showExecSections ? (
        <SectionCard
          ariaLabel="Distribusi kanal dan negara"
          title="Distribusi Kanal & Negara"
          subtitle="Asal lead lintas kanal dan wilayah"
          overline="Sumber Lead"
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Kanal Lead</h3>
              {data.byChannel.length === 0 ? (
                <p className="text-sm text-zinc-400">Tidak ada data kanal.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {data.byChannel.map((c) => (
                    <li key={c.channel} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="truncate text-sm text-zinc-700">{channelLabel(c.channel)}</span>
                      <Badge variant="secondary" className="tabular-nums">{c.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Negara</h3>
              {data.byCountry.length === 0 ? (
                <p className="text-sm text-zinc-400">Tidak ada data negara.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {data.byCountry.map((c) => (
                    <li key={c.country} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-700">
                        <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                        <span className="truncate">{c.country}</span>
                      </span>
                      <Badge variant="secondary" className="tabular-nums">{c.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </SectionCard>
        ) : null}

        <SectionCard
          ariaLabel="Produksi dan risiko"
          title="Produksi & Risiko"
          subtitle="Kesehatan operasional dan aktivitas terbaru"
          overline="Operasional"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className={`rounded-lg border p-3 ${data.projectsAtRisk > 0 ? "border-rose-200 bg-rose-50" : "bg-zinc-50"}`}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <AlertTriangle className={`h-3.5 w-3.5 ${data.projectsAtRisk > 0 ? "text-rose-500" : "text-zinc-400"}`} aria-hidden />
                Project at Risk
              </div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${data.projectsAtRisk > 0 ? "text-rose-600" : "text-zinc-900"}`}>
                {data.projectsAtRisk}
              </div>
              <div className="text-xs text-zinc-500">{data.projectsAtRisk > 0 ? "perlu perhatian segera" : "semua aman"}</div>
            </div>
            <div className="rounded-lg border bg-zinc-50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Factory className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                Kapasitas Produksi
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">{data.productionCapacity}</div>
              <div className="text-xs text-zinc-500">project aktif berjalan</div>
            </div>
          </div>

          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Audit Terbaru</h3>
          <RecentAuditList items={data.recentAudit} />
        </SectionCard>
      </div>
      ) : null}

      {/* ============ Footer ============ */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          Data diperbarui {fetchTime ? timeAgo(fetchTime) : "-"}
        </span>
        <span>Auto-refresh setiap 60 detik</span>
      </footer>

      {/* ============ Dialog konfirmasi keputusan approval ============ */}
      <Dialog open={confirmState !== null} onOpenChange={(open) => { if (!open) closeConfirm(); }}>
        <DialogContent className="sm:max-w-md" aria-label="Konfirmasi keputusan approval">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmState?.decision === "approve" ? (
                <>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden>
                    <Check className="h-4 w-4" />
                  </span>
                  Setujui Pengajuan
                </>
              ) : (
                <>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-rose-600" aria-hidden>
                    <X className="h-4 w-4" />
                  </span>
                  Tolak Pengajuan
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {confirmState?.approval.entityLabel ?? "Pengajuan"}
              {confirmState?.approval.amount != null ? ` · ${formatCurrency(confirmState.approval.amount)}` : ""}
              {confirmState ? ` · oleh ${confirmState.approval.requestedBy}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="approval-decision-note" className="text-xs font-medium text-zinc-600">
              Catatan keputusan{" "}
              {confirmState?.decision === "reject" ? (
                <span className="text-rose-600">*</span>
              ) : (
                <span className="text-zinc-400">(opsional)</span>
              )}
            </label>
            <Textarea
              id="approval-decision-note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              rows={3}
              disabled={deciding}
              placeholder={
                confirmState?.decision === "reject"
                  ? "Wajib diisi — tulis alasan penolakan"
                  : "Contoh: disetujui, lanjutkan ke quotation"
              }
              aria-required={confirmState?.decision === "reject"}
            />
            {confirmState?.decision === "reject" && !decisionNote.trim() ? (
              <p className="text-[11px] text-rose-600">Catatan wajib diisi untuk menolak pengajuan.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeConfirm} disabled={deciding}>
              Batal
            </Button>
            <Button
              size="sm"
              onClick={() => void submitDecision()}
              disabled={deciding || (confirmState?.decision === "reject" && !decisionNote.trim())}
              className={
                confirmState?.decision === "approve"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-rose-600 text-white hover:bg-rose-700"
              }
              aria-label={confirmState?.decision === "approve" ? "Konfirmasi setujui pengajuan" : "Konfirmasi tolak pengajuan"}
            >
              {confirmState?.decision === "approve" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
              {confirmState?.decision === "approve" ? "Setujui" : "Tolak Pengajuan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
