"use client";

/**
 * Ronde 40-E — form tugas bersama (baru / edit) yang dipakai Follow-up Center
 * dan drawer detail opportunity.
 * - Assignee multi (chip toggle, minimal 1) dari api.users() (role "client" dikecualikan).
 * - Opportunity picker WAJIB (Popover+Command, debounced) — atau badge tetap bila lockedOpportunity.
 * - Lampiran: tautan (URL) & file ≤5MB (data URL), maks 5.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  FileText,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldHintInLabel } from "@/components/crm/field-hint";
import { TASK_TYPES } from "@/lib/crm/constants";
import { api } from "@/lib/crm/api-client";
import { initials } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";
import type { TaskDTO } from "@/lib/crm/types";

// ---------- Konstanta form ----------

// Ronde 42 — tipe task dari konstanta bersama (hint ditampilkan sbg tooltip & sub-text opsi)
const TASK_TYPE_OPTIONS = TASK_TYPES.map((t) => ({ key: t.key, label: t.label, hint: t.hint }));

const TASK_PRIORITY_OPTIONS = [
  { key: "low", label: "Rendah" },
  { key: "medium", label: "Sedang" },
  { key: "high", label: "Tinggi" },
] as const;

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — sinkron dgn validasi server (task-parse)

type AttachmentDraft =
  | { type: "link"; name: string; url: string }
  | { type: "file"; name: string; url: string; size: number };

interface UserOption {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
}

interface OppOption {
  id: string;
  title: string;
  brandName: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- Ronde 42 — helper prefill mode EDIT ----------

/** Parse daftar nama assignee dari TaskDTO (assignees JSON/array, fallback assigneeName). */
function assigneesFromDto(task: TaskDTO): string[] {
  let parsed: string[] = [];
  if (Array.isArray(task.assignees)) parsed = task.assignees.filter((n): n is string => typeof n === "string");
  else if (typeof task.assignees === "string") {
    try {
      const v: unknown = JSON.parse(task.assignees);
      if (Array.isArray(v)) parsed = v.filter((n): n is string => typeof n === "string");
    } catch {
      parsed = [];
    }
  }
  if (parsed.length === 0 && task.assigneeName) return [task.assigneeName];
  return parsed;
}

