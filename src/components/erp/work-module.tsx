"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDown, ArrowUp, Ban, CalendarRange, CheckCircle2, ChevronRight,
  ClipboardCheck, LayoutTemplate, Layers, Plus, RefreshCw, Rocket, Timer, Trash2, X,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import { formatDate, formatDateTime } from "@/lib/crm/utils";
import {
  workApi,
  type DeliverableVersionDTO, type WorkDeliverableDTO, type WorkInstanceDTO,
  type WorkOverviewDTO, type WorkPeriodDTO, type WorkStepInput, type WorkTemplateDTO,
  type WorkVersionDTO,
} from "@/lib/erp/work-client";

// ============ Konstanta tampilan ============

type BrandLite = { id: string; name: string; color?: string | null };
type ProjectLite = { id: string; code: string; name: string; brandId: string; status: string };
type UserLite = { id: string; name: string; role: string | null };

const CONTEXT_META: Record<string, { label: string; cls: string }> = {
  project: { label: "Project", cls: "bg-zinc-200 text-zinc-700" },
  retainer: { label: "Retainer", cls: "bg-emerald-100 text-emerald-700" },
  rnd: { label: "R&D", cls: "bg-violet-100 text-violet-700" },
  standalone: { label: "Standalone", cls: "bg-amber-100 text-amber-700" },
};

const KIND_META: Record<string, { label: string; cls: string }> = {
  task: { label: "Task", cls: "bg-zinc-100 text-zinc-600" },
  review: { label: "Review", cls: "bg-amber-100 text-amber-700" },
  approval: { label: "Approval", cls: "bg-violet-100 text-violet-700" },
  publish: { label: "Publish", cls: "bg-emerald-100 text-emerald-700" },
};

const STEP_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  published: { label: "Published", cls: "bg-emerald-100 text-emerald-700" },
  archived: { label: "Archived", cls: "bg-zinc-100 text-zinc-400" },
};

const INSTANCE_STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Aktif", cls: "bg-emerald-600 text-white" },
  done: { label: "Selesai", cls: "bg-zinc-900 text-zinc-50" },
  cancelled: { label: "Dibatalkan", cls: "bg-rose-100 text-rose-700" },
};

const PERIOD_STATUS_META: Record<string, { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "bg-amber-100 text-amber-700" },
  active: { label: "Aktif", cls: "bg-emerald-100 text-emerald-700" },
  closed: { label: "Ditutup", cls: "bg-zinc-200 text-zinc-500" },
};

const DV_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  internal_review: { label: "Review Internal", cls: "bg-amber-100 text-amber-700" },
  client_review: { label: "Review Klien", cls: "bg-amber-300 text-amber-900" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  published: { label: "Published", cls: "bg-emerald-600 text-white" },
  revision: { label: "Revisi", cls: "bg-rose-100 text-rose-700" },
};

const DELIVERABLE_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-zinc-100 text-zinc-600" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  revision: { label: "Revisi", cls: "bg-rose-100 text-rose-700" },
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", director: "Direktur", manager: "Manajer",
  marketing: "Marketing", production: "Produksi", finance: "Finance", hr: "HR",
};

function metaOf(map: Record<string, { label: string; cls: string }>, key: string) {
  return map[key] ?? { label: key, cls: "bg-zinc-100 text-zinc-600" };
}

// ============ Elemen kecil ============

function BrandDot({ brand }: { brand?: BrandLite | null }) {
  if (!brand) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500" aria-label={`Brand ${brand.name}`}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: brand.color || "#d4d4d8" }} aria-hidden />
      {brand.name}
    </span>
  );
}

function StatusBadge({ meta }: { meta: { label: string; cls: string } }) {
  return (
    <Badge variant="outline" className={`border-transparent px-1.5 text-[10px] font-semibold ${meta.cls}`}>
      {meta.label}
    </Badge>
  );
}

