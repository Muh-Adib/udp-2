"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Download,
  FileUp,
  Flame,
  Inbox,
  KanbanSquare,
  Loader2,
  Plus,
  Search,
  Table2,
  Upload,
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
import OpportunityFormDialog from "@/components/crm/opportunity-form-dialog";
import { api } from "@/lib/crm/api-client";
import { LOST_REASONS, OPEN_STAGES, stageColor, stageLabel } from "@/lib/crm/constants";
import { scoreTier } from "@/lib/crm/scoring";
import { useCrmStore } from "@/lib/crm/store";
import type {
  ImportOpportunityCommitResponseDTO,
  ImportOpportunityPreviewResponseDTO,
  ImportOpportunityRowDTO,
  OpportunityDTO,
} from "@/lib/crm/types";
import { formatCurrency, formatDate, initials, timeAgo } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ---------- Konstanta tampilan ----------

const KANBAN_KEYS: string[] = [...OPEN_STAGES, "won", "lost", "nurture"];
const TERMINAL_STAGES = ["won", "lost", "nurture"];
const UNASSIGNED = "__unassigned";

type ViewMode = "kanban" | "table";

// ---------- Ekspor CSV opportunity (Task 13): BOM + CRLF + separator titik-koma ----------

const OPP_CSV_HEADERS = [
  "judul", "brand", "perusahaan", "kontak", "kategori_layanan", "layanan",
  "tahap", "temperatur", "prioritas", "skor", "nilai_estimasi", "mata_uang",
  "probabilitas_pct", "owner", "target_close", "aksi_berikutnya", "dibuat",
] as const;

function escapeCsvField(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildOpportunitiesCsv(opps: OpportunityDTO[]): string {
  const lines: string[] = [OPP_CSV_HEADERS.join(";")];
  for (const o of opps) {
    const fields: string[] = [
      o.title,
      o.brand?.name ?? "",
      o.company?.name ?? "",
      o.contact?.fullName ?? "",
      o.serviceCategory ?? "",
      o.serviceName ?? "",
      stageLabel(o.stage),
      o.temperature,
      o.priority,
      String(o.score ?? ""),
      o.estimatedValue != null ? String(o.estimatedValue) : "",
      o.currency,
      String(o.probability),
      o.ownerName ?? "",
      o.expectedCloseDate ? formatDate(o.expectedCloseDate) : "",
      o.nextAction ?? "",
      formatDate(o.createdAt),
    ];
    lines.push(fields.map(escapeCsvField).join(";"));
  }
  return "\uFEFF" + lines.join("\r\n");
}

// ---------- Impor CSV opportunity (Task 15-a): round-trip dengan format ekspor ----------

const OPP_IMPORT_MAX_ROWS = 200;

/** Deteksi separator dari baris pertama: titik koma (hasil ekspor) atau koma. */
function detectCsvSeparator(firstLine: string): string {
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

/** Parser CSV murni (adaptasi contacts-module, tidak diekspor): strip BOM, quoted field dengan escape "", CRLF/LF. */
function parseCsv(text: string): string[][] {
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  const firstNewline = raw.search(/\r?\n/);
  const sep = detectCsvSeparator(firstNewline === -1 ? raw : raw.slice(0, firstNewline));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && raw[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);

  // Lewati baris yang seluruh selnya kosong.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function isOppHeaderRow(cells: string[]): boolean {
  const lower = cells.map((c) => c.trim().toLowerCase());
  return lower.includes("judul") && lower.includes("brand");
}

/** Petakan baris CSV ke baris impor: via header (lowercase) atau urutan kolom ekspor bila tanpa header. */
function mapOpportunityCsvRows(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const known = OPP_CSV_HEADERS as readonly string[];
  const header = isOppHeaderRow(rows[0]);
  const cols = header
    ? rows[0].map((c) => {
        const k = c.trim().toLowerCase();
        return known.includes(k) ? k : null;
      })
    : [...known];
  const body = header ? rows.slice(1) : rows;
  return body.map((cells) => {
    const out: Record<string, string> = {};
    cols.forEach((key, i) => {
      if (key) out[key] = (cells[i] ?? "").trim();
    });
    return out;
  });
}

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

function scoreOf(opp: OpportunityDTO): number {
  return opp.score ?? 0;
}

function isScoreVisible(opp: OpportunityDTO): boolean {
  return opp.stage !== "won" && opp.stage !== "lost";
}

/** Chip skor kecil untuk kartu kanban (ikon Flame + angka, warna tier). */
function ScoreChip({ opp }: { opp: OpportunityDTO }) {
  const score = scoreOf(opp);
  const tier = scoreTier(score);
  const tip = (opp.scoreReasons ?? []).slice(0, 3).join(" · ");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        tier.cls
      )}
      title={tip || `Skor lead ${score}`}
      aria-label={`Skor lead ${score}: ${tier.label}`}
    >
      <Flame className="size-3" aria-hidden="true" />
      {score}
    </span>
  );
}

