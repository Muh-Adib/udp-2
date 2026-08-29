"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Globe,
  Instagram,
  Loader2,
  LayoutDashboard,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Sparkles,
  StickyNote,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import { CHANNELS, LOST_REASONS, PIPELINE_STAGES, stageColor, stageLabel } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import { formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ---------- Types ----------

type DetailData = Awaited<ReturnType<typeof api.opportunity>>["opportunity"];
type RelatedOpp = Awaited<ReturnType<typeof api.opportunity>>["related"][number];
type TaskRow = DetailData["tasks"][number];
type InteractionRow = DetailData["interactions"][number];

type NoteItem = {
  id: string;
  body: string;
  author: string;
  type: string;
  createdAt: string;
};

export interface OpportunityDetailProps {
  opportunityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dipanggil saat data berubah (stage, cross-sell) agar list di parent ikut segar. */
  onChanged?: () => void;
}

// ---------- Ikon kanal ----------

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  email: Mail,
  instagram: Instagram,
  website: Globe,
  phone: Phone,
  meeting: Video,
  portal: LayoutDashboard,
  note: StickyNote,
};

/** Wrapper stabil agar ikon kanal tidak dianggap komponen yang dibuat saat render. */
function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  const Ic = CHANNEL_ICONS[channel] ?? MessageSquare;
  return <Ic className={className} aria-hidden="true" />;
}

function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}

// ---------- Helper kecil ----------

const AI_LABELS: Record<string, string> = {
  RINGKASAN: "Ringkasan",
  SENTIMEN: "Sentimen",
  "NEXT-BEST-ACTION": "Next-best-action",
  RISIKO: "Risiko",
};

function parseAiSummary(text: string): { label: string; body: string }[] {
  const sections: { label: string; body: string }[] = [];
  let current: { label: string; body: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, "").trim();
    if (!line) {
      if (current) current.body += "\n";
      continue;
    }
    const key = Object.keys(AI_LABELS).find((k) => line.toUpperCase().startsWith(k));
    if (key) {
      if (current) sections.push(current);
      const rest = line.slice(key.length).replace(/^[:\-\u2013\s]+/, "");
      current = { label: AI_LABELS[key], body: rest };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isPastDate(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() < startOfToday();
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="truncate text-sm font-medium text-zinc-800">{children}</p>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const color = stageColor(stage);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {stageLabel(stage)}
    </span>
  );
}

function BrandBadge({ brand }: { brand?: DetailData["brand"] | RelatedOpp["brand"] }) {
  if (!brand) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2 py-0.5 text-xs font-medium text-zinc-700">
      <span className="size-2 rounded-full" style={{ backgroundColor: brand.color }} />
      {brand.name}
    </span>
  );
}

