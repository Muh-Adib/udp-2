"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Inbox,
  KanbanSquare,
  Search,
  Table2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import OpportunityDetail from "@/components/crm/opportunity-detail";
import { api } from "@/lib/crm/api-client";
import { LOST_REASONS, OPEN_STAGES, stageColor, stageLabel } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type { OpportunityDTO } from "@/lib/crm/types";
import { formatCurrency, formatDate, initials, timeAgo } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ---------- Konstanta tampilan ----------

const KANBAN_KEYS: string[] = [...OPEN_STAGES, "won", "lost", "nurture"];
const TERMINAL_STAGES = ["won", "lost", "nurture"];
const UNASSIGNED = "__unassigned";

type ViewMode = "kanban" | "table";
type SortDir = "asc" | "desc" | null;

interface LostExtra {
  lostReason: string;
  lostNotes?: string;
  competitor?: string;
}

// ---------- Helper ----------

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isOverdue(opp: OpportunityDTO): boolean {
  if (!opp.nextActionDate || TERMINAL_STAGES.includes(opp.stage)) return false;
  return new Date(opp.nextActionDate).getTime() < startOfToday();
}

function priorityChip(priority: string): string {
  if (priority === "urgent") return "bg-red-100 text-red-700";
  if (priority === "high") return "bg-amber-100 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

function temperatureDot(temperature: string): string {
  if (temperature === "hot") return "bg-red-600";
  if (temperature === "warm") return "bg-amber-500";
  return "bg-cyan-600";
}

function companyOf(opp: OpportunityDTO): string {
  return opp.company?.name ?? opp.contact?.company?.name ?? "Tanpa perusahaan";
}

// ---------- Kartu opportunity (draggable) ----------

function OppCard({ opp, onOpen }: { opp: OpportunityDTO; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opp.id });
  const overdue = isOverdue(opp);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`Buka detail ${opp.title}`}
      onClick={() => onOpen(opp.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(opp.id);
        }
      }}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "cursor-grab touch-none rounded-xl border bg-white p-3 shadow-sm outline-none transition-colors hover:border-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-900/20 active:cursor-grabbing",
        isDragging && "z-10 rotate-1 opacity-70 ring-2 ring-zinc-900/20"
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{companyOf(opp)}</p>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            priorityChip(opp.priority)
          )}
        >
          {opp.priority}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-zinc-500">{opp.title}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {opp.serviceName ? (
          <span className="max-w-full truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
            {opp.serviceName}
          </span>
        ) : null}
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700">
          {formatCurrency(opp.estimatedValue, opp.currency)} · {opp.probability}%
        </span>
        {opp.stage === "lost" && opp.lostReason ? (
          <span className="max-w-full truncate rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-600">
            {opp.lostReason}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", temperatureDot(opp.temperature))}
          title={`Temperatur: ${opp.temperature}`}
        />
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-700"
          title={`Owner: ${opp.ownerName ?? "Belum di-assign"}`}
        >
          {initials(opp.ownerName)}
        </span>
        {overdue ? (
          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
            Overdue
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400">{timeAgo(opp.updatedAt)}</span>
      </div>
    </div>
  );
}

// ---------- Kolom stage (droppable) ----------

function StageColumn({
  stageKey,
  opportunities,
  onOpen,
}: {
  stageKey: string;
  opportunities: OpportunityDTO[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });
  const color = stageColor(stageKey);
  const total = opportunities.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-xl border bg-zinc-50 transition-colors",
        isOver && "bg-zinc-200/50"
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-zinc-600">
          {stageLabel(stageKey)}
        </h3>
        <Badge variant="secondary" className="px-1.5 text-[11px]">
          {opportunities.length}
        </Badge>
      </div>
      <p className="px-3 pt-1.5 text-[11px] text-zinc-400">{formatCurrency(total)}</p>
      <div className="crm-scroll flex max-h-[600px] flex-col gap-2 overflow-y-auto p-2">
        {opportunities.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-[11px] text-zinc-400">
            Kosong
          </p>
        ) : (
          opportunities.map((opp) => <OppCard key={opp.id} opp={opp} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

// ---------- Tabel opportunity ----------

function OpportunityTable({
  rows,
  sortDir,
  onToggleSort,
  onOpen,
}: {
  rows: OpportunityDTO[];
  sortDir: SortDir;
  onToggleSort: () => void;
  onOpen: (id: string) => void;
}) {
  const color = stageColor;
  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[220px]">Judul / Perusahaan</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead>Layanan</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-7 font-medium"
                onClick={onToggleSort}
                aria-label="Urutkan berdasarkan nilai"
              >
                Nilai
                {sortDir === "asc" ? (
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                ) : sortDir === "desc" ? (
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowUpDown className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </TableHead>
            <TableHead>Prob.</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Expected Close</TableHead>
            <TableHead className="min-w-[180px]">Next Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((opp) => {
            const brandColor = opp.brand?.color ?? "#a1a1aa";
            const closeOverdue =
              !!opp.expectedCloseDate &&
              !TERMINAL_STAGES.includes(opp.stage) &&
              new Date(opp.expectedCloseDate).getTime() < startOfToday();
            return (
              <TableRow
                key={opp.id}
                className="cursor-pointer"
                onClick={() => onOpen(opp.id)}
              >
                <TableCell>
                  <button
                    type="button"
                    className="max-w-[260px] text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(opp.id);
                    }}
                    aria-label={`Buka detail ${opp.title}`}
                  >
                    <span className="block truncate font-medium text-zinc-900 hover:underline">{opp.title}</span>
                    <span className="block truncate text-xs text-zinc-500">{companyOf(opp)}</span>
                  </button>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-zinc-700">
                    <span className="size-2 rounded-full" style={{ backgroundColor: brandColor }} />
                    {opp.brand?.name ?? "-"}
                  </span>
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-sm text-zinc-600">
                  {opp.serviceName ?? "-"}
                </TableCell>
                <TableCell>
                  <span
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: `${color(opp.stage)}1f`, color: color(opp.stage) }}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: color(opp.stage) }} />
                    {stageLabel(opp.stage)}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm font-medium text-zinc-800">
                  {formatCurrency(opp.estimatedValue, opp.currency)}
                </TableCell>
                <TableCell className="text-sm text-zinc-600">{opp.probability}%</TableCell>
                <TableCell>
                  {opp.ownerName ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-zinc-700">
                      <span className="flex size-5 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-700">
                        {initials(opp.ownerName)}
                      </span>
                      {opp.ownerName}
                    </span>
                  ) : (
                    <span className="text-xs italic text-zinc-400">Belum di-assign</span>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    "whitespace-nowrap text-sm",
                    closeOverdue ? "font-medium text-red-600" : "text-zinc-600"
                  )}
                >
                  {formatDate(opp.expectedCloseDate)}
                </TableCell>
                <TableCell>
                  {opp.nextAction ? (
                    <div className="max-w-[200px]">
                      <p className="truncate text-sm text-zinc-700">{opp.nextAction}</p>
                      {opp.nextActionDate ? (
                        <p className={cn("text-xs", isOverdue(opp) ? "text-rose-600" : "text-zinc-400")}>
                          {formatDate(opp.nextActionDate)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">-</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------- Dialog alasan lost ----------

function LostReasonDialog({
  open,
  saving,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  onConfirm: (extra: LostExtra) => void;
  onCancel: () => void;
}) {
  const [lostReason, setLostReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [competitor, setCompetitor] = useState("");

  function resetAndClose() {
    setLostReason("");
    setLostNotes("");
    setCompetitor("");
    onCancel();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && resetAndClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pindah ke Lost</DialogTitle>
          <DialogDescription>
            Pilih alasan mengapa opportunity ini tidak berhasil. Alasan wajib diisi sebelum lanjut.
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
          <Button variant="outline" onClick={resetAndClose}>
            Batal
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={!lostReason || saving}
            onClick={() => {
              const extra: LostExtra = {
                lostReason,
                lostNotes: lostNotes.trim() || undefined,
                competitor: competitor.trim() || undefined,
              };
              setLostReason("");
              setLostNotes("");
              setCompetitor("");
              onConfirm(extra);
            }}
          >
            Tandai Lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Modul utama ----------

export default function PipelineModule() {
  const { user, brands, activeBrandFilter, setActiveBrandFilter } = useCrmStore();

  const [opps, setOpps] = useState<OpportunityDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("kanban");
  const [tempFilter, setTempFilter] = useState<string>("all");
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingLost, setPendingLost] = useState<OpportunityDTO | null>(null);
  const [savingStage, setSavingStage] = useState(false);

  const oppsRef = useRef<OpportunityDTO[]>([]);
  const draggedRecentlyRef = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Debounce pencarian
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const res = await api.opportunities({
          brandId: activeBrandFilter !== "all" ? activeBrandFilter : undefined,
          q: q.trim() ? q.trim() : undefined,
        });
        oppsRef.current = res.opportunities;
        setOpps(res.opportunities);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal memuat opportunity");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [activeBrandFilter, q]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const ownerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const o of opps) {
      if (o.ownerName && o.ownerName.trim()) names.add(o.ownerName.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [opps]);

  const filtered = useMemo(() => {
    if (owner === "all") return opps;
    if (owner === UNASSIGNED) return opps.filter((o) => !o.ownerName || !o.ownerName.trim());
    return opps.filter((o) => o.ownerName === owner);
  }, [opps, owner]);

  const tableRows = useMemo(() => {
    const base = tempFilter === "all" ? filtered : filtered.filter((o) => o.temperature === tempFilter);
    if (!sortDir) return base;
    return [...base].sort((a, b) => {
      const av = a.estimatedValue ?? 0;
      const bv = b.estimatedValue ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, tempFilter, sortDir]);

  const grouped = useMemo(() => {
    const map: Record<string, OpportunityDTO[]> = {};
    for (const key of KANBAN_KEYS) map[key] = [];
    for (const o of filtered) {
      const target = KANBAN_KEYS.includes(o.stage) ? o.stage : null;
      if (target) map[target].push(o);
    }
    return map;
  }, [filtered]);

  function openDetail(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  function toggleSort() {
    setSortDir((prev) => (prev === null ? "desc" : prev === "desc" ? "asc" : null));
  }

  async function moveOpportunity(opp: OpportunityDTO, stage: string, extra?: LostExtra) {
    const snapshot = oppsRef.current;
    const optimistic = snapshot.map((o) => (o.id === opp.id ? { ...o, stage } : o));
    oppsRef.current = optimistic;
    setOpps(optimistic);
    setSavingStage(true);
    try {
      const res = await api.updateOpportunity(opp.id, {
        stage,
        ...(extra ?? {}),
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      if (stage === "won") {
        toast.success(
          res.createdProject
            ? `Deal Won! Project ${res.createdProject.code} otomatis dibuat beserta invoice DP`
            : "Deal ditandai Won"
        );
      } else {
        toast.success(`Stage "${opp.title}" diubah ke ${stageLabel(stage)}`);
      }
      await load({ silent: true });
    } catch (e) {
      oppsRef.current = snapshot;
      setOpps(snapshot);
      toast.error(e instanceof Error ? e.message : "Gagal memperbarui stage");
    } finally {
      setSavingStage(false);
    }
  }

  function handleDragStart() {
    draggedRecentlyRef.current = true;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    window.setTimeout(() => {
      draggedRecentlyRef.current = false;
    }, 250);
    if (!over) return;
    const opp = oppsRef.current.find((o) => o.id === active.id);
    if (!opp) return;
    const targetStage = String(over.id);
    if (!KANBAN_KEYS.includes(targetStage)) return;
    if (targetStage === opp.stage) return;
    if (targetStage === "lost") {
      setPendingLost(opp);
      return;
    }
    void moveOpportunity(opp, targetStage);
  }

  const isEmpty = !loading && filtered.length === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-zinc-900">Sales Pipeline</h1>
        <p className="text-sm text-zinc-500">
          Kelola opportunity lintas brand: kanban drag-and-drop, tabel ringkas, dan detail lengkap.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Cari lead, perusahaan..."
            aria-label="Cari opportunity"
            className="w-full bg-white pl-8"
          />
        </div>

        <Select value={activeBrandFilter} onValueChange={setActiveBrandFilter}>
          <SelectTrigger className="w-full bg-white sm:w-44" aria-label="Filter brand">
            <SelectValue placeholder="Semua Brand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Brand</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: b.color }} />
                  {b.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-full bg-white sm:w-44" aria-label="Filter owner">
            <SelectValue placeholder="Semua Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Owner</SelectItem>
            <SelectItem value={UNASSIGNED}>Belum di-assign</SelectItem>
            {ownerOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {view === "table" ? (
          <Select value={tempFilter} onValueChange={setTempFilter}>
            <SelectTrigger className="w-full bg-white sm:w-40" aria-label="Filter temperatur">
              <SelectValue placeholder="Semua Temperatur" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Temperatur</SelectItem>
              <SelectItem value="hot">Hot</SelectItem>
              <SelectItem value="warm">Warm</SelectItem>
              <SelectItem value="cold">Cold</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="bg-zinc-200/60 text-zinc-700">
            {filtered.length} opportunity
          </Badge>
          <ToggleGroup
            type="single"
            variant="outline"
            value={view}
            onValueChange={(v) => {
              if (v === "kanban" || v === "table") setView(v);
            }}
          >
            <ToggleGroupItem
              value="kanban"
              aria-label="Tampilan Kanban"
              className="data-[state=on]:bg-zinc-900 data-[state=on]:text-white"
            >
              <KanbanSquare className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Kanban</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              aria-label="Tampilan Tabel"
              className="data-[state=on]:bg-zinc-900 data-[state=on]:text-white"
            >
              <Table2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Tabel</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Konten */}
      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[420px] w-[280px] shrink-0 rounded-xl" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-white py-16 text-center shadow-sm">
          <Inbox className="size-10 text-zinc-300" aria-hidden="true" />
          <p className="font-medium text-zinc-700">Belum ada opportunity</p>
          <p className="max-w-sm text-sm text-zinc-500">
            Tidak ada opportunity yang cocok dengan filter saat ini. Coba ubah kata kunci, brand, atau owner.
          </p>
        </div>
      ) : view === "kanban" ? (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            window.setTimeout(() => {
              draggedRecentlyRef.current = false;
            }, 250);
          }}
        >
          <div className="crm-scroll overflow-x-auto pb-2">
            <div className="flex min-w-max gap-3">
              {KANBAN_KEYS.map((key) => (
                <StageColumn
                  key={key}
                  stageKey={key}
                  opportunities={grouped[key] ?? []}
                  onOpen={(id) => {
                    if (draggedRecentlyRef.current) return;
                    openDetail(id);
                  }}
                />
              ))}
            </div>
          </div>
        </DndContext>
      ) : (
        <OpportunityTable
          rows={tableRows}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          onOpen={(id) => {
            if (draggedRecentlyRef.current) return;
            openDetail(id);
          }}
        />
      )}

      {/* Drawer detail */}
      <OpportunityDetail
        opportunityId={selectedId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onChanged={() => void load({ silent: true })}
      />

      {/* Dialog alasan lost (dari drag kanban) */}
      <LostReasonDialog
        open={!!pendingLost}
        saving={savingStage}
        onCancel={() => setPendingLost(null)}
        onConfirm={(extra) => {
          if (!pendingLost) return;
          const opp = pendingLost;
          setPendingLost(null);
          void moveOpportunity(opp, "lost", extra);
        }}
      />
    </div>
  );
}
