"use client";

/**
 * Task 74-b — Modul "Tugas" (produksi, rapat, & pekerjaan internal).
 * Sengaja DIPISAH dari modul Follow-up (komersial): daftar ini menampilkan semua
 * task KECUALI type=follow_up (server-side filter excludeType=follow_up di GET /api/tasks).
 *
 * Catatan teknis: api.tasks() di api-client belum menerima param type/excludeType,
 * sehingga GET daftar memakai fetch langsung (pola yang sama dipakai modul lain,
 * mis. ekspor CSV); mutasi tetap lewat api.createTask / api.updateTask.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BellRing, Building2, CalendarClock, CalendarDays, CheckCircle2, ClipboardList,
  ListFilter, Plus, RefreshCw, RotateCcw, Search, Video, type LucideIcon,
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import { PRIORITIES, TASK_TYPES } from "@/lib/crm/constants";
import { NOTIF_CHANGED_EVENT } from "@/lib/crm/notif-prefs";
import type { ProjectDTO, TaskDTO } from "@/lib/crm/types";
import { formatDate, formatDateTime, initials, parseJsonArray, timeAgo } from "@/lib/crm/utils";

// ============ Meta tipe & prioritas ============

// Warna/ikon tipe mengikuti spesifikasi modul Tugas: meeting=Video violet,
// produksi/internal=Building2 zinc, admin=ClipboardList cyan; follow_up & revisi
// sebagai fallback (task follow_up tidak tampil di modul ini).
const TYPE_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  follow_up: { label: "Follow-up", icon: BellRing, cls: "bg-amber-100 text-amber-700" },
  meeting: { label: "Meeting", icon: Video, cls: "bg-violet-100 text-violet-700" },
  production: { label: "Produksi", icon: Building2, cls: "bg-zinc-100 text-zinc-600" },
  revision: { label: "Revisi", icon: RotateCcw, cls: "bg-rose-100 text-rose-700" },
  admin: { label: "Administrasi", icon: ClipboardList, cls: "bg-cyan-100 text-cyan-700" },
  internal: { label: "Internal", icon: Building2, cls: "bg-zinc-100 text-zinc-600" },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { label: type, icon: CalendarClock, cls: "bg-zinc-100 text-zinc-600" };
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

// Opsi filter/tipe dialog dari konstanta bersama — TANPA follow_up (modul komersial).
const TASK_TYPE_OPTIONS = TASK_TYPES.filter((t) => t.key !== "follow_up");

const PRIORITY_OPTIONS: { key: string; label: string }[] = PRIORITIES.map((p) => ({
  key: p,
  label: p === "low" ? "Rendah" : p === "medium" ? "Sedang" : p === "high" ? "Tinggi" : "Urgent",
}));

// ============ Helper ============

/** TaskDTO.assignees bisa string JSON (dari DB) atau array — parse defensif. */
function taskAssigneeList(task: Pick<TaskDTO, "assignees" | "assigneeName">): string[] {
  const raw = task.assignees;
  let parsed: string[] = [];
  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (typeof raw === "string") {
    parsed = parseJsonArray(raw);
  }
  const list = parsed.filter((n): n is string => typeof n === "string" && n.trim() !== "");
  if (list.length === 0 && task.assigneeName) return [task.assigneeName];
  return list;
}

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

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
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

function EmptyGroup({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400">
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden /> {text}
    </div>
  );
}