/** Lampiran tersimpan → draft editor (link/file). */
function taskAttachmentsFromDto(task: TaskDTO): AttachmentDraft[] {
  let list: unknown = task.attachments;
  if (typeof task.attachments === "string") {
    try {
      list = JSON.parse(task.attachments);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (a): a is { type: string; name: string; url: string; size?: number } =>
        !!a && typeof a === "object" && typeof (a as { url?: unknown }).url === "string"
    )
    .map((a) =>
      a.type === "file"
        ? { type: "file" as const, name: a.name, url: a.url, size: a.size ?? 0 }
        : { type: "link" as const, name: a.name, url: a.url }
    );
}

/** ISO dueDate → nilai siap input: meeting "YYYY-MM-DDTHH:mm", lainnya "YYYY-MM-DD". */
function prefillDue(type: string, iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    if (type === "meeting") {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${hh}:${mm}`;
    }
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dipanggil setelah task tersimpan (dgn TaskDTO dari server). */
  onSaved?: (task: TaskDTO) => void;
  /** Bila diisi — opportunity terkunci (badge), picker disembunyikan (drawer detail). */
  lockedOpportunity?: { id: string; title: string } | null;
  /** Nama assignee yang sudah terpilih saat dialog dibuka. */
  presetAssignees?: string[];
  /** Ronde 42 — bila diisi → mode EDIT (prefill + PATCH), sekaligus "melihat" detail task. */
  editTask?: TaskDTO | null;
}

export default function TaskFormDialog({
  open,
  onOpenChange,
  onSaved,
  lockedOpportunity,
  presetAssignees,
  editTask,
}: TaskFormDialogProps) {
  const isEdit = !!editTask;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("follow_up");
  const [priority, setPriority] = useState<string>("medium");
  const [dueDate, setDueDate] = useState("");

  // Assignee multi
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);

  // Opportunity picker
  const [opportunity, setOpportunity] = useState<OppOption | null>(null);
  const [oppOpen, setOppOpen] = useState(false);
  const [oppQuery, setOppQuery] = useState("");
  const [oppOptions, setOppOptions] = useState<OppOption[]>([]);
  const [oppLoading, setOppLoading] = useState(false);

  // Lampiran
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [linkRowOpen, setLinkRowOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState(false);

  // Reset + muat data dasar saat dialog dibuka (Ronde 42 — mode edit prefill dari editTask)
  useEffect(() => {
    if (!open) return;
    if (editTask) {
      setTitle(editTask.title);
      setDescription(editTask.description ?? "");
      setType(editTask.type);
      setPriority(editTask.priority || "medium");
      setDueDate(prefillDue(editTask.type, editTask.dueDate));
      setAssignees(assigneesFromDto(editTask));
      setOpportunity(
        editTask.opportunityId || lockedOpportunity
          ? { id: (lockedOpportunity?.id ?? editTask.opportunityId) as string, title: lockedOpportunity?.title ?? editTask.opportunity?.title ?? "", brandName: editTask.opportunity?.brand?.name ?? null }
          : null
      );
      setAttachments(taskAttachmentsFromDto(editTask));
    } else {
      setTitle("");
      setDescription("");
      setType("follow_up");
      setPriority("medium");
      setDueDate("");
      setAssignees(presetAssignees ? [...presetAssignees] : []);
      setOpportunity(lockedOpportunity ? { id: lockedOpportunity.id, title: lockedOpportunity.title, brandName: null } : null);
      setAttachments([]);
    }
    setOppOpen(false);
    setOppQuery("");
    setOppOptions([]);
    setLinkRowOpen(false);
    setLinkUrl("");

    let cancelled = false;
    api
      .users()
      .then((res) => {
        if (cancelled) return;
        setUsers(res.users.filter((u) => u.role !== "client"));
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
          toast.error("Gagal memuat daftar anggota tim");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, editTask, lockedOpportunity, presetAssignees]);

  // Pencarian opportunity debounced (server-side q)
  useEffect(() => {
    if (!oppOpen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setOppLoading(true);
      api
        .opportunities({ q: oppQuery.trim() || undefined })
        .then((res) => {
          if (cancelled) return;
          setOppOptions(
            res.opportunities.map((o) => ({ id: o.id, title: o.title, brandName: o.brand?.name ?? null }))
          );
        })
        .catch(() => {
          if (!cancelled) setOppOptions([]);
        })
        .finally(() => {
          if (!cancelled) setOppLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [oppOpen, oppQuery]);

  const canSubmit = !!title.trim() && assignees.length > 0 && !!(lockedOpportunity?.id ?? opportunity?.id);

  function toggleAssignee(name: string) {
    setAssignees((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  /** Ronde 42 — saat tipe berubah, format nilai tenggat menyesuaikan (date ↔ datetime-local). */
  function handleTypeChange(next: string) {
    setType(next);
    if (next === "meeting") {
      // dari "YYYY-MM-DD" → "YYYY-MM-DDT09:00" (jam default 09:00 agar reminder bermakna)
      setDueDate((v) => (v && v.length === 10 ? `${v}T09:00` : v));
    } else if (dueDate.length > 10) {
      setDueDate(dueDate.slice(0, 10));
    }
  }

  function confirmLink() {
    const url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Tautan harus diawali http:// atau https://");
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(`Maksimal ${MAX_ATTACHMENTS} lampiran`);
      return;
    }
    setAttachments((prev) => [...prev, { type: "link", name: url, url }]);
    setLinkUrl("");
    setLinkRowOpen(false);
  }

  function handleFileChosen(file: File | null | undefined) {
    if (!file) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(`Maksimal ${MAX_ATTACHMENTS} lampiran`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("File melebihi 5 MB");
      return;
    }
    setReadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      setReadingFile(false);
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url) {
        toast.error("Gagal membaca file");
        return;
      }
      setAttachments((prev) => [...prev, { type: "file", name: file.name, url, size: file.size }]);
    };
    reader.onerror = () => {
      setReadingFile(false);
      toast.error("Gagal membaca file");
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!title.trim()) {
      toast.error("Judul tugas wajib diisi");
      return;
    }
    if (assignees.length === 0) {
      toast.error("Minimal satu assignee wajib dipilih");
      return;
    }
    const oppId = lockedOpportunity?.id ?? opportunity?.id;
    if (!oppId) {
      toast.error("Tugas wajib terhubung dengan opportunity");
      return;
    }
    // Ronde 42 — meeting WAJIB punya tanggal + jam (reminder 1 jam sebelumnya butuh jam mulai)
    if (type === "meeting" && (!dueDate || dueDate.length <= 10)) {
      toast.error("Meeting wajib punya tanggal & jam mulai — reminder 1 jam sebelumnya dihitung dari sini");
      return;
    }
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      type,
      priority,
      dueDate: dueDate || null,
      opportunityId: oppId,
      assignees,
      attachments: attachments.map((a) =>
        a.type === "file" ? { type: "file", name: a.name, url: a.url, size: a.size } : { type: "link", name: a.name, url: a.url }
      ),
    };
    setSaving(true);
    try {
      const res = isEdit && editTask
        ? await api.updateTask(editTask.id, payload)
        : await api.createTask(payload);
      toast.success(isEdit ? "Tugas diperbarui" : "Tugas dibuat");
      onOpenChange(false);
      onSaved?.(res.task);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isEdit ? "Gagal memperbarui tugas" : "Gagal membuat tugas");
    } finally {
      setSaving(false);
    }
  }

  const oppLabel = useMemo(
    () => (opportunity ? `${opportunity.title}${opportunity.brandName ? ` — ${opportunity.brandName}` : ""}` : ""),
    [opportunity]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Detail & Edit Tugas" : "Tugas Baru"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Lihat dan ubah detail tugas — assignee, tenggat, lampiran, dan opportunity terkait."
              : "Buat tugas dengan penanggung jawab, opportunity terkait, dan lampiran pendukung."}
          </DialogDescription>
        </DialogHeader>

        <div className="crm-scroll max-h-[85vh] space-y-4 overflow-y-auto pr-1">
          {/* Judul */}
          <div className="space-y-1.5">
            <Label htmlFor="tf-title" className="flex items-center gap-1">
              Judul * <FieldHintInLabel tip="Nama pekerjaan yang jelas — tampil di Follow-up Center, notifikasi, dan filter tugas saya." />
            </Label>
            <Input
              id="tf-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Follow-up proposal redesign website"
              disabled={saving}
              autoFocus
            />
          </div>

          {/* Tipe + Prioritas + Tenggat */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tf-type" className="flex items-center gap-1">
                Tipe <FieldHintInLabel tip="Jenis pekerjaan: Follow-up (tindak lanjut klien), Meeting (rapat — ada reminder 1 jam sebelumnya), Produksi (shooting/editing), Revisi, atau Administrasi (dokumen & kontrak)." />
              </Label>
              <Select value={type} onValueChange={handleTypeChange} disabled={saving}>
                <SelectTrigger id="tf-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      <span className="flex flex-col">
                        <span>{t.label}</span>
                        <span className="text-[10px] font-normal text-zinc-400">{t.hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tf-priority" className="flex items-center gap-1">
                Prioritas <FieldHintInLabel tip="Tingkat kepentingan — Urgent/Tinggi muncul lebih dulu di urutan tugas tim." />
              </Label>
              <Select value={priority} onValueChange={setPriority} disabled={saving}>
                <SelectTrigger id="tf-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tf-due" className="flex items-center gap-1">
                {type === "meeting" ? "Jadwal (tanggal & jam)" : "Tenggat"}
                <FieldHintInLabel
                  tip={
                    type === "meeting"
                      ? "Tanggal DAN jam mulai meeting. Semua assignee menerima reminder notifikasi 1 jam sebelum jadwal ini."
                      : "Batas waktu penyelesaian — lewat tanggal ini task masuk kelompok Overdue dan memicu notifikasi."
                  }
                />
              </Label>
              <Input
                id="tf-due"
                type={type === "meeting" ? "datetime-local" : "date"}
                step={type === "meeting" ? 300 : undefined}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={saving}
                aria-label={type === "meeting" ? "Tanggal dan jam meeting" : "Tanggal tenggat tugas"}
              />
            </div>
          </div>

          {/* Assignee multi (chip cloud) */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              Assignee * <FieldHintInLabel tip="Klik nama anggota tim yang mengerjakan. Bisa lebih dari satu — nama pertama jadi penanggung jawab utama. Semua assignee melihat task ini di daftar “Tugas saya”." />
              <span className="font-normal text-zinc-400">— pilih minimal satu</span>
            </Label>
            {users === null ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-zinc-400">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Memuat anggota tim…
              </p>
            ) : users.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-zinc-400">
                Tidak ada anggota tim yang bisa ditugaskan.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {users.map((u) => {
                  const selected = assignees.includes(u.name);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleAssignee(u.name)}
                      disabled={saving}
                      aria-pressed={selected}
                      aria-label={`Pilih assignee ${u.name}`}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs font-medium transition-colors",
                        selected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
                      )}
                    >
                      <span
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: selected ? "rgba(255,255,255,0.25)" : u.avatarColor }}
                        aria-hidden="true"
                      >
                        {initials(u.name)}
                      </span>
                      <span className="truncate">{u.name}</span>
                      {selected ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
            {assignees.length > 0 ? (
              <p className="text-[11px] text-zinc-400">
                {assignees.length} assignee dipilih — penanggung jawab utama: {assignees[0]}
              </p>
            ) : null}
          </div>

          {/* Opportunity (wajib) */}
          <div className="space-y-1.5">
            <Label htmlFor="tf-opp-trigger" className="flex items-center gap-1">
              Opportunity * <FieldHintInLabel tip="Tugas selalu terhubung ke satu peluang di pipeline — konteks brand, kontak, dan percakapan diambil dari sini. Cari berdasarkan judul." />
            </Label>
            {lockedOpportunity ? (
              <div
                className="flex items-center gap-2 rounded-lg border bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                aria-label={`Opportunity terkunci: ${lockedOpportunity.title}`}
              >
                <FileText className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-[11px] uppercase tracking-wide text-zinc-400">Opportunity: </span>
                  <span className="font-medium">{lockedOpportunity.title}</span>
                </span>
              </div>
            ) : (
              <Popover open={oppOpen} onOpenChange={setOppOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="tf-opp-trigger"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={oppOpen}
                    className="w-full justify-between font-normal"
                    disabled={saving}
                  >
                    <span className={cn("truncate", !opportunity && "text-zinc-400")}>
                      {opportunity ? oppLabel : "Pilih opportunity terkait…"}
                    </span>
                    <Search className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Cari judul opportunity…"
                      value={oppQuery}
                      onValueChange={setOppQuery}
                    />
                    <CommandList className="max-h-56">
                      {oppLoading && oppOptions.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 p-4 text-xs text-zinc-400">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Memuat…
                        </div>
                      ) : oppOptions.length === 0 && !oppLoading ? (
                        <CommandEmpty>Tidak ada opportunity ditemukan.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {oppOptions.map((o) => (
                            <CommandItem
                              key={o.id}
                              value={o.id}
                              onSelect={() => {
                                setOpportunity(o);
                                setOppOpen(false);
                              }}
                              className="cursor-pointer"
                            >
                              <Check
                                className={cn("mr-2 size-4 shrink-0", opportunity?.id === o.id ? "opacity-100" : "opacity-0")}
                                aria-hidden="true"
                              />
                              <span className="min-w-0 truncate">
                                {o.title}
                                {o.brandName ? <span className="text-zinc-400"> — {o.brandName}</span> : null}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Deskripsi */}
          <div className="space-y-1.5">
            <Label htmlFor="tf-desc" className="flex items-center gap-1">
              Deskripsi <FieldHintInLabel tip="Detail pekerjaan: ekspektasi hasil, catatan untuk assignee, referensi materi, dsb. (opsional)." />
            </Label>
            <Textarea
              id="tf-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detail pekerjaan, catatan untuk assignee, dst. (opsional)"
              disabled={saving}
            />
          </div>

          {/* Lampiran */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              Lampiran <FieldHintInLabel tip="Tautan referensi (Google Drive, Figma, dsb.) atau file pendukung maksimal 5 MB per file, total maksimal 5 lampiran." />
              <span className="font-normal text-zinc-400">— maks {MAX_ATTACHMENTS}, file ≤5 MB</span>
            </Label>
            {attachments.length > 0 ? (
              <ul className="space-y-1.5">
                {attachments.map((a, idx) => (
                  <li
                    key={`${a.type}-${a.name}-${idx}`}
                    className="flex items-center gap-2 rounded-lg border bg-zinc-50 px-2.5 py-1.5 text-xs"
                  >
                    {a.type === "link" ? (
                      <Link2 className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                    ) : (
                      <Paperclip className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-zinc-700" title={a.name}>
                      {a.name}
                    </span>
                    {a.type === "file" ? (
                      <span className="shrink-0 text-zinc-400">{formatFileSize(a.size)}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={saving}
                      className="rounded p-0.5 text-zinc-400 transition-colors hover:text-rose-600"
                      aria-label={`Hapus lampiran ${a.name}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {linkRowOpen ? (
              <div className="flex items-center gap-2">
                <Input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://tautan-pendukung.id/dokumen"
                  aria-label="URL tautan lampiran"
                  disabled={saving}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmLink();
                    }
                  }}
                  autoFocus
                />
                <Button type="button" size="sm" onClick={confirmLink} disabled={saving || !linkUrl.trim()}>
                  Tambah
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-zinc-400"
                  onClick={() => {
                    setLinkRowOpen(false);
                    setLinkUrl("");
                  }}
                  aria-label="Batal tambah tautan"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLinkRowOpen(true)}
                  disabled={saving || attachments.length >= MAX_ATTACHMENTS}
                >
                  <Link2 className="size-3.5" aria-hidden="true" />
                  Tambah Tautan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving || readingFile || attachments.length >= MAX_ATTACHMENTS}
                >
                  {readingFile ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Paperclip className="size-3.5" aria-hidden="true" />
                  )}
                  Tambah File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    handleFileChosen(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                  aria-hidden="true"
                  tabIndex={-1}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button
            className="bg-zinc-900 hover:bg-zinc-800"
            onClick={() => void submit()}
            disabled={saving || !canSubmit || readingFile}
            aria-label={isEdit ? "Simpan perubahan tugas" : "Simpan tugas baru"}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {saving ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Buat Tugas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
