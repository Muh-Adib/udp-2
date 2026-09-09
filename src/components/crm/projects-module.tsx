"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, CalendarDays, ChartGantt, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, CircleDotDashed,
  Download, ExternalLink, Factory, FileCheck, FolderKanban, GitPullRequestArrow, GripVertical, LayoutGrid, Link2, Loader2,
  Paperclip, Pencil, Plus, ReceiptText, RefreshCw, Route, ShieldCheck, Trash2, User, User2, X, XCircle,
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
import { SERVICE_CATEGORIES } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type {
  Brand, ChangeRequestDTO, CompanyRef, InvoiceDTO, MilestoneDTO, ProjectDeliverableDTO, ProjectDTO,
} from "@/lib/crm/types";
import { formatCurrency, formatDate, formatDateTime, timeAgo } from "@/lib/crm/utils";
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

// Task 22-4 — Deliverable & Review (file/tautan yang dikirim untuk ditinjau klien/manajemen)
const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  animation: "Animasi",
  website: "Website",
  video: "Video / Produksi",
  immersive: "Immersive / AR-VR",
  digital_marketing: "Digital Marketing",
};

const DELIVERABLE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu Review", cls: "bg-zinc-100 text-zinc-600" },
  approved: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  revision: { label: "Revisi", cls: "bg-amber-100 text-amber-700" },
};

function dlvMeta(s: string) {
  return DELIVERABLE_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" };
}

// ============ Ronde 34 — Alur Produksi: peta tahapan + RECORD nyata per tahap ============
// Keluhan user: "untuk keproduksian floenya belum jelas recordnya". Sheet detail dulu
// hanya menampilkan status + progress tanpa menjelaskan posisi project dalam alur
// produksi dan record apa yang sudah tersimpan di tiap tahap.

const PRODUCTION_STEPS = ["Deal & Kontrak", "Perencanaan", "Produksi", "Review", "Serah Terima"] as const;