function TemperatureBadge({ temperature }: { temperature: string }) {
  const dot =
    temperature === "hot" ? "bg-red-600" : temperature === "warm" ? "bg-amber-500" : "bg-cyan-600";
  const label = temperature.charAt(0).toUpperCase() + temperature.slice(1);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

// ---------- Komponen kecil: bubble timeline ----------

function TimelineBubble({ item }: { item: InteractionRow }) {
  const outbound = item.direction === "outbound";
  return (
    <div className={cn("flex w-full", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm",
          outbound ? "rounded-tr-sm bg-zinc-900 text-white" : "rounded-tl-sm border bg-zinc-100 text-zinc-800"
        )}
      >
        <div
          className={cn(
            "mb-1 flex flex-wrap items-center gap-1.5 text-[11px]",
            outbound ? "text-white/60" : "text-zinc-500"
          )}
        >
          <ChannelIcon channel={item.channel} className="size-3.5" />
          <span className="font-medium">{channelLabel(item.channel)}</span>
          <span aria-hidden="true">•</span>
          <span>{formatDateTime(item.createdAt)}</span>
          <span aria-hidden="true">•</span>
          <span className="truncate">{item.senderName ?? "Tanpa nama"}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
      </div>
    </div>
  );
}

// ---------- Komponen utama ----------

export default function OpportunityDetail({ opportunityId, open, onOpenChange, onChanged }: OpportunityDetailProps) {
  const { user, brands } = useCrmStore();

  const [activeId, setActiveId] = useState<string | null>(opportunityId);
  const [data, setData] = useState<DetailData | null>(null);
  const [related, setRelated] = useState<RelatedOpp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI summary
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Form kirim pesan
  const [msgChannel, setMsgChannel] = useState<string>("whatsapp");
  const [msgContent, setMsgContent] = useState("");
  const [sending, setSending] = useState(false);

  // Task cepat
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskSaving, setTaskSaving] = useState(false);

  // Catatan
  const [noteType, setNoteType] = useState<"internal" | "director_feedback">("internal");
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Footer stage
  const [stageSelect, setStageSelect] = useState<string>("");
  const [savingStage, setSavingStage] = useState(false);

  // Dialog lost
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [competitor, setCompetitor] = useState("");

  // Dialog cross-sell
  const [crossOpen, setCrossOpen] = useState(false);
  const [crossBrand, setCrossBrand] = useState("");
  const [crossTitle, setCrossTitle] = useState("");
  const [crossValue, setCrossValue] = useState("");
  const [crossSaving, setCrossSaving] = useState(false);

  // Sinkron saat parent mengganti opportunity
  useEffect(() => {
    setActiveId(opportunityId);
  }, [opportunityId]);

  const load = useCallback(async () => {
    if (!activeId || !open) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.opportunity(activeId);
      setData(res.opportunity);
      setRelated(res.related);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat detail opportunity");
    } finally {
      setLoading(false);
    }
  }, [activeId, open]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset state turunan ketika opportunity berubah / data baru masuk
  useEffect(() => {
    setStageSelect(data?.stage ?? "");
    setAiText(null);
    setAiError(null);
    setMsgContent("");
    setTaskTitle("");
    setTaskDue("");
    setNoteText("");
  }, [data?.id, data?.stage]);

  const actorMeta = useMemo(
    () => ({ actorName: user?.name ?? "System", actorRole: user?.role ?? "system" }),
    [user?.name, user?.role]
  );

  const notesMerged: NoteItem[] = useMemo(() => {
    if (!data) return [];
    const fromNotes: NoteItem[] = data.notes.map((n) => ({
      id: `note-${n.id}`,
      body: n.body,
      author: n.authorName,
      type: n.type,
      createdAt: n.createdAt,
    }));
    const fromInteractions: NoteItem[] = data.interactions
      .filter((i) => i.channel === "note")
      .map((i) => ({
        id: `int-${i.id}`,
        body: i.content,
        author: i.senderName ?? "System",
        type: i.subject === "director_feedback" ? "director_feedback" : "internal",
        createdAt: i.createdAt,
      }));
    return [...fromNotes, ...fromInteractions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [data]);

  const timeline = useMemo(
    () => (data?.interactions ?? []).filter((i) => i.channel !== "note"),
    [data]
  );

  // ---------- Aksi ----------

  async function runAi() {
    if (!activeId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await api.aiSummary(activeId);
      setAiText(res.summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal membuat ringkasan AI";
      setAiError(msg);
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  }

  async function sendMessage() {
    if (!data || !activeId) return;
    if (!msgContent.trim()) {
      toast.error("Pesan tidak boleh kosong");
      return;
    }
    setSending(true);
    try {
      await api.createInteraction({
        opportunityId: activeId,
        direction: "outbound",
        channel: msgChannel,
        content: msgContent.trim(),
        senderName: user?.name ?? "System",
        respondedBy: user?.name ?? "System",
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
        contactId: data.contactId,
        companyId: data.companyId,
        brandId: data.brandId,
      });
      toast.success("Pesan terkirim dan tercatat di timeline");
      setMsgContent("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim pesan");
    } finally {
      setSending(false);
    }
  }

  async function toggleTask(task: TaskRow, done: boolean) {
    try {
      await api.updateTask(task.id, { status: done ? "done" : "open" });
      setData((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) =>
                t.id === task.id
                  ? { ...t, status: done ? "done" : "open", completedAt: done ? new Date().toISOString() : null }
                  : t
              ),
            }
          : prev
      );
      toast.success(done ? "Tugas ditandai selesai" : "Tugas dibuka kembali");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memperbarui tugas");
      await load();
    }
  }

  async function addTask() {
    if (!activeId) return;
    if (!taskTitle.trim()) {
      toast.error("Judul tugas wajib diisi");
      return;
    }
    setTaskSaving(true);
    try {
      await api.createTask({
        title: taskTitle.trim(),
        dueDate: taskDue || undefined,
        opportunityId: activeId,
        assigneeName: user?.name ?? null,
        priority: "medium",
        type: "follow_up",
        ...actorMeta,
      });
      toast.success("Tugas ditambahkan");
      setTaskTitle("");
      setTaskDue("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menambah tugas");
    } finally {
      setTaskSaving(false);
    }
  }

  async function addNote() {
    if (!data || !activeId) return;
    if (!noteText.trim()) {
      toast.error("Catatan tidak boleh kosong");
      return;
    }
    setNoteSaving(true);
    try {
      await api.createInteraction({
        opportunityId: activeId,
        channel: "note",
        direction: "outbound",
        content: noteText.trim(),
        subject: noteType,
        senderName: user?.name ?? "System",
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
        contactId: data.contactId,
        companyId: data.companyId,
        brandId: data.brandId,
      });
      toast.success("Catatan disimpan");
      setNoteText("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan catatan");
    } finally {
      setNoteSaving(false);
    }
  }

  async function commitStage(stage: string, extra?: Record<string, unknown>) {
    if (!activeId) return;
    setSavingStage(true);
    try {
      const res = await api.updateOpportunity(activeId, { stage, ...extra, ...actorMeta });
      if (stage === "won") {
        toast.success(
          res.createdProject
            ? `Deal Won! Project ${res.createdProject.code} otomatis dibuat beserta invoice DP`
            : "Stage diubah ke Won"
        );
      } else {
        toast.success(`Stage diubah ke ${stageLabel(stage)}`);
      }
      setLostOpen(false);
      setLostReason("");
      setLostNotes("");
      setCompetitor("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan stage");
    } finally {
      setSavingStage(false);
    }
  }

  function handleSaveStage() {
    if (!data || !stageSelect) return;
    if (stageSelect === data.stage) {
      toast.info("Stage sudah sama, tidak ada perubahan");
      return;
    }
    if (stageSelect === "lost") {
      setLostOpen(true);
      return;
    }
    void commitStage(stageSelect);
  }

  async function createCrossSell() {
    if (!data || !activeId) return;
    if (!crossBrand || !crossTitle.trim()) {
      toast.error("Brand dan judul cross-sell wajib diisi");
      return;
    }
    setCrossSaving(true);
    try {
      await api.createOpportunity({
        title: crossTitle.trim(),
        brandId: crossBrand,
        contactId: data.contactId,
        companyId: data.companyId,
        estimatedValue: crossValue ? Number(crossValue) : undefined,
        leadSource: "cross_sell",
        crossSellOfId: activeId,
        ownerName: user?.name ?? null,
        ...actorMeta,
      });
      toast.success("Opportunity cross-sell berhasil dibuat");
      setCrossOpen(false);
      setCrossBrand("");
      setCrossTitle("");
      setCrossValue("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat cross-sell");
    } finally {
      setCrossSaving(false);
    }
  }

  // ---------- Render ----------

  return (
    <>
      <Sheet open={open && !!activeId} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          {loading && !data ? (
            <div className="flex-1 space-y-4 p-4">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-64 rounded-xl" />
            </div>
          ) : error && !data ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <MessageSquare className="size-8 text-zinc-300" aria-hidden="true" />
              <p className="text-sm font-medium text-zinc-700">Gagal memuat detail</p>
              <p className="text-xs text-zinc-500">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Coba lagi
              </Button>
            </div>
          ) : data ? (
            <>
              <SheetHeader className="border-b pr-12">
                <div className="flex flex-wrap items-center gap-1.5">
                  <BrandBadge brand={data.brand} />
                  <StageBadge stage={data.stage} />
                </div>
                <SheetTitle className="text-base leading-snug">{data.title}</SheetTitle>
                <SheetDescription>
                  {data.company?.name ?? "Tanpa perusahaan"} · {data.contact?.fullName ?? "Tanpa contact"}
                  {data.serviceName ? ` · ${data.serviceName}` : ""}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto p-4 crm-scroll">
                {/* Ringkasan singkat */}
                <div className="grid grid-cols-2 gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-4">
                  <Meta label="Nilai">{formatCurrencyFull(data.estimatedValue, data.currency)}</Meta>
                  <Meta label="Probability">{data.probability}%</Meta>
                  <Meta label="Expected Close">
                    <span className={cn(isPastDate(data.expectedCloseDate) && data.stage !== "won" && data.stage !== "lost" && "text-red-600")}>
                      {formatDate(data.expectedCloseDate)}
                    </span>
                  </Meta>
                  <Meta label="Owner">{data.ownerName ?? "Belum di-assign"}</Meta>
                  <Meta label="Prioritas">
                    <span className="capitalize">{data.priority}</span>
                  </Meta>
                  <Meta label="Temperatur">
                    <TemperatureBadge temperature={data.temperature} />
                  </Meta>
                  <Meta label="Sumber">{data.leadSource ?? "-"}</Meta>
                  <Meta label="Target Deadline">{formatDate(data.targetDeadline)}</Meta>
                </div>

                {data.lostReason ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <span className="font-semibold">Alasan lost:</span> {data.lostReason}
                    {data.competitor ? ` · Kompetitor: ${data.competitor}` : ""}
                    {data.lostNotes ? <p className="mt-1 text-red-600/80">{data.lostNotes}</p> : null}
                  </div>
                ) : null}

                {data.brief ? (
                  <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Brief</p>
                    <p className="whitespace-pre-wrap">{data.brief}</p>
                  </div>
                ) : null}

                {/* Tombol AI */}
                <div className="mt-4 flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-400">Asisten AI meringkas riwayat percakapan lead.</p>
                  <Button size="sm" variant="outline" onClick={() => void runAi()} disabled={aiLoading}>
                    {aiLoading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="size-4" aria-hidden="true" />
                    )}
                    Ringkas dengan AI
                  </Button>
                </div>

                {aiLoading ? (
                  <div className="mt-2 space-y-2 rounded-xl border bg-white p-4 shadow-sm">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : aiError ? (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{aiError}</div>
                ) : aiText ? (
                  <div className="mt-2 space-y-2 rounded-xl border bg-zinc-50 p-4">
                    {parseAiSummary(aiText).length > 0 ? (
                      parseAiSummary(aiText).map((s) => (
                        <p key={s.label} className="text-sm leading-relaxed text-zinc-700">
                          <span className="font-semibold text-zinc-900">{s.label}:</span>{" "}
                          <span className="whitespace-pre-wrap">{s.body}</span>
                        </p>
                      ))
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{aiText}</p>
                    )}
                  </div>
                ) : null}

                {/* Tabs */}
                <Tabs defaultValue="timeline" className="mt-5">
                  <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="tasks">Tugas</TabsTrigger>
                    <TabsTrigger value="notes">Catatan</TabsTrigger>
                    <TabsTrigger value="related">Terkait</TabsTrigger>
                  </TabsList>

                  {/* Timeline */}
                  <TabsContent value="timeline" className="mt-3">
                    <div className="crm-scroll flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
                      {timeline.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-zinc-400">
                          Belum ada percakapan pada opportunity ini.
                        </p>
                      ) : (
                        timeline.map((item) => <TimelineBubble key={item.id} item={item} />)
                      )}
                    </div>
                    <div className="mt-4 rounded-xl border bg-white p-3 shadow-sm">
                      <Textarea
                        rows={3}
                        value={msgContent}
                        onChange={(e) => setMsgContent(e.target.value)}
                        placeholder="Tulis pesan tindak lanjut..."
                        aria-label="Pesan tindak lanjut"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <Select value={msgChannel} onValueChange={setMsgChannel}>
                          <SelectTrigger size="sm" className="w-40" aria-label="Kanal pesan">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CHANNELS.map((c) => (
                              <SelectItem key={c.key} value={c.key}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="ml-auto bg-zinc-900 hover:bg-zinc-800"
                          onClick={() => void sendMessage()}
                          disabled={sending || !msgContent.trim()}
                        >
                          {sending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Send className="size-4" aria-hidden="true" />
                          )}
                          Kirim
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Tugas */}
                  <TabsContent value="tasks" className="mt-3">
                    <ul className="crm-scroll flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                      {data.tasks.length === 0 ? (
                        <li className="rounded-xl border border-dashed p-6 text-center text-sm text-zinc-400">
                          Belum ada tugas terkait opportunity ini.
                        </li>
                      ) : (
                        data.tasks.map((task) => {
                          const done = task.status === "done";
                          const overdue = !!task.dueDate && !done && isPastDate(task.dueDate);
                          return (
                            <li
                              key={task.id}
                              className="flex items-start gap-3 rounded-xl border bg-white p-3 shadow-sm"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={done}
                                onCheckedChange={(v) => void toggleTask(task, v === true)}
                                aria-label={`Tandai tugas ${task.title} selesai`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className={cn("text-sm font-medium text-zinc-800", done && "text-zinc-400 line-through")}>
                                  {task.title}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "px-1.5 py-0 text-[10px] capitalize",
                                      task.priority === "urgent" && "border-red-200 bg-red-50 text-red-700",
                                      task.priority === "high" && "border-amber-200 bg-amber-50 text-amber-700"
                                    )}
                                  >
                                    {task.priority}
                                  </Badge>
                                  {task.assigneeName ? <span>{task.assigneeName}</span> : null}
                                  {task.dueDate ? (
                                    <span className={cn(overdue && "font-medium text-red-600")}>
                                      Jatuh tempo {formatDate(task.dueDate)}
                                      {overdue ? " · terlambat" : ""}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                    <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-white p-3 shadow-sm sm:flex-row">
                      <Input
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Tugas cepat, mis. Kirim proposal revisi"
                        aria-label="Judul tugas baru"
                        className="flex-1"
                      />
                      <Input
                        type="date"
                        value={taskDue}
                        onChange={(e) => setTaskDue(e.target.value)}
                        aria-label="Tanggal jatuh tempo tugas"
                        className="sm:w-40"
                      />
                      <Button
                        size="sm"
                        className="bg-zinc-900 hover:bg-zinc-800"
                        onClick={() => void addTask()}
                        disabled={taskSaving || !taskTitle.trim()}
                      >
                        {taskSaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Plus className="size-4" aria-hidden="true" />
                        )}
                        Tambah
                      </Button>
                    </div>
                  </TabsContent>

                  {/* Catatan */}
                  <TabsContent value="notes" className="mt-3">
                    <ul className="crm-scroll flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                      {notesMerged.length === 0 ? (
                        <li className="rounded-xl border border-dashed p-6 text-center text-sm text-zinc-400">
                          Belum ada catatan internal.
                        </li>
                      ) : (
                        notesMerged.map((n) => (
                          <li key={n.id} className="rounded-xl border bg-white p-3 shadow-sm">
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                              {n.type === "director_feedback" ? (
                                <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">Feedback Direktur</Badge>
                              ) : (
                                <Badge variant="secondary">Internal</Badge>
                              )}
                              <span className="font-medium text-zinc-700">{n.author}</span>
                              <span>{formatDateTime(n.createdAt)}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-zinc-700">{n.body}</p>
                          </li>
                        ))
                      )}
                    </ul>
                    <div className="mt-3 space-y-2 rounded-xl border bg-white p-3 shadow-sm">
                      <Textarea
                        rows={3}
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Tulis catatan internal untuk tim..."
                        aria-label="Catatan baru"
                      />
                      <div className="flex items-center gap-2">
                        <Select value={noteType} onValueChange={(v) => setNoteType(v === "director_feedback" ? "director_feedback" : "internal")}>
                          <SelectTrigger size="sm" className="w-44" aria-label="Tipe catatan">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="internal">Catatan internal</SelectItem>
                            <SelectItem value="director_feedback">Feedback Direktur</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          className="ml-auto bg-zinc-900 hover:bg-zinc-800"
                          onClick={() => void addNote()}
                          disabled={noteSaving || !noteText.trim()}
                        >
                          {noteSaving ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <StickyNote className="size-4" aria-hidden="true" />
                          )}
                          Simpan Catatan
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Terkait */}
                  <TabsContent value="related" className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {related.length === 0 ? (
                        <p className="w-full rounded-xl border border-dashed p-6 text-center text-sm text-zinc-400">
                          Belum ada opportunity lain untuk perusahaan ini.
                        </p>
                      ) : (
                        related.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setActiveId(r.id)}
                            className="inline-flex max-w-full items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50"
                            aria-label={`Buka detail ${r.title}`}
                          >
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: r.brand?.color ?? "#a1a1aa" }} />
                            <span className="max-w-[180px] truncate">{r.title}</span>
                            <StageBadge stage={r.stage} />
                          </button>
                        ))
                      )}
                    </div>
                    {data.company ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-4"
                        onClick={() => setCrossOpen(true)}
                      >
                        <ArrowLeftRight className="size-4" aria-hidden="true" />
                        Buat Cross-sell
                      </Button>
                    ) : null}
                  </TabsContent>
                </Tabs>
              </div>

              <SheetFooter className="flex-row items-center gap-2 border-t">
                <Select value={stageSelect} onValueChange={setStageSelect}>
                  <SelectTrigger className="flex-1" aria-label="Pindah stage">
                    <SelectValue placeholder="Pindah stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="bg-zinc-900 hover:bg-zinc-800"
                  onClick={handleSaveStage}
                  disabled={savingStage || !stageSelect || stageSelect === data.stage}
                >
                  {savingStage ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  Simpan
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Dialog konfirmasi lost (dari footer stage) */}
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pindah ke Lost</DialogTitle>
            <DialogDescription>
              Pilih alasan mengapa opportunity ini tidak berhasil. Alasan wajib diisi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={lostReason} onValueChange={setLostReason}>
              <SelectTrigger className="w-full" aria-label="Alasan lost">
                <SelectValue placeholder="Pilih alasan lost" />
              </SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={competitor}
              onChange={(e) => setCompetitor(e.target.value)}
              placeholder="Nama kompetitor (opsional)"
              aria-label="Nama kompetitor"
            />
            <Textarea
              rows={3}
              value={lostNotes}
              onChange={(e) => setLostNotes(e.target.value)}
              placeholder="Catatan tambahan (opsional)"
              aria-label="Catatan lost"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>
              Batal
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              disabled={!lostReason || savingStage}
              onClick={() => void commitStage("lost", {
                lostReason,
                lostNotes: lostNotes.trim() || undefined,
                competitor: competitor.trim() || undefined,
              })}
            >
              {savingStage ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Tandai Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog mini cross-sell */}
      <Dialog open={crossOpen} onOpenChange={setCrossOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Cross-sell</DialogTitle>
            <DialogDescription>
              Buat opportunity baru di brand lain untuk perusahaan {data?.company?.name ?? "-"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={crossBrand} onValueChange={setCrossBrand}>
              <SelectTrigger className="w-full" aria-label="Brand cross-sell">
                <SelectValue placeholder="Pilih brand lain" />
              </SelectTrigger>
              <SelectContent>
                {brands
                  .filter((b) => b.id !== data?.brandId)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              value={crossTitle}
              onChange={(e) => setCrossTitle(e.target.value)}
              placeholder={`Judul cross-sell, mis. ${data?.serviceName ?? "Layanan"} untuk ${data?.company?.name ?? "klien"}`}
              aria-label="Judul cross-sell"
            />
            <Input
              type="number"
              min={0}
              value={crossValue}
              onChange={(e) => setCrossValue(e.target.value)}
              placeholder="Nilai estimasi (opsional)"
              aria-label="Nilai estimasi cross-sell"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrossOpen(false)}>
              Batal
            </Button>
            <Button
              className="bg-zinc-900 hover:bg-zinc-800"
              onClick={() => void createCrossSell()}
              disabled={crossSaving || !crossBrand || !crossTitle.trim()}
            >
              {crossSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Buat Cross-sell
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
