"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock, CalendarDays, Check, CheckCircle2, CircleDashed, CircleDotDashed,
  Factory, FolderKanban, GitPullRequestArrow, Plus, ReceiptText, RefreshCw, User2, X,
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
  const [decideTarget, setDecideTarget] = useState<{ cr: ChangeRequestDTO; decision: "approve" | "reject" } | null>(null);
  const [decideNote, setDecideNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const canDecideCr = user?.role === "director" || user?.role === "super_admin";
  const detailCrs = detail?.changeRequests ?? [];
  const approvedCrSum = detailCrs
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + (c.additionalCost ?? 0), 0);

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

  function openDecide(cr: ChangeRequestDTO, decision: "approve" | "reject") {
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
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang daftar project">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
        </Button>
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
        <span className="text-xs text-zinc-500 sm:ml-auto">
          {stats.total} project · {stats.active} aktif · rata-rata progress {stats.avgProgress}%
        </span>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Grid kartu */}
      {(projects ?? []).length === 0 ? (
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
                            {cr.status === "pending" && canDecideCr ? (
                              <div className="mt-2.5 flex items-center gap-2">
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
              {decideTarget?.decision === "approve" ? "Setujui change request?" : "Tolak change request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decideTarget
                ? `${decideTarget.cr.number} · ${decideTarget.cr.title} — +${formatCurrency(decideTarget.cr.additionalCost)}, +${decideTarget.cr.additionalDays} hari.`
                : ""}
              {decideTarget?.decision === "approve"
                ? " Nilai kontrak &amp; deadline project akan diperbarui dan invoice tambahan diterbitkan otomatis."
                : " Perubahan scope tidak akan diterapkan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cr-decision-note">Catatan keputusan (opsional)</Label>
            <Textarea
              id="cr-decision-note"
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value)}
              placeholder={decideTarget?.decision === "approve" ? "Contoh: Disetujui sesuai diskusi dengan klien" : "Contoh: Scope di luar anggaran tahun ini"}
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
                  : "bg-rose-600 text-white hover:bg-rose-700"
              }
              aria-label={decideTarget?.decision === "approve" ? "Konfirmasi setujui change request" : "Konfirmasi tolak change request"}
            >
              {deciding ? "Memproses…" : decideTarget?.decision === "approve" ? "Ya, Setujui" : "Ya, Tolak"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
