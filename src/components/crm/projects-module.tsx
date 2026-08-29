"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, CalendarDays, ChartGantt, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, CircleDotDashed,
  Download, Factory, FolderKanban, GitPullRequestArrow, GripVertical, LayoutGrid, Plus, ReceiptText, RefreshCw, User2, X, XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type { ChangeRequestDTO, MilestoneDTO, ProjectDTO } from "@/lib/crm/types";
import { formatCurrency, formatDate, timeAgo } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ============ Meta ============

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Perencanaan", cls: "bg-zinc-100 text-zinc-600" },
  in_progress: { label: "Berjalan", cls: "bg-amber-100 text-amber-700" },
  review: { label: "Review", cls: "bg-violet-100 text-violet-700" },
  completed: { label: "Selesai", cls: "bg-emerald-100 text-emerald-700" },
};

const MILESTONE_STATUS: Record<string, { label: string; cls: string; icon: LucideIcon }> = {
  done: { label: "Selesai", cls: "border-emerald-200 bg-emerald-50 text-emerald-700 line-through decoration-emerald-500", icon: CheckCircle2 },
  in_progress: { label: "Dikerjakan", cls: "border-amber-200 bg-amber-50 text-amber-700", icon: CircleDotDashed },
  pending: { label: "Menunggu", cls: "border-zinc-200 bg-white text-zinc-500", icon: CircleDashed },
};

const CR_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu Persetujuan", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Ditolak", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "Dibatalkan", cls: "bg-zinc-100 text-zinc-600" },
};

function statusMeta(s: string) {
  return PROJECT_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" };
}

// ---------- Ekspor CSV project (Task 13): BOM + CRLF + separator titik-koma ----------

const PROJECT_CSV_HEADERS = [
  "kode", "nama", "brand", "klien", "kategori_layanan", "status", "progress_pct",
  "pm", "mulai", "deadline", "nilai_kontrak", "budget_internal", "milestone_selesai", "milestone_total",
] as const;

function escapeCsvField(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildProjectsCsv(projects: ProjectDTO[]): string {
  const lines: string[] = [PROJECT_CSV_HEADERS.join(";")];
  for (const p of projects) {
    const ms = p.milestones ?? [];
    const fields: string[] = [
      p.code,
      p.name,
      p.brand?.name ?? "",
      p.company?.name ?? "",
      p.serviceCategory ?? "",
      statusMeta(p.status).label,
      String(p.progress),
      p.pmName ?? "",
      p.startDate ? formatDate(p.startDate) : "",
      p.dueDate ? formatDate(p.dueDate) : "",
      p.contractValue != null ? String(p.contractValue) : "",
      p.budgetInternal != null ? String(p.budgetInternal) : "",
      String(ms.filter((m) => m.status === "done").length),
      String(ms.length),
    ];
    lines.push(fields.map(escapeCsvField).join(";"));
  }
  return "\uFEFF" + lines.join("\r\n");
}

function crMeta(s: string) {
  return CR_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" };
}

function msMeta(s: string) {
  return MILESTONE_STATUS[s] ?? { label: s, cls: "border-zinc-200 bg-white text-zinc-500", icon: CircleDashed };
}

function dueSoon(p: ProjectDTO): boolean {
  if (p.status === "completed" || !p.dueDate) return false;
  const diffDays = (new Date(p.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return diffDays < 7;
}

// ============ Sub-komponen kecil ============

function ProjectCard({ project, onOpen, onMilestoneClick }: {
  project: ProjectDTO;
  onOpen: () => void;
  onMilestoneClick: (m: MilestoneDTO) => void;
}) {
  const st = statusMeta(project.status);
  const brand = project.brand;
  const pendingCrCount = (project.changeRequests ?? []).filter((c) => c.status === "pending").length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Buka detail project ${project.name}`}
      className="rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-zinc-500">{project.code}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-zinc-900">{project.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pendingCrCount > 0 ? (
            <span
              title="Ada change request menunggu persetujuan klien"
              aria-label={`Ada ${pendingCrCount} change request menunggu`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
            >
              <GitPullRequestArrow className="h-3 w-3" aria-hidden />
              {pendingCrCount} CR
            </span>
          ) : null}
          <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {brand ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: brand.color }} aria-hidden />
            {brand.name}
          </span>
        ) : null}
        {project.company?.name ? <span className="truncate">{project.company.name}</span> : null}
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Progress</span>
          <span className="font-semibold tabular-nums text-zinc-700">{project.progress}%</span>
        </div>
        <Progress value={project.progress} aria-label={`Progress project ${project.progress}%`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-600">
          <User2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          <span className="truncate">{project.pmName ?? "Belum ada PM"}</span>
        </div>
        <div className="flex items-center justify-end gap-1.5 text-zinc-600">
          <span className="truncate font-medium">{formatCurrency(project.contractValue)}</span>
        </div>
        <div className={`flex items-center gap-1.5 ${dueSoon(project) ? "font-medium text-rose-600" : "text-zinc-600"}`}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Deadline {formatDate(project.dueDate)}</span>
        </div>
      </div>

      {(project.milestones ?? []).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          {(project.milestones ?? []).map((m) => {
            const meta = msMeta(m.status);
            const Icon = meta.icon;
            return (
              <span
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => onMilestoneClick(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onMilestoneClick(m);
                  }
                }}
                aria-label={`Milestone ${m.name} — ${meta.label}. Klik untuk menandai selesai`}
                className={`inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:border-zinc-400 ${meta.cls}`}
              >
                <Icon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{m.name}</span>
              </span>
            );
          })}
        </div>
      ) : null}
    </button>
  );
}

// ============ Timeline (Gantt) view ============

const DAY_MS = 24 * 60 * 60 * 1000;

function shortDate(ts: number): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(ts);
}

function TimelineRow({ project, pct, onOpen }: {
  project: ProjectDTO;
  pct: (ts: number) => number;
  onOpen: (p: ProjectDTO) => void;
}) {
  const barCls =
    project.status === "in_progress" ? "bg-zinc-900/90"
    : project.status === "review" ? "bg-violet-500"
    : project.status === "completed" ? "bg-emerald-500"
    : "bg-zinc-400";
  const startTs = project.startDate ? new Date(project.startDate).getTime() : NaN;
  const endTs = project.dueDate ? new Date(project.dueDate).getTime() : NaN;
  const hasStart = Number.isFinite(startTs);
  const hasEnd = Number.isFinite(endTs);
  const leftPct = hasStart ? pct(startTs) : null;
  const widthPct = hasStart && hasEnd ? Math.max(pct(endTs) - pct(startTs), 2) : null;
  const barWidth = widthPct !== null ? Math.min(widthPct, 100 - (leftPct ?? 0)) : null;
  const barTitle = `${project.name} · ${formatDate(project.startDate)} → ${formatDate(project.dueDate)} · ${project.progress}%`;

  return (
    <button
      type="button"
      onClick={() => onOpen(project)}
      aria-label={`Buka detail project ${project.name}`}
      className="flex h-11 w-full border-t border-zinc-100 text-left transition-colors hover:bg-zinc-50"
    >
      <div className="flex w-[200px] shrink-0 items-center gap-2 overflow-hidden pr-3">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: project.brand?.color ?? "#a1a1aa" }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] leading-tight text-zinc-500">{project.code}</p>
          <p className="truncate text-sm leading-tight text-zinc-800">{project.name}</p>
        </div>
      </div>
      <div className="relative flex-1">
        {leftPct !== null && barWidth !== null ? (
          <div
            className={`absolute top-1/2 h-5 -translate-y-1/2 rounded-full ${barCls}`}
            style={{ left: `${leftPct}%`, width: `${barWidth}%` }}
            title={barTitle}
          >
            {widthPct !== null && widthPct >= 14 ? (
              <span className="absolute inset-y-0 right-1.5 flex items-center text-[10px] font-semibold text-white">
                {project.progress}%
              </span>
            ) : null}
          </div>
        ) : null}
        {leftPct !== null && barWidth !== null && widthPct !== null && widthPct < 14 ? (
          <span
            className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-zinc-500"
            style={{ left: `calc(${leftPct + barWidth}% + 6px)` }}
          >
            {project.progress}%
          </span>
        ) : null}
        {leftPct !== null && barWidth === null ? (
          <span
            className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ${barCls}`}
            style={{ left: `${leftPct}%` }}
            title={barTitle}
          />
        ) : null}
        {!hasStart && !hasEnd ? (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-zinc-400">
            Tanpa tanggal
          </span>
        ) : null}
        {(project.milestones ?? []).map((m) => {
          if (!m.dueDate) return null;
          const ts = new Date(m.dueDate).getTime();
          if (!Number.isFinite(ts)) return null;
          const dCls =
            m.status === "done" ? "bg-emerald-500"
            : m.status === "in_progress" ? "bg-amber-500"
            : "bg-zinc-300";
          return (
            <span
              key={m.id}
              className={`absolute h-2.5 w-2.5 rounded-[2px] ${dCls}`}
              style={{
                left: `${pct(ts)}%`,
                top: "calc(50% - 10px)",
                transform: "translate(-50%, -50%) rotate(45deg)",
              }}
              title={`${m.name} · ${msMeta(m.status).label}`}
            />
          );
        })}
      </div>
    </button>
  );
}