/** Chip tier + angka skor untuk tabel (tabular-nums). */
function ScoreTierCell({ opp }: { opp: OpportunityDTO }) {
  const score = scoreOf(opp);
  const tier = scoreTier(score);
  const tip = (opp.scoreReasons ?? []).slice(0, 3).join(" · ");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        tier.cls
      )}
      title={tip || `Skor lead ${score}`}
      aria-label={`Skor lead ${score}: ${tier.label}`}
    >
      <Flame className="size-3" aria-hidden="true" />
      {score} · {tier.label}
    </span>
  );
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
        {isScoreVisible(opp) ? <ScoreChip opp={opp} /> : null}
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
  scoreSortDir,
  onToggleScoreSort,
  onOpen,
}: {
  rows: OpportunityDTO[];
  sortDir: SortDir;
  onToggleSort: () => void;
  scoreSortDir: SortDir;
  onToggleScoreSort: () => void;
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
                onClick={onToggleScoreSort}
                aria-label="Urutkan berdasarkan skor"
              >
                Skor
                {scoreSortDir === "asc" ? (
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                ) : scoreSortDir === "desc" ? (
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowUpDown className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </TableHead>
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
                <TableCell>
                  {isScoreVisible(opp) ? (
                    <ScoreTierCell opp={opp} />
                  ) : (
                    <span className="text-xs text-zinc-400">-</span>
                  )}
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

// ---------- Dialog: Impor CSV opportunity (Task 15-a) ----------

function importStatusChipClass(status: ImportOpportunityRowDTO["status"]): string {
  if (status === "valid") return "bg-emerald-100 text-emerald-700";
  if (status === "review") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function formatNilaiImport(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits ? formatCurrency(Number(digits)) : "-";
}

function ImportOpportunitiesDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const user = useCrmStore((s) => s.user);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<ImportOpportunityPreviewResponseDTO | null>(null);
  // Keputusan per baris duplikat (16-b): "Lewati" (default) | "Buat baru" | "Perbarui yang ada".
  const [rowActions, setRowActions] = useState<Record<number, "skip" | "create" | "update">>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFileName(null);
      setRows([]);
      setPreview(null);
      setRowActions({});
      setAnalyzing(false);
      setCommitting(false);
    }
  }, [open]);

  async function runPreview(parsed: Record<string, string>[]) {
    setAnalyzing(true);
    try {
      const res = await api.importOpportunities({
        rows: parsed,
        commit: false,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      const data = res as ImportOpportunityPreviewResponseDTO;
      setPreview(data);
      // Baris duplikat default "Lewati".
      const init: Record<number, "skip" | "create" | "update"> = {};
      for (const r of data.preview) {
        if (r.duplicateOf) init[r.index] = "skip";
      }
      setRowActions(init);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menganalisis data impor");
    } finally {
      setAnalyzing(false);
    }
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const parsed = mapOpportunityCsvRows(parseCsv(text));
      if (parsed.length === 0) {
        toast.error("Tidak ada baris terbaca dari file CSV");
        return;
      }
      if (parsed.length > OPP_IMPORT_MAX_ROWS) {
        toast.error(`Maksimal ${OPP_IMPORT_MAX_ROWS} baris per impor (terdeteksi ${parsed.length})`);
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      void runPreview(parsed);
    };
    reader.onerror = () => toast.error("Gagal membaca file CSV");
    reader.readAsText(file);
    e.target.value = ""; // agar file yang sama bisa diunggah ulang
  }

  async function commit() {
    if (!preview || rows.length === 0) return;
    setCommitting(true);
    try {
      const res = await api.importOpportunities({
        rows,
        commit: true,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
        rowActions,
      });
      const data = res as ImportOpportunityCommitResponseDTO;
      const parts = [`${data.summary.created} opportunity dibuat`];
      if (data.summary.updated > 0) parts.push(`${data.summary.updated} diperbarui`);
      parts.push(`${data.summary.skipped} dilewati`);
      if (data.summary.invalid > 0) parts.push(`${data.summary.invalid} invalid`);
      toast.success(`Impor selesai — ${parts.join(", ")}`);
      onImported();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengimpor opportunity");
    } finally {
      setCommitting(false);
    }
  }

  function backToInput() {
    setPreview(null);
    setRows([]);
    setFileName(null);
    setRowActions({});
  }

  // Rencana aksi untuk footer: baris valid non-duplikat = buat baru, duplikat sesuai pilihan (default lewati).
  const duplicateCount = preview?.summary.duplicateCount ?? 0;
  let plannedCreate = 0;
  let plannedUpdate = 0;
  let plannedSkip = 0;
  if (preview) {
    for (const r of preview.preview) {
      if (r.status !== "valid") continue;
      const a = r.duplicateOf ? (rowActions[r.index] ?? "skip") : "create";
      if (a === "create") plannedCreate++;
      else if (a === "update") plannedUpdate++;
      else plannedSkip++;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-2xl">
        {!preview ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="size-5 text-zinc-900" /> Impor CSV Opportunity
              </DialogTitle>
              <DialogDescription>
                Unggah file CSV hasil &quot;Ekspor CSV&quot; untuk membuat opportunity massal. Semua baris divalidasi
                dulu sebelum disimpan.
              </DialogDescription>
            </DialogHeader>

            {/* Dropzone unggah file */}
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-8 text-center transition-colors hover:border-zinc-400 hover:bg-zinc-100",
                analyzing && "pointer-events-none opacity-60"
              )}
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-zinc-200/70 text-zinc-500">
                {analyzing ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
              </span>
              <span className="text-sm font-medium text-zinc-800">
                {analyzing ? "Menganalisis baris…" : "Pilih file CSV untuk diimpor"}
              </span>
              <span className="max-w-sm text-xs leading-relaxed text-zinc-500">
                Format kolom sama dengan hasil Ekspor CSV: judul, brand, perusahaan, kontak, kategori_layanan, layanan,
                tahap, temperatur, prioritas, skor, nilai_estimasi, mata_uang, probabilitas_pct, owner, target_close,
                aksi_berikutnya, dibuat — dipisah titik koma, maksimal {OPP_IMPORT_MAX_ROWS} baris. Kolom skor &amp;
                dibuat diabaikan (skor dihitung otomatis).
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
                aria-label="Unggah file CSV opportunity"
              />
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={analyzing}>
                Batal
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="size-5 text-zinc-900" /> Pratinjau Impor
              </DialogTitle>
              <DialogDescription>
                {fileName ? `${fileName} · ` : ""}
                {preview.summary.total} baris terbaca. Periksa hasil validasi sebelum menyimpan.
              </DialogDescription>
            </DialogHeader>

            {/* Chip ringkasan */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {preview.summary.valid} Valid
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                {preview.summary.review} Review
              </span>
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                {preview.summary.invalid} Invalid
              </span>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
                {preview.summary.total} baris
              </span>
            </div>

            {/* Ringkasan dedupe (16-b) — hanya bila ada baris duplikat */}
            {preview.summary.duplicateCount > 0 && (
              <div
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
                role="status"
                aria-label={`${preview.summary.duplicateCount} duplikat terdeteksi`}
              >
                <Copy className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                <span>
                  <span className="font-semibold">{preview.summary.duplicateCount} duplikat terdeteksi</span>
                  {" "}— pilih tindakan per baris pada kolom Tindakan. Baris duplikat default dilewati; saat
                  memilih perbarui, judul, brand, perusahaan, dan kontak tidak akan ditimpa.
                </span>
              </div>
            )}

            {/* Tabel pratinjau per baris */}
            <div className="crm-scroll max-h-96 overflow-y-auto overflow-x-auto rounded-xl border bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50">
                    <TableHead>Judul</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Kontak</TableHead>
                    <TableHead>Tahap</TableHead>
                    <TableHead className="text-right">Nilai</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead className="text-right">Tindakan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.map((row) => (
                    <TableRow
                      key={row.index}
                      className={row.duplicateOf ? "bg-amber-50/50" : undefined}
                    >
                      <TableCell className="max-w-40 truncate font-medium text-zinc-800" title={row.judul}>
                        {row.judul || "-"}
                      </TableCell>
                      <TableCell className="max-w-28 truncate" title={row.brand}>
                        {row.brand || "-"}
                      </TableCell>
                      <TableCell className="max-w-32 truncate" title={row.kontak}>
                        {row.kontak || "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{stageLabel(row.tahapResolved)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatNilaiImport(row.nilai)}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1">
                          <span
                            className={cn(
                              "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              importStatusChipClass(row.status)
                            )}
                          >
                            {row.status === "valid" ? "Valid" : row.status === "review" ? "Review" : "Invalid"}
                          </span>
                          {row.duplicateOf && (
                            <span
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
                              title={`Duplikat dari opportunity existing: "${row.duplicateOf.title}" (dibuat ${formatDate(row.duplicateOf.createdAt)})`}
                              aria-label={`Duplikat dari: ${row.duplicateOf.title}`}
                            >
                              <Copy className="size-3" aria-hidden />
                              Duplikat
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-44">
                        {row.errors.length ? (
                          <span className="block truncate text-xs text-red-600" title={row.errors.join("; ")}>
                            {row.errors.join("; ")}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.duplicateOf ? (
                          <div className="flex justify-end">
                            <Select
                              value={rowActions[row.index] ?? "skip"}
                              onValueChange={(v) =>
                                setRowActions((prev) => ({
                                  ...prev,
                                  [row.index]: v as "skip" | "create" | "update",
                                }))
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[136px] text-xs"
                                aria-label={`Tindakan baris ${row.index + 1} (${row.judul || "tanpa judul"})`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Lewati</SelectItem>
                                <SelectItem value="create">Buat baru</SelectItem>
                                <SelectItem value="update">Perbarui yang ada</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-300">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <span className="mr-auto hidden self-center text-xs text-zinc-500 sm:block">
                {duplicateCount > 0 ? (
                  <>
                    {plannedCreate} dibuat baru · {plannedUpdate} diperbarui · {plannedSkip} duplikat dilewati ·{" "}
                    {preview.summary.review} review · {preview.summary.invalid} invalid
                  </>
                ) : (
                  <>
                    {preview.summary.valid} siap diimpor · {preview.summary.review} review dilewati ·{" "}
                    {preview.summary.invalid} invalid
                  </>
                )}
              </span>
              <Button variant="outline" onClick={backToInput} disabled={committing}>
                Unggah ulang
              </Button>
              <Button
                className="bg-zinc-900 text-white hover:bg-zinc-800"
                disabled={preview.summary.valid === 0 || committing}
                onClick={() => void commit()}
                aria-label={`Impor ${preview.summary.valid} baris opportunity`}
              >
                {committing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {committing ? "Mengimpor…" : `Impor ${preview.summary.valid} baris`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Modul utama ----------

export default function PipelineModule() {
  const { user, brands, activeBrandFilter, setActiveBrandFilter } = useCrmStore();
  const pendingFocus = useCrmStore((s) => s.pendingFocus);
  const clearPendingFocus = useCrmStore((s) => s.clearPendingFocus);

  const [opps, setOpps] = useState<OpportunityDTO[]>([]);
  const [loading, setLoading] = useState(true);
  // Ronde 36 (audit FIX): state error muat — dulu kegagalan fetch hanya toast &
  // kanban menampilkan empty state "Belum ada opportunity" yang menyesatkan.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("kanban");
  const [tempFilter, setTempFilter] = useState<string>("all");
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [scoreSortDir, setScoreSortDir] = useState<SortDir>(null);
  const [sortByScore, setSortByScore] = useState(false);
  const [skorMin, setSkorMin] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingLost, setPendingLost] = useState<OpportunityDTO | null>(null);
  const [savingStage, setSavingStage] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Ronde 35 — tombol "Peluang Baru" dengan form opportunity bersama
  const [newOpen, setNewOpen] = useState(false);

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
        setLoadError(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Gagal memuat opportunity");
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
    let base = tempFilter === "all" ? filtered : filtered.filter((o) => o.temperature === tempFilter);
    if (skorMin !== "all") {
      const min = Number(skorMin);
      base = base.filter((o) => scoreOf(o) >= min);
    }
    if (scoreSortDir) {
      base = [...base].sort((a, b) =>
        scoreSortDir === "asc" ? scoreOf(a) - scoreOf(b) : scoreOf(b) - scoreOf(a)
      );
    }
    if (!sortDir) return base;
    return [...base].sort((a, b) => {
      const av = a.estimatedValue ?? 0;
      const bv = b.estimatedValue ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [filtered, tempFilter, skorMin, scoreSortDir, sortDir]);

  const grouped = useMemo(() => {
    const map: Record<string, OpportunityDTO[]> = {};
    for (const key of KANBAN_KEYS) map[key] = [];
    for (const o of filtered) {
      const target = KANBAN_KEYS.includes(o.stage) ? o.stage : null;
      if (target) map[target].push(o);
    }
    if (sortByScore) {
      for (const key of KANBAN_KEYS) {
        map[key].sort((a, b) => scoreOf(b) - scoreOf(a));
      }
    }
    return map;
  }, [filtered, sortByScore]);

  function openDetail(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  // Global search (ronde 26) — buka detail opportunity hasil pencarian (⌘K).
  // Loading ditunggu dulu (effect berjalan lagi saat daftar siap); id tak ditemukan di daftar
  // → coba cocokkan sbg penawaran (buka opportunity induknya), selain itu tetap coba buka id
  // tersebut (drawer memuat detail by id — meng-cover opportunity di luar filter aktif).
  useEffect(() => {
    if (!pendingFocus || pendingFocus.module !== "pipeline") return;
    if (loading) return; // daftar belum termuat — tunggu data tiba
    const opp = oppsRef.current.find((o) => o.id === pendingFocus.id);
    if (opp) {
      openDetail(opp.id);
      clearPendingFocus();
      return;
    }
    let cancelled = false;
    api.quotations()
      .then((res) => {
        if (cancelled) return;
        const quotation = res.quotations.find((x) => x.id === pendingFocus.id);
        openDetail(quotation ? quotation.opportunityId : pendingFocus.id);
        clearPendingFocus();
      })
      .catch(() => {
        if (!cancelled) clearPendingFocus(); // gagal fetch → navigasi modul saja
      });
    return () => {
      cancelled = true;
    };
  }, [pendingFocus, loading, clearPendingFocus]);

  function toggleSort() {
    setSortDir((prev) => (prev === null ? "desc" : prev === "desc" ? "asc" : null));
  }

  function toggleScoreSort() {
    setScoreSortDir((prev) => (prev === null ? "desc" : prev === "desc" ? "asc" : null));
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
          <>
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
            <Select value={skorMin} onValueChange={setSkorMin}>
              <SelectTrigger className="w-full bg-white sm:w-40" aria-label="Filter skor minimum">
                <SelectValue placeholder="Skor Min" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Skor Min: Semua</SelectItem>
                <SelectItem value="45">≥ 45 (Warm+)</SelectItem>
                <SelectItem value="70">≥ 70 (Hot)</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Badge variant="secondary" className="bg-zinc-200/60 text-zinc-700">
            {filtered.length} opportunity
          </Badge>
          <Button
            size="sm"
            aria-label="Buat opportunity baru"
            title="Buat opportunity baru"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Peluang Baru</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Impor opportunity dari CSV"
            title="Impor opportunity dari CSV"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Impor CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Ekspor opportunity ke CSV"
            title={`Ekspor ${view === "table" ? tableRows.length : filtered.length} opportunity ke CSV`}
            onClick={() => {
              const rows = view === "table" ? tableRows : filtered;
              if (rows.length === 0) {
                toast.error("Tidak ada opportunity untuk diekspor");
                return;
              }
              const csv = buildOpportunitiesCsv(rows);
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const ymd = new Date().toISOString().slice(0, 10);
              a.href = url;
              a.download = `opportunity-grupcrm-${ymd}.csv`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              toast.success(`Ekspor CSV selesai — ${rows.length} opportunity diunduh`);
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Ekspor CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={sortByScore}
            aria-label="Urutkan kartu berdasarkan skor"
            onClick={() => setSortByScore((v) => !v)}
            className={cn(
              sortByScore &&
                "bg-zinc-900 text-white hover:bg-zinc-800 hover:text-white"
            )}
          >
            <ArrowDownWideNarrow className="size-4" aria-hidden="true" />
            Urut Skor
          </Button>
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
      {loadError && !loading ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50 py-14 text-center">
          <p className="font-medium text-rose-700">Gagal memuat pipeline</p>
          <p className="max-w-sm text-sm text-rose-600">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()} aria-label="Coba muat ulang pipeline">
            Coba lagi
          </Button>
        </div>
      ) : loading ? (
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
          scoreSortDir={scoreSortDir}
          onToggleScoreSort={toggleScoreSort}
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

      {/* Dialog impor CSV opportunity (Task 15-a) */}
      <ImportOpportunitiesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void load({ silent: true })}
      />

      {/* Ronde 35 — buat opportunity baru (form bersama, konsisten dgn form konversi Inbox) */}
      <OpportunityFormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSaved={() => void load({ silent: true })}
      />
    </div>
  );
}
