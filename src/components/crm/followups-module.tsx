"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BellRing, Building2, CalendarClock, CalendarDays, CheckCircle2, ClipboardList,
  ListFilter, Plus, RefreshCw, Video, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/crm/api-client";
import { PRIORITIES } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type { TaskDTO } from "@/lib/crm/types";
import { formatDate, initials, timeAgo } from "@/lib/crm/utils";

// ============ Meta tipe task & prioritas ============

const TASK_TYPES: { key: string; label: string; icon: LucideIcon; cls: string }[] = [
  { key: "follow_up", label: "Follow-up", icon: BellRing, cls: "bg-amber-100 text-amber-700" },
  { key: "meeting", label: "Meeting", icon: Video, cls: "bg-violet-100 text-violet-700" },
  { key: "internal", label: "Internal", icon: Building2, cls: "bg-zinc-100 text-zinc-600" },
  { key: "admin", label: "Admin", icon: ClipboardList, cls: "bg-cyan-100 text-cyan-700" },
];

function taskTypeMeta(type: string) {
  return TASK_TYPES.find((t) => t.key === type) ?? { key: type, label: type, icon: ClipboardList, cls: "bg-zinc-100 text-zinc-600" };
}

function priorityMeta(p: string): { label: string; cls: string } {
  switch (p) {
    case "urgent": return { label: "Urgent", cls: "bg-rose-100 text-rose-700" };
    case "high": return { label: "Tinggi", cls: "bg-amber-100 text-amber-700" };
    case "medium": return { label: "Sedang", cls: "bg-zinc-100 text-zinc-600" };
    case "low": return { label: "Rendah", cls: "bg-zinc-100 text-zinc-400" };
    default: return { label: p, cls: "bg-zinc-100 text-zinc-600" };
  }
}

// ============ Helper tanggal ============

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function isOverdue(t: TaskDTO): boolean {
  return t.status === "open" && !!t.dueDate && new Date(t.dueDate).getTime() < startOfToday().getTime();
}

function isToday(t: TaskDTO): boolean {
  if (!t.dueDate) return false;
  const due = new Date(t.dueDate).getTime();
  return due >= startOfToday().getTime() && due <= endOfToday().getTime();
}

// ============ Sub-komponen kecil ============

function StatCard({ label, value, icon: Icon, cls }: {
  label: string; value: number; icon: LucideIcon; cls: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <span className={`rounded-lg p-2 ${cls}`} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">{count}</span>
      <span className="h-px flex-1 bg-zinc-200" aria-hidden />
    </div>
  );
}

function TaskCard({ task, onToggle, busy }: {
  task: TaskDTO;
  onToggle: (t: TaskDTO) => void;
  busy: boolean;
}) {
  const type = taskTypeMeta(task.type);
  const prio = priorityMeta(task.priority);
  const TypeIcon = type.icon;
  const done = task.status === "done";
  const overdue = isOverdue(task);
  const opp = task.opportunity;
  const brand = opp?.brand;

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-zinc-300 ${done ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={done}
          onCheckedChange={() => onToggle(task)}
          disabled={busy}
          className="mt-0.5"
          aria-label={done ? `Buka kembali task ${task.title}` : `Tandai selesai task ${task.title}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`gap-1 border-transparent px-1.5 ${type.cls}`}>
              <TypeIcon className="h-3 w-3" aria-hidden /> {type.label}
            </Badge>
            <Badge variant="outline" className={`border-transparent px-1.5 ${prio.cls}`}>{prio.label}</Badge>
            {overdue && <Badge className="border-transparent bg-rose-100 text-rose-700">Overdue</Badge>}
          </div>
          <p className={`text-sm font-semibold leading-snug text-zinc-900 ${done ? "line-through decoration-zinc-400" : ""}`}>
            {task.title}
          </p>
          {task.description ? (
            <p className="line-clamp-2 text-xs text-zinc-500">{task.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500">
            {task.dueDate ? (
              <span className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-rose-600" : "text-zinc-600"}`}>
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden /> {formatDate(task.dueDate)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden /> Tanpa tenggat
              </span>
            )}
            {opp ? (
              <button
                type="button"
                onClick={() => toast.info("Buka dari modul Sales Pipeline")}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
                aria-label={`Buka opportunity ${opp.title} dari modul Sales Pipeline`}
              >
                {brand ? (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: brand.color }} aria-hidden />
                ) : null}
                <span className="truncate">{opp.title}</span>
              </button>
            ) : null}
            {done && task.completedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Selesai {timeAgo(task.completedAt)}
              </span>
            ) : null}
          </div>
        </div>
        {task.assigneeName ? (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white"
            title={task.assigneeName}
            aria-label={`Ditugaskan ke ${task.assigneeName}`}
          >
            {initials(task.assigneeName)}
          </span>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 text-[11px] font-bold text-zinc-400" title="Belum di-assign" aria-hidden>
            ?
          </span>
        )}
      </div>
    </div>
  );
}

function FollowupsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <Skeleton className="h-10 w-full" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}

function EmptyGroup({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400">
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden /> {text}
    </div>
  );
}

// ============ Module utama ============

export default function FollowupsModule() {
  const user = useCrmStore((s) => s.user);

  const [tasks, setTasks] = useState<TaskDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", type: "follow_up", priority: "medium", assigneeName: "", dueDate: "", opportunityId: "",
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.tasks({
        status: statusFilter !== "all" ? statusFilter : undefined,
        assignee: assigneeFilter !== "all" ? assigneeFilter : undefined,
        overdue: onlyOverdue ? "true" : undefined,
      });
      setTasks(res.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat task");
      if (!silent) toast.error("Gagal memuat task follow-up");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, assigneeFilter, onlyOverdue]);

  useEffect(() => { void load(); }, [load]);

  const assignees = useMemo(() => {
    const set = new Set<string>();
    (tasks ?? []).forEach((t) => { if (t.assigneeName) set.add(t.assigneeName); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const stats = useMemo(() => {
    const list = tasks ?? [];
    const todayEnd = endOfToday().getTime();
    const weekAgo = todayEnd - 7 * 24 * 60 * 60 * 1000;
    return {
      open: list.filter((t) => t.status === "open").length,
      overdue: list.filter((t) => isOverdue(t)).length,
      dueToday: list.filter((t) => t.status === "open" && isToday(t)).length,
      doneThisWeek: list.filter((t) => t.status === "done" && t.completedAt
        && new Date(t.completedAt).getTime() >= weekAgo
        && new Date(t.completedAt).getTime() <= todayEnd).length,
    };
  }, [tasks]);

  const groups = useMemo(() => {
    const list = tasks ?? [];
    return {
      overdue: list.filter((t) => isOverdue(t)),
      today: list.filter((t) => t.status === "open" && isToday(t)),
      upcoming: list.filter((t) => t.status === "open" && !isOverdue(t) && !isToday(t)),
      done: list.filter((t) => t.status === "done"),
    };
  }, [tasks]);

  async function handleToggle(t: TaskDTO) {
    const nextStatus = t.status === "done" ? "open" : "done";
    setBusyId(t.id);
    try {
      const res = await api.updateTask(t.id, { status: nextStatus });
      setTasks((prev) => (prev ?? []).map((x) => (x.id === t.id ? res.task : x)));
      toast.success(nextStatus === "done" ? "Task ditandai selesai" : "Task dibuka kembali");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui task");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e?.preventDefault();
    if (!form.title.trim()) { toast.error("Judul task wajib diisi"); return; }
    setSaving(true);
    try {
      await api.createTask({
        title: form.title.trim(),
        type: form.type,
        priority: form.priority,
        assigneeName: form.assigneeName.trim() || undefined,
        dueDate: form.dueDate || undefined,
        opportunityId: form.opportunityId.trim() || undefined,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      toast.success("Task follow-up dibuat");
      setCreateOpen(false);
      setForm({ title: "", type: "follow_up", priority: "medium", assigneeName: "", dueDate: "", opportunityId: "" });
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat task");
    } finally {
      setSaving(false);
    }
  }

  if (loading && tasks === null) return <FollowupsSkeleton />;

  const sectionBody = (list: TaskDTO[], emptyText: string): ReactNode =>
    list.length === 0 ? (
      <EmptyGroup text={emptyText} />
    ) : (
      <div className="space-y-3">
        {list.map((t) => (
          <TaskCard key={t.id} task={t} onToggle={handleToggle} busy={busyId === t.id} />
        ))}
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header + filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Follow-up Center</h1>
          <p className="text-sm text-zinc-500">Task &amp; jadwal follow-up per opportunity</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Muat ulang daftar task"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} aria-label="Tambah task follow-up baru">
            <Plus className="h-4 w-4" aria-hidden /> Tambah Task
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Filter status task">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter assignee">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Assignee</SelectItem>
              {assignees.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
          <Switch checked={onlyOverdue} onCheckedChange={setOnlyOverdue} aria-label="Hanya tampilkan task overdue" />
          Hanya overdue
        </label>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Open" value={stats.open} icon={ListFilter} cls="bg-zinc-100 text-zinc-600" />
        <StatCard label="Overdue" value={stats.overdue} icon={CalendarClock} cls="bg-rose-100 text-rose-600" />
        <StatCard label="Due Hari Ini" value={stats.dueToday} icon={CalendarDays} cls="bg-amber-100 text-amber-600" />
        <StatCard label="Selesai Minggu Ini" value={stats.doneThisWeek} icon={CheckCircle2} cls="bg-emerald-100 text-emerald-600" />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* List dikelompokkan */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        {assigneeFilter !== "all" && assignees.length === 0 && tasks?.length === 0 ? (
          <EmptyGroup text="Tidak ada task untuk filter ini" />
        ) : null}
        <div className="space-y-6">
          {groups.overdue.length > 0 && (
            <section aria-label="Task overdue" className="space-y-3">
              <SectionHeading title="Overdue" count={groups.overdue.length} />
              {sectionBody(groups.overdue, "Tidak ada task overdue")}
            </section>
          )}
          <section aria-label="Task hari ini" className="space-y-3">
            <SectionHeading title="Hari ini" count={groups.today.length} />
            {sectionBody(groups.today, "Tidak ada task jatuh tempo hari ini")}
          </section>
          <section aria-label="Task mendatang" className="space-y-3">
            <SectionHeading title="Mendatang" count={groups.upcoming.length} />
            {sectionBody(groups.upcoming, "Tidak ada task mendatang")}
          </section>
          <section aria-label="Task selesai" className="space-y-3">
            <SectionHeading title="Selesai" count={groups.done.length} />
            {sectionBody(groups.done, "Belum ada task selesai")}
          </section>
        </div>
      </div>

      {/* Dialog tambah task */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Task Follow-up</DialogTitle>
            <DialogDescription>Buat task baru untuk jadwal follow-up, meeting, atau pekerjaan internal.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="task-title">Judul Task *</Label>
              <Input
                id="task-title" value={form.title} required
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Contoh: Follow-up proposal redesign website"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="task-type">Tipe</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger id="task-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-priority">Prioritas</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger id="task-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{priorityMeta(p).label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="task-assignee">Assignee</Label>
                <Input
                  id="task-assignee" value={form.assigneeName}
                  onChange={(e) => setForm((f) => ({ ...f, assigneeName: e.target.value }))}
                  placeholder="Nama orang yang mengerjakan"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-due">Due Date</Label>
                <Input
                  id="task-due" type="date" value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-opp">Opportunity ID (opsional)</Label>
              <Input
                id="task-opp" value={form.opportunityId}
                onChange={(e) => setForm((f) => ({ ...f, opportunityId: e.target.value }))}
                placeholder="Tempel ID opportunity bila terkait"
              />
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
              <Button type="submit" disabled={saving} aria-label="Simpan task baru">
                {saving ? "Menyimpan…" : "Simpan Task"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