function TaskCard({ task, onToggle, busy }: {
  task: TaskDTO;
  onToggle: (t: TaskDTO) => void;
  busy: boolean;
}) {
  const meta = typeMeta(task.type);
  const prio = priorityMeta(task.priority);
  const TypeIcon = meta.icon;
  const done = task.status === "done";
  const overdue = isOverdue(task);
  const assigneeList = taskAssigneeList(task);
  const shownAssignees = assigneeList.slice(0, 3);
  const extraAssignees = assigneeList.length - shownAssignees.length;

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-zinc-300 ${done ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={done}
          onCheckedChange={() => onToggle(task)}
          disabled={busy}
          className="mt-0.5"
          aria-label={done ? `Buka kembali tugas ${task.title}` : `Tandai selesai tugas ${task.title}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`gap-1 border-transparent px-1.5 ${meta.cls}`}>
              <TypeIcon className="h-3 w-3" aria-hidden /> {meta.label}
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
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {task.type === "meeting" ? formatDateTime(task.dueDate) : formatDate(task.dueDate)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden /> Tanpa tenggat
              </span>
            )}
            {task.project ? (
              <Badge
                variant="outline"
                className="max-w-full border-zinc-200 bg-zinc-50 px-1.5 font-mono text-[10px] font-medium text-zinc-600"
                title={task.milestone ? `${task.project.name} — ${task.milestone.name}` : task.project.name}
              >
                {task.project.code}{task.milestone ? ` · ${task.milestone.name}` : ""}
              </Badge>
            ) : null}
            {done && task.completedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Selesai {timeAgo(task.completedAt)}
              </span>
            ) : null}
          </div>
        </div>
        {assigneeList.length > 0 ? (
          <span
            className="flex shrink-0 items-center -space-x-1.5"
            aria-label={`Ditugaskan ke ${assigneeList.join(", ")}`}
            title={`Ditugaskan ke: ${assigneeList.join(", ")}`}
          >
            {shownAssignees.map((name) => (
              <span
                key={name}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white ring-2 ring-white"
                aria-hidden
              >
                {initials(name)}
              </span>
            ))}
            {extraAssignees > 0 ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600 ring-2 ring-white" aria-hidden>
                +{extraAssignees}
              </span>
            ) : null}
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

function TasksSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <Skeleton className="h-10 w-full" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}

// ============ Dialog "Tugas Baru" ============

interface UserOption { id: string; name: string }

function NewTaskDialog({ open, onOpenChange, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (task: TaskDTO) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("production");
  const [priority, setPriority] = useState<string>("medium");
  const [assignee, setAssignee] = useState<string>("none");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [milestoneId, setMilestoneId] = useState<string>("none");

  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset form + muat master (anggota tim & project) saat dialog dibuka
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setType("production");
    setPriority("medium");
    setAssignee("none");
    setDueDate("");
    setProjectId("none");
    setMilestoneId("none");

    let cancelled = false;
    api.users()
      .then((res) => {
        if (cancelled) return;
        setUsers(res.users.filter((u) => u.role !== "client").map((u) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
          toast.error("Gagal memuat daftar anggota tim — tugas dibuat tanpa assignee");
        }
      });
    api.projects()
      .then((res) => {
        if (!cancelled) setProjects(res.projects);
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          toast.error("Gagal memuat daftar project — tugas dibuat tanpa project");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const milestones = useMemo(
    () => (projectId !== "none" ? projects?.find((p) => p.id === projectId)?.milestones ?? [] : []),
    [projects, projectId]
  );

  /** Saat tipe berubah, format tenggat menyesuaikan (meeting = datetime-local). */
  function handleTypeChange(next: string) {
    setType(next);
    if (next === "meeting") {
      setDueDate((v) => (v && v.length === 10 ? `${v}T09:00` : v));
    } else if (dueDate.length > 10) {
      setDueDate(dueDate.slice(0, 10));
    }
  }

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Judul tugas wajib diisi");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { title: trimmed, type, priority };
      if (description.trim()) payload.description = description.trim();
      if (assignee !== "none") payload.assignees = [assignee];
      if (dueDate) payload.dueDate = dueDate;
      if (projectId !== "none") payload.projectId = projectId;
      if (milestoneId !== "none") payload.milestoneId = milestoneId;
      const res = await api.createTask(payload);
      toast.success(`Tugas "${trimmed}" dibuat`);
      onSaved(res.task);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat tugas");
    } finally {
      setSaving(false);
    }
  }

  const masterLoading = users === null || projects === null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto crm-scroll sm:max-w-lg" aria-label="Buat tugas baru">
        <DialogHeader>
          <DialogTitle>Tugas Baru</DialogTitle>
          <DialogDescription>
            Tugas produksi, rapat, atau pekerjaan internal. Untuk follow-up komersial
            lead &amp; opportunity, gunakan modul Follow-up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="newtask-title">Judul *</Label>
            <Input
              id="newtask-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="cth. Shooting video profil — lokasi kantor klien"
              className="bg-white"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newtask-desc">Deskripsi</Label>
            <Textarea
              id="newtask-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Detail pekerjaan, lokasi, kebutuhan alat, dsb. (opsional)"
              className="bg-white"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="newtask-type">Tipe</Label>
              <Select value={type} onValueChange={handleTypeChange}>
                <SelectTrigger id="newtask-type" className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newtask-priority">Prioritas</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="newtask-priority" className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newtask-assignee">Assignee</Label>
              {users === null ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : (
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger id="newtask-assignee" className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa assignee</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="newtask-due">{type === "meeting" ? "Waktu rapat" : "Tenggat"}</Label>
              <Input
                id="newtask-due"
                type={type === "meeting" ? "datetime-local" : "date"}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newtask-project">Project</Label>
              {projects === null ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : (
                <Select
                  value={projectId}
                  onValueChange={(v) => {
                    setProjectId(v);
                    setMilestoneId("none");
                  }}
                >
                  <SelectTrigger id="newtask-project" className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="newtask-milestone">Milestone</Label>
              {masterLoading ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : (
                <Select value={milestoneId} onValueChange={setMilestoneId} disabled={projectId === "none"}>
                  <SelectTrigger id="newtask-milestone" className="bg-white">
                    <SelectValue placeholder={projectId === "none" ? "Pilih project dulu" : "Tanpa milestone"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa milestone</SelectItem>
                    {milestones.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !title.trim()} aria-label="Simpan tugas baru">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {saving ? "Menyimpan…" : "Simpan Tugas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Module utama ============

export default function TasksModule() {
  const [tasks, setTasks] = useState<TaskDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [projectFilter, setProjectFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);

  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Task 74-b — sumber data modul Tugas: semua task KECUALI follow_up
      // (follow-up komersial tampil di modul Follow-up).
      const sp = new URLSearchParams({ excludeType: "follow_up" });
      if (typeFilter !== "all") sp.set("type", typeFilter);
      if (statusFilter !== "all") sp.set("status", statusFilter);
      if (onlyOverdue) sp.set("overdue", "true");
      const res = await fetch(`/api/tasks?${sp}`, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as { tasks?: TaskDTO[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat tugas");
      if (!silent) toast.error("Gagal memuat daftar tugas");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, onlyOverdue]);

  useEffect(() => { void load(); }, [load]);

  // Opsi filter project diambil dari task yang memang punya project (sisi klien)
  const projectOptions = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    (tasks ?? []).forEach((t) => {
      if (t.projectId && t.project) map.set(t.projectId, t.project);
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [tasks]);

  // Filter sisi klien: project + pencarian judul (debounce 300ms)
  const displayTasks = useMemo(() => {
    let list = tasks ?? [];
    if (projectFilter !== "all") list = list.filter((t) => t.projectId === projectFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.title.toLowerCase().includes(q));
    return list;
  }, [tasks, projectFilter, search]);

  const stats = useMemo(() => {
    const list = displayTasks;
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
  }, [displayTasks]);

  const groups = useMemo(() => {
    const list = displayTasks;
    return {
      overdue: list.filter((t) => isOverdue(t)),
      today: list.filter((t) => t.status === "open" && isToday(t)),
      upcoming: list.filter((t) => t.status === "open" && !isOverdue(t) && !isToday(t)),
      done: list.filter((t) => t.status === "done"),
    };
  }, [displayTasks]);

  async function handleToggle(t: TaskDTO) {
    const nextStatus = t.status === "done" ? "open" : "done";
    setBusyId(t.id);
    try {
      const res = await api.updateTask(t.id, { status: nextStatus });
      setTasks((prev) => (prev ?? []).map((x) => (x.id === t.id ? res.task : x)));
      toast.success(nextStatus === "done" ? "Tugas ditandai selesai" : "Tugas dibuka kembali");
      window.dispatchEvent(new CustomEvent(NOTIF_CHANGED_EVENT));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui tugas");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && tasks === null) return <TasksSkeleton />;

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

  const hasActiveTaskFilter = (tasks ?? []).length > 0 && displayTasks.length === 0;

  return (
    <div className="space-y-6">
      {/* Header + aksi */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Tugas</h1>
          <p className="text-sm text-zinc-500">
            Tugas produksi, rapat, &amp; pekerjaan internal — follow-up komersial ada di modul{" "}
            <span className="font-medium text-zinc-700">Follow-up</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Muat ulang daftar tugas"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} aria-label="Tambah tugas baru">
            <Plus className="h-4 w-4" aria-hidden /> Tugas Baru
          </Button>
        </div>
      </div>

      {/* Toolbar filter */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Filter tipe tugas">
                <SelectValue placeholder="Tipe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tipe</SelectItem>
                {TASK_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[140px]" aria-label="Filter status tugas">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filter project">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Project</SelectItem>
              {projectOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
            <Switch checked={onlyOverdue} onCheckedChange={setOnlyOverdue} aria-label="Hanya tampilkan tugas overdue" />
            Hanya overdue
          </label>
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari judul tugas…"
              className="bg-white pl-8"
              aria-label="Cari judul tugas"
            />
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Terbuka" value={stats.open} icon={ListFilter} cls="bg-zinc-100 text-zinc-600" />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          icon={CalendarClock}
          cls={stats.overdue > 0 ? "bg-rose-100 text-rose-600" : "bg-zinc-100 text-zinc-600"}
        />
        <StatCard label="Tenggat Hari Ini" value={stats.dueToday} icon={CalendarDays} cls="bg-amber-100 text-amber-600" />
        <StatCard label="Selesai Minggu Ini" value={stats.doneThisWeek} icon={CheckCircle2} cls="bg-emerald-100 text-emerald-600" />
      </div>

      {error ? (
        <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            className="border-rose-300 bg-white text-rose-700 hover:bg-rose-100"
            onClick={() => void load()}
            aria-label="Coba lagi memuat daftar tugas"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Coba Lagi
          </Button>
        </div>
      ) : null}

      {/* List dikelompokkan */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        {hasActiveTaskFilter ? (
          <EmptyGroup text="Tidak ada tugas untuk filter ini" />
        ) : null}
        <div className="crm-scroll max-h-96 space-y-6 overflow-y-auto pr-1">
          {groups.overdue.length > 0 && (
            <section aria-label="Tugas overdue" className="space-y-3">
              <SectionHeading title="Overdue" count={groups.overdue.length} />
              {sectionBody(groups.overdue, "Tidak ada tugas overdue")}
            </section>
          )}
          <section aria-label="Tugas hari ini" className="space-y-3">
            <SectionHeading title="Hari ini" count={groups.today.length} />
            {sectionBody(groups.today, "Tidak ada tugas jatuh tempo hari ini")}
          </section>
          <section aria-label="Tugas mendatang" className="space-y-3">
            <SectionHeading title="Mendatang" count={groups.upcoming.length} />
            {sectionBody(groups.upcoming, "Tidak ada tugas mendatang")}
          </section>
          <section aria-label="Tugas selesai" className="space-y-3">
            <SectionHeading title="Selesai" count={groups.done.length} />
            {sectionBody(groups.done, "Belum ada tugas selesai")}
          </section>
        </div>
      </div>

      {/* Dialog tugas baru */}
      <NewTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          // Silent refetch agar task baru langsung masuk grup yang benar
          void load(true);
          window.dispatchEvent(new CustomEvent(NOTIF_CHANGED_EVENT));
        }}
      />
    </div>
  );
}