function TimelineView({ projects, onOpen }: { projects: ProjectDTO[]; onOpen: (p: ProjectDTO) => void }) {
  const range = useMemo(() => {
    const now = Date.now();
    let min: number | null = null;
    let max: number | null = null;
    for (const p of projects) {
      let contributed = false;
      const track = (raw?: string | Date | number | null) => {
        if (!raw) return;
        const ts = new Date(raw).getTime();
        if (!Number.isFinite(ts)) return;
        min = min === null ? ts : Math.min(min, ts);
        max = max === null ? ts : Math.max(max, ts);
        contributed = true;
      };
      track(p.startDate);
      track(p.dueDate);
      for (const m of p.milestones ?? []) track(m.dueDate);
      if (!contributed) track(now); // fallback: project tanpa tanggal → acuan hari ini
    }
    if (min === null || max === null) return { min: now - 15 * DAY_MS, max: now + 15 * DAY_MS };
    const pad = 7 * DAY_MS;
    return { min: min - pad, max: max + pad };
  }, [projects]);

  const span = Math.max(range.max - range.min, DAY_MS);
  const pct = useCallback((ts: number) => Math.max(0, Math.min(100, ((ts - range.min) / span) * 100)), [range.min, span]);
  const nowPct = pct(Date.now());

  const gridlines = useMemo(() => {
    const n = 6;
    return Array.from({ length: n }, (_, i) => {
      const ratio = i / (n - 1);
      return { pct: ratio * 100, label: shortDate(range.min + ratio * span) };
    });
  }, [range.min, span]);

  const todayTransform = nowPct <= 5 ? "translateX(0)" : nowPct >= 95 ? "translateX(-100%)" : "translateX(-50%)";

  return (
    <div className="overflow-x-auto crm-scroll rounded-xl border bg-white p-4 shadow-sm">
      <div className="min-w-[760px]">
        {/* Sumbu waktu (header) */}
        <div className="flex">
          <div className="w-[200px] shrink-0" />
          <div className="relative h-7 flex-1">
            {gridlines.map((g, i) => (
              <span
                key={i}
                className="absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-zinc-400"
                style={{
                  left: `${g.pct}%`,
                  transform: i === 0 ? "translateX(0)" : i === gridlines.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {g.label}
              </span>
            ))}
            <span
              className="absolute top-0 whitespace-nowrap text-[10px] font-semibold text-rose-500"
              style={{ left: `${nowPct}%`, transform: todayTransform }}
            >
              Hari ini
            </span>
          </div>
        </div>

        {/* Baris project + gridline vertikal */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-[200px] right-0" aria-hidden>
            {gridlines.map((g, i) => (
              <div key={i} className="absolute inset-y-0 border-l border-dashed border-zinc-200" style={{ left: `${g.pct}%` }} />
            ))}
            <div className="absolute inset-y-0 border-l-2 border-rose-400" style={{ left: `${nowPct}%` }} />
          </div>
          {projects.map((p) => (
            <TimelineRow key={p.id} project={p} pct={pct} onOpen={onOpen} />
          ))}
        </div>

        {/* Legenda */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-zinc-400" aria-hidden /> Perencanaan</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-zinc-900/90" aria-hidden /> Berjalan</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-violet-500" aria-hidden /> Review</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-emerald-500" aria-hidden /> Selesai</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-emerald-500" aria-hidden /> Milestone selesai</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-amber-500" aria-hidden /> Dikerjakan</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-zinc-300" aria-hidden /> Menunggu</span>
          <span className="flex items-center gap-1.5"><span className="h-3.5 border-l-2 border-rose-400" aria-hidden /> Hari ini</span>
        </div>
      </div>
    </div>
  );
}

// ============ Calendar (bulanan) view ============

type CalendarEvent =
  | { kind: "project"; project: ProjectDTO }
  | { kind: "milestone"; project: ProjectDTO; milestone: MilestoneDTO };

// 2024-01-01 adalah Senin → ["Sen","Sel","Rab","Kam","Jum","Sab","Min"]
const WEEKDAY_LABELS: string[] = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i)))
);

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ---------- Fallback "Jadwalkan ulang" (menu konteks / keyboard — Task 15-c) ----------