function KpiCard({ label, value, icon, accent }: {
  label: string; value: number | string; icon: React.ReactNode; accent: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`rounded-lg p-2 ${accent}`} aria-hidden>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wide text-zinc-500">{label}</p>
          <p className="text-2xl font-bold text-zinc-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ pos, total, done }: { pos: number; total: number; done: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((pos / total) * 100)) : 0;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-zinc-100"
      role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : "bg-amber-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ============ Tab: Ringkasan ============

function SummaryTab({ overview, instances, deliverables, onNavigate }: {
  overview: WorkOverviewDTO | null;
  instances: WorkInstanceDTO[];
  deliverables: WorkDeliverableDTO[];
  onNavigate: (tab: string) => void;
}) {
  const activeTop = useMemo(
    () => instances.filter((i) => i.status === "active")
      .sort((a, b) => (b.currentPos / Math.max(1, b.version.steps?.length ?? 1)) - (a.currentPos / Math.max(1, a.version.steps?.length ?? 1)))
      .slice(0, 5),
    [instances],
  );
  const pending = useMemo(
    () => deliverables.flatMap((d) =>
      d.versions.filter((v) => v.status === "internal_review" || v.status === "client_review")
        .map((v) => ({ d, v })),
    ).slice(0, 6),
    [deliverables],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Template Aktif" value={overview?.templates ?? "–"} icon={<LayoutTemplate className="h-4 w-4 text-zinc-600" />} accent="bg-zinc-100" />
        <KpiCard label="Instance Aktif" value={overview?.activeInstances ?? "–"} icon={<Activity className="h-4 w-4 text-amber-600" />} accent="bg-amber-50" />
        <KpiCard label="Selesai" value={overview?.doneInstances ?? "–"} icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} accent="bg-emerald-50" />
        <KpiCard label="Periode Aktif" value={overview?.activePeriods ?? "–"} icon={<CalendarRange className="h-4 w-4 text-zinc-600" />} accent="bg-zinc-100" />
        <KpiCard
          label="Review Menunggu" value={overview?.pendingReviews ?? "–"}
          icon={<ClipboardCheck className="h-4 w-4 text-rose-600" />}
          accent={(overview?.pendingReviews ?? 0) > 0 ? "bg-rose-50" : "bg-zinc-100"}
        />
        <KpiCard label="Published Bulan Ini" value={overview?.publishedThisMonth ?? "–"} icon={<Rocket className="h-4 w-4 text-emerald-600" />} accent="bg-emerald-50" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Instance aktif — kemajuan terbesar di atas */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <Layers className="h-4 w-4 text-zinc-400" aria-hidden /> Instance Berjalan
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500" onClick={() => onNavigate("instances")}>
              Lihat semua
            </Button>
          </div>
          {activeTop.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">Tidak ada instance aktif.</p>
          ) : (
            <div className="space-y-3">
              {activeTop.map((inst) => {
                const total = inst.version.steps?.length ?? 0;
                const step = (inst.version.steps ?? []).find((s) => s.position === inst.currentPos) ?? null;
                return (
                  <div key={inst.id} className="rounded-lg border border-zinc-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800" title={inst.title}>{inst.title}</p>
                      <span className="shrink-0 text-xs font-semibold text-zinc-500">{inst.currentPos}/{total}</span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar pos={inst.currentPos} total={total} done={false} />
                    </div>
                    <p className="mt-1.5 truncate text-xs text-zinc-500">
                      {step ? `Sedang: ${step.name}` : "Belum mulai"}
                      {step?.slaHours != null ? ` · SLA ${step.slaHours} jam` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Review deliverable yang menunggu keputusan */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <ClipboardCheck className="h-4 w-4 text-rose-400" aria-hidden /> Review Menunggu
            </h3>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-zinc-500" onClick={() => onNavigate("deliverables")}>
              Buka deliverables
            </Button>
          </div>
          {pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">Tidak ada versi yang sedang direview.</p>
          ) : (
            <div className="space-y-2">
              {pending.map(({ d, v }) => (
                <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800" title={d.name}>{d.name}</p>
                    <p className="text-xs text-zinc-400">{d.project?.name ?? d.project?.code ?? "—"} · v{v.version}</p>
                  </div>
                  <StatusBadge meta={metaOf(DV_STATUS_META, v.status)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Tab: Instances Workflow ============

function InstanceCard({ inst, canAdvance, isManagerPlus, onAdvance, onAskFinish, onCancel }: {
  inst: WorkInstanceDTO;
  canAdvance: boolean;
  isManagerPlus: boolean;
  onAdvance: (inst: WorkInstanceDTO) => void;
  onAskFinish: (inst: WorkInstanceDTO) => void;
  onCancel: (inst: WorkInstanceDTO) => void;
}) {
  const steps = inst.version.steps ?? [];
  const total = steps.length;
  const step = steps.find((s) => s.position === inst.currentPos) ?? null;
  const isLast = inst.currentPos + 1 >= total;
  const brand = inst.project?.brand ?? inst.workPeriod?.brand ?? inst.version.template?.brand ?? null;
  const sMeta = metaOf(INSTANCE_STATUS_META, inst.status);
  const cMeta = metaOf(CONTEXT_META, inst.contextType);

  const contextName =
    inst.contextType === "project"
      ? inst.project ? `${inst.project.code} — ${inst.project.name}` : null
      : inst.workPeriod ? inst.workPeriod.name : null;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm transition-colors hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-900">{inst.title}</p>
            <StatusBadge meta={sMeta} />
            <StatusBadge meta={cMeta} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>{inst.version.template?.name ?? "Template"} <span className="font-semibold text-zinc-700">v{inst.version.version}</span></span>
            {contextName ? <span className="truncate">· {contextName}</span> : null}
            <BrandDot brand={brand} />
            <span>· mulai {formatDate(inst.startedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canAdvance && inst.status === "active" && (
            <Button
              size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-700"
              onClick={() => (isLast ? onAskFinish(inst) : onAdvance(inst))}
              aria-label={`Advance instance ${inst.title}`}
            >
              <ChevronRight className="h-4 w-4" aria-hidden /> Advance
            </Button>
          )}
          {isManagerPlus && inst.status === "active" && (
            <Button
              size="sm" variant="outline"
              className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => onCancel(inst)}
              aria-label={`Batalkan instance ${inst.title}`}
            >
              <Ban className="h-4 w-4" aria-hidden /> Batalkan
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-zinc-600">
            {inst.status === "done" ? "Semua tahap tuntas" : step ? `Tahap ${inst.currentPos}/${total}: ${step.name}` : `Belum mulai (0/${total})`}
          </span>
          <span className="text-zinc-400">{inst.currentPos}/{total}</span>
        </div>
        <ProgressBar pos={inst.currentPos} total={Math.max(total, 1)} done={inst.status === "done"} />
        {step ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StatusBadge meta={metaOf(KIND_META, step.kind)} />
            {step.roleNeeded ? (
              <Badge variant="outline" className="border-zinc-200 px-1.5 text-[10px] text-zinc-500">
                {ROLE_LABEL[step.roleNeeded] ?? step.roleNeeded}
              </Badge>
            ) : null}
            {step.slaHours != null ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                <Timer className="h-3 w-3" aria-hidden /> SLA {step.slaHours} jam
              </span>
            ) : null}
          </div>
        ) : null}
        {inst.assigneeIds ? (
          <p className="pt-1 text-[11px] text-zinc-400">Pelaksana: {inst.assigneeIds.split(",").length} user</p>
        ) : null}
      </div>
    </div>
  );
}

function CreateInstanceDialog({ open, onOpenChange, templates, projects, periods, users, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: WorkTemplateDTO[];
  projects: ProjectLite[];
  periods: WorkPeriodDTO[];
  users: UserLite[];
  onCreated: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [contextType, setContextType] = useState("project");
  const [projectId, setProjectId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [assigneeText, setAssigneeText] = useState("");
  const [saving, setSaving] = useState(false);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const published = template?.versions.find((v) => v.status === "published") ?? null;

  const matchedUsers = useMemo(() => {
    const names = assigneeText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (names.length === 0) return [];
    return users.filter((u) => names.includes(u.name.toLowerCase()));
  }, [assigneeText, users]);

  const reset = () => {
    setTemplateId(""); setTitle(""); setContextType("project");
    setProjectId(""); setPeriodId(""); setAssigneeText("");
  };

  const submit = async () => {
    if (!templateId) return toast.error("Pilih template workflow dulu");
    if (!published) return toast.error("Template ini belum punya versi published");
    if (!title.trim()) return toast.error("Judul instance wajib diisi");
    if (contextType === "project" && !projectId) return toast.error("Pilih project untuk context project");
    if (contextType === "retainer" && !periodId) return toast.error("Pilih periode kerja untuk context retainer");
    setSaving(true);
    try {
      await workApi.createInstance({
        versionId: published.id,
        title: title.trim(),
        contextType,
        projectId: contextType === "project" ? projectId : null,
        workPeriodId: contextType === "retainer" ? periodId : null,
        assigneeIds: matchedUsers.map((u) => u.id),
      });
      toast.success("Instance workflow dibuat — mulai dari tahap 0");
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat instance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat Instance Workflow</DialogTitle>
          <DialogDescription>
            Instance hanya bisa dibuat dari versi workflow yang <span className="font-semibold">published</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wi-template">Template</Label>
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setProjectId(""); setPeriodId(""); }}>
              <SelectTrigger id="wi-template" aria-label="Pilih template workflow"><SelectValue placeholder="Pilih template" /></SelectTrigger>
              <SelectContent>
                {templates.filter((t) => t.active).map((t) => {
                  const pub = t.versions.find((v) => v.status === "published");
                  return (
                    <SelectItem key={t.id} value={t.id} disabled={!pub}>
                      {t.name}{pub ? ` (v${pub.version})` : " — belum ada versi published"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {templateId && !published ? (
              <p className="text-xs text-rose-600">Template ini belum punya versi published — publish versi dulu di tab Template &amp; Versi.</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wi-title">Judul Pekerjaan</Label>
            <Input id="wi-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="cth. Siklus Konten Minggu 3 — Nov 2026" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wi-context">Context</Label>
              <Select value={contextType} onValueChange={setContextType}>
                <SelectTrigger id="wi-context" aria-label="Pilih context"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="retainer">Retainer</SelectItem>
                  <SelectItem value="rnd">R&amp;D</SelectItem>
                  <SelectItem value="standalone">Standalone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {contextType === "project" ? (
              <div className="space-y-1.5">
                <Label htmlFor="wi-project">Project</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id="wi-project" aria-label="Pilih project"><SelectValue placeholder="Pilih project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : contextType === "retainer" ? (
              <div className="space-y-1.5">
                <Label htmlFor="wi-period">Periode Kerja</Label>
                <Select value={periodId} onValueChange={setPeriodId}>
                  <SelectTrigger id="wi-period" aria-label="Pilih periode kerja"><SelectValue placeholder="Pilih periode" /></SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.status})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : <div />}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wi-assignees">Pelaksana (pisahkan koma)</Label>
            <Input
              id="wi-assignees" value={assigneeText} onChange={(e) => setAssigneeText(e.target.value)}
              placeholder="cth. Fadel, Yusi, Rustam Aji"
            />
            {assigneeText.trim() ? (
              <p className={`text-xs ${matchedUsers.length > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                {matchedUsers.length > 0
                  ? `${matchedUsers.length} pengguna dikenali: ${matchedUsers.map((u) => u.name).join(", ")}`
                  : "Tidak ada nama yang cocok dengan daftar pengguna"}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => void submit()} disabled={saving}>
            {saving ? "Menyimpan…" : "Buat Instance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstancesTab({ instances, templates, projects, periods, users, canAdvance, isManagerPlus, refresh }: {
  instances: WorkInstanceDTO[];
  templates: WorkTemplateDTO[];
  projects: ProjectLite[];
  periods: WorkPeriodDTO[];
  users: UserLite[];
  canAdvance: boolean;
  isManagerPlus: boolean;
  refresh: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState<WorkInstanceDTO | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<WorkInstanceDTO | null>(null);

  const filtered = useMemo(
    () => (statusFilter === "all" ? instances : instances.filter((i) => i.status === statusFilter)),
    [instances, statusFilter],
  );

  const advance = useCallback(async (inst: WorkInstanceDTO) => {
    try {
      const res = await workApi.updateInstance(inst.id, { action: "advance" });
      if (res.done) {
        toast.success(`"${inst.title}" tuntas — semua tahap selesai`);
      } else {
        const next = res.instance.version.steps?.find((s) => s.position === res.instance.currentPos);
        toast.success(`Maju ke tahap ${res.instance.currentPos}/${res.instance.version.steps?.length ?? "?"}${next ? ` — ${next.name}` : ""}`);
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal advance instance");
    }
  }, [refresh]);

  const cancelInstance = useCallback(async (inst: WorkInstanceDTO) => {
    try {
      await workApi.updateInstance(inst.id, { action: "cancel" });
      toast.success("Instance dibatalkan");
      setConfirmCancel(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membatalkan instance");
    }
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter status instance">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="done">Selesai</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-zinc-500">{filtered.length} instance</span>
        {isManagerPlus ? (
          <Button
            size="sm" className="ml-auto h-9 bg-zinc-900 text-white hover:bg-zinc-700"
            onClick={() => setCreateOpen(true)} aria-label="Buat instance workflow"
          >
            <Plus className="h-4 w-4" aria-hidden /> Buat Instance
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-zinc-400 shadow-sm">
          Tidak ada instance workflow untuk filter ini.
        </div>
      ) : (
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1 crm-scroll">
          {filtered.map((inst) => (
            <InstanceCard
              key={inst.id} inst={inst} canAdvance={canAdvance} isManagerPlus={isManagerPlus}
              onAdvance={(i) => void advance(i)}
              onAskFinish={setConfirmFinish}
              onCancel={setConfirmCancel}
            />
          ))}
        </div>
      )}

      <CreateInstanceDialog
        open={createOpen} onOpenChange={setCreateOpen}
        templates={templates} projects={projects} periods={periods} users={users}
        onCreated={refresh}
      />

      {/* Konfirmasi advance terakhir → done */}
      <AlertDialog open={!!confirmFinish} onOpenChange={(v) => !v && setConfirmFinish(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tuntaskan instance ini?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{confirmFinish?.title}&quot; sedang di tahap terakhir. Advance sekarang akan menandai instance sebagai{" "}
              <span className="font-semibold text-zinc-800">selesai (done)</span> dan mencatat waktu penyelesaian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => { const i = confirmFinish; setConfirmFinish(null); if (i) void advance(i); }}
            >
              Ya, Tuntaskan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi batal */}
      <AlertDialog open={!!confirmCancel} onOpenChange={(v) => !v && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan instance?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{confirmCancel?.title}&quot; akan berstatus <span className="font-semibold text-rose-600">dibatalkan</span> dan tidak bisa dilanjutkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => { const i = confirmCancel; setConfirmCancel(null); if (i) void cancelInstance(i); }}
            >
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Editor tahapan (dipakai versi baru & draft) ============

type EditorStep = { name: string; kind: string; roleNeeded: string; slaHours: string };

function emptyStep(): EditorStep {
  return { name: "", kind: "task", roleNeeded: "", slaHours: "" };
}

function editorToInput(rows: EditorStep[]): WorkStepInput[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      kind: r.kind,
      roleNeeded: r.roleNeeded.trim() ? r.roleNeeded.trim() : null,
      slaHours: r.slaHours.trim() !== "" && Number.isFinite(Number(r.slaHours)) ? Math.round(Number(r.slaHours)) : null,
    }));
}

function StepEditor({ rows, setRows }: { rows: EditorStep[]; setRows: (rows: EditorStep[]) => void }) {
  const update = (i: number, patch: Partial<EditorStep>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white" aria-hidden>
              {i + 1}
            </span>
            <Input
              value={row.name} onChange={(e) => update(i, { name: e.target.value })}
              placeholder={`Nama tahap #${i + 1}`} className="h-8 flex-1" aria-label={`Nama tahap ${i + 1}`}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Naikkan tahap ${i + 1}`}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Turunkan tahap ${i + 1}`}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:bg-rose-50 hover:text-rose-600" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} aria-label={`Hapus tahap ${i + 1}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Select value={row.kind} onValueChange={(v) => update(i, { kind: v })}>
              <SelectTrigger className="h-8 text-xs" aria-label={`Jenis tahap ${i + 1}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="approval">Approval</SelectItem>
                <SelectItem value="publish">Publish</SelectItem>
              </SelectContent>
            </Select>
            <Select value={row.roleNeeded || "none"} onValueChange={(v) => update(i, { roleNeeded: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs" aria-label={`Role pelaksana tahap ${i + 1}`}><SelectValue placeholder="Role (opsional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Role bebas</SelectItem>
                {Object.entries(ROLE_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="number" min={0} max={2000} value={row.slaHours}
              onChange={(e) => update(i, { slaHours: e.target.value })}
              placeholder="SLA jam" className="h-8 text-xs" aria-label={`SLA jam tahap ${i + 1}`}
            />
          </div>
        </div>
      ))}
      <Button
        variant="outline" size="sm" className="h-8 w-full border-dashed"
        onClick={() => setRows([...rows, emptyStep()])} aria-label="Tambah tahap"
      >
        <Plus className="h-4 w-4" aria-hidden /> Tambah Tahap
      </Button>
    </div>
  );
}

// ============ Tab: Template & Versi ============

function CreateTemplateDialog({ open, onOpenChange, brands, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  brands: BrandLite[]; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandId, setBrandId] = useState("none");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("Nama template wajib diisi");
    setSaving(true);
    try {
      await workApi.createTemplate({
        name: name.trim(),
        description: description.trim() || null,
        brandId: brandId === "none" ? null : brandId,
      });
      toast.success("Template dibuat — tambahkan versi draft berikutnya");
      setName(""); setDescription(""); setBrandId("none");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Template Workflow Baru</DialogTitle>
          <DialogDescription>Template adalah cetak biru; eksekusi nyata lewat instance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wt-name">Nama Template</Label>
            <Input id="wt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Digmar — Siklus Konten Bulanan" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wt-desc">Deskripsi</Label>
            <Textarea id="wt-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Opsional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wt-brand">Brand (opsional)</Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger id="wt-brand" aria-label="Pilih brand"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanpa brand</SelectItem>
                {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => void submit()} disabled={saving}>
            {saving ? "Menyimpan…" : "Buat Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateVersionDialog({ open, onOpenChange, template, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  template: WorkTemplateDTO | null; onCreated: () => void;
}) {
  const [rows, setRows] = useState<EditorStep[]>([emptyStep()]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setRows([emptyStep()]); setNote(""); }
  }, [open, template?.id]);

  const submit = async () => {
    if (!template) return;
    const steps = editorToInput(rows);
    if (steps.length === 0) return toast.error("Minimal satu tahapan dengan nama terisi");
    setSaving(true);
    try {
      await workApi.createVersion(template.id, { steps, note: note.trim() || null });
      toast.success(`Draft versi baru dibuat untuk "${template.name}"`);
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat versi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Versi Baru — {template?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Versi baru lahir sebagai <span className="font-semibold">draft</span>. Publish terpisah; versi published lama akan otomatis diarsipkan.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto pr-1 crm-scroll">
          <StepEditor rows={rows} setRows={setRows} />
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="wv-note">Catatan versi (opsional)</Label>
            <Input id="wv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="cth. Tambah tahap QA klien" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => void submit()} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesTab({ templates, brands, isManagerPlus, refresh }: {
  templates: WorkTemplateDTO[];
  brands: BrandLite[];
  isManagerPlus: boolean;
  refresh: () => void;
}) {
  const [selTemplateId, setSelTemplateId] = useState<string | null>(null);
  const [selVersionId, setSelVersionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkVersionDTO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draftRows, setDraftRows] = useState<EditorStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [createTplOpen, setCreateTplOpen] = useState(false);
  const [createVerOpen, setCreateVerOpen] = useState(false);

  const selected = templates.find((t) => t.id === selTemplateId) ?? null;

  useEffect(() => {
    if (!selVersionId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    workApi.version(selVersionId)
      .then((res) => {
        if (cancelled) return;
        setDetail(res.version);
        setDraftRows((res.version.steps ?? []).map((s) => ({
          name: s.name, kind: s.kind, roleNeeded: s.roleNeeded ?? "", slaHours: s.slaHours != null ? String(s.slaHours) : "",
        })));
        setDirty(false);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Gagal memuat detail versi"))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => { cancelled = true; };
  }, [selVersionId]);

  const saveDraft = async () => {
    if (!detail) return;
    const steps = editorToInput(draftRows);
    if (steps.length === 0) return toast.error("Minimal satu tahapan dengan nama terisi");
    setSavingDraft(true);
    try {
      await workApi.updateVersion(detail.id, { steps });
      toast.success("Tahapan draft tersimpan");
      setDirty(false);
      refresh();
      const res = await workApi.version(detail.id);
      setDetail(res.version);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const publishVersion = async () => {
    if (!detail) return;
    try {
      const res = await workApi.publishVersion(detail.id);
      toast.success(res.alreadyPublished ? "Versi ini sudah published" : `v${res.version.version} published — versi published lama diarsipkan`);
      setConfirmPublish(false);
      refresh();
      setSelVersionId(res.version.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal publish versi");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{templates.length} template · pilih template untuk melihat versi &amp; tahapan</p>
        {isManagerPlus ? (
          <Button size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => setCreateTplOpen(true)} aria-label="Buat template workflow">
            <Plus className="h-4 w-4" aria-hidden /> Template Baru
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Daftar template */}
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1 crm-scroll">
          {templates.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-zinc-400 shadow-sm">
              Belum ada template workflow.
            </div>
          ) : templates.map((t) => {
            const pub = t.versions.find((v) => v.status === "published");
            const draft = t.versions.find((v) => v.status === "draft");
            return (
              <button
                key={t.id} type="button"
                onClick={() => { setSelTemplateId(t.id); setSelVersionId(null); setDetail(null); }}
                className={`block w-full rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:shadow-md ${
                  selTemplateId === t.id ? "ring-2 ring-zinc-900/70" : ""
                }`}
                aria-label={`Pilih template ${t.name}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{t.name}</p>
                    {t.description ? <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{t.description}</p> : null}
                    <div className="mt-1.5"><BrandDot brand={t.brand ?? null} /></div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {pub ? <StatusBadge meta={{ label: `v${pub.version} published`, cls: "bg-emerald-100 text-emerald-700" }} /> : null}
                    {draft ? <StatusBadge meta={{ label: `v${draft.version} draft`, cls: "bg-amber-100 text-amber-700" }} /> : null}
                    <span className="text-[11px] text-zinc-400">{t.versions.length} versi</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.versions.map((v) => (
                    <span
                      key={v.id}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        v.status === "published" ? "bg-emerald-600 text-white"
                          : v.status === "draft" ? "bg-amber-100 text-amber-700"
                          : "bg-zinc-100 text-zinc-400"
                      }`}
                    >
                      v{v.version}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Panel detail versi */}
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          {!selected ? (
            <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
              Pilih template di kiri untuk melihat versi &amp; tahapan.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">{selected.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <BrandDot brand={selected.brand ?? null} />
                    <span className="text-xs text-zinc-400">{selected.versions.length} versi</span>
                  </div>
                </div>
                {isManagerPlus ? (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setCreateVerOpen(true)} aria-label="Buat versi draft baru">
                    <Plus className="h-4 w-4" aria-hidden /> Versi Baru (Draft)
                  </Button>
                ) : null}
              </div>

              {/* Pilih versi */}
              <div className="flex flex-wrap gap-1.5">
                {selected.versions.map((v) => (
                  <button
                    key={v.id} type="button"
                    onClick={() => setSelVersionId(v.id)}
                    className={`rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
                      selVersionId === v.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                    aria-label={`Lihat versi ${v.version}`}
                  >
                    v{v.version} · {v.status}
                  </button>
                ))}
              </div>

              {!selVersionId ? (
                <p className="py-6 text-center text-sm text-zinc-400">Pilih versi untuk melihat tahapan.</p>
              ) : detailLoading || !detail ? (
                <div className="space-y-2 py-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-zinc-900">v{detail.version}</span>
                    <StatusBadge meta={metaOf(STEP_STATUS_META, detail.status)} />
                    {detail.publishedAt ? (
                      <span className="text-[11px] text-zinc-400">publish {formatDateTime(detail.publishedAt)}</span>
                    ) : null}
                    {detail.note ? <span className="text-[11px] italic text-zinc-400">“{detail.note}”</span> : null}
                  </div>

                  {detail.status === "draft" ? (
                    <>
                      <StepEditor rows={draftRows} setRows={(r) => { setDraftRows(r); setDirty(true); }} />
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline" className="h-8 flex-1"
                          onClick={() => void saveDraft()} disabled={savingDraft || !dirty}
                          aria-label="Simpan tahapan draft"
                        >
                          {savingDraft ? "Menyimpan…" : "Simpan Tahapan"}
                        </Button>
                        <Button
                          size="sm" className="h-8 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => setConfirmPublish(true)}
                          aria-label="Publish versi draft"
                        >
                          <Rocket className="h-4 w-4" aria-hidden /> Publish Versi
                        </Button>
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Versi published tidak bisa diedit — perubahan alur = buat versi baru.
                      </p>
                    </>
                  ) : (
                    <ol className="space-y-2">
                      {(detail.steps ?? []).map((s) => (
                        <li key={s.id} className="flex items-start gap-2.5 rounded-lg border border-zinc-100 p-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white" aria-hidden>
                            {s.position}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-zinc-800">{s.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <StatusBadge meta={metaOf(KIND_META, s.kind)} />
                              {s.roleNeeded ? (
                                <Badge variant="outline" className="border-zinc-200 px-1.5 text-[10px] text-zinc-500">
                                  {ROLE_LABEL[s.roleNeeded] ?? s.roleNeeded}
                                </Badge>
                              ) : null}
                              {s.slaHours != null ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                                  <Timer className="h-3 w-3" aria-hidden /> {s.slaHours} jam
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                      {detail.status === "archived" ? (
                        <p className="text-[11px] text-zinc-400">Versi ini sudah diarsipkan — instance lama tetap memakai versi ini.</p>
                      ) : null}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <CreateTemplateDialog open={createTplOpen} onOpenChange={setCreateTplOpen} brands={brands} onCreated={refresh} />
      <CreateVersionDialog open={createVerOpen} onOpenChange={setCreateVerOpen} template={selected} onCreated={refresh} />

      {/* Konfirmasi publish versi */}
      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish versi {detail ? `v${detail.version}` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Bila template ini sudah punya versi published lain, versi lama akan{" "}
              <span className="font-semibold text-zinc-800">otomatis diarsipkan</span> (satu published per template).
              Instance baru setelahnya memakai versi ini; instance lama tidak berubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void publishVersion()}>
              Ya, Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Tab: Periode Kerja ============

function CreatePeriodDialog({ open, onOpenChange, brands, projects, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  brands: BrandLite[]; projects: ProjectLite[]; onCreated: () => void;
}) {
  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [projectId, setProjectId] = useState("none");
  const [contractRef, setContractRef] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!brandId) return toast.error("Pilih brand periode");
    if (!name.trim()) return toast.error("Nama periode wajib diisi");
    if (!start || !end) return toast.error("Isi tanggal mulai dan akhir periode");
    setSaving(true);
    try {
      await workApi.createPeriod({
        brandId, name: name.trim(), periodStart: start, periodEnd: end,
        projectId: projectId === "none" ? null : projectId,
        contractRef: contractRef.trim() || null,
      });
      toast.success("Periode kerja dibuat (planned) — aktifkan saat siap berjalan");
      setName(""); setStart(""); setEnd(""); setProjectId("none"); setContractRef("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat periode");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Periode Kerja Baru</DialogTitle>
          <DialogDescription>Siklus kerja berulang untuk kontrak retainer — alur: planned → aktif → ditutup.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wp-brand">Brand</Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger id="wp-brand" aria-label="Pilih brand periode"><SelectValue placeholder="Pilih brand" /></SelectTrigger>
              <SelectContent>
                {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wp-name">Nama Periode</Label>
            <Input id="wp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Digmar Retainer Nov 2026" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-start">Mulai</Label>
            <Input id="wp-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Tanggal mulai periode" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-end">Akhir</Label>
            <Input id="wp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Tanggal akhir periode" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-project">Project (opsional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="wp-project" aria-label="Pilih project terkait"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanpa project</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-contract">Referensi Kontrak</Label>
            <Input id="wp-contract" value={contractRef} onChange={(e) => setContractRef(e.target.value)} placeholder="cth. PKS/DGM/2026/012" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => void submit()} disabled={saving}>
            {saving ? "Menyimpan…" : "Buat Periode"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PeriodsTab({ periods, brands, projects, isManagerPlus, refresh }: {
  periods: WorkPeriodDTO[];
  brands: BrandLite[];
  projects: ProjectLite[];
  isManagerPlus: boolean;
  refresh: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = useCallback(async (id: string, action: "activate" | "close") => {
    setBusyId(id);
    try {
      await workApi.updatePeriod(id, { action });
      toast.success(action === "activate" ? "Periode diaktifkan" : "Periode ditutup");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah periode");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{periods.length} periode · tutup hanya bisa bila tidak ada instance aktif</p>
        {isManagerPlus ? (
          <Button size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => setCreateOpen(true)} aria-label="Buat periode kerja">
            <Plus className="h-4 w-4" aria-hidden /> Periode Baru
          </Button>
        ) : null}
      </div>

      {periods.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-zinc-400 shadow-sm">
          Belum ada periode kerja.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {periods.map((p) => {
            const sMeta = metaOf(PERIOD_STATUS_META, p.status);
            return (
              <div key={p.id} className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900" title={p.name}>{p.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <BrandDot brand={p.brand ?? null} />
                      {p.project ? <span className="text-xs text-zinc-500">{p.project.code}</span> : null}
                    </div>
                  </div>
                  <StatusBadge meta={sMeta} />
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {formatDate(p.periodStart)} → {formatDate(p.periodEnd)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                  {p.contractRef ? (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono">{p.contractRef}</span>
                  ) : null}
                  <span>{p._count?.instances ?? 0} instance</span>
                </div>
                {isManagerPlus ? (
                  <div className="mt-3 flex gap-2">
                    {p.status === "planned" ? (
                      <Button
                        size="sm" variant="outline" className="h-8 flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        disabled={busyId === p.id}
                        onClick={() => void act(p.id, "activate")}
                        aria-label={`Aktifkan periode ${p.name}`}
                      >
                        <Activity className="h-3.5 w-3.5" aria-hidden /> Aktifkan
                      </Button>
                    ) : null}
                    {p.status !== "closed" ? (
                      <Button
                        size="sm" variant="outline" className="h-8 flex-1"
                        disabled={busyId === p.id}
                        onClick={() => void act(p.id, "close")}
                        aria-label={`Tutup periode ${p.name}`}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden /> Tutup
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <CreatePeriodDialog open={createOpen} onOpenChange={setCreateOpen} brands={brands} projects={projects} onCreated={refresh} />
    </div>
  );
}

// ============ Tab: Deliverables ============

function NewDeliverableVersionDialog({ open, onOpenChange, deliverable, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  deliverable: WorkDeliverableDTO | null; onCreated: () => void;
}) {
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setContent(""); setUrl(""); }
  }, [open, deliverable?.id]);

  const submit = async () => {
    if (!deliverable) return;
    if (!content.trim() && !url.trim()) return toast.error("Isi konten atau URL versi baru");
    setSaving(true);
    try {
      await workApi.createDeliverableVersion(deliverable.id, {
        content: content.trim() || null,
        url: url.trim() || null,
      });
      toast.success("Versi baru (draft) dibuat");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      // 409 (review masih berjalan) ditampilkan apa adanya — jelas kenapa ditolak.
      toast.error(err instanceof Error ? err.message : "Gagal membuat versi baru");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Versi Baru — {deliverable?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Hanya bisa bila tidak ada versi yang sedang direview (satu review aktif per deliverable).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dv-content">Konten / Caption</Label>
            <Textarea id="dv-content" rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Caption/naskah versi baru…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dv-url">URL (opsional)</Label>
            <Input id="dv-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.example.com/…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-700" onClick={() => void submit()} disabled={saving}>
            {saving ? "Menyimpan…" : "Buat Versi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionTimelineItem({ deliverable, version, canWrite, canPublish, canApproveInternal, busy, onAction, onAskRevision, onAskClient }: {
  deliverable: WorkDeliverableDTO;
  version: DeliverableVersionDTO;
  canWrite: boolean;
  canPublish: boolean;
  canApproveInternal: boolean;
  busy: boolean;
  onAction: (deliverable: WorkDeliverableDTO, version: DeliverableVersionDTO, action: "submit_internal" | "approve_internal" | "publish") => void;
  onAskRevision: (deliverable: WorkDeliverableDTO, version: DeliverableVersionDTO) => void;
  onAskClient: (deliverable: WorkDeliverableDTO, version: DeliverableVersionDTO) => void;
}) {
  const meta = metaOf(DV_STATUS_META, version.status);
  return (
    <div className="rounded-lg border border-zinc-100 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-900">v{version.version}</span>
          <StatusBadge meta={meta} />
          <span className="text-[11px] text-zinc-400">{formatDateTime(version.createdAt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canWrite && version.status === "draft" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onAction(deliverable, version, "submit_internal")} aria-label={`Submit internal v${version.version}`}>
              Submit Internal
            </Button>
          )}
          {canApproveInternal && version.status === "internal_review" && (
            <Button size="sm" variant="outline" className="h-7 border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50" disabled={busy} onClick={() => onAction(deliverable, version, "approve_internal")} aria-label={`Setujui internal v${version.version}`}>
              Setujui Internal
            </Button>
          )}
          {canWrite && (version.status === "internal_review" || version.status === "client_review") && (
            <Button size="sm" variant="outline" className="h-7 border-rose-200 text-xs text-rose-600 hover:bg-rose-50" disabled={busy} onClick={() => onAskRevision(deliverable, version)} aria-label={`Minta revisi v${version.version}`}>
              Minta Revisi
            </Button>
          )}
          {canWrite && version.status === "client_review" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onAskClient(deliverable, version)} aria-label={`Setujui klien v${version.version}`}>
              Setujui Klien
            </Button>
          )}
          {canPublish && version.status === "approved" && (
            <Button size="sm" className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={busy} onClick={() => onAction(deliverable, version, "publish")} aria-label={`Publish v${version.version}`}>
              <Rocket className="h-3.5 w-3.5" aria-hidden /> Publish
            </Button>
          )}
        </div>
      </div>
      {version.content ? <p className="mt-2 line-clamp-2 text-xs text-zinc-600">{version.content}</p> : null}
      {version.url ? (
        <a href={version.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-zinc-500 underline decoration-zinc-300 hover:text-zinc-800">
          {version.url}
        </a>
      ) : null}
      {version.feedback ? (
        <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs italic text-rose-700">Feedback: {version.feedback}</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
        {version.reviewedBy ? <span>Reviewer internal: {version.reviewedBy}</span> : null}
        {version.clientReviewedBy ? <span>Reviewer klien: {version.clientReviewedBy}</span> : null}
        {version.publishedAt ? <span>Publish: {formatDateTime(version.publishedAt)}</span> : null}
      </div>
    </div>
  );
}

function DeliverablesTab({ deliverables, canWrite, canPublish, canApproveInternal, refresh }: {
  deliverables: WorkDeliverableDTO[];
  canWrite: boolean;
  canPublish: boolean;
  canApproveInternal: boolean;
  refresh: () => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newVerOpen, setNewVerOpen] = useState(false);

  // Dialog aksi
  const [revisionTarget, setRevisionTarget] = useState<{ d: WorkDeliverableDTO; v: DeliverableVersionDTO } | null>(null);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [revisionClientName, setRevisionClientName] = useState("");
  const [clientTarget, setClientTarget] = useState<{ d: WorkDeliverableDTO; v: DeliverableVersionDTO } | null>(null);
  const [clientName, setClientName] = useState("");

  const selected = deliverables.find((d) => d.id === selId) ?? null;

  const runAction = useCallback(async (
    deliverable: WorkDeliverableDTO,
    version: DeliverableVersionDTO,
    action: "submit_internal" | "approve_internal" | "publish",
  ) => {
    setBusy(true);
    try {
      const res = await workApi.updateDeliverableVersion(deliverable.id, version.id, { action });
      if (action === "publish") {
        toast.success(res.alreadyPublished
          ? `v${version.version} sudah published — retry aman, tidak ada publish ganda`
          : `v${version.version} published`);
      } else if (action === "approve_internal") {
        toast.success(`v${version.version} lolos review internal — lanjut review klien`);
      } else {
        toast.success(`v${version.version} dikirim ke review internal`);
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menjalankan aksi");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const submitRevision = async () => {
    if (!revisionTarget) return;
    if (!revisionFeedback.trim()) return toast.error("Feedback wajib diisi saat meminta revisi");
    if (revisionTarget.v.status === "client_review" && !revisionClientName.trim()) {
      return toast.error("Nama reviewer klien wajib diisi untuk revisi dari review klien");
    }
    setBusy(true);
    try {
      await workApi.updateDeliverableVersion(revisionTarget.d.id, revisionTarget.v.id, {
        action: "request_revision",
        feedback: revisionFeedback.trim(),
        clientName: revisionClientName.trim() || null,
      });
      toast.success(`Revisi diminta untuk v${revisionTarget.v.version}`);
      setRevisionTarget(null); setRevisionFeedback(""); setRevisionClientName("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal meminta revisi");
    } finally {
      setBusy(false);
    }
  };

  const submitClientApprove = async () => {
    if (!clientTarget) return;
    if (!clientName.trim()) return toast.error("Nama klien wajib diisi — persetujuan dicatat atas nama klien");
    setBusy(true);
    try {
      await workApi.updateDeliverableVersion(clientTarget.d.id, clientTarget.v.id, {
        action: "approve_client",
        clientName: clientName.trim(),
      });
      toast.success(`v${clientTarget.v.version} approved atas nama klien ${clientName.trim()}`);
      setClientTarget(null); setClientName("");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat persetujuan klien");
    } finally {
      setBusy(false);
    }
  };

  const activeVersionBadge = (d: WorkDeliverableDTO) => {
    const v = d.versions[0];
    if (!v) return <span className="text-[11px] text-zinc-400">tanpa versi</span>;
    return <StatusBadge meta={{ label: `v${v.version} · ${metaOf(DV_STATUS_META, v.status).label}`, cls: metaOf(DV_STATUS_META, v.status).cls }} />;
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        {deliverables.length} deliverable · alur: draft → review internal → review klien → approved → published
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Daftar deliverable */}
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1 lg:col-span-2 crm-scroll">
          {deliverables.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-zinc-400 shadow-sm">
              Belum ada deliverable.
            </div>
          ) : deliverables.map((d) => (
            <button
              key={d.id} type="button"
              onClick={() => setSelId(d.id)}
              className={`block w-full rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:shadow-md ${
                selId === d.id ? "ring-2 ring-zinc-900/70" : ""
              }`}
              aria-label={`Pilih deliverable ${d.name}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">{d.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {d.project ? `${d.project.code} — ${d.project.name}` : "—"}
                  </p>
                  <div className="mt-1"><BrandDot brand={d.project?.brand ?? null} /></div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge meta={metaOf(DELIVERABLE_STATUS_META, d.status)} />
                  {activeVersionBadge(d)}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Timeline versi */}
        <div className="rounded-xl border bg-white p-4 shadow-sm lg:col-span-3">
          {!selected ? (
            <div className="flex h-64 items-center justify-center text-sm text-zinc-400">
              Pilih deliverable untuk melihat timeline versi &amp; aksi review.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">{selected.name}</p>
                  <p className="text-xs text-zinc-500">{selected.project ? `${selected.project.code} — ${selected.project.name}` : "—"}</p>
                </div>
                {canWrite ? (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setNewVerOpen(true)} aria-label="Buat versi baru deliverable">
                    <Plus className="h-4 w-4" aria-hidden /> Versi Baru
                  </Button>
                ) : null}
              </div>

              {selected.versions.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-400">Belum ada versi untuk deliverable ini.</p>
              ) : (
                <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1 crm-scroll">
                  {selected.versions.map((v) => (
                    <VersionTimelineItem
                      key={v.id} deliverable={selected} version={v}
                      canWrite={canWrite} canPublish={canPublish} canApproveInternal={canApproveInternal}
                      busy={busy}
                      onAction={(d, ver, a) => void runAction(d, ver, a)}
                      onAskRevision={(d, ver) => { setRevisionTarget({ d, v: ver }); setRevisionFeedback(""); setRevisionClientName(""); }}
                      onAskClient={(d, ver) => { setClientTarget({ d, v: ver }); setClientName(""); }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <NewDeliverableVersionDialog open={newVerOpen} onOpenChange={setNewVerOpen} deliverable={selected} onCreated={refresh} />

      {/* Dialog minta revisi */}
      <Dialog open={!!revisionTarget} onOpenChange={(v) => !v && setRevisionTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Minta Revisi — v{revisionTarget?.v.version ?? ""}</DialogTitle>
            <DialogDescription>
              {revisionTarget?.v.status === "client_review"
                ? "Revisi dari review klien: nama reviewer klien wajib dicatat."
                : "Feedback wajib diisi agar produksi tahu apa yang harus diperbaiki."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rev-feedback">Feedback</Label>
              <Textarea
                id="rev-feedback" rows={3} value={revisionFeedback}
                onChange={(e) => setRevisionFeedback(e.target.value)}
                placeholder="cth. Warna tidak sesuai palet brand, ubah slide 3…"
              />
            </div>
            {revisionTarget?.v.status === "client_review" ? (
              <div className="space-y-1.5">
                <Label htmlFor="rev-client">Nama Reviewer Klien</Label>
                <Input
                  id="rev-client" value={revisionClientName}
                  onChange={(e) => setRevisionClientName(e.target.value)}
                  placeholder="cth. Ibu Ratna — PT Nusantara"
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionTarget(null)}>Batal</Button>
            <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => void submitRevision()} disabled={busy}>
              Kirim Revisi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog setujui klien */}
      <Dialog open={!!clientTarget} onOpenChange={(v) => !v && setClientTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Setujui Klien — v{clientTarget?.v.version ?? ""}</DialogTitle>
            <DialogDescription>
              Catatan internal: persetujuan klien dicatat atas nama — pastikan klien sudah benar-benar menyetujui.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Nama Klien</Label>
            <Input
              id="client-name" value={clientName} onChange={(e) => setClientName(e.target.value)}
              placeholder="cth. Pak Budi — PT Nusantara Digital Raya"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClientTarget(null)}>Batal</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void submitClientApprove()} disabled={busy}>
              Catat Persetujuan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ Modul utama ============

function ModuleSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export default function WorkModule() {
  const role = useCrmStore((s) => s.user?.role ?? null);
  const brands = useCrmStore((s) => s.brands);

  const isManagerPlus = role === "manager" || role === "director" || role === "super_admin";
  const canAdvance = isManagerPlus || role === "production" || role === "marketing";
  const canPublish = isManagerPlus || role === "production";
  const canApproveInternal = isManagerPlus || role === "production";
  const canWrite = canAdvance; // level write modul work: production/marketing/manager+

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<WorkOverviewDTO | null>(null);
  const [templates, setTemplates] = useState<WorkTemplateDTO[]>([]);
  const [instances, setInstances] = useState<WorkInstanceDTO[]>([]);
  const [periods, setPeriods] = useState<WorkPeriodDTO[]>([]);
  const [deliverables, setDeliverables] = useState<WorkDeliverableDTO[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [ov, tpl, ins, per, del] = await Promise.all([
        workApi.overview(),
        workApi.templates(),
        workApi.instances(),
        workApi.periods(),
        workApi.deliverables(),
      ]);
      setOverview(ov);
      setTemplates(tpl.templates);
      setInstances(ins.instances);
      setPeriods(per.periods);
      setDeliverables(del.deliverables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal memuat data Work Engine";
      setError(msg);
      if (!silent) toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Data referensi untuk dialog (project & pengguna) — gagal = diamkan (dialog tetap terbuka kosong).
  useEffect(() => {
    api.projects({})
      .then((res) => setProjects(res.projects.map((p) => ({ id: p.id, code: p.code, name: p.name, brandId: p.brandId, status: p.status }))))
      .catch(() => {});
    api.users()
      .then((res) => setUsers(res.users.map((u) => ({ id: u.id, name: u.name, role: u.role }))))
      .catch(() => {});
  }, []);

  const [tab, setTab] = useState("ringkasan");

  if (loading) return <ModuleSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Work Engine</h1>
          <p className="text-sm text-zinc-500">Workflow berversi, periode kerja retainer, &amp; versioning deliverable</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Muat ulang data work engine">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
        </Button>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>Coba Lagi</Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="instances">Instances Workflow</TabsTrigger>
          <TabsTrigger value="templates">Template &amp; Versi</TabsTrigger>
          <TabsTrigger value="periods">Periode Kerja</TabsTrigger>
          <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
        </TabsList>

        <TabsContent value="ringkasan" className="mt-4">
          <SummaryTab overview={overview} instances={instances} deliverables={deliverables} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="instances" className="mt-4">
          <InstancesTab
            instances={instances} templates={templates} projects={projects} periods={periods} users={users}
            canAdvance={canAdvance} isManagerPlus={isManagerPlus} refresh={() => void load(true)}
          />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab templates={templates} brands={brands} isManagerPlus={isManagerPlus} refresh={() => void load(true)} />
        </TabsContent>
        <TabsContent value="periods" className="mt-4">
          <PeriodsTab periods={periods} brands={brands} projects={projects} isManagerPlus={isManagerPlus} refresh={() => void load(true)} />
        </TabsContent>
        <TabsContent value="deliverables" className="mt-4">
          <DeliverablesTab
            deliverables={deliverables}
            canWrite={canWrite} canPublish={canPublish} canApproveInternal={canApproveInternal}
            refresh={() => void load(true)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