function ProductionFlow({ project, deliverables, crs, invoices }: {
  project: ProjectDTO;
  deliverables: ProjectDeliverableDTO[] | null;
  crs: ChangeRequestDTO[];
  invoices: InvoiceDTO[] | null;
}) {
  const milestones = project.milestones ?? [];
  const doneMs = milestones.filter((m) => m.status === "done").length;
  const dlv = deliverables ?? [];
  const dlvApproved = dlv.filter((d) => d.status === "approved").length;
  const dlvRevision = dlv.filter((d) => d.status === "revision").length;
  const dlvPending = dlv.filter((d) => d.status === "pending").length;
  const approvedCr = crs.filter((c) => c.status === "approved");
  const invTotal = (invoices ?? []).reduce((s, i) => s + i.total, 0);
  const paidTotal = (invoices ?? []).reduce((s, i) => s + (i.payments ?? []).reduce((ps, p) => ps + p.amount, 0), 0);

  // Posisi tahap saat ini (0-4): planning→1, in_progress→2, review→3, completed→4 (semua selesai)
  const currentIdx = project.status === "planning" ? 1
    : project.status === "in_progress" ? 2
    : project.status === "review" ? 3
    : project.status === "completed" ? 5 // 5 = seluruh alur selesai
    : 0;

  /** Record yang tampil di bawah tiap nama tahap — dari data nyata, bukan teks statis. */
  const stepRecords: string[] = [
    // 0 — Deal & Kontrak
    project.opportunityId
      ? `Dari opportunity won · kontrak ${formatCurrency(project.contractValue ?? 0)}`
      : `Project manual · kontrak ${formatCurrency(project.contractValue ?? 0)}`,
    // 1 — Perencanaan
    milestones.length > 0
      ? `${milestones.length} milestone direncanakan`
      : "Belum ada milestone — tambahkan rencana kerja",
    // 2 — Produksi
    milestones.length > 0
      ? `${doneMs}/${milestones.length} milestone selesai · progress ${project.progress}%`
      : `Progress ${project.progress}%`,
    // 3 — Review
    deliverables === null
      ? "Memuat deliverable…"
      : dlv.length > 0
        ? `${dlv.length} deliverable · ${dlvApproved} disetujui${dlvPending ? ` · ${dlvPending} menunggu` : ""}${dlvRevision ? ` · ${dlvRevision} revisi` : ""}`
        : "Belum ada deliverable dikirim",
    // 4 — Serah Terima & Penagihan
    invoices === null
      ? "Memuat invoice…"
      : invoices.length > 0
        ? `${invoices.length} invoice · terbit ${formatCurrency(invTotal)}${paidTotal > 0 ? ` · dibayar ${formatCurrency(paidTotal)}` : ""}`
        : approvedCr.length > 0
          ? `${approvedCr.length} CR disetujui — invoice tambahan terbit`
          : "Belum ada invoice project",
  ];

  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <Route className="h-3.5 w-3.5" aria-hidden /> Alur Produksi
        {currentIdx === 5 ? (
          <Badge variant="outline" className="ml-auto border-transparent bg-emerald-100 text-[11px] text-emerald-700">Alur selesai</Badge>
        ) : (
          <span className="ml-auto text-[11px] font-normal normal-case text-zinc-400">
            Tahap {currentIdx + 1}/5 · {PRODUCTION_STEPS[currentIdx]}
          </span>
        )}
      </p>
      <ol className="mt-2.5 flex items-start gap-0" aria-label="Alur produksi project">
        {PRODUCTION_STEPS.map((label, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          return (
            <li key={label} className="flex min-w-0 flex-1 flex-col items-center text-center" aria-current={isCurrent ? "step" : undefined}>
              <div className="flex w-full items-center" aria-hidden>
                <span className={cn("h-0.5 flex-1", idx === 0 ? "bg-transparent" : isDone || isCurrent ? "bg-emerald-400" : "bg-zinc-200")} />
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-bold",
                    isDone ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrent ? "border-emerald-500 bg-white text-emerald-600"
                      : "border-zinc-200 bg-white text-zinc-300",
                  )}
                >
                  {isDone ? <Check className="h-3 w-3" /> : idx + 1}
                </span>
                <span className={cn("h-0.5 flex-1", idx === PRODUCTION_STEPS.length - 1 ? "bg-transparent" : isDone ? "bg-emerald-400" : "bg-zinc-200")} />
              </div>
              <p className={cn("mt-1 px-0.5 text-[10px] font-semibold leading-tight", isDone || isCurrent ? "text-zinc-800" : "text-zinc-400")}>
                {label}
              </p>
              <p className={cn("mt-0.5 px-0.5 text-[9px] leading-tight", isDone || isCurrent ? "text-zinc-500" : "text-zinc-300")}>
                {stepRecords[idx]}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Task 25-b — label peran reviewer deliverable (reviewedRole). Role tak dikenal ditampilkan apa adanya. */
function reviewerRoleLabel(role?: string | null): string {
  switch (role) {
    case "production": return "Produksi";
    case "director": return "Direktur";
    case "manager": return "Manajer";
    case "hr": return "HR";
    case "super_admin": return "Super Admin";
    case "client": return "Klien";
    default: return role ?? "";
  }
}

function formatSizeKb(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

const MAX_DELIVERABLE_BYTES = 1_200_000; // 1.2MB — sinkron dengan validasi API

/** fileData (base64 data URL) dikirim server tetapi tidak dideklarasikan di ProjectDeliverableDTO —
 *  types.ts tidak boleh diubah, jadi perluas secara lokal untuk keperluan unduh. */
type DeliverableRowData = ProjectDeliverableDTO & { fileData?: string | null };

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

function CalendarView({ projects, onOpenDetail, onRescheduleMilestone, onOpenReschedule, onRescheduleProject, onOpenRescheduleProject }: {
  projects: ProjectDTO[];
  onOpenDetail: (p: ProjectDTO) => void;
  /** Fase 3 — drag-reschedule: pindahkan deadline milestone ke tanggal lain. */
  onRescheduleMilestone?: (project: ProjectDTO, m: MilestoneDTO, newDate: Date) => void;
  /** Fase 3c — fallback touch/keyboard: buka dialog "Jadwalkan Ulang Milestone". */
  onOpenReschedule?: (project: ProjectDTO, m: MilestoneDTO) => void;
  /** Ronde 16 — drag-reschedule deadline project (chip "deadline"). */
  onRescheduleProject?: (p: ProjectDTO, newDate: Date) => void;
  /** Ronde 16 — dialog "Jadwalkan Ulang Deadline Project" (klik kanan / Shift+F10). */
  onOpenRescheduleProject?: (p: ProjectDTO) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  // State drag-reschedule (HTML5 drag events — ringan tanpa library).
  // Ronde 16: mendukung chip milestone DAN chip deadline project.
  const [dragging, setDragging] = useState<
    | { kind: "project"; projectId: string }
    | { kind: "milestone"; projectId: string; milestoneId: string }
    | null
  >(null);
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
                    if (!target || !cell.date) return;
                    const project = projects.find((p) => p.id === target.projectId);
                    if (!project) return;
                    if (target.kind === "project") {
                      onRescheduleProject?.(project, cell.date);
                      return;
                    }
                    if (!onRescheduleMilestone) return;
                    const ms = project.milestones?.find((m) => m.id === target.milestoneId);
                    if (ms) onRescheduleMilestone(project, ms, cell.date);
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
                            draggable={Boolean(onRescheduleProject)}
                            onDragStart={(e) => {
                              if (!onRescheduleProject) return;
                              e.dataTransfer.setData("text/plain", ev.project.id);
                              e.dataTransfer.effectAllowed = "move";
                              setDragging({ kind: "project", projectId: ev.project.id });
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setDropDayKey(null);
                            }}
                            onContextMenu={(e) => {
                              // Klik kanan & long-press mobile → dialog jadwalkan ulang deadline project
                              if (!onOpenRescheduleProject) return;
                              e.preventDefault();
                              onOpenRescheduleProject(ev.project);
                            }}
                            onKeyDown={(e) => {
                              // Shift+F10 / tombol ContextMenu → dialog jadwalkan ulang deadline project
                              if (!onOpenRescheduleProject) return;
                              if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
                                e.preventDefault();
                                e.stopPropagation();
                                onOpenRescheduleProject(ev.project);
                              }
                            }}
                            title={`${ev.project.code} · ${ev.project.name} · deadline · ${ev.project.progress}%${onRescheduleProject ? " · seret untuk menjadwalkan ulang deadline" : ""}${onOpenRescheduleProject ? " · klik kanan atau Shift+F10 untuk dialog jadwalkan ulang" : ""}`}
                            aria-label={`Buka detail project ${ev.project.name} (deadline)${onRescheduleProject ? ", seret untuk menjadwalkan ulang deadline" : ""}${onOpenRescheduleProject ? ", klik kanan atau Shift+F10 untuk jadwalkan ulang" : ""}`}
                            className={cn(
                              "group flex w-full select-none items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-white transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1",
                              onRescheduleProject && "cursor-grab active:cursor-grabbing",
                              dragging?.kind === "project" && dragging.projectId === ev.project.id && "opacity-40"
                            )}
                            style={{ backgroundColor: ev.project.brand?.color ?? "#3f3f46" }}
                          >
                            <span className="truncate">{ev.project.code} · deadline</span>
                            {onRescheduleProject ? (
                              <GripVertical className="ml-auto h-3 w-3 shrink-0 text-white/80 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
                            ) : null}
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
                              setDragging({ kind: "milestone", projectId: ev.project.id, milestoneId: ev.milestone.id });
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
                              "flex w-full select-none items-center gap-1 truncate rounded border border-zinc-200 bg-white px-1 py-0.5 text-left text-[10px] text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1",
                              ev.milestone.status !== "done" && onRescheduleMilestone && "cursor-grab active:cursor-grabbing hover:border-zinc-400",
                              dragging?.kind === "milestone" && dragging.milestoneId === ev.milestone.id && "opacity-40"
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
          {onOpenReschedule || onOpenRescheduleProject ? (
            <span className="flex items-center gap-1.5 text-zinc-400">
              <GripVertical className="h-3 w-3" aria-hidden />
              Seret atau klik-kanan milestone / deadline project untuk menjadwalkan ulang
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ============ Deliverable & Review (Task 22-4) ============

/** Satu baris deliverable: ikon jenis, meta, status, aksi review (manajemen/produksi) & hapus. */
function DeliverableRow({ d, user, milestoneName, onChanged }: {
  d: DeliverableRowData;
  user: { name: string; role: string } | null;
  /** Ronde 35 — nama milestone terkait (bila deliverable ditautkan). */
  milestoneName?: string | null;
  onChanged: () => Promise<void>;
}) {
  const meta = dlvMeta(d.status);
  const [review, setReview] = useState<null | "approved" | "revision">(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const canReview = user?.role === "super_admin" || user?.role === "director" || user?.role === "production";
  const canDelete = canReview || (!!user?.name && d.createdBy === user.name);
  const KindIcon = d.kind === "file" ? Paperclip : Link2;

  async function submitDecision() {
    if (!user || !review) return;
    setBusy(true);
    try {
      await api.decideDeliverable({
        id: d.id,
        decision: review,
        reviewComment: comment.trim() || undefined,
        reviewedBy: user.name,
        reviewedRole: user.role,
      });
      toast.success(review === "approved" ? `“${d.name}” disetujui` : `Revisi diminta untuk “${d.name}”`);
      setReview(null);
      setComment("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan keputusan review");
    } finally {
      setBusy(false);
    }
  }

  /** Hapus via fetch langsung: api.deleteDeliverable (kontrak api-client tidak boleh diubah)
   *  tidak mengirim identitas aktor, sedangkan aturan hapus butuh actorName/actorRole. */
  async function remove() {
    if (!user) return;
    if (!window.confirm(`Hapus deliverable “${d.name}”? Tindakan ini tidak dapat dibatalkan.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects/deliverables", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, actorName: user.name, actorRole: user.role }),
      });
      const json: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Gagal menghapus deliverable");
      toast.success("Deliverable dihapus");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus deliverable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100" aria-hidden>
            <KindIcon className="h-3.5 w-3.5 text-zinc-500" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{d.name}</p>
            {milestoneName ? (
              <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600" title={`Deliverable untuk milestone ${milestoneName}`}>
                <Route className="h-2.5 w-2.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="truncate">Milestone: {milestoneName}</span>
              </span>
            ) : null}
            <p className="truncate text-[11px] text-zinc-500">
              {d.kind === "file"
                ? [d.fileName, d.sizeBytes ? formatSizeKb(d.sizeBytes) : null].filter(Boolean).join(" · ")
                : d.url}
            </p>
            {d.note ? <p className="mt-1 text-xs text-zinc-500">{d.note}</p> : null}
            <p className="mt-1 text-[11px] text-zinc-400">
              Dikirim {timeAgo(d.createdAt)}{d.createdBy ? ` oleh ${d.createdBy}` : ""}
            </p>
            {d.status !== "pending" && d.reviewedBy ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                {d.reviewedRole === "client" ? (
                  <User className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <ShieldCheck className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
                )}
                <span>
                  Direview oleh {d.reviewedBy}{d.reviewedRole ? ` · ${reviewerRoleLabel(d.reviewedRole)}` : ""}
                  {d.reviewedAt ? ` · ${formatDateTime(d.reviewedAt)}` : ""}
                </span>
              </p>
            ) : null}
            {d.reviewComment ? (
              <p className="mt-0.5 text-[11px] italic text-zinc-500">Catatan review: “{d.reviewComment}”</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 ${meta.cls}`}>{meta.label}</Badge>
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-400 hover:text-rose-600"
              onClick={() => void remove()}
              disabled={busy}
              aria-label={`Hapus deliverable ${d.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {d.kind === "link" && d.url ? (
          <a
            href={d.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Buka tautan
          </a>
        ) : null}
        {d.kind === "file" && d.fileData ? (
          <a
            href={d.fileData}
            download={d.fileName ?? undefined}
            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> Unduh
          </a>
        ) : null}
        {canReview ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-emerald-200 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              disabled={busy}
              onClick={() => { setReview("approved"); setComment(d.reviewComment ?? ""); }}
              aria-label={`Setujui deliverable ${d.name}`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden /> Setujui
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-amber-200 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"
              disabled={busy}
              onClick={() => { setReview("revision"); setComment(d.reviewComment ?? ""); }}
              aria-label={`Minta revisi deliverable ${d.name}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Minta Revisi
            </Button>
          </>
        ) : null}
      </div>

      {review !== null ? (
        <div className="mt-2.5 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={review === "approved" ? "Catatan persetujuan (opsional)…" : "Jelaskan bagian yang perlu direvisi…"}
            aria-label="Catatan review deliverable"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { setReview(null); setComment(""); }}
              aria-label="Batal review deliverable"
            >
              Batal
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void submitDecision()}
              className={review === "approved" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-amber-600 text-white hover:bg-amber-700"}
              aria-label="Konfirmasi keputusan review"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {review === "approved" ? "Konfirmasi Setujui" : "Kirim Permintaan Revisi"}
            </Button>
          </div>
        </div>
      ) : null}
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

// Fase 3c / Ronde 16 — target dialog jadwalkan ulang: milestone ATAU deadline project
type RescheduleTarget =
  | { kind: "project"; project: ProjectDTO }
  | { kind: "milestone"; project: ProjectDTO; milestone: MilestoneDTO };

export default function ProjectsModule() {
  const storeBrands = useCrmStore((s) => s.brands);
  const user = useCrmStore((s) => s.user);
  const pendingFocus = useCrmStore((s) => s.pendingFocus);
  const clearPendingFocus = useCrmStore((s) => s.clearPendingFocus);

  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [view, setView] = useState<"cards" | "timeline" | "calendar">("cards");

  const [detail, setDetail] = useState<ProjectDTO | null>(null);
  const [editStatus, setEditStatus] = useState("planning");
  const [editProgress, setEditProgress] = useState("0");
  // Ronde 38 — detail kini juga bisa mengedit PM, deadline & budget internal
  // (API PATCH sudah mendukung ketiganya sejak r26, UI-nya yang belum ada).
  const [editPm, setEditPm] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editBudget, setEditBudget] = useState("");
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

  // Fase 3c — dialog "Jadwalkan Ulang" (fallback klik kanan / long-press / keyboard).
  // Ronde 16: juga untuk deadline project (varian tanpa status).
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleStatus, setRescheduleStatus] = useState("pending");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  // Task 22-4 — Deliverable & Review pada sheet detail
  const [deliverables, setDeliverables] = useState<ProjectDeliverableDTO[] | null>(null);
  // Ronde 34 — invoice project utk record tahap Penagihan di Alur Produksi
  const [detailInvoices, setDetailInvoices] = useState<InvoiceDTO[] | null>(null);
  const [dfOpen, setDfOpen] = useState(false);
  const [dfName, setDfName] = useState("");
  const [dfKind, setDfKind] = useState<"link" | "file">("link");
  const [dfUrl, setDfUrl] = useState("");
  const [dfFileName, setDfFileName] = useState("");
  const [dfFileData, setDfFileData] = useState("");
  const [dfMimeType, setDfMimeType] = useState("");
  const [dfSizeBytes, setDfSizeBytes] = useState<number | null>(null);
  const [dfNote, setDfNote] = useState("");
  const [dfSaving, setDfSaving] = useState(false);
  // Ronde 35 — deliverable opsional terkait milestone (timeline produksi)
  const [dfMilestoneId, setDfMilestoneId] = useState("");

  // Ronde 35 — tambah/edit milestone (nama + capaian + due date)
  const [msOpen, setMsOpen] = useState(false);
  const [msEditing, setMsEditing] = useState<MilestoneDTO | null>(null);
  const [msName, setMsName] = useState("");
  const [msAchievement, setMsAchievement] = useState("");
  const [msDueDate, setMsDueDate] = useState("");
  const [msSaving, setMsSaving] = useState(false);

  // Ronde 35 — tagih milestone (invoice termin): alur Produksi → Keuangan
  const [invTarget, setInvTarget] = useState<{ project: ProjectDTO; milestone: MilestoneDTO } | null>(null);
  const [invDesc, setInvDesc] = useState("");
  const [invAmount, setInvAmount] = useState("");
  const [invSaving, setInvSaving] = useState(false);

  // Task 22-4 — dialog Proyek Baru (pembuatan manual, tanpa opportunity Won)
  const [npOpen, setNpOpen] = useState(false);
  const [npName, setNpName] = useState("");
  const [npBrandId, setNpBrandId] = useState("");
  const [npCompanyId, setNpCompanyId] = useState("");
  const [npServiceCategory, setNpServiceCategory] = useState("none");
  const [npStatus, setNpStatus] = useState("planning");
  const [npPmName, setNpPmName] = useState("");
  const [npStartDate, setNpStartDate] = useState("");
  const [npDueDate, setNpDueDate] = useState("");
  const [npBudget, setNpBudget] = useState("");
  const [npContract, setNpContract] = useState("");
  const [npCompanies, setNpCompanies] = useState<CompanyRef[] | null>(null);
  const [npBrandOptions, setNpBrandOptions] = useState<Brand[]>([]);
  const [npSaving, setNpSaving] = useState(false);

  const canDecideCr = user?.role === "director" || user?.role === "super_admin";
  // Ronde 35 — hanya finance/direktur yang bisa menerbitkan invoice milestone
  const canInvoice = user?.role === "finance" || user?.role === "director" || user?.role === "super_admin";
  const detailCrs = detail?.changeRequests ?? [];
  const approvedCrSum = detailCrs
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + (c.additionalCost ?? 0), 0);

  // Task 22-4 — ringkasan deliverable untuk chips header section
  const dlvCounts = useMemo(() => {
    const list = deliverables ?? [];
    return {
      total: list.length,
      pending: list.filter((d) => d.status === "pending").length,
      approved: list.filter((d) => d.status === "approved").length,
      revision: list.filter((d) => d.status === "revision").length,
    };
  }, [deliverables]);

  // Opsi brand untuk dialog Proyek Baru: store biasanya sudah terisi, fallback fetch saat dialog dibuka.
  const npBrands = storeBrands.length > 0 ? storeBrands : npBrandOptions;
  const detailId = detail?.id ?? null;

  // Item aktif pada dialog jadwalkan ulang (lookup terkini dari state agar guard same-day akurat).
  // Untuk kind "project" item-nya adalah project itu sendiri; untuk milestone tetap milestone-nya.
  const rescheduleCurrent = (() => {
    if (!rescheduleTarget) return null;
    const fresh = (projects ?? []).find((p) => p.id === rescheduleTarget.project.id) ?? rescheduleTarget.project;
    return rescheduleTarget.kind === "project"
      ? fresh
      : fresh.milestones?.find((x) => x.id === rescheduleTarget.milestone.id) ?? rescheduleTarget.milestone;
  })();
  // Guard "same-day no-change": Simpan disabled bila tanggal sama DAN (utk milestone) status tidak berubah.
  // Catatan: ProjectDTO JUGA punya field status (planning/in_progress/…) — jadi varian project TIDAK boleh
  // membandingkan rescheduleStatus; hanya varian milestone yang memakai status chip.
  const rescheduleDirty = (() => {
    if (!rescheduleTarget || !rescheduleCurrent) return false;
    const curDue = rescheduleCurrent.dueDate ? new Date(rescheduleCurrent.dueDate) : null;
    const dateDirty = rescheduleDate !== toDateInputValue(curDue);
    if (rescheduleTarget.kind !== "milestone") return dateDirty;
    const ms = rescheduleCurrent as MilestoneDTO; // kind milestone → rescheduleCurrent pasti milestone
    return dateDirty || rescheduleStatus !== ms.status;
  })();

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

  // Task 22-4 — lazy-fetch deliverable saat sheet detail dibuka (per project id)
  useEffect(() => {
    if (!detailId) {
      setDeliverables(null);
      return;
    }
    let cancelled = false;
    api.projectDeliverables(detailId)
      .then((res) => { if (!cancelled) setDeliverables(res.deliverables); })
      .catch(() => {
        if (!cancelled) {
          setDeliverables([]);
          toast.error("Gagal memuat deliverable");
        }
      });
    // Ronde 34 — invoice project (untuk record "Penagihan" di Alur Produksi):
    // API invoice tak punya filter projectId — ambil per perusahaan lalu filter klien.
    const proj = (projects ?? []).find((p) => p.id === detailId);
    if (proj?.companyId) {
      api.invoices({ companyId: proj.companyId })
        .then((res) => { if (!cancelled) setDetailInvoices(res.invoices.filter((i) => i.projectId === detailId)); })
        .catch(() => { if (!cancelled) setDetailInvoices([]); });
    } else if (!cancelled) {
      setDetailInvoices([]);
    }
    return () => { cancelled = true; };
  }, [detailId, projects]);

  /** Muat ulang deliverable project yang sedang dibuka di sheet detail. */
  const reloadDeliverables = useCallback(async () => {
    if (!detailId) return;
    try {
      const res = await api.projectDeliverables(detailId);
      setDeliverables(res.deliverables);
    } catch {
      toast.error("Gagal memuat deliverable");
    }
  }, [detailId]);

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
    setEditPm(p.pmName ?? "");
    setEditDue(p.dueDate ? toDateInputValue(new Date(p.dueDate)) : "");
    setEditBudget(p.budgetInternal != null ? String(p.budgetInternal) : "");
    setDfOpen(false);
    resetDf();
  }

  // Global search (ronde 26) — buka sheet detail project hasil pencarian (⌘K).
  // Bila daftar belum termuat (null), pendingFocus dipertahankan — effect berjalan lagi
  // saat data tiba; sudah termuat tapi id tak ketemu → cukup pindah modul (clear).
  // Ronde 38 — bila id TIDAK ketemu karena filter aktif (status/brand), reset filter
  // ke "all" dan tunggu reload — dulu fokus diam-diam dibuang dan detail tak terbuka.
  useEffect(() => {
    if (!pendingFocus || pendingFocus.module !== "projects") return;
    if (!projects) return; // menunggu load pertama selesai
    const target = projects.find((p) => p.id === pendingFocus.id);
    if (target) {
      openDetail(target);
      clearPendingFocus();
      return;
    }
    if (statusFilter !== "all" || brandFilter !== "all") {
      setStatusFilter("all");
      setBrandFilter("all");
      return; // load() berjalan via effect filter — effect ini berjalan lagi setelah data tiba
    }
    clearPendingFocus();
  }, [pendingFocus, projects, clearPendingFocus, statusFilter, brandFilter]);

  function resetDf() {
    setDfName("");
    setDfKind("link");
    setDfUrl("");
    setDfFileName("");
    setDfFileData("");
    setDfMimeType("");
    setDfSizeBytes(null);
    setDfNote("");
    setDfMilestoneId("");
  }

  /** Ronde 35 — buka form deliverable dari milestone tertentu (pra-pilih milestone). */
  function openDfForMilestone(m: MilestoneDTO) {
    resetDf();
    setDfMilestoneId(m.id);
    setDfOpen(true);
  }

  /** Ronde 35 — dialog tambah (m=null) / edit (m!=null) milestone. */
  function openMilestoneDialog(m?: MilestoneDTO) {
    setMsEditing(m ?? null);
    setMsName(m?.name ?? "");
    setMsAchievement(m?.achievement ?? "");
    setMsDueDate(m?.dueDate ? toDateInputValue(new Date(m.dueDate)) : "");
    setMsOpen(true);
  }

  async function submitMilestoneDialog() {
    if (!detail || !user) return;
    const name = msName.trim();
    if (!name) { toast.error("Nama milestone wajib diisi"); return; }
    setMsSaving(true);
    try {
      if (msEditing) {
        await api.updateMilestone({
          milestoneId: msEditing.id,
          name,
          achievement: msAchievement.trim() || null,
          dueDate: msDueDate || null,
          actorName: user.name,
          actorRole: user.role,
        });
        toast.success("Milestone diperbarui", { description: `${name} — capaian tersimpan` });
      } else {
        await api.createMilestone({
          projectId: detail.id,
          name,
          achievement: msAchievement.trim() || undefined,
          dueDate: msDueDate || null,
          actorName: user.name,
          actorRole: user.role,
        });
        toast.success("Milestone ditambahkan", { description: `${name} masuk timeline produksi` });
      }
      setMsOpen(false);
      await refreshDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan milestone");
    } finally {
      setMsSaving(false);
    }
  }

  /** Ronde 35 — buka dialog tagih milestone: nominal default = kontrak dibagi rata milestone. */
  function openInvoiceForMilestone(project: ProjectDTO, m: MilestoneDTO) {
    const total = project.milestones?.length ?? 0;
    const suggested = total > 0 ? Math.round((project.contractValue ?? 0) / total) : (project.contractValue ?? 0);
    setInvTarget({ project, milestone: m });
    setInvDesc(`Milestone ${m.name} — ${project.name}`);
    setInvAmount(suggested > 0 ? String(suggested) : "");
  }

  async function submitMilestoneInvoice() {
    if (!invTarget || !user) return;
    const amount = Number(invAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal invoice harus angka lebih besar dari 0");
      return;
    }
    setInvSaving(true);
    try {
      const res = await api.createProjectInvoice({
        projectId: invTarget.project.id,
        description: invDesc.trim() || `Milestone ${invTarget.milestone.name} — ${invTarget.project.name}`,
        amount,
        milestoneName: invTarget.milestone.name,
        actorName: user.name,
        actorRole: user.role,
      });
      toast.success(`Invoice ${res.invoice.number} dibuat (draft)`, {
        description: "Dikirim dari modul Finance setelah diperiksa.",
      });
      setInvTarget(null);
      // refresh invoice project utk record tahap Penagihan
      const proj = invTarget.project;
      api.invoices({ companyId: proj.companyId })
        .then((r) => setDetailInvoices(r.invoices.filter((i) => i.projectId === proj.id)))
        .catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat invoice");
    } finally {
      setInvSaving(false);
    }
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

  // Ronde 36 (audit FIX): guard msBusyId — aksi toast "Ya, selesaikan" yang diklik
  // berkali-kali tidak lagi mengirim banyak PATCH berturut-turut.
  const [msBusyId, setMsBusyId] = useState<string | null>(null);

  async function markMilestoneDone(project: ProjectDTO, m: MilestoneDTO) {
    if (msBusyId) return;
    setMsBusyId(m.id);
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
    } finally {
      setMsBusyId(null);
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

  /** Ronde 16 — sinkronkan perubahan dueDate project ke daftar + sheet detail (dipakai drag & dialog). */
  function patchProjectDueDateState(projectId: string, dueDate: string | null) {
    setProjects((prev) => (prev ?? []).map((p) => (p.id === projectId ? { ...p, dueDate } : p)));
    setDetail((d) => (d && d.id === projectId ? { ...d, dueDate } : d));
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

  /** Ronde 16 — drag-reschedule deadline project di kalender: update optimis + revert bila gagal. */
  async function handleRescheduleProject(p: ProjectDTO, newDate: Date) {
    const oldDue = p.dueDate ? new Date(p.dueDate) : null;
    if (oldDue && isSameLocalDay(oldDue, newDate)) return; // guard: drop di sel tanggal yang sama = no-op

    patchProjectDueDateState(p.id, newDate.toISOString()); // optimis
    try {
      await api.updateProject({
        id: p.id,
        dueDate: newDate.toISOString(),
        actorName: user?.name ?? "Produksi",
        actorRole: user?.role ?? "production",
      });
      toast.success(`Deadline ${p.code}: ${oldDue ? formatDate(oldDue) : "tanpa tanggal"} → ${formatDate(newDate)}`, {
        description: p.name,
      });
    } catch (err) {
      patchProjectDueDateState(p.id, oldDue ? oldDue.toISOString() : null); // revert
      toast.error(err instanceof Error ? err.message : "Gagal menjadwalkan ulang deadline project");
    }
  }

  /** Fase 3c — buka dialog jadwalkan ulang dari chip kalender (klik kanan / Shift+F10 / long-press). */
  function openRescheduleDialog(project: ProjectDTO, m: MilestoneDTO) {
    setRescheduleTarget({ kind: "milestone", project, milestone: m });
    setRescheduleDate(toDateInputValue(m.dueDate ? new Date(m.dueDate) : null));
    setRescheduleStatus(m.status);
  }

  /** Ronde 16 — buka dialog jadwalkan ulang deadline project dari chip kalender (klik kanan / Shift+F10). */
  function openRescheduleProjectDialog(p: ProjectDTO) {
    setRescheduleTarget({ kind: "project", project: p });
    setRescheduleDate(toDateInputValue(p.dueDate ? new Date(p.dueDate) : null));
  }

  function bumpRescheduleDate(days: number) {
    const targetDue = rescheduleTarget
      ? rescheduleTarget.kind === "project"
        ? rescheduleTarget.project.dueDate
        : rescheduleTarget.milestone.dueDate
      : null;
    const base = parseDateInputValue(rescheduleDate) ?? (targetDue ? new Date(targetDue) : new Date());
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, 12);
    setRescheduleDate(toDateInputValue(next));
  }

  /** Fase 3c / Ronde 16 — simpan dialog: ubah dueDate project ATAU dueDate+status milestone (optimis + revert bila gagal). */
  async function handleSaveRescheduleDialog() {
    if (!rescheduleTarget || !user) return;
    // Ambil data terkini dari state (snapshot dialog bisa basi setelah update optimis sebelumnya)
    const project = (projects ?? []).find((p) => p.id === rescheduleTarget.project.id) ?? rescheduleTarget.project;
    const newDate = parseDateInputValue(rescheduleDate);
    if (!newDate) {
      toast.error("Pilih tanggal deadline yang valid");
      return;
    }

    // --- Ronde 16: varian deadline project (tanpa status) ---
    if (rescheduleTarget.kind === "project") {
      const oldDue = project.dueDate ? new Date(project.dueDate) : null;
      if (oldDue && isSameLocalDay(oldDue, newDate)) return; // guard: tidak ada perubahan

      setRescheduleSaving(true);
      patchProjectDueDateState(project.id, newDate.toISOString()); // optimis
      try {
        await api.updateProject({
          id: project.id,
          dueDate: newDate.toISOString(),
          actorName: user.name,
          actorRole: user.role,
        });
        toast.success(`Deadline ${project.code}: ${oldDue ? formatDate(oldDue) : "tanpa tanggal"} → ${formatDate(newDate)}`, {
          description: project.name,
        });
        setRescheduleTarget(null); // tutup pada sukses
      } catch (err) {
        patchProjectDueDateState(project.id, oldDue ? oldDue.toISOString() : null); // revert
        toast.error(err instanceof Error ? err.message : "Gagal menjadwalkan ulang deadline project");
      } finally {
        setRescheduleSaving(false);
      }
      return;
    }

    // --- Fase 3c: varian milestone (dueDate + status) ---
    const m = project.milestones?.find((x) => x.id === rescheduleTarget.milestone.id) ?? rescheduleTarget.milestone;
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
    // Ronde 38 — validasi budget internal (boleh kosong → 0).
    const budgetNum = Number(editBudget);
    if (editBudget.trim() !== "" && !Number.isFinite(budgetNum)) {
      toast.error("Budget internal harus angka");
      return;
    }
    setSavingDetail(true);
    try {
      const res = await api.updateProject({
        id: detail.id,
        status: editStatus,
        progress,
        pmName: editPm.trim() || null,
        budgetInternal: editBudget.trim() === "" ? 0 : Math.round(budgetNum),
        dueDate: editDue ? editDue : null,
      });
      setProjects((prev) => (prev ?? []).map((p) => (p.id === res.project.id ? { ...p, ...res.project } : p)));
      setDetail((d) => (d ? { ...d, ...res.project, status: editStatus, progress } : d));
      toast.success(`Project ${res.project.code} diperbarui`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan project");
    } finally {
      setSavingDetail(false);
    }
  }

  /** Task 22-4 — baca file terpilih sebagai data URL (FileReader), tolak > 1.2MB di sisi klien. */
  function handleDfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_DELIVERABLE_BYTES) {
      toast.error("Ukuran file maksimal 1.2MB — gunakan tautan (Drive/Dropbox) untuk file besar");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDfFileData(String(reader.result ?? ""));
      setDfFileName(f.name);
      setDfMimeType(f.type || "application/octet-stream");
      setDfSizeBytes(f.size);
    };
    reader.onerror = () => toast.error("Gagal membaca file");
    reader.readAsDataURL(f);
  }

  /** Task 22-4 — kirim deliverable (tautan/file) untuk ditinjau. */
  async function submitDeliverable() {
    if (!detail || !user) {
      toast.error("Sesi tidak ditemukan — muat ulang halaman");
      return;
    }
    const name = dfName.trim();
    if (!name) {
      toast.error("Nama deliverable wajib diisi");
      return;
    }
    if (dfKind === "link") {
      if (!/^https?:\/\//i.test(dfUrl.trim())) {
        toast.error("URL tautan wajib diawali http(s)://");
        return;
      }
    } else if (!dfFileName || !dfFileData) {
      toast.error("Pilih file yang akan dikirim");
      return;
    }
    setDfSaving(true);
    try {
      await api.createDeliverable(detail.id, {
        name,
        kind: dfKind,
        ...(dfKind === "link"
          ? { url: dfUrl.trim() }
          : { fileName: dfFileName, fileData: dfFileData, mimeType: dfMimeType, sizeBytes: dfSizeBytes ?? undefined }),
        note: dfNote.trim() || undefined,
        // Ronde 35 — tautkan ke milestone bila dipilih (opsional)
        ...(dfMilestoneId ? { milestoneId: dfMilestoneId } : {}),
        createdBy: user.name,
      });
      toast.success("Deliverable terkirim — menunggu review klien/manajemen");
      setDfOpen(false);
      resetDf();
      await reloadDeliverables();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim deliverable");
    } finally {
      setDfSaving(false);
    }
  }

  /** Task 22-4 — buka dialog Proyek Baru; opsi perusahaan di-fetch lazy sekali, brand dari store (fallback fetch). */
  async function openNewProject() {
    setNpName("");
    setNpBrandId("");
    setNpCompanyId("");
    setNpServiceCategory("none");
    setNpStatus("planning");
    setNpPmName("");
    setNpStartDate("");
    setNpDueDate("");
    setNpBudget("");
    setNpContract("");
    setNpOpen(true);
    if (storeBrands.length === 0 || npCompanies === null) {
      try {
        const [brandRes, companyRes] = await Promise.all([
          storeBrands.length === 0 ? api.brands() : Promise.resolve(null),
          npCompanies === null ? api.companies() : Promise.resolve(null),
        ]);
        if (brandRes) setNpBrandOptions(brandRes.brands);
        if (companyRes) setNpCompanies(companyRes.companies);
      } catch {
        toast.error("Gagal memuat data brand/perusahaan");
      }
    }
  }

  /** Task 22-4 — simpan project baru (manual create, tanpa milestone/invoice otomatis). */
  async function submitNewProject(e: React.FormEvent) {
    e?.preventDefault();
    if (!user) {
      toast.error("Sesi tidak ditemukan — muat ulang halaman");
      return;
    }
    const name = npName.trim();
    if (!name) { toast.error("Nama project wajib diisi"); return; }
    if (!npBrandId) { toast.error("Pilih brand untuk project ini"); return; }
    if (!npCompanyId) { toast.error("Pilih perusahaan klien"); return; }
    setNpSaving(true);
    try {
      const res = await api.createProject({
        name,
        brandId: npBrandId,
        companyId: npCompanyId,
        serviceCategory: npServiceCategory === "none" ? undefined : npServiceCategory,
        status: npStatus,
        pmName: npPmName.trim() || undefined,
        startDate: npStartDate || undefined,
        dueDate: npDueDate || undefined,
        budgetInternal: Number(npBudget) || 0,
        contractValue: Number(npContract) || 0,
        actorName: user.name,
        actorRole: user.role,
      });
      // Ronde 38 — API kini mengembalikan project lengkap (brand/company/milestone/
      // changeRequests) + milestone otomatis dari template workflow layanan;
      // detail langsung dibuka agar alur "buat → isi detail" tersambung.
      const created = res.project as ProjectDTO;
      toast.success("Proyek dibuat", {
        description: `${created.code} — ${created.milestones?.length ? `${created.milestones.length} milestone dari template workflow` : "tambahkan milestone & detail produksi di panel ini"}`,
      });
      setNpOpen(false);
      setProjects((prev) => (prev ? [created, ...prev] : [created]));
      openDetail(created);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat project");
    } finally {
      setNpSaving(false);
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void openNewProject()}
            disabled={npSaving}
            aria-label="Buat proyek baru secara manual"
          >
            {npSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Proyek Baru
          </Button>
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
        <CalendarView projects={projects ?? []} onOpenDetail={openDetail} onRescheduleMilestone={handleRescheduleMilestone} onOpenReschedule={openRescheduleDialog} onRescheduleProject={handleRescheduleProject} onOpenRescheduleProject={openRescheduleProjectDialog} />
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

                {/* Ronde 34 — peta alur produksi + record nyata per tahap */}
                <ProductionFlow
                  project={detail}
                  deliverables={deliverables}
                  crs={detailCrs}
                  invoices={detailInvoices}
                />

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

                {/* Ronde 35 — Timeline Milestone: urutan tahap, capaian per tahap,
                    deliverable terkait, dan aksi (selesaikan / kirim deliverable / tagih). */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Timeline Milestone ({(detail.milestones ?? []).filter((m) => m.status === "done").length}/{(detail.milestones ?? []).length} selesai)
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openMilestoneDialog()}
                      aria-label="Tambah milestone baru"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah Milestone
                    </Button>
                  </div>
                  {(detail.milestones ?? []).length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-zinc-400">
                      Belum ada milestone — tambahkan rencana kerja per tahap.
                    </div>
                  ) : (
                    <ol className="crm-scroll max-h-[26rem] overflow-y-auto pr-1" aria-label="Timeline milestone project">
                      {(detail.milestones ?? []).map((m, idx) => {
                        const meta = msMeta(m.status);
                        const Icon = meta.icon;
                        const isDone = m.status === "done";
                        const isCurrent = m.status === "in_progress";
                        const isLast = idx === (detail.milestones ?? []).length - 1;
                        const msDlv = (deliverables ?? []).filter((d) => d.milestoneId === m.id);
                        const overdue = !isDone && m.dueDate ? new Date(m.dueDate).getTime() < Date.now() : false;
                        return (
                          <li key={m.id} className="relative flex gap-3 pb-4 last:pb-0">
                            {/* Rail + dot */}
                            <div className="flex flex-col items-center" aria-hidden="true">
                              <span
                                className={cn(
                                  "flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-white",
                                  isDone ? "border-emerald-500 bg-emerald-500 text-white"
                                    : isCurrent ? "border-amber-500 text-amber-600"
                                    : "border-zinc-200 text-zinc-400",
                                )}
                              >
                                {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3 w-3" />}
                              </span>
                              {!isLast ? (
                                <span className={cn("mt-1 w-px flex-1", isDone ? "bg-emerald-300" : "bg-zinc-200")} />
                              ) : null}
                            </div>

                            {/* Kartu tahap */}
                            <div
                              className={cn(
                                "min-w-0 flex-1 rounded-lg border bg-white p-3",
                                isCurrent ? "border-amber-200 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]" : "",
                              )}
                              aria-current={isCurrent ? "step" : undefined}
                            >
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-mono text-[10px] text-zinc-400">#{m.order + 1}</span>
                                <p className={cn("min-w-0 flex-1 truncate text-sm font-medium", isDone ? "text-emerald-700" : "text-zinc-800")}>
                                  {m.name}
                                </p>
                                {overdue ? (
                                  <Badge variant="outline" className="border-transparent bg-rose-100 px-1.5 text-[10px] text-rose-700">
                                    Lewat due
                                  </Badge>
                                ) : null}
                                <span className={cn("text-[11px]", overdue ? "font-medium text-rose-600" : "text-zinc-400")}>
                                  {m.dueDate ? `due ${formatDate(m.dueDate)}` : "tanpa due date"}
                                </span>
                              </div>

                              {/* Capaian — apa yang dicapai/diserahkan di tahap ini */}
                              {m.achievement ? (
                                <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-zinc-500">
                                  <FileCheck className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
                                  <span>{m.achievement}</span>
                                </p>
                              ) : null}

                              {/* Deliverable terkait milestone ini (opsional) */}
                              {msDlv.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Deliverable untuk ${m.name}`}>
                                  {msDlv.map((d) => (
                                    <span
                                      key={d.id}
                                      className={cn(
                                        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                                        d.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                          : d.status === "revision" ? "border-rose-200 bg-rose-50 text-rose-700"
                                          : "border-amber-200 bg-amber-50 text-amber-700",
                                      )}
                                      title={d.status === "approved" ? "Disetujui" : d.status === "revision" ? "Diminta revisi" : "Menunggu review"}
                                    >
                                      {d.kind === "link" ? <Link2 className="h-3 w-3 shrink-0" aria-hidden /> : <Paperclip className="h-3 w-3 shrink-0" aria-hidden />}
                                      <span className="truncate">{d.name}</span>
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              {/* Aksi per tahap */}
                              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                {!isDone ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 border-emerald-200 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => confirmMilestone(detail, m)}
                                    aria-label={`Tandai milestone ${m.name} selesai`}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Selesaikan
                                  </Button>
                                ) : (
                                  <Badge variant="outline" className="border-transparent bg-emerald-100 text-[11px] text-emerald-700">Selesai</Badge>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => openDfForMilestone(m)}
                                  aria-label={`Kirim deliverable untuk milestone ${m.name}`}
                                >
                                  <Paperclip className="h-3.5 w-3.5" aria-hidden /> Kirim Deliverable
                                </Button>
                                {canInvoice ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => openInvoiceForMilestone(detail, m)}
                                    aria-label={`Tagih milestone ${m.name}`}
                                  >
                                    <ReceiptText className="h-3.5 w-3.5" aria-hidden /> Tagih
                                  </Button>
                                ) : null}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-zinc-500"
                                  onClick={() => openMilestoneDialog(m)}
                                  aria-label={`Edit milestone ${m.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                                </Button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
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

                {/* Deliverable & Review (Task 22-4) — kirim file/tautan → review klien/manajemen */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        <FileCheck className="h-3.5 w-3.5" aria-hidden />
                        Deliverable &amp; Review
                      </p>
                      {/* Task 25-b — ringkasan produksi, dihitung dari list deliverable */}
                      {deliverables !== null && deliverables.length > 0 ? (
                        <span
                          className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600"
                          aria-label="Ringkasan status deliverable"
                        >
                          {dlvCounts.pending} pending · {dlvCounts.approved} disetujui · {dlvCounts.revision} revisi
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { if (!dfOpen) resetDf(); setDfOpen((v) => !v); }}
                      aria-expanded={dfOpen}
                      aria-label="Kirim file atau tautan untuk ditinjau"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Kirim File / Tautan
                    </Button>
                  </div>

                  {dfOpen ? (
                    <div className="mb-2 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      {/* Task 25-b — penjelasan alur review via secure link */}
                      <p className="text-[11px] text-zinc-500">
                        Deliverable akan muncul di secure link klien untuk disetujui / diminta revisi.
                      </p>
                      <div className="grid gap-1.5">
                        <Label htmlFor="dlv-name">Nama deliverable *</Label>
                        <Input
                          id="dlv-name"
                          value={dfName}
                          onChange={(e) => setDfName(e.target.value)}
                          placeholder="Contoh: Draft desain halaman utama"
                          aria-label="Nama deliverable"
                        />
                      </div>
                      {/* Ronde 35 — kaitkan deliverable ke milestone (opsional) */}
                      {(detail.milestones ?? []).length > 0 ? (
                        <div className="grid gap-1.5">
                          <Label htmlFor="dlv-milestone">Milestone terkait (opsional)</Label>
                          <Select value={dfMilestoneId || "none"} onValueChange={(v) => setDfMilestoneId(v === "none" ? "" : v)}>
                            <SelectTrigger id="dlv-milestone" className="w-full bg-white" aria-label="Milestone terkait deliverable">
                              <SelectValue placeholder="Pilih milestone" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Tanpa milestone</SelectItem>
                              {(detail.milestones ?? []).map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  #{m.order + 1} · {m.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-zinc-400">Deliverable muncul di timeline milestone terkait.</p>
                        </div>
                      ) : null}
                      <div className="grid gap-1.5">
                        <Label>Jenis</Label>
                        <div className="flex w-fit items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5" role="group" aria-label="Jenis deliverable">
                          <button
                            type="button"
                            onClick={() => setDfKind("link")}
                            aria-pressed={dfKind === "link"}
                            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${dfKind === "link" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden /> Tautan
                          </button>
                          <button
                            type="button"
                            onClick={() => setDfKind("file")}
                            aria-pressed={dfKind === "file"}
                            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${dfKind === "file" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
                          >
                            <Paperclip className="h-3.5 w-3.5" aria-hidden /> File
                          </button>
                        </div>
                      </div>
                      {dfKind === "link" ? (
                        <div className="grid gap-1.5">
                          <Label htmlFor="dlv-url">URL tautan *</Label>
                          <Input
                            id="dlv-url"
                            type="url"
                            value={dfUrl}
                            onChange={(e) => setDfUrl(e.target.value)}
                            placeholder="https://drive.google.com/…"
                            aria-label="URL tautan deliverable"
                          />
                          <p className="text-[11px] text-zinc-400">Wajib diawali http:// atau https:// — mis. Google Drive, Figma, YouTube.</p>
                        </div>
                      ) : (
                        <div className="grid gap-1.5">
                          <Label htmlFor="dlv-file">File (maks 1.2MB) *</Label>
                          <input
                            id="dlv-file"
                            type="file"
                            onChange={handleDfFile}
                            className="block w-full cursor-pointer rounded-md border border-zinc-200 bg-white text-xs text-zinc-500 file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-zinc-700"
                            aria-label="Pilih file untuk dikirim"
                          />
                          {dfFileName ? (
                            <p className="text-[11px] text-zinc-500">
                              {dfFileName}{dfSizeBytes ? ` · ${formatSizeKb(dfSizeBytes)}` : ""} — siap dikirim
                            </p>
                          ) : null}
                        </div>
                      )}
                      <div className="grid gap-1.5">
                        <Label htmlFor="dlv-note">Catatan (opsional)</Label>
                        <Textarea
                          id="dlv-note"
                          rows={2}
                          value={dfNote}
                          onChange={(e) => setDfNote(e.target.value)}
                          placeholder="Konteks untuk reviewer…"
                          aria-label="Catatan deliverable"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setDfOpen(false)} disabled={dfSaving} aria-label="Batal kirim deliverable">
                          Batal
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void submitDeliverable()}
                          disabled={dfSaving || !dfName.trim()}
                          aria-label="Kirim deliverable untuk ditinjau"
                        >
                          {dfSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                          {dfSaving ? "Mengirim…" : "Kirim untuk Ditinjau"}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {deliverables === null ? (
                    <div className="space-y-2" aria-hidden>
                      <Skeleton className="h-16 rounded-lg" />
                      <Skeleton className="h-16 rounded-lg" />
                    </div>
                  ) : deliverables.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-zinc-400">
                      Belum ada deliverable. Kirim tautan atau file untuk ditinjau klien/manajemen.
                    </div>
                  ) : (
                    <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll">
                      {deliverables.map((d) => (
                        <DeliverableRow
                          key={d.id}
                          d={d}
                          user={user}
                          milestoneName={d.milestoneId ? (detail.milestones ?? []).find((m) => m.id === d.milestoneId)?.name ?? null : null}
                          onChanged={reloadDeliverables}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Update status, progress & detail produksi */}
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
                    {/* Ronde 38 — edit PM, deadline & budget internal langsung dari detail */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="proj-pm">Project Manager</Label>
                      <Input
                        id="proj-pm" value={editPm} placeholder="Nama PM"
                        onChange={(e) => setEditPm(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="proj-due">Deadline</Label>
                      <Input
                        id="proj-due" type="date" value={editDue}
                        onChange={(e) => setEditDue(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="proj-budget">Budget Internal (Rp)</Label>
                      <Input
                        id="proj-budget" type="number" min={0} step={100000} value={editBudget}
                        placeholder="Misal 27500000"
                        onChange={(e) => setEditBudget(e.target.value)}
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

      {/* Fase 3c / Ronde 16 — dialog "Jadwalkan Ulang" (fallback klik kanan / long-press / Shift+F10).
           Varian milestone: tanggal + status. Varian deadline project: tanggal saja. */}
      <Dialog
        open={rescheduleTarget !== null}
        onOpenChange={(open) => { if (!open && !rescheduleSaving) setRescheduleTarget(null); }}
      >
        <DialogContent
          className="rounded-xl sm:max-w-sm"
          aria-label={rescheduleTarget?.kind === "project" ? "Jadwalkan ulang deadline project" : "Jadwalkan ulang milestone"}
        >
          <DialogHeader>
            <DialogTitle>
              {rescheduleTarget?.kind === "project" ? "Jadwalkan Ulang Deadline Project" : "Jadwalkan Ulang Milestone"}
            </DialogTitle>
            <DialogDescription>
              {rescheduleTarget
                ? rescheduleTarget.kind === "project"
                  ? `${rescheduleTarget.project.code} · ${rescheduleTarget.project.name}`
                  : `${rescheduleTarget.project.code} · ${rescheduleTarget.project.name} — ${rescheduleTarget.milestone.name}`
                : "Pilih tanggal deadline baru."}
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
                  aria-label={rescheduleTarget?.kind === "project" ? "Tanggal deadline baru project" : "Tanggal deadline baru milestone"}
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
              {rescheduleTarget?.kind === "milestone" ? (
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
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRescheduleTarget(null)}
              disabled={rescheduleSaving}
              aria-label={rescheduleTarget?.kind === "project" ? "Batal jadwalkan ulang deadline project" : "Batal jadwalkan ulang milestone"}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveRescheduleDialog()}
              disabled={!rescheduleDirty || rescheduleSaving}
              aria-label={rescheduleTarget?.kind === "project" ? "Simpan deadline project" : "Simpan jadwal milestone"}
            >
              {rescheduleSaving ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task 22-4 — dialog Proyek Baru (pembuatan manual) */}
      <Dialog open={npOpen} onOpenChange={setNpOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll rounded-xl sm:max-w-lg" aria-label="Form proyek baru">
          <DialogHeader>
            <DialogTitle>Proyek Baru</DialogTitle>
            <DialogDescription>
              Buat project secara manual tanpa menunggu opportunity Won. Kode project otomatis mengikuti brand
              (contoh: UNI-2026-004). Milestone &amp; invoice tidak dibuat otomatis.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitNewProject} className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="np-name">Nama project *</Label>
              <Input
                id="np-name"
                value={npName}
                onChange={(e) => setNpName(e.target.value)}
                placeholder="Contoh: Website Profil PT Nusantara"
                required
                aria-label="Nama project"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="np-brand">Brand *</Label>
                <Select value={npBrandId} onValueChange={setNpBrandId}>
                  <SelectTrigger id="np-brand" aria-label="Brand project">
                    <SelectValue placeholder="Pilih brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {npBrands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-company">Perusahaan klien *</Label>
                <Select value={npCompanyId} onValueChange={setNpCompanyId}>
                  <SelectTrigger id="np-company" aria-label="Perusahaan klien">
                    <SelectValue placeholder={npCompanies === null ? "Memuat…" : "Pilih perusahaan"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(npCompanies ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="np-service">Kategori layanan</Label>
                <Select value={npServiceCategory} onValueChange={setNpServiceCategory}>
                  <SelectTrigger id="np-service" aria-label="Kategori layanan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tidak ditentukan</SelectItem>
                    {SERVICE_CATEGORIES.map((s) => (
                      <SelectItem key={s} value={s}>{SERVICE_CATEGORY_LABELS[s] ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-status">Status awal</Label>
                <Select value={npStatus} onValueChange={setNpStatus}>
                  <SelectTrigger id="np-status" aria-label="Status awal project"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">Perencanaan</SelectItem>
                    <SelectItem value="in_progress">Berjalan</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-pm">Project Manager</Label>
              <Input
                id="np-pm"
                value={npPmName}
                onChange={(e) => setNpPmName(e.target.value)}
                placeholder="Contoh: Budi M. Kurniawan"
                aria-label="Nama project manager"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="np-start">Mulai</Label>
                <Input id="np-start" type="date" value={npStartDate} onChange={(e) => setNpStartDate(e.target.value)} aria-label="Tanggal mulai" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-due">Deadline</Label>
                <Input id="np-due" type="date" value={npDueDate} onChange={(e) => setNpDueDate(e.target.value)} aria-label="Tanggal deadline" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="np-budget">Budget internal</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden>Rp</span>
                  <Input
                    id="np-budget"
                    type="number" min={0} step={100000} inputMode="numeric"
                    className="pl-9"
                    value={npBudget}
                    onChange={(e) => setNpBudget(e.target.value)}
                    placeholder="0"
                    aria-label="Budget internal dalam rupiah"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-contract">Nilai kontrak</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden>Rp</span>
                  <Input
                    id="np-contract"
                    type="number" min={0} step={100000} inputMode="numeric"
                    className="pl-9"
                    value={npContract}
                    onChange={(e) => setNpContract(e.target.value)}
                    placeholder="0"
                    aria-label="Nilai kontrak dalam rupiah"
                  />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">
              Dibuat oleh {user?.name ?? "-"} — project muncul langsung di daftar &amp; kalender produksi.
            </p>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setNpOpen(false)} disabled={npSaving} aria-label="Batal buat proyek">
                Batal
              </Button>
              <Button
                type="submit"
                disabled={npSaving || !npName.trim() || !npBrandId || !npCompanyId}
                aria-label="Simpan proyek baru"
              >
                {npSaving ? "Membuat…" : "Buat Proyek"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ronde 35 — dialog tambah/edit milestone */}
      <Dialog open={msOpen} onOpenChange={(v) => { if (!v) { setMsOpen(false); setMsEditing(null); } }}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => { e.preventDefault(); void submitMilestoneDialog(); }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{msEditing ? "Edit Milestone" : "Tambah Milestone"}</DialogTitle>
              <DialogDescription>
                {msEditing
                  ? "Perbarui nama, capaian, atau tenggat tahap kerja ini."
                  : "Tambahkan tahap kerja baru ke timeline produksi. Isi capaian agar tim tahu apa yang harus selesai di tahap ini."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ms-name">Nama milestone *</Label>
                <Input
                  id="ms-name"
                  value={msName}
                  onChange={(e) => setMsName(e.target.value)}
                  placeholder="Contoh: Approval Storyboard"
                  aria-label="Nama milestone"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ms-achievement">Capaian / apa yang diserahkan (opsional)</Label>
                <Textarea
                  id="ms-achievement"
                  rows={2}
                  value={msAchievement}
                  onChange={(e) => setMsAchievement(e.target.value)}
                  placeholder="Contoh: Storyboard lengkap disetujui klien — produksi aset bisa dimulai"
                  aria-label="Capaian milestone"
                />
                <p className="text-[11px] text-zinc-400">Ditampilkan di timeline produksi sebagai target tahap ini.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ms-due">Tenggat (opsional)</Label>
                <Input id="ms-due" type="date" value={msDueDate} onChange={(e) => setMsDueDate(e.target.value)} aria-label="Tenggat milestone" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => { setMsOpen(false); setMsEditing(null); }} disabled={msSaving}>
                Batal
              </Button>
              <Button type="submit" disabled={msSaving || !msName.trim()}>
                {msSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {msSaving ? "Menyimpan…" : msEditing ? "Simpan Perubahan" : "Tambah Milestone"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ronde 35 — dialog tagih milestone (invoice termin): Produksi → Keuangan */}
      <Dialog open={!!invTarget} onOpenChange={(v) => { if (!v) setInvTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-zinc-500" aria-hidden /> Tagih Milestone
            </DialogTitle>
            <DialogDescription>
              Terbitkan invoice termin (draft) untuk tahap{" "}
              <span className="font-medium text-zinc-700">{invTarget?.milestone.name}</span> di project{" "}
              <span className="font-medium text-zinc-700">{invTarget?.project.code}</span>. Invoice masuk ke modul Finance untuk dikirim ke klien.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="inv-desc">Deskripsi invoice</Label>
              <Input
                id="inv-desc"
                value={invDesc}
                onChange={(e) => setInvDesc(e.target.value)}
                aria-label="Deskripsi invoice"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inv-amount">Nominal (sebelum PPN)</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden>Rp</span>
                <Input
                  id="inv-amount"
                  type="number" min={0} step={100000} inputMode="numeric"
                  className="pl-9"
                  value={invAmount}
                  onChange={(e) => setInvAmount(e.target.value)}
                  placeholder="0"
                  aria-label="Nominal invoice dalam rupiah"
                />
              </div>
              <p className="text-[11px] text-zinc-400">
                Default = nilai kontrak dibagi rata per milestone — sesuaikan bila termin berbeda. PPN 11% ditambahkan otomatis.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setInvTarget(null)} disabled={invSaving}>
              Batal
            </Button>
            <Button type="button" onClick={() => void submitMilestoneInvoice()} disabled={invSaving || !Number(invAmount)}>
              {invSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {invSaving ? "Membuat…" : "Buat Invoice Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