/** Format Date → nilai untuk <input type="date"> (yyyy-mm-dd lokal). */
function toDateInputValue(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse nilai <input type="date"> → Date lokal pukul 12:00 (aman dari geser tanggal). */
function parseDateInputValue(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CalendarView({ projects, onOpenDetail, onRescheduleMilestone, onOpenReschedule }: {
  projects: ProjectDTO[];
  onOpenDetail: (p: ProjectDTO) => void;
  /** Fase 3 — drag-reschedule: pindahkan deadline milestone ke tanggal lain. */
  onRescheduleMilestone?: (project: ProjectDTO, m: MilestoneDTO, newDate: Date) => void;
  /** Fase 3c — fallback touch/keyboard: buka dialog "Jadwalkan Ulang Milestone". */
  onOpenReschedule?: (project: ProjectDTO, m: MilestoneDTO) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  // State drag-reschedule (HTML5 drag events — ringan tanpa library)
  const [dragging, setDragging] = useState<{ milestoneId: string; projectId: string } | null>(null);
  const [dropDayKey, setDropDayKey] = useState<string | null>(null);

  // Event per tanggal (key "y-m-d" lokal). Project/milestone tanpa dueDate diabaikan.
  // Milestone hanya dari project berstatus bukan completed/cancelled.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const push = (d: Date, ev: CalendarEvent) => {
      const key = dateKey(d);
      const arr = map.get(key);
      if (arr) arr.push(ev);
      else map.set(key, [ev]);
    };
    for (const p of projects) {
      if (p.dueDate) {
        const d = new Date(p.dueDate);
        if (!Number.isNaN(d.getTime())) push(d, { kind: "project", project: p });
      }
      if (p.status !== "completed" && p.status !== "cancelled") {
        for (const m of p.milestones ?? []) {
          if (!m.dueDate) continue;
          const d = new Date(m.dueDate);
          if (!Number.isNaN(d.getTime())) push(d, { kind: "milestone", project: p, milestone: m });
        }
      }
    }
    return map;
  }, [projects]);

  // Grid 6 baris × 7 kolom (Senin-based) — tinggi konsisten antar bulan.
  const cells = useMemo(() => {
    const offset = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, i) => {
      const day = i - offset + 1;
      const valid = day >= 1 && day <= daysInMonth;
      return { i, day: valid ? day : null, date: valid ? new Date(cursor.year, cursor.month, day) : null };
    });
  }, [cursor]);

  const now = new Date();
  const todayKey = dateKey(now);
  const isCurrentMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth();
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })
    .format(new Date(cursor.year, cursor.month, 1));

  // Warna brand unik (maks 4) untuk legenda "Deadline project".
  const brandColors = useMemo(() => {
    const seen: string[] = [];
    for (const p of projects) {
      if (p.brand?.color && !seen.includes(p.brand.color)) seen.push(p.brand.color);
      if (seen.length >= 4) break;
    }
    return seen;
  }, [projects]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-white p-10 text-center shadow-sm">
        <CalendarDays className="h-8 w-8 text-zinc-300" aria-hidden />
        <p className="text-sm text-zinc-400">Tidak ada project untuk filter ini.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto crm-scroll rounded-xl border bg-white shadow-sm">
      <div className="min-w-[680px] p-4">
        {/* Header bulan */}
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)} aria-label="Bulan berikutnya">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <p className="ml-1 text-sm font-semibold text-zinc-900">{monthLabel}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-8"
            onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
            disabled={isCurrentMonth}
          >
            Hari ini
          </Button>
        </div>

        {/* Grid kalender */}
        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200">
          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
            {WEEKDAY_LABELS.map((w, i) => (
              <div
                key={w}
                className={`px-2 py-1.5 text-[11px] font-semibold text-zinc-500 ${i < 6 ? "border-r border-zinc-200" : ""}`}
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const dayEvents = cell.date ? eventsByDay.get(dateKey(cell.date)) ?? [] : [];
              const visible = dayEvents.slice(0, 3);
              const rest = dayEvents.slice(3);
              const restTitle = rest
                .map((ev) => (ev.kind === "project" ? `${ev.project.code} · deadline` : `${ev.project.code} · ${ev.milestone.name}`))
                .join("\n");
              const isWeekend = cell.i % 7 >= 5;
              const isToday = cell.date ? dateKey(cell.date) === todayKey : false;
              const bgCls = !cell.date ? "bg-zinc-50/40" : isToday ? "bg-zinc-100" : isWeekend ? "bg-zinc-50/60" : "";
              const cellKey = cell.date ? dateKey(cell.date) : null;
              const isDropTarget = Boolean(dragging) && cellKey !== null && dropDayKey === cellKey;
              return (
                <div
                  key={cell.i}
                  className={`min-h-[92px] p-1.5 ${bgCls} ${cell.i % 7 !== 6 ? "border-r border-zinc-100" : ""} ${cell.i < 35 ? "border-b border-zinc-100" : ""} ${
                    isDropTarget ? "ring-2 ring-inset ring-zinc-900 bg-zinc-100" : ""
                  }`}
                  onDragOver={(e) => {
                    if (!dragging || !cell.date) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropDayKey !== cellKey) setDropDayKey(cellKey);
                  }}
                  onDragLeave={() => {
                    if (cellKey && dropDayKey === cellKey) setDropDayKey(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const target = dragging;
                    setDragging(null);
                    setDropDayKey(null);
                    if (!target || !cell.date || !onRescheduleMilestone) return;
                    const project = projects.find((p) => p.id === target.projectId);
                    const ms = project?.milestones?.find((m) => m.id === target.milestoneId);
                    if (project && ms) onRescheduleMilestone(project, ms, cell.date);
                  }}
                >
                  <div className="flex items-center">
                    {cell.day !== null ? (
                      isToday ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[11px] font-bold leading-none text-white tabular-nums">
                          {cell.day}
                        </span>
                      ) : (
                        <span className="text-[11px] leading-none text-zinc-500 tabular-nums">{cell.day}</span>
                      )
                    ) : null}
                  </div>
                  {visible.length > 0 ? (
                    <div className="mt-1 space-y-1">
                      {visible.map((ev) =>
                        ev.kind === "project" ? (
                          <button
                            key={`p-${ev.project.id}`}
                            type="button"
                            onClick={() => onOpenDetail(ev.project)}
                            title={`${ev.project.code} · ${ev.project.name} · deadline · ${ev.project.progress}%`}
                            aria-label={`Buka detail project ${ev.project.name} (deadline)`}
                            className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-white transition-opacity hover:opacity-80"
                            style={{ backgroundColor: ev.project.brand?.color ?? "#3f3f46" }}
                          >
                            {ev.project.code} · deadline
                          </button>
                        ) : (
                          <button
                            key={`m-${ev.milestone.id}`}
                            type="button"
                            onClick={() => onOpenDetail(ev.project)}
                            draggable={ev.milestone.status !== "done" && Boolean(onRescheduleMilestone)}
                            onDragStart={(e) => {
                              if (ev.milestone.status === "done") return;
                              e.dataTransfer.setData("text/plain", ev.milestone.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDragging({ milestoneId: ev.milestone.id, projectId: ev.project.id });
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setDropDayKey(null);
                            }}
                            onContextMenu={(e) => {
                              // Klik kanan & long-press mobile → dialog jadwalkan ulang (fallback touch)
                              if (!onOpenReschedule) return;
                              e.preventDefault();
                              onOpenReschedule(ev.project, ev.milestone);
                            }}
                            onKeyDown={(e) => {
                              // Shift+F10 / tombol ContextMenu → dialog jadwalkan ulang
                              if (!onOpenReschedule) return;
                              if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
                                e.preventDefault();
                                e.stopPropagation();
                                onOpenReschedule(ev.project, ev.milestone);
                              }
                            }}
                            title={`${ev.project.code} · ${ev.milestone.name} · ${msMeta(ev.milestone.status).label}${onOpenReschedule ? (ev.milestone.status !== "done" && onRescheduleMilestone ? " · seret atau klik kanan untuk menjadwalkan ulang" : " · klik kanan untuk menjadwalkan ulang") : ""}`}
                            aria-label={`Buka detail project ${ev.project.name} — milestone ${ev.milestone.name} (${msMeta(ev.milestone.status).label})${onOpenReschedule ? ", klik kanan atau Shift+F10 untuk jadwalkan ulang" : ""}`}
                            className={cn(
                              "flex w-full select-none items-center gap-1 truncate rounded border border-zinc-200 bg-white px-1 py-0.5 text-left text-[10px] text-zinc-700 transition-colors hover:bg-zinc-50",
                              ev.milestone.status !== "done" && onRescheduleMilestone && "cursor-grab active:cursor-grabbing hover:border-zinc-400",
                              dragging?.milestoneId === ev.milestone.id && "opacity-40"
                            )}
                            style={{ borderLeftWidth: 2, borderLeftColor: ev.project.brand?.color ?? "#a1a1aa" }}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rotate-45 rounded-[1px] ${
                                ev.milestone.status === "done" ? "bg-emerald-500" : ev.milestone.status === "in_progress" ? "bg-amber-500" : "bg-zinc-300"
                              }`}
                              aria-hidden
                            />
                            <span className="truncate">{ev.milestone.name}</span>
                            {ev.milestone.status !== "done" && onRescheduleMilestone ? (
                              <GripVertical className="ml-auto h-2.5 w-2.5 shrink-0 text-zinc-300" aria-hidden />
                            ) : null}
                          </button>
                        )
                      )}
                    </div>
                  ) : null}
                  {rest.length > 0 ? (
                    <span className="mt-1 block truncate text-[10px] font-medium text-zinc-500" title={restTitle}>
                      +{rest.length} lagi
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legenda */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="flex -space-x-1" aria-hidden>
              {(brandColors.length > 0 ? brandColors : [null]).map((c, idx) => (
                <span
                  key={idx}
                  className="h-2.5 w-3 rounded-full ring-1 ring-white"
                  style={{ backgroundColor: c ?? "#a1a1aa" }}
                />
              ))}
            </span>
            Deadline project
          </span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-emerald-500" aria-hidden /> Milestone selesai</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-amber-500" aria-hidden /> Dikerjakan</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[2px] bg-zinc-300" aria-hidden /> Menunggu</span>
          {onOpenReschedule ? (
            <span className="flex items-center gap-1.5 text-zinc-400">
              <GripVertical className="h-3 w-3" aria-hidden />
              Seret atau klik-kanan milestone untuk menjadwalkan ulang
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
      </div>
    </div>
  );
}

// ============ Module utama ============

export default function ProjectsModule() {
  const storeBrands = useCrmStore((s) => s.brands);
  const user = useCrmStore((s) => s.user);

  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [view, setView] = useState<"cards" | "timeline" | "calendar">("cards");

  const [detail, setDetail] = useState<ProjectDTO | null>(null);
  const [editStatus, setEditStatus] = useState("planning");
  const [editProgress, setEditProgress] = useState("0");
  const [savingDetail, setSavingDetail] = useState(false);

  // Change request (Fase 2 — Produksi)
  const [crDialogOpen, setCrDialogOpen] = useState(false);
  const [crTitle, setCrTitle] = useState("");
  const [crDesc, setCrDesc] = useState("");
  const [crCost, setCrCost] = useState("");
  const [crDays, setCrDays] = useState("");
  const [crSaving, setCrSaving] = useState(false);
  const [decideTarget, setDecideTarget] = useState<{ cr: ChangeRequestDTO; decision: "approve" | "reject" | "cancel" } | null>(null);
  const [decideNote, setDecideNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  // Fase 3c — dialog "Jadwalkan Ulang Milestone" (fallback klik kanan / long-press / keyboard)
  const [rescheduleTarget, setRescheduleTarget] = useState<{ project: ProjectDTO; milestone: MilestoneDTO } | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleStatus, setRescheduleStatus] = useState("pending");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  const canDecideCr = user?.role === "director" || user?.role === "super_admin";
  const detailCrs = detail?.changeRequests ?? [];
  const approvedCrSum = detailCrs
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + (c.additionalCost ?? 0), 0);

  // Milestone aktif pada dialog jadwalkan ulang (lookup terkini dari state agar guard same-day akurat)
  const rescheduleCurrent = rescheduleTarget
    ? (projects ?? []).find((p) => p.id === rescheduleTarget.project.id)?.milestones?.find((x) => x.id === rescheduleTarget.milestone.id)
      ?? rescheduleTarget.milestone
    : null;
  // Guard "same-day no-change": Simpan disabled bila tanggal sama DAN status tidak berubah
  const rescheduleDirty = rescheduleCurrent
    ? rescheduleDate !== toDateInputValue(rescheduleCurrent.dueDate ? new Date(rescheduleCurrent.dueDate) : null)
      || rescheduleStatus !== rescheduleCurrent.status
    : false;

  const load = useCallback(async (silent = false): Promise<ProjectDTO[]> => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.projects({
        status: statusFilter,
        brandId: brandFilter !== "all" ? brandFilter : undefined,
      });
      setProjects(res.projects);
      return res.projects;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat project");
      if (!silent) toast.error("Gagal memuat data project");
      return [];
    } finally {
      setLoading(false);
    }
  }, [statusFilter, brandFilter]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const list = projects ?? [];
    return {
      active: list.filter((p) => p.status === "in_progress" || p.status === "review").length,
      total: list.length,
      avgProgress: list.length > 0 ? Math.round(list.reduce((s, p) => s + p.progress, 0) / list.length) : 0,
    };
  }, [projects]);

  function openDetail(p: ProjectDTO) {
    setDetail(p);
    setEditStatus(p.status);
    setEditProgress(String(p.progress));
  }

  function confirmMilestone(project: ProjectDTO, m: MilestoneDTO) {
    if (m.status === "done") {
      toast.info(`Milestone "${m.name}" sudah selesai`);
      return;
    }
    toast.info(`Tandai milestone "${m.name}" selesai?`, {
      description: `Project ${project.code} · progress akan dihitung ulang otomatis`,
      action: {
        label: "Ya, selesaikan",
        onClick: () => { void markMilestoneDone(project, m); },
      },
    });
  }

  /** Ambil ulang daftar project lalu sinkronkan sheet detail dengan data terbaru. */
  async function refreshDetail() {
    const fresh = await load(true);
    setDetail((d) => (d ? fresh.find((p) => p.id === d.id) ?? d : d));
  }

  async function markMilestoneDone(project: ProjectDTO, m: MilestoneDTO) {
    try {
      await api.updateProject({
        id: project.id,
        milestoneId: m.id,
        milestoneStatus: "done",
      });
      // API menghitung ulang progress & status project di server — ambil data terbaru
      toast.success(`Milestone "${m.name}" ditandai selesai`);
      await refreshDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui milestone");
    }
  }

  /** Sinkronkan perubahan milestone ke daftar project + sheet detail (jika terbuka) — dipakai drag & dialog. */
  function patchMilestoneState(projectId: string, milestoneId: string, patch: { dueDate?: string | null; status?: string }) {
    const apply = (x: MilestoneDTO): MilestoneDTO => ({
      ...x,
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : null),
      ...(patch.status !== undefined ? { status: patch.status } : null),
    });
    setProjects((prev) => (prev ?? []).map((p) =>
      p.id !== projectId ? p : { ...p, milestones: (p.milestones ?? []).map((x) => (x.id === milestoneId ? apply(x) : x)) }
    ));
    setDetail((d) => (d && d.id === projectId
      ? { ...d, milestones: (d.milestones ?? []).map((x) => (x.id === milestoneId ? apply(x) : x)) }
      : d));
  }

  /** Fase 3 — drag-reschedule milestone di kalender: update optimis + revert bila gagal. */
  async function handleRescheduleMilestone(project: ProjectDTO, m: MilestoneDTO, newDate: Date) {
    const oldDue = m.dueDate ? new Date(m.dueDate) : null;
    if (oldDue && isSameLocalDay(oldDue, newDate)) return;
    if (m.status === "done") {
      toast.info(`Milestone "${m.name}" sudah selesai — tidak dapat dijadwalkan ulang`);
      return;
    }

    patchMilestoneState(project.id, m.id, { dueDate: newDate.toISOString() }); // optimis
    try {
      await api.updateMilestone({
        milestoneId: m.id,
        dueDate: newDate.toISOString(),
        actorName: user?.name ?? "Produksi",
        actorRole: user?.role ?? "production",
      });
      toast.success(`Milestone "${m.name}" dijadwalkan ulang`, {
        description: oldDue ? `${formatDate(oldDue)} → ${formatDate(newDate)}` : `Deadline baru: ${formatDate(newDate)}`,
      });
    } catch (err) {
      patchMilestoneState(project.id, m.id, { dueDate: oldDue ? oldDue.toISOString() : null }); // revert
      toast.error(err instanceof Error ? err.message : "Gagal menjadwalkan ulang milestone");
    }
  }

  /** Fase 3c — buka dialog jadwalkan ulang dari chip kalender (klik kanan / Shift+F10 / long-press). */
  function openRescheduleDialog(project: ProjectDTO, m: MilestoneDTO) {
    setRescheduleTarget({ project, milestone: m });
    setRescheduleDate(toDateInputValue(m.dueDate ? new Date(m.dueDate) : null));
    setRescheduleStatus(m.status);
  }

  function bumpRescheduleDate(days: number) {
    const base = parseDateInputValue(rescheduleDate)
      ?? (rescheduleTarget?.milestone.dueDate ? new Date(rescheduleTarget.milestone.dueDate) : new Date());
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 12);
    setRescheduleDate(toDateInputValue(next));
  }

  /** Fase 3c — simpan dialog: ubah dueDate dan/atau status milestone (optimis + revert bila gagal). */
  async function handleSaveRescheduleDialog() {
    if (!rescheduleTarget || !user) return;
    // Ambil milestone terkini dari state (snapshot dialog bisa basi setelah update optimis sebelumnya)
    const project = (projects ?? []).find((p) => p.id === rescheduleTarget.project.id) ?? rescheduleTarget.project;
    const m = project.milestones?.find((x) => x.id === rescheduleTarget.milestone.id) ?? rescheduleTarget.milestone;
    const newDate = parseDateInputValue(rescheduleDate);
    if (!newDate) {
      toast.error("Pilih tanggal deadline yang valid");
      return;
    }
    const oldDue = m.dueDate ? new Date(m.dueDate) : null;
    const dateChanged = !oldDue || !isSameLocalDay(oldDue, newDate);
    const statusChanged = rescheduleStatus !== m.status;
    if (!dateChanged && !statusChanged) return; // guard: tidak ada perubahan

    setRescheduleSaving(true);
    patchMilestoneState(project.id, m.id, {
      dueDate: dateChanged ? newDate.toISOString() : undefined,
      status: statusChanged ? rescheduleStatus : undefined,
    }); // optimis
    try {
      await api.updateMilestone({
        milestoneId: m.id,
        dueDate: dateChanged ? newDate.toISOString() : undefined,
        status: statusChanged ? rescheduleStatus : undefined,
        actorName: user.name,
        actorRole: user.role,
      });
      if (dateChanged) {
        toast.success(`${m.name}: ${oldDue ? formatDate(oldDue) : "tanpa tanggal"} → ${formatDate(newDate)}`, {
          description: statusChanged ? `Status: ${msMeta(m.status).label} → ${msMeta(rescheduleStatus).label}` : undefined,
        });
      } else {
        toast.success(`Status milestone "${m.name}" diperbarui`, {
          description: `${msMeta(m.status).label} → ${msMeta(rescheduleStatus).label}`,
        });
      }
      setRescheduleTarget(null); // tutup pada sukses
      if (statusChanged) await refreshDetail(); // sinkronkan ulang data project
    } catch (err) {
      patchMilestoneState(project.id, m.id, {
        dueDate: dateChanged ? (oldDue ? oldDue.toISOString() : null) : undefined,
        status: statusChanged ? m.status : undefined,
      }); // revert
      toast.error(err instanceof Error ? err.message : "Gagal menjadwalkan ulang milestone");
    } finally {
      setRescheduleSaving(false);
    }
  }

  function openCrDialog() {
    setCrTitle("");
    setCrDesc("");
    setCrCost("");
    setCrDays("");
    setCrDialogOpen(true);
  }

  async function submitCreateCr(e: React.FormEvent) {
    e?.preventDefault();
    if (!detail || !user) {
      toast.error("Sesi tidak ditemukan — muat ulang halaman");
      return;
    }
    const title = crTitle.trim();
    const description = crDesc.trim();
    if (!title || !description) {
      toast.error("Judul dan deskripsi change request wajib diisi");
      return;
    }
    setCrSaving(true);
    try {
      const res = await api.createChangeRequest({
        projectId: detail.id,
        title,
        description,
        additionalCost: Math.max(0, Number(crCost) || 0),
        additionalDays: Math.max(0, Number(crDays) || 0),
        requestedBy: user.name,
        actorRole: user.role,
      });
      toast.success(`Change Request ${res.changeRequest.number} diajukan — menunggu persetujuan klien`);
      setCrDialogOpen(false);
      await refreshDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengajukan change request");
    } finally {
      setCrSaving(false);
    }
  }

  function openDecide(cr: ChangeRequestDTO, decision: "approve" | "reject" | "cancel") {
    setDecideNote("");
    setDecideTarget({ cr, decision });
  }

  async function submitDecision() {
    if (!decideTarget || !user) return;
    setDeciding(true);
    try {
      const res = await api.decideChangeRequest({
        id: decideTarget.cr.id,
        decision: decideTarget.decision,
        decisionNote: decideNote.trim() || undefined,
        actorName: user.name,
        actorRole: user.role,
      });
      if (decideTarget.decision === "approve") {
        toast.success(res.invoice
          ? `CR ${res.changeRequest.number} disetujui — invoice ${res.invoice.number} dibuat`
          : `CR ${res.changeRequest.number} disetujui`);
      } else if (decideTarget.decision === "cancel") {
        toast.info(`CR ${res.changeRequest.number} dibatalkan`);
      } else {
        toast.success(`CR ${res.changeRequest.number} ditolak`);
      }
      setDecideTarget(null);
      await refreshDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memutuskan change request");
    } finally {
      setDeciding(false);
    }
  }

  async function saveDetail(e: React.FormEvent) {
    e?.preventDefault();
    if (!detail) return;
    const progress = Math.max(0, Math.min(100, Number(editProgress)));
    if (!Number.isFinite(progress)) { toast.error("Progress harus angka 0–100"); return; }
    setSavingDetail(true);
    try {
      const res = await api.updateProject({ id: detail.id, status: editStatus, progress });
      setProjects((prev) => (prev ?? []).map((p) => (p.id === res.project.id ? { ...p, ...res.project } : p)));
      setDetail((d) => (d ? { ...d, ...res.project, status: editStatus, progress } : d));
      toast.success(`Project ${res.project.code} diperbarui`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan project");
    } finally {
      setSavingDetail(false);
    }
  }

  if (loading && projects === null) return <ProjectsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Projects</h1>
          <p className="text-sm text-zinc-500">Produksi setelah deal berhasil — template workflow per layanan</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const rows = projects ?? [];
              if (rows.length === 0) {
                toast.error("Tidak ada project untuk diekspor");
                return;
              }
              const csv = buildProjectsCsv(rows);
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const ymd = new Date().toISOString().slice(0, 10);
              a.href = url;
              a.download = `project-grupcrm-${ymd}.csv`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              toast.success(`Ekspor CSV selesai — ${rows.length} project diunduh`);
            }}
            aria-label="Ekspor project ke CSV"
          >
            <Download className="h-4 w-4" aria-hidden /> Ekspor CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang daftar project">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter status project">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="planning">Perencanaan</SelectItem>
            <SelectItem value="in_progress">Berjalan</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="completed">Selesai</SelectItem>
          </SelectContent>
        </Select>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filter brand project">
            <SelectValue placeholder="Brand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Brand</SelectItem>
            {storeBrands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          <span className="text-xs text-zinc-500">
            {stats.total} project · {stats.active} aktif · rata-rata progress {stats.avgProgress}%
          </span>
          <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5" role="group" aria-label="Mode tampilan project">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView("cards")}
              aria-pressed={view === "cards"}
              aria-label="Tampilan kartu"
              className={`h-7 gap-1.5 rounded-md px-2.5 ${view === "cards" ? "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Kartu
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView("timeline")}
              aria-pressed={view === "timeline"}
              aria-label="Tampilan timeline"
              className={`h-7 gap-1.5 rounded-md px-2.5 ${view === "timeline" ? "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}
            >
              <ChartGantt className="h-3.5 w-3.5" aria-hidden /> Timeline
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView("calendar")}
              aria-pressed={view === "calendar"}
              aria-label="Tampilan kalender"
              className={`h-7 gap-1.5 rounded-md px-2.5 ${view === "calendar" ? "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Kalender
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Tampilan kartu / timeline / kalender */}
      {view === "cards" ? (
        (projects ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-white p-10 text-center shadow-sm">
            <FolderKanban className="h-8 w-8 text-zinc-300" aria-hidden />
            <p className="text-sm text-zinc-400">Belum ada project untuk filter ini.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(projects ?? []).map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => openDetail(p)}
                onMilestoneClick={(m) => confirmMilestone(p, m)}
              />
            ))}
          </div>
        )
      ) : view === "calendar" ? (
        <CalendarView projects={projects ?? []} onOpenDetail={openDetail} onRescheduleMilestone={handleRescheduleMilestone} onOpenReschedule={openRescheduleDialog} />
      ) : (projects ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-white p-10 text-center shadow-sm">
          <ChartGantt className="h-8 w-8 text-zinc-300" aria-hidden />
          <p className="text-sm text-zinc-400">Tidak ada project untuk filter ini.</p>
        </div>
      ) : (
        <TimelineView projects={projects ?? []} onOpen={openDetail} />
      )}

      {/* Sheet detail */}
      <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent className="w-full overflow-y-auto crm-scroll sm:max-w-md">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle className="leading-snug">{detail.name}</SheetTitle>
                <SheetDescription>
                  <span className="font-mono">{detail.code}</span>
                  {detail.brand ? ` · ${detail.brand.name}` : ""}
                  {detail.company?.name ? ` · ${detail.company.name}` : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-5 px-4 pb-8">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`border-transparent px-1.5 ${statusMeta(detail.status).cls}`}>
                    {statusMeta(detail.status).label}
                  </Badge>
                  {detail.serviceCategory ? (
                    <Badge variant="outline" className="border-transparent bg-zinc-100 px-1.5 text-zinc-600">
                      {detail.serviceCategory}
                    </Badge>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Progress</span>
                    <span className="font-semibold tabular-nums text-zinc-700">{detail.progress}%</span>
                  </div>
                  <Progress value={detail.progress} aria-label={`Progress ${detail.progress}%`} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-zinc-500">Project Manager</p>
                    <p className="mt-0.5 text-zinc-800">{detail.pmName ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Nilai Kontrak</p>
                    <p className="mt-0.5 font-medium tabular-nums text-zinc-800">{formatCurrency(detail.contractValue)}</p>
                    {approvedCrSum > 0 ? (
                      <p className="mt-0.5 text-[11px] font-medium text-emerald-600">
                        +{formatCurrency(approvedCrSum)} dari change request
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Mulai</p>
                    <p className="mt-0.5 text-zinc-800">{formatDate(detail.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Deadline</p>
                    <p className={`mt-0.5 ${dueSoon(detail) ? "font-medium text-rose-600" : "text-zinc-800"}`}>
                      {formatDate(detail.dueDate)}
                    </p>
                  </div>
                </div>

                {/* Milestones */}
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Milestone ({(detail.milestones ?? []).filter((m) => m.status === "done").length}/{(detail.milestones ?? []).length} selesai)
                  </p>
                  <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll">
                    {(detail.milestones ?? []).map((m) => {
                      const meta = msMeta(m.status);
                      const Icon = meta.icon;
                      return (
                        <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon className={`h-4 w-4 shrink-0 ${m.status === "done" ? "text-emerald-600" : m.status === "in_progress" ? "text-amber-600" : "text-zinc-400"}`} aria-hidden />
                            <div className="min-w-0">
                              <p className={`truncate text-sm font-medium ${m.status === "done" ? "text-emerald-700 line-through decoration-emerald-500" : "text-zinc-800"}`}>
                                {m.name}
                              </p>
                              <p className="text-[11px] text-zinc-400">
                                #{m.order} {m.dueDate ? `· due ${formatDate(m.dueDate)}` : ""}
                              </p>
                            </div>
                          </div>
                          {m.status !== "done" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => confirmMilestone(detail, m)}
                              aria-label={`Tandai milestone ${m.name} selesai`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Selesaikan
                            </Button>
                          ) : (
                            <Badge variant="outline" className="shrink-0 border-transparent bg-emerald-100 text-emerald-700">Selesai</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Change Request (Fase 2 — Produksi) */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      <GitPullRequestArrow className="h-3.5 w-3.5" aria-hidden />
                      Change Request ({detailCrs.length})
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openCrDialog}
                      aria-label="Ajukan change request baru"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Ajukan Change Request
                    </Button>
                  </div>
                  <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll">
                    {detailCrs.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-4 text-center text-xs text-zinc-400">
                        Belum ada change request untuk project ini.
                      </div>
                    ) : (
                      detailCrs.map((cr) => {
                        const meta = crMeta(cr.status);
                        return (
                          <div key={cr.id} className="rounded-lg border bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] text-zinc-500">{cr.number}</span>
                              <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 ${meta.cls}`}>
                                {meta.label}
                              </Badge>
                            </div>
                            <p className="mt-1.5 text-sm font-semibold text-zinc-900">{cr.title}</p>
                            <p className="mt-0.5 text-xs text-zinc-500">{cr.description}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                              <span className="font-semibold tabular-nums text-emerald-700">
                                +{formatCurrency(cr.additionalCost)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <CalendarClock className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
                                {cr.additionalDays} hari tambahan
                              </span>
                              <span>Diajukan oleh {cr.requestedBy}</span>
                              <span>{timeAgo(cr.createdAt)}</span>
                            </div>
                            {cr.status !== "pending" ? (
                              <div className="mt-2 border-t border-zinc-100 pt-2">
                                <p className="text-[11px] text-zinc-500">
                                  Diputuskan oleh {cr.decidedBy ?? "-"}
                                  {cr.decidedAt ? ` · ${timeAgo(cr.decidedAt)}` : ""}
                                </p>
                                {cr.decisionNote ? (
                                  <p className="mt-0.5 text-[11px] italic text-zinc-500">“{cr.decisionNote}”</p>
                                ) : null}
                                {cr.status === "approved" && cr.invoiceId ? (
                                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                    <ReceiptText className="h-3 w-3" aria-hidden /> Invoice tambahan diterbitkan
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {cr.status === "pending" ? (
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                {canDecideCr ? (
                                  <>
                                    <Button
                                      size="sm"
                                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                                      onClick={() => openDecide(cr, "approve")}
                                      aria-label={`Setujui change request ${cr.number}`}
                                    >
                                      <Check className="h-3.5 w-3.5" aria-hidden /> Setujui
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                      onClick={() => openDecide(cr, "reject")}
                                      aria-label={`Tolak change request ${cr.number}`}
                                    >
                                      <X className="h-3.5 w-3.5" aria-hidden /> Tolak
                                    </Button>
                                  </>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800"
                                  onClick={() => openDecide(cr, "cancel")}
                                  aria-label={`Batalkan change request ${cr.number}`}
                                >
                                  <XCircle className="h-3.5 w-3.5" aria-hidden /> Batalkan
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Update status & progress */}
                <form onSubmit={saveDetail} className="space-y-3 rounded-xl border bg-zinc-50 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <Factory className="h-3.5 w-3.5" aria-hidden /> Update Produksi
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="proj-status">Status</Label>
                      <Select value={editStatus} onValueChange={setEditStatus}>
                        <SelectTrigger id="proj-status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="planning">Perencanaan</SelectItem>
                          <SelectItem value="in_progress">Berjalan</SelectItem>
                          <SelectItem value="review">Review</SelectItem>
                          <SelectItem value="completed">Selesai</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="proj-progress">Progress (0–100)</Label>
                      <Input
                        id="proj-progress" type="number" min={0} max={100}
                        value={editProgress}
                        onChange={(e) => setEditProgress(e.target.value)}
                      />
                    </div>
                  </div>
                  <SheetFooter className="px-0">
                    <Button type="submit" disabled={savingDetail} aria-label="Simpan perubahan project">
                      {savingDetail ? "Menyimpan…" : "Simpan Perubahan"}
                    </Button>
                  </SheetFooter>
                </form>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Dialog pengajuan change request */}
      <Dialog open={crDialogOpen} onOpenChange={setCrDialogOpen}>
        <DialogContent className="sm:max-w-md" aria-label="Form pengajuan change request">
          <DialogHeader>
            <DialogTitle>Ajukan Change Request</DialogTitle>
            <DialogDescription>
              Usulkan perubahan scope untuk {detail?.code ?? "project"}. Setelah klien menyetujui, nilai kontrak &amp;
              deadline project otomatis diperbarui dan invoice tambahan dibuat.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreateCr} className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cr-title">Judul</Label>
              <Input
                id="cr-title"
                value={crTitle}
                onChange={(e) => setCrTitle(e.target.value)}
                placeholder="Contoh: Tambahan halaman landing page"
                required
                aria-label="Judul change request"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cr-desc">Deskripsi perubahan scope</Label>
              <Textarea
                id="cr-desc"
                value={crDesc}
                onChange={(e) => setCrDesc(e.target.value)}
                placeholder="Jelaskan perubahan scope yang diminta…"
                rows={3}
                required
                aria-label="Deskripsi perubahan scope"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cr-cost">Biaya tambahan (IDR)</Label>
                <Input
                  id="cr-cost"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={crCost}
                  onChange={(e) => setCrCost(e.target.value)}
                  placeholder="0"
                  aria-label="Biaya tambahan dalam rupiah"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cr-days">Perpanjangan deadline (hari)</Label>
                <Input
                  id="cr-days"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={crDays}
                  onChange={(e) => setCrDays(e.target.value)}
                  placeholder="0"
                  aria-label="Perpanjangan deadline dalam hari"
                />
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">
              Diajukan oleh {user?.name ?? "-"} — menunggu persetujuan Direktur, Super Admin, atau klien.
            </p>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCrDialogOpen(false)}
                disabled={crSaving}
                aria-label="Batal ajukan change request"
              >
                Batal
              </Button>
              <Button type="submit" disabled={crSaving} aria-label="Kirim pengajuan change request">
                {crSaving ? "Mengirim…" : "Ajukan Change Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AlertDialog konfirmasi keputusan change request */}
      <AlertDialog
        open={decideTarget !== null}
        onOpenChange={(open) => { if (!open) setDecideTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decideTarget?.decision === "approve"
                ? "Setujui change request?"
                : decideTarget?.decision === "cancel"
                  ? "Batalkan change request?"
                  : "Tolak change request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decideTarget?.decision === "cancel" ? (
                decideTarget
                  ? `${decideTarget.cr.number} akan dibatalkan dan tidak diproses lebih lanjut.`
                  : ""
              ) : (
                <>
                  {decideTarget
                    ? `${decideTarget.cr.number} · ${decideTarget.cr.title} — +${formatCurrency(decideTarget.cr.additionalCost)}, +${decideTarget.cr.additionalDays} hari.`
                    : ""}
                  {decideTarget?.decision === "approve"
                    ? " Nilai kontrak &amp; deadline project akan diperbarui dan invoice tambahan diterbitkan otomatis."
                    : " Perubahan scope tidak akan diterapkan."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cr-decision-note">Catatan keputusan (opsional)</Label>
            <Textarea
              id="cr-decision-note"
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value)}
              placeholder={
                decideTarget?.decision === "approve" ? "Contoh: Disetujui sesuai diskusi dengan klien"
                : decideTarget?.decision === "cancel" ? "Contoh: Change request diajukan keliru"
                : "Contoh: Scope di luar anggaran tahun ini"
              }
              rows={3}
              aria-label="Catatan keputusan change request"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deciding} aria-label="Batal memutuskan change request">Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={deciding}
              onClick={(e) => { e.preventDefault(); void submitDecision(); }}
              className={
                decideTarget?.decision === "approve"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : decideTarget?.decision === "cancel"
                    ? "bg-zinc-900 text-white hover:bg-zinc-700"
                    : "bg-rose-600 text-white hover:bg-rose-700"
              }
              aria-label={`Konfirmasi ${decideTarget?.decision === "approve" ? "setujui" : decideTarget?.decision === "cancel" ? "batalkan" : "tolak"} change request`}
            >
              {deciding
                ? "Memproses…"
                : decideTarget?.decision === "approve"
                  ? "Ya, Setujui"
                  : decideTarget?.decision === "cancel"
                    ? "Ya, Batalkan"
                    : "Ya, Tolak"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fase 3c — dialog "Jadwalkan Ulang Milestone" (fallback klik kanan / long-press / Shift+F10) */}
      <Dialog
        open={rescheduleTarget !== null}
        onOpenChange={(open) => { if (!open && !rescheduleSaving) setRescheduleTarget(null); }}
      >
        <DialogContent className="rounded-xl sm:max-w-sm" aria-label="Jadwalkan ulang milestone">
          <DialogHeader>
            <DialogTitle>Jadwalkan Ulang Milestone</DialogTitle>
            <DialogDescription>
              {rescheduleTarget
                ? `${rescheduleTarget.project.code} · ${rescheduleTarget.project.name} — ${rescheduleTarget.milestone.name}`
                : "Pilih tanggal dan status milestone."}
            </DialogDescription>
          </DialogHeader>
          {rescheduleCurrent ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                Tanggal saat ini:{" "}
                <span className="font-medium text-zinc-700">
                  {rescheduleCurrent.dueDate ? formatDate(rescheduleCurrent.dueDate) : "belum diatur"}
                </span>
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="ms-reschedule-date" className="text-xs uppercase tracking-wide text-zinc-500">
                  Tanggal deadline
                </Label>
                <Input
                  id="ms-reschedule-date"
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  aria-label="Tanggal deadline baru milestone"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pintasan geser tanggal">
                {[1, 7, 14].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 hover:bg-zinc-50"
                    onClick={() => bumpRescheduleDate(n)}
                    aria-label={`Geser tanggal maju ${n} hari`}
                  >
                    +{n} hari
                  </Button>
                ))}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ms-reschedule-status" className="text-xs uppercase tracking-wide text-zinc-500">
                  Status
                </Label>
                <Select value={rescheduleStatus} onValueChange={setRescheduleStatus}>
                  <SelectTrigger id="ms-reschedule-status" aria-label="Status milestone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Menunggu</SelectItem>
                    <SelectItem value="in_progress">Dikerjakan</SelectItem>
                    <SelectItem value="done">Selesai</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRescheduleTarget(null)}
              disabled={rescheduleSaving}
              aria-label="Batal jadwalkan ulang milestone"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveRescheduleDialog()}
              disabled={!rescheduleDirty || rescheduleSaving}
              aria-label="Simpan jadwal milestone"
            >
              {rescheduleSaving ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
