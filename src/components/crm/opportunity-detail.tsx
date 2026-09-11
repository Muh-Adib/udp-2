"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Calculator,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  Clock,
  CircleAlert,
  FileText,
  FolderKanban,
  Globe,
  Hourglass,
  Instagram,
  Link2,
  Loader2,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  Video,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WhatsAppIcon } from "@/components/crm/whatsapp-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
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
import { BRIEF_STATUS_META } from "@/lib/crm/brief";
import { CHANNELS, LOST_REASONS, NURTURE_SEGMENTS, PIPELINE_STAGES, stageColor, stageLabel } from "@/lib/crm/constants";
import { computeLeadScore, scoreTier } from "@/lib/crm/scoring";
import OpportunityFormDialog from "@/components/crm/opportunity-form-dialog";
import TaskFormDialog from "@/components/crm/task-form-dialog";
import { useCrmStore } from "@/lib/crm/store";
import type { Brand, BriefStatus, EstimationCostCategory, EstimationCostItem, EstimationDTO, QuotationDTO, QuotationItemDTO, TaskAttachment } from "@/lib/crm/types";
import { QuotationPrintArea } from "@/components/crm/quotation-print";
import BriefPanel from "@/components/crm/brief-panel";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime, initials, parseJsonArray } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ---------- Types ----------

// Server Fase 2 menyertakan estimation & quotations pada respons detail opportunity.
type DetailData = Awaited<ReturnType<typeof api.opportunity>>["opportunity"] & {
  estimation?: EstimationDTO | null;
  quotations?: QuotationDTO[];
};
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
  whatsapp: WhatsAppIcon,
  email: Mail,
  instagram: Instagram,
  website: Globe,
  phone: Phone,
  meeting: Video,
  portal: LayoutDashboard,
  note: StickyNote,
};

/** Ronde 34 — label status project produksi (kartu "Project Produksi" pada deal Won). */
const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: "Perencanaan",
  in_progress: "Berjalan",
  review: "Review",
  completed: "Selesai",
  cancelled: "Dibatalkan",
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

// ---------- Fase 4: badge skor lead (ring SVG + popover rincian) ----------

function ScoreRing({ score, ring }: { score: number; ring: string }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, score));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      className="shrink-0"
      role="img"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r={radius} fill="none" stroke="#e4e4e7" strokeWidth="3.5" />
      <circle
        cx="20"
        cy="20"
        r={radius}
        fill="none"
        stroke={ring}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 20 20)"
        className="transition-[stroke-dashoffset] duration-500"
      />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        className="fill-zinc-900"
        style={{ fontSize: "12px", fontWeight: 700 }}
      >
        {score}
      </text>
    </svg>
  );
}

function ScoreBadge({ score, reasons }: { score: number; reasons: string[] }) {
  const tier = scoreTier(score);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900/20"
          aria-label={`Skor lead ${score}: ${tier.label}. Lihat rincian skor`}
        >
          <ScoreRing score={score} ring={tier.ring} />
          <span className="flex flex-col items-start gap-0.5 leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              Skor Lead
            </span>
            <span className={cn("rounded px-1.5 text-[11px] font-semibold", tier.cls)}>
              {tier.label}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <p className="mb-1.5 text-xs font-semibold text-zinc-900">
          Rincian skor: {score}/100
        </p>
        {reasons.length === 0 ? (
          <p className="text-xs text-zinc-500">Belum ada faktor tambahan (skor dasar 30).</p>
        ) : (
          <ul className="crm-scroll max-h-40 space-y-1 overflow-y-auto pr-1 text-xs text-zinc-600">
            {reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-1.5">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-zinc-300" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------- Komponen kecil: bubble timeline ----------

/**
 * Task 17-c — indikator status pengiriman pesan outbound (tick gaya WhatsApp).
 * read → CheckCheck emerald, delivered → CheckCheck zinc, sent → Check zinc,
 * failed → AlertTriangle merah; outbound WhatsApp tanpa status → Clock "Menunggu status".
 * Baris inbound TIDAK menampilkan tick.
 */
function DeliveryTick({ status, channel }: { status?: string | null; channel?: string | null }) {
  const label =
    status === "read" ? "Dibaca"
    : status === "delivered" ? "Terkirim"
    : status === "sent" ? "Terkirim"
    : status === "failed" ? "Gagal terkirim"
    : channel === "whatsapp" ? "Menunggu status"
    : null;
  if (!label) return null;
  const Icon =
    status === "read" || status === "delivered" ? CheckCheck
    : status === "sent" ? Check
    : status === "failed" ? AlertTriangle
    : Clock;
  const tone =
    status === "read" ? "text-emerald-600"
    : status === "failed" ? "text-red-600"
    : status === "sent" || status === "delivered" ? "text-zinc-400"
    : "text-zinc-300";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center">
      <Icon className={cn("size-3.5", tone)} aria-hidden="true" />
    </span>
  );
}

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
          {outbound ? <DeliveryTick status={item.deliveryStatus} channel={item.channel} /> : null}
          <span aria-hidden="true">•</span>
          <span className="truncate">{item.senderName ?? "Tanpa nama"}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
      </div>
    </div>
  );
}

// ---------- Fase 2: helper estimasi & quotation ----------

function toNum(v: string): number {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? 0 : n;
}

// ---------- Ronde 40-E: helper task multi-assignee & lampiran ----------

/** TaskDTO.assignees bisa string JSON (dari DB) atau array — parse defensif. */
function taskAssigneeList(task: { assignees?: string | string[]; assigneeName?: string | null }): string[] {
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

/** TaskDTO.attachments bisa string JSON (dari DB) atau array — parse defensif. */
function taskAttachmentList(raw: TaskRow["attachments"]): TaskAttachment[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(
    (a): a is TaskAttachment =>
      !!a &&
      typeof a === "object" &&
      typeof (a as TaskAttachment).url === "string" &&
      ((a as TaskAttachment).type === "link" || (a as TaskAttachment).type === "file")
  );
}

/** Ronde 49 — EstimationDTO.costCategories (JSON string | array) → kategori RAB — parse defensif. */
function parseEstimationCategories(est?: EstimationDTO | null): EstimationCostCategory[] {
  if (!est?.costCategories) return [];
  let list: unknown = est.costCategories;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return (list as EstimationCostCategory[]).filter(
    (c): c is EstimationCostCategory =>
      !!c && typeof c === "object" && typeof c.name === "string" && Array.isArray(c.items)
  );
}

/** EstimationDTO.costItems (JSON string | array) → daftar item — parse defensif. */
function parseEstimationCostItems(est?: EstimationDTO | null): EstimationCostItem[] {
  if (!est?.costItems) return [];
  let list: unknown = est.costItems;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(
    (it): it is EstimationCostItem =>
      !!it && typeof it === "object" && typeof (it as EstimationCostItem).name === "string"
  );
}

// ---------- Ronde 49: RAB bertingkat (kategori → item) + multi-mata uang ----------

type PctKey = "contingencyPct" | "managementFeePct" | "discountPct" | "taxPct" | "targetMarginPct";

type EstimationForm = Record<PctKey | "revenue" | "notes", string>;

/** Baris item dalam kategori RAB. */
type RabItemRow = { name: string; qty: string; unit: string; price: string };
/** Kategori RAB beserta itemnya. */
type RabCategoryRow = { name: string; items: RabItemRow[] };

const RAB_CURRENCY_OPTIONS = ["IDR", "USD", "SGD", "EUR", "AUD", "JPY", "MYR", "GBP", "CNY"] as const;

/** Saran kategori default (digabung dgn riwayat estimasi dari server). */
const DEFAULT_CATEGORY_SUGGESTIONS = [
  "Produksi / Operasional", "Talent & Tim", "Peralatan & Equipment", "Lokasi", "Transportasi & Logistik",
  "Akomodasi", "Konsumsi", "Post-Production", "Software & Lisensi", "Hosting & Domain", "Lain-lain",
];
const DEFAULT_UNIT_SUGGESTIONS = ["unit", "pcs", "orang", "hari", "jam", "paket", "set", "bulan", "project", "kali", "slot"];

/** Kurs fallback (indikatif) bila API kurs gagal diakses (mis. offline). */
const FALLBACK_IDR_RATE: Record<string, number> = {
  USD: 16250, SGD: 12200, EUR: 17650, AUD: 10650, JPY: 108, MYR: 3480, GBP: 20650, CNY: 2250,
};

type IdrFx = { rate: number | null; source: string | null };

const FX_CACHE_PREFIX = "udp-fx:";
const FX_TTL_MS = 60 * 60 * 1000; // 1 jam

/** Baca cache kurs localStorage (TTL 1 jam). */
function readFxCache(currency: string): IdrFx | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_PREFIX + currency);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rate?: number; source?: string; t?: number };
    if (typeof parsed.rate !== "number" || !parsed.t || Date.now() - parsed.t > FX_TTL_MS) return null;
    return { rate: parsed.rate, source: parsed.source ?? null };
  } catch {
    return null;
  }
}

function writeFxCache(currency: string, fx: IdrFx) {
  try {
    localStorage.setItem(FX_CACHE_PREFIX + currency, JSON.stringify({ ...fx, t: Date.now() }));
  } catch {
    /* abaikan */
  }
}

function fxStamp(): string {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

/**
 * Ronde 49 — kurs currency→IDR dari API gratis (sinkron, tanpa API key):
 * 1) open.er-api.com  2) frankfurter.app (ECB)  3) fallback indikatif.
 * Hasil di-cache localStorage 1 jam agar stabil selama sesi & hemat kuota.
 */
async function fetchIdrRate(currency: string): Promise<IdrFx> {
  if (currency === "IDR") return { rate: null, source: null };
  const cached = readFxCache(currency);
  if (cached) return cached;
  const stamp = fxStamp();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json.rates?.IDR;
      if (typeof rate === "number" && rate > 0) {
        const fx: IdrFx = { rate, source: `open.er-api.com · ${stamp}` };
        writeFxCache(currency, fx);
        return fx;
      }
    }
  } catch {
    /* lanjut ke fallback */
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.frankfurter.app/latest?from=${currency}&to=IDR`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json.rates?.IDR;
      if (typeof rate === "number" && rate > 0) {
        const fx: IdrFx = { rate, source: `frankfurter.app (ECB) · ${stamp}` };
        writeFxCache(currency, fx);
        return fx;
      }
    }
  } catch {
    /* lanjut ke fallback */
  }
  const fb = FALLBACK_IDR_RATE[currency];
  return fb ? { rate: fb, source: `kurs indikatif (offline) · ${stamp}` } : { rate: null, source: null };
}

/** Keterangan kecil konversi ke IDR (hanya bila mata uang non-IDR & nilai > 0). */
function toIdrNote(value: number, fx: IdrFx): string | null {
  if (!fx.rate || fx.rate <= 0 || value <= 0) return null;
  return `≈ ${formatCurrencyFull(Math.round(value * fx.rate), "IDR")}`;
}

/** Input teks dgn saran autocomplete (dropdown ringan, navigasi keyboard). */
function SuggestInput({
  value, onChange, suggestions, placeholder, ariaLabel, disabled, className,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const base = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
    return base.filter((s) => s.toLowerCase() !== q).slice(0, 8);
  }, [value, suggestions]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || filtered.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % filtered.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[highlight]) onChange(filtered[highlight]);
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && filtered.length > 0}
      />
      {open && filtered.length > 0 ? (
        <ul
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-52 overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
          role="listbox"
          aria-label={`Saran ${ariaLabel}`}
        >
          {filtered.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                className={cn("w-full px-2.5 py-1.5 text-left text-xs outline-none hover:bg-accent", i === highlight && "bg-accent")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlight(i)}
                role="option"
                aria-selected={i === highlight}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Ronde 40-E — taxPct dipilih lewat Select master pajak (bukan input bebas);
// grid parameter hanya menampilkan persen non-pajak.
const PCT_PARAMETERS: { key: PctKey; label: string }[] = [
  { key: "contingencyPct", label: "Contingency %" },
  { key: "managementFeePct", label: "Management Fee %" },
  { key: "discountPct", label: "Discount %" },
];

/** Opsi pajak bila GET /api/taxes gagal — tetap bisa pilih PPN standar manual. */
const FALLBACK_TAX_OPTIONS = [{ name: "PPN (manual)", rate: 11 }];

type TaxOption = { name: string; rate: number };

/** Nilai default sama dengan default schema (contingency 5, mgmt fee 5, tax 11, target 30). */
const EMPTY_ESTIMATION_FORM: EstimationForm = {
  contingencyPct: "5",
  managementFeePct: "5",
  discountPct: "0",
  taxPct: "11",
  targetMarginPct: "30",
  revenue: "", // Ronde 41 — kosong = "belum diketahui" (null), bukan 0
  notes: "",
};

/**
 * Ronde 49 — EstimationDTO → baris editor RAB, dgn migrasi otomatis dari struktur lama:
 * 1) costCategories (baru)  2) costItems legacy → kategori "Biaya Umum"
 * 3) 9 kategori tetap legacy → kategori per nilai non-nol.
 */
function rabRowsFromEstimation(est?: EstimationDTO | null): RabCategoryRow[] {
  let list: unknown = est?.costCategories;
  if (typeof list === "string" && list) {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (Array.isArray(list) && list.length > 0) {
    return (list as EstimationCostCategory[])
      .filter((c) => !!c && typeof c.name === "string")
      .map((c) => ({
        name: c.name,
        items: (Array.isArray(c.items) ? c.items : [])
          .filter((it) => !!it && typeof it.name === "string")
          .map((it) => ({ name: it.name, qty: String(it.qty ?? 0), unit: it.unit ?? "unit", price: String(it.price ?? 0) })),
      }));
  }
  const legacyItems = parseEstimationCostItems(est);
  if (legacyItems.length > 0) {
    return [
      {
        name: "Biaya Umum",
        items: legacyItems.map((it) => ({ name: it.name, qty: String(it.qty ?? 0), unit: "unit", price: String(it.unitPrice ?? 0) })),
      },
    ];
  }
  const legacyMap: [string, number][] = [
    ["Tenaga Internal", est?.laborInternal ?? 0],
    ["Vendor / Freelancer", est?.vendorFreelance ?? 0],
    ["Equipment", est?.equipment ?? 0],
    ["Transportasi", est?.transport ?? 0],
    ["Akomodasi", est?.accommodation ?? 0],
    ["Talent", est?.talent ?? 0],
    ["Lokasi", est?.locationFee ?? 0],
    ["Software / Lisensi", est?.softwareLicense ?? 0],
    ["Hosting / Domain", est?.hostingDomain ?? 0],
  ];
  return legacyMap
    .filter(([, v]) => v > 0)
    .map(([name, v]) => ({ name, items: [{ name, qty: "1", unit: "paket", price: String(v) }] }));
}

function formFromEstimation(est: EstimationDTO): EstimationForm {
  return {
    contingencyPct: String(est.contingencyPct ?? 0),
    managementFeePct: String(est.managementFeePct ?? 0),
    discountPct: String(est.discountPct ?? 0),
    taxPct: String(est.taxPct ?? 0),
    targetMarginPct: String(est.targetMarginPct ?? 0),
    // Ronde 41 — revenue null → kosong ("belum diketahui"), bukan "0"
    revenue: est.revenue === null || est.revenue === undefined ? "" : String(est.revenue),
    notes: est.notes ?? "",
  };
}

type EstimationCalc = {
  totalCost: number;
  contingency: number;
  managementFee: number;
  costWithFees: number;
  discountAmount: number;
  netRevenue: number;
  taxAmount: number;
  grandTotal: number;
  margin: number;
  marginPct: number;
};

/** Rumus identik dengan server (src/app/api/opportunities/[id]/estimation):
 *  totalCost = Σ total kategori RAB; taxPct dipaksa 0 bila tanpa pajak (taxName null). */
function computeEstimation(form: EstimationForm, categoriesTotal: number, taxPct: number): EstimationCalc {
  const totalCost = categoriesTotal;
  const contingency = Math.round((totalCost * toNum(form.contingencyPct)) / 100);
  const managementFee = Math.round((totalCost * toNum(form.managementFeePct)) / 100);
  const costWithFees = totalCost + contingency + managementFee;
  const revenue = toNum(form.revenue);
  const discountAmount = Math.round((revenue * toNum(form.discountPct)) / 100);
  const netRevenue = revenue - discountAmount;
  const taxAmount = Math.round((netRevenue * taxPct) / 100);
  const grandTotal = netRevenue + taxAmount;
  const margin = netRevenue - costWithFees;
  const marginPct = netRevenue > 0 ? Math.round((margin / netRevenue) * 1000) / 10 : 0;
  return {
    totalCost, contingency, managementFee, costWithFees,
    discountAmount, netRevenue, taxAmount, grandTotal, margin, marginPct,
  };
}

function marginTone(marginPct: number, target: number): { label: string; text: string; badge: string; bar: string } {
  if (marginPct >= target) {
    return { label: "Di atas target", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100", bar: "[&>div]:bg-emerald-500" };
  }
  if (marginPct >= target - 10) {
    return { label: "Mendekati target", text: "text-amber-600", badge: "bg-amber-100 text-amber-700 hover:bg-amber-100", bar: "[&>div]:bg-amber-500" };
  }
  return { label: "Di bawah target", text: "text-rose-600", badge: "bg-rose-100 text-rose-700 hover:bg-rose-100", bar: "[&>div]:bg-rose-500" };
}

// ---------- Fase 2: panel kalkulasi estimasi (live) ----------

function CalcRow({ label, value, currency, muted }: { label: string; value: number; currency: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={muted ? "text-zinc-400" : "text-zinc-500"}>{label}</span>
      <span className={cn("tabular-nums", muted ? "text-zinc-500" : "font-medium text-zinc-800")}>
        {formatCurrencyFull(value, currency)}
      </span>
    </div>
  );
}

function CalcPanel({ calc, form, currency, taxName, fx }: { calc: EstimationCalc; form: EstimationForm; currency: string; taxName: string | null; fx: IdrFx }) {
  const target = toNum(form.targetMarginPct);
  const grandNote = toIdrNote(calc.grandTotal, fx);
  const costNote = toIdrNote(calc.totalCost, fx);
  const hasRevenue = calc.netRevenue > 0;
  const tone = hasRevenue ? marginTone(calc.marginPct, target) : null;
  const barPct = target > 0 ? Math.max(0, Math.min(100, (calc.marginPct / target) * 100)) : 0;

  return (
    <div className="rounded-xl border bg-zinc-50 p-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Kalkulasi (live)</p>
      <div className="space-y-1.5">
        <CalcRow label="Total Biaya" value={calc.totalCost} currency={currency} />
        <CalcRow label={`Contingency (${toNum(form.contingencyPct)}%)`} value={calc.contingency} currency={currency} muted />
        <CalcRow label={`Management Fee (${toNum(form.managementFeePct)}%)`} value={calc.managementFee} currency={currency} muted />
        <CalcRow label="Total Biaya + Fee" value={calc.costWithFees} currency={currency} />
        <div className="my-1 border-t border-dashed border-zinc-200" />
        <CalcRow label={`Diskon (${toNum(form.discountPct)}%)`} value={-calc.discountAmount} currency={currency} muted />
        <CalcRow label="Net Revenue" value={calc.netRevenue} currency={currency} />
        {/* Ronde 40-E — label pajak memakai nama master pajak; baris disembunyikan bila tanpa pajak */}
        {calc.taxAmount > 0 ? (
          <CalcRow label={`${taxName ?? "PPN"} (${toNum(form.taxPct)}%)`} value={calc.taxAmount} currency={currency} muted />
        ) : null}
        <CalcRow label="Grand Total" value={calc.grandTotal} currency={currency} />
        {grandNote ? <p className="text-right text-[10px] text-zinc-400">{grandNote} (kurs {currency}→IDR)</p> : null}
        {costNote ? <p className="text-right text-[10px] text-zinc-400">Total biaya {costNote}</p> : null}
      </div>

      <div className="mt-3 rounded-lg border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Margin</p>
            <p className={cn("text-lg font-semibold tabular-nums", hasRevenue ? tone?.text : "text-zinc-400")}>
              {formatCurrencyFull(calc.margin, currency)} <span className="text-sm font-medium">({calc.marginPct}%)</span>
            </p>
          </div>
          {tone && hasRevenue ? (
            <Badge className={cn("border-transparent", tone.badge)}>{tone.label}</Badge>
          ) : (
            <Badge variant="secondary">Belum ada revenue</Badge>
          )}
        </div>
        <div className="mt-2 space-y-1">
          <Progress
            value={barPct}
            aria-label="Progress margin terhadap target"
            className={cn("h-2", hasRevenue && tone ? tone.bar : "[&>div]:bg-zinc-300")}
          />
          <p className="text-[11px] text-zinc-400">
            Target margin {target}% — progress bar margin terhadap target.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Fase 2: tab Estimasi ----------

function EstimationTab({
  opportunityId,
  initialEstimation,
  currency,
  actorName,
  actorRole,
  pendingApprovals,
  onSaved,
  onChanged,
  serviceName,
  brandId,
}: {
  opportunityId: string;
  initialEstimation: EstimationDTO | null;
  currency: string;
  actorName: string;
  actorRole: string;
  /** Ronde 40 — approval pending dari detail opportunity (take 5, opsional). */
  pendingApprovals?: DetailData["pendingApprovals"];
  onSaved: (estimation: EstimationDTO) => void;
  /** Ronde 40-E — reload detail penuh (dipakai setelah keputusan approval). */
  onChanged: () => void;
  /** Ronde 42 — layanan terpilih di opportunity → saran harga dari katalog brand. */
  serviceName?: string | null;
  brandId?: string | null;
}) {
  const [est, setEst] = useState<EstimationDTO | null>(initialEstimation);
  const [form, setForm] = useState<EstimationForm>(() =>
    initialEstimation ? formFromEstimation(initialEstimation) : EMPTY_ESTIMATION_FORM
  );
  // Ronde 49 — RAB bertingkat (kategori → item) + mata uang & kurs
  const [categories, setCategories] = useState<RabCategoryRow[]>(() => rabRowsFromEstimation(initialEstimation));
  const [currencyState, setCurrencyState] = useState<string>(() => {
    const saved = initialEstimation?.currency;
    return saved && (RAB_CURRENCY_OPTIONS as readonly string[]).includes(saved) ? saved : "IDR";
  });
  const [fx, setFx] = useState<IdrFx>({ rate: null, source: null });
  const [suggestions, setSuggestions] = useState<{ categories: string[]; items: string[]; units: string[] }>({
    categories: DEFAULT_CATEGORY_SUGGESTIONS,
    items: [],
    units: DEFAULT_UNIT_SUGGESTIONS,
  });
  const [taxName, setTaxName] = useState<string | null>(initialEstimation?.taxName ?? null);
  const [taxOptions, setTaxOptions] = useState<TaxOption[] | null>(null);
  const [loading, setLoading] = useState(!initialEstimation);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Ronde 40-E — keputusan approval direktur
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  // Lazy load: fetch saat tab dibuka dan detail belum membawa estimasi (auto-create draft di server).
  useEffect(() => {
    if (initialEstimation) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getEstimation(opportunityId)
      .then((res) => {
        if (cancelled) return;
        setEst(res.estimation);
        setForm(formFromEstimation(res.estimation));
        setCategories(rabRowsFromEstimation(res.estimation));
        setCurrencyState(res.estimation.currency && (RAB_CURRENCY_OPTIONS as readonly string[]).includes(res.estimation.currency) ? res.estimation.currency : "IDR");
        setTaxName(res.estimation.taxName ?? null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Gagal memuat estimasi");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opportunityId, initialEstimation, reloadKey]);

  // Ronde 40-E — master pajak dimuat sekali saat tab dibuka (fallback manual bila gagal).
  useEffect(() => {
    let cancelled = false;
    api
      .taxes()
      .then((res) => {
        if (!cancelled) setTaxOptions(res.taxes.map((t) => ({ name: t.name, rate: t.rate })));
      })
      .catch(() => {
        if (!cancelled) setTaxOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ronde 49 — saran autocomplete RAB dari seluruh estimasi (riwayat tim)
  useEffect(() => {
    let cancelled = false;
    api
      .estimationSuggestions()
      .then((res) => {
        if (cancelled) return;
        setSuggestions({
          categories: [...new Set([...res.categories, ...DEFAULT_CATEGORY_SUGGESTIONS])],
          items: res.items,
          units: [...new Set([...res.units, ...DEFAULT_UNIT_SUGGESTIONS])],
        });
      })
      .catch(() => {
        /* saran default tetap terpakai */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ronde 49 — kurs currency→IDR live (API gratis, cache 1 jam) bila non-IDR
  useEffect(() => {
    let cancelled = false;
    setFx({ rate: null, source: null });
    fetchIdrRate(currencyState)
      .then((res) => {
        if (!cancelled) setFx(res);
      })
      .catch(() => {
        if (!cancelled) setFx({ rate: null, source: null });
      });
    return () => {
      cancelled = true;
    };
  }, [currencyState]);

  // Ronde 40-E — cari approval pending utk estimasi ini: coba pendingApprovals dari
  // detail dulu; bila tidak ketemu (mis. daftar terpotong take 5), minta /api/approvals?status=pending.
  useEffect(() => {
    if (est?.status !== "pending_approval") {
      setPendingApprovalId(null);
      return;
    }
    let cancelled = false;
    const fromDetail = (pendingApprovals ?? []).find(
      (a) => a.entityType === "estimation" && a.status === "pending" && a.entityId === est.id
    );
    if (fromDetail) {
      setPendingApprovalId(fromDetail.id);
      return;
    }
    api
      .approvals("pending")
      .then((res) => {
        if (cancelled) return;
        const found = res.approvals.find(
          (a) => a.entityType === "estimation" && a.status === "pending" && a.entityId === est.id
        );
        setPendingApprovalId(found?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setPendingApprovalId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [est?.status, est?.id, pendingApprovals]);

  const locked = est?.status === "pending_approval" || est?.status === "approved";

  // Ronde 42 — SARAN HARGA dari katalog layanan brand: layanan yang dipilih di opportunity
  // punya rincian biaya + margin target → saran harga (dihitung server). Auto-terapkan saat
  // estimasi masih draft kosong; tombol "Terapkan" selalu tersedia (kecuali terkunci).
  const [suggestion, setSuggestion] = useState<{ name: string; suggestedPrice: number } | null>(null);
  useEffect(() => {
    if (!serviceName || !brandId) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    api.brandServices(brandId)
      .then((res) => {
        if (cancelled) return;
        const svc = res.services.find((s) => s.name === serviceName);
        if (svc?.suggestedPrice && svc.suggestedPrice > 0) {
          setSuggestion({ name: svc.name, suggestedPrice: svc.suggestedPrice });
        } else {
          setSuggestion(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceName, brandId]);

  // Auto-terapkan sekali: estimasi draft + revenue masih kosong + saran tersedia
  useEffect(() => {
    if (!suggestion) return;
    if (est && est.status !== "draft") return;
    setForm((f) => (f.revenue.trim() === "" ? { ...f, revenue: String(suggestion.suggestedPrice) } : f));
  }, [suggestion, est?.status]);
  // Ronde 49 — Σ total kategori RAB (hanya kategori & item bernama; bulatkan spt server)
  const categoriesTotal = useMemo(
    () =>
      categories
        .filter((c) => c.name.trim() !== "")
        .reduce(
          (s, c) =>
            s +
            c.items
              .filter((r) => r.name.trim() !== "")
              .reduce((ss, r) => ss + Math.round((toNum(r.qty) || 0) * (toNum(r.price) || 0)), 0),
          0,
        ),
    [categories]
  );
  const effectiveTaxPct = taxName ? toNum(form.taxPct) : 0;
  const calc = useMemo(() => computeEstimation(form, categoriesTotal, effectiveTaxPct), [form, categoriesTotal, effectiveTaxPct]);
  const revenueNum = toNum(form.revenue);
  const disabled = loading || locked || saving;

  // Opsi Select pajak: master (atau fallback manual) + nilai tersimpan bila tak ada di master
  const taxSelectOptions = useMemo(() => {
    const base = taxOptions === null ? [] : taxOptions.length > 0 ? taxOptions : FALLBACK_TAX_OPTIONS;
    if (taxName && !base.some((t) => t.name === taxName)) {
      return [...base, { name: taxName, rate: toNum(form.taxPct) }];
    }
    return base;
  }, [taxOptions, taxName, form.taxPct]);

  const isDecisionMaker = actorRole === "director" || actorRole === "super_admin";

  function setField(key: keyof EstimationForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ---------- Ronde 49: editor RAB kategori → item ----------

  const cur: string = currencyState;

  function addCategory() {
    setCategories((rows) => [...rows, { name: "", items: [{ name: "", qty: "1", unit: "unit", price: "" }] }]);
  }

  function removeCategory(idx: number) {
    setCategories((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateCategory(idx: number, patch: Partial<Pick<RabCategoryRow, "name">>) {
    setCategories((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addItem(catIdx: number) {
    setCategories((rows) =>
      rows.map((r, i) => (i === catIdx ? { ...r, items: [...r.items, { name: "", qty: "1", unit: "unit", price: "" }] } : r)),
    );
  }

  function updateItem(catIdx: number, itemIdx: number, patch: Partial<RabItemRow>) {
    setCategories((rows) =>
      rows.map((r, i) =>
        i === catIdx ? { ...r, items: r.items.map((it, j) => (j === itemIdx ? { ...it, ...patch } : it)) } : r,
      ),
    );
  }

  function removeItem(catIdx: number, itemIdx: number) {
    setCategories((rows) =>
      rows.map((r, i) => (i === catIdx ? { ...r, items: r.items.filter((_, j) => j !== itemIdx) } : r)),
    );
  }

  function selectTax(value: string) {
    if (value === "none") {
      setTaxName(null);
      setField("taxPct", "0");
      return;
    }
    const opt = taxSelectOptions.find((t) => t.name === value);
    if (opt) {
      setTaxName(opt.name);
      setField("taxPct", String(opt.rate));
    }
  }

  async function persist(submit: boolean) {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        submit,
        actorName,
        actorRole,
        notes: form.notes.trim() || null,
        // Ronde 41 — revenue kosong dikirim null ("belum diketahui"), bukan 0
        revenue: form.revenue.trim() === "" ? null : revenueNum,
        // Ronde 40-E — nama pajak dari master (null = tanpa pajak, taxPct dipaksa 0 server)
        taxName,
        taxPct: effectiveTaxPct,
      };
      for (const p of PCT_PARAMETERS) payload[p.key] = toNum(form[p.key]);
      payload.targetMarginPct = toNum(form.targetMarginPct);
      // Ronde 49 — kirim RAB kategori→item (selalu, agar server menol-kan legacy);
      // subtotal & total kategori dihitung ulang di server dgn pembulatan mata uang.
      payload.currency = cur;
      payload.fxRate = cur === "IDR" ? null : fx.rate;
      payload.fxSource = cur === "IDR" ? null : fx.source;
      payload.costCategories = categories
        .filter((c) => c.name.trim() !== "")
        .map((c) => ({
          name: c.name.trim(),
          items: c.items
            .filter((r) => r.name.trim() !== "")
            .map((r) => ({ name: r.name.trim(), qty: Number(r.qty) || 0, unit: r.unit.trim() || "unit", price: Number(r.price) || 0 })),
        }));

      const res = await api.saveEstimation(opportunityId, payload);
      setEst(res.estimation);
      setCategories(rabRowsFromEstimation(res.estimation));
      setTaxName(res.estimation.taxName ?? null);
      if (submit) {
        toast.success("Estimasi diajukan untuk approval");
        if (res.approval) toast.info("Approval dikirim ke Direktur");
      } else {
        toast.success("Draft estimasi disimpan");
      }
      onSaved(res.estimation);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan estimasi");
    } finally {
      setSaving(false);
    }
  }

  // Ronde 40-E — keputusan approval direktur (approve → server auto-move ke Negotiation)
  async function decide(decision: "approve" | "reject", decisionNote?: string) {
    if (!pendingApprovalId) return;
    setDeciding(true);
    try {
      const res = await api.decideApproval({
        id: pendingApprovalId,
        decision,
        decisionNote: decisionNote?.trim() || undefined,
        actorName,
        actorRole,
      });
      if (decision === "approve") {
        // Ronde 49 — approval memicu konversi otomatis estimasi → penawaran (server)
        toast.success(
          res.autoQuotation
            ? `Estimasi disetujui — penawaran ${res.autoQuotation.number} dibuat otomatis (total = grand total estimasi)`
            : "Estimasi disetujui — peluang otomatis pindah ke Negotiation",
        );
      } else {
        toast.success("Estimasi ditolak — tim dapat merevisi lalu mengajukan ulang");
      }
      setRejectOpen(false);
      setRejectNote("");
      setEst((prev) =>
        prev
          ? {
              ...prev,
              status: decision === "approve" ? "approved" : "rejected",
              approvedBy: decision === "approve" ? actorName : prev.approvedBy,
              approvedAt: decision === "approve" ? new Date().toISOString() : prev.approvedAt,
            }
          : prev
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memutuskan approval");
    } finally {
      setDeciding(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-12 rounded-lg" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-44 rounded-xl" />
      </div>
    );
  }

  if (loadError || !est) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
        <Calculator className="size-6 text-zinc-300" aria-hidden="true" />
        <p className="text-sm font-medium text-zinc-700">Gagal memuat estimasi</p>
        <p className="text-xs text-zinc-500">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
          Coba lagi
        </Button>
      </div>
    );
  }

  const banner =
    est.status === "pending_approval"
      ? { cls: "border-amber-200 bg-amber-50 text-amber-800", Icon: Hourglass, text: "Menunggu Approval Direktur", sub: "Field terkunci sampai estimasi diputuskan." }
      : est.status === "approved"
        ? { cls: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: BadgeCheck, text: `Disetujui oleh ${est.approvedBy ?? "Direktur"}`, sub: est.approvedAt ? formatDateTime(est.approvedAt) : undefined }
        : est.status === "rejected"
          ? { cls: "border-rose-200 bg-rose-50 text-rose-800", Icon: CircleAlert, text: "Ditolak — silakan revisi & ajukan ulang", sub: undefined }
          : null;

  return (
    <div className="space-y-4">
      {banner ? (
        <div className={cn("flex items-start gap-2 rounded-xl border p-3 text-sm", banner.cls)} role="status">
          <banner.Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{banner.text}</p>
            {banner.sub ? <p className="text-xs opacity-80">{banner.sub}</p> : null}
            {/* Ronde 40-E (BUG FIX) — tombol keputusan untuk Direktur/Super Admin langsung
                di banner; dulu tidak ada tombol sama sekali sehingga estimasi tidak bisa
                disetujui dari tab Estimasi. Approve juga menggeser stage ke Negotiation (server). */}
            {est.status === "pending_approval" && isDecisionMaker && pendingApprovalId ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void decide("approve")}
                  disabled={deciding}
                  aria-label="Setujui estimasi"
                >
                  {deciding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                  Setujui
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
                  onClick={() => setRejectOpen(true)}
                  disabled={deciding}
                  aria-label="Tolak estimasi"
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  Tolak
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Ronde 49 — RAB: kategori → item + mata uang & konversi IDR live */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Rincian Anggaran (RAB)</p>
            <p className="text-xs text-zinc-500">Kategori berisi item — total biaya = jumlah total kategori.</p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="est-currency" className="text-xs font-medium text-zinc-600">
              Mata Uang
            </label>
            <Select value={cur} onValueChange={(v) => setCurrencyState(v)} disabled={disabled}>
              <SelectTrigger id="est-currency" size="sm" className="w-28 text-sm" aria-label="Pilih mata uang estimasi">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RAB_CURRENCY_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {cur !== "IDR" ? (
          <p className="mb-3 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500" role="note">
            {fx.rate
              ? `Kurs 1 ${cur} = ${formatCurrencyFull(Math.round(fx.rate), "IDR")} · sumber ${fx.source ?? "—"} — keterangan konversi bersifat indikasi; harga penawaran tetap dalam ${cur}.`
              : `Mengambil kurs ${cur} → IDR dari API gratis…`}
          </p>
        ) : null}

        {categories.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-zinc-400">
            Belum ada kategori. Klik <strong>Tambah Kategori</strong> lalu isi item di dalamnya (mis. kategori
            &ldquo;Peralatan&rdquo; berisi item &ldquo;Sewa kamera&rdquo; · 2 hari).
          </p>
        ) : null}

        <div className="space-y-3">
          {categories.map((cat, ci) => {
            const catTotal = cat.items
              .filter((r) => r.name.trim() !== "")
              .reduce((s, r) => s + Math.round((toNum(r.qty) || 0) * (toNum(r.price) || 0)), 0);
            const catNote = toIdrNote(catTotal, fx);
            return (
              <div key={ci} className="rounded-lg border bg-zinc-50/40 p-3">
                <div className="flex items-center gap-2">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white"
                    aria-hidden="true"
                  >
                    {ci + 1}
                  </span>
                  <SuggestInput
                    value={cat.name}
                    onChange={(v) => updateCategory(ci, { name: v })}
                    suggestions={suggestions.categories}
                    placeholder={`Kategori ${ci + 1}, mis. Peralatan`}
                    ariaLabel={`Nama kategori ${ci + 1}`}
                    disabled={disabled}
                    className="h-8 text-sm font-medium"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-zinc-400 hover:text-rose-600"
                    onClick={() => removeCategory(ci)}
                    disabled={disabled}
                    aria-label={`Hapus kategori ${ci + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>

                {cat.items.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="hidden gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400 sm:grid sm:grid-cols-[minmax(0,1fr)_56px_76px_120px_110px_32px]">
                      <span>Nama Item</span>
                      <span>Qty</span>
                      <span>Satuan</span>
                      <span>Harga</span>
                      <span className="text-right">Total</span>
                      <span />
                    </div>
                    {cat.items.map((it, ii) => {
                      const lineTotal = Math.round((toNum(it.qty) || 0) * (toNum(it.price) || 0));
                      const lineNote = toIdrNote(lineTotal, fx);
                      return (
                        <div
                          key={ii}
                          className="grid grid-cols-2 gap-1.5 rounded-md border bg-white p-2 sm:grid-cols-[minmax(0,1fr)_56px_76px_120px_110px_32px] sm:items-center sm:gap-2 sm:rounded-md sm:border-0 sm:bg-transparent sm:p-0"
                        >
                          <div className="col-span-2 sm:col-span-1">
                            <SuggestInput
                              value={it.name}
                              onChange={(v) => updateItem(ci, ii, { name: v })}
                              suggestions={suggestions.items}
                              placeholder={`Item ${ii + 1}, mis. Sewa kamera`}
                              ariaLabel={`Nama item ${ii + 1} pada kategori ${ci + 1}`}
                              disabled={disabled}
                              className="h-8 text-sm"
                            />
                          </div>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={it.qty}
                            onChange={(e) => updateItem(ci, ii, { qty: e.target.value })}
                            placeholder="1"
                            aria-label={`Qty item ${ii + 1} pada kategori ${ci + 1}`}
                            disabled={disabled}
                            className="h-8 text-sm"
                          />
                          <SuggestInput
                            value={it.unit}
                            onChange={(v) => updateItem(ci, ii, { unit: v })}
                            suggestions={suggestions.units}
                            placeholder="unit"
                            ariaLabel={`Satuan item ${ii + 1} pada kategori ${ci + 1}`}
                            disabled={disabled}
                            className="h-8 text-sm"
                          />
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400" aria-hidden="true">
                              {cur}
                            </span>
                            <Input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={it.price}
                              onChange={(e) => updateItem(ci, ii, { price: e.target.value })}
                              placeholder="0"
                              aria-label={`Harga satuan item ${ii + 1} pada kategori ${ci + 1} (${cur})`}
                              disabled={disabled}
                              className="h-8 pl-9 text-sm"
                            />
                          </div>
                          <div className="text-right">
                            <span
                              className="block text-xs tabular-nums text-zinc-700 sm:text-sm"
                              aria-label={`Total item ${ii + 1} pada kategori ${ci + 1}`}
                            >
                              {formatCurrency(lineTotal, cur)}
                            </span>
                            {lineNote ? <span className="block text-[10px] text-zinc-400">{lineNote}</span> : null}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 justify-self-end text-zinc-300 hover:text-rose-600"
                            onClick={() => removeItem(ci, ii)}
                            disabled={disabled}
                            aria-label={`Hapus item ${ii + 1} pada kategori ${ci + 1}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-[11px] text-zinc-400">
                    Belum ada item pada kategori ini.
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-zinc-200 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-zinc-500 hover:text-zinc-800"
                    onClick={() => addItem(ci)}
                    disabled={disabled}
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Tambah Item
                  </Button>
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">
                      Total <span className="font-medium text-zinc-700">{cat.name.trim() || `Kategori ${ci + 1}`}</span>
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-zinc-900">{formatCurrencyFull(catTotal, cur)}</p>
                    {catNote ? <p className="text-[10px] text-zinc-400">{catNote}</p> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline" onClick={addCategory} disabled={disabled}>
            <Plus className="size-3.5" aria-hidden="true" />
            Tambah Kategori
          </Button>
          <div className="text-right">
            <p className="text-xs text-zinc-500">Σ Total Biaya (semua kategori)</p>
            <p className="text-base font-bold tabular-nums text-zinc-900">{formatCurrencyFull(categoriesTotal, cur)}</p>
          </div>
        </div>

        {/* Parameter */}
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Parameter</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PCT_PARAMETERS.map((p) => (
              <div key={p.key} className="space-y-1">
                <label htmlFor={`est-pct-${p.key}`} className="text-xs font-medium text-zinc-600">
                  {p.label}
                </label>
                <Input
                  id={`est-pct-${p.key}`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  className="h-8 text-sm"
                  value={form[p.key]}
                  onChange={(e) => setField(p.key, e.target.value)}
                  disabled={disabled}
                  aria-label={p.label}
                />
              </div>
            ))}
            {/* Ronde 40-E — pajak dari master (bukan input PPN % bebas) */}
            <div className="space-y-1">
              <label htmlFor="est-tax" className="text-xs font-medium text-zinc-600">
                Pajak
              </label>
              <Select
                value={taxName ?? "none"}
                onValueChange={selectTax}
                disabled={disabled}
              >
                <SelectTrigger id="est-tax" size="sm" className="w-full text-sm" aria-label="Pilih pajak">
                  <SelectValue placeholder="Pilih pajak" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa Pajak</SelectItem>
                  {taxSelectOptions.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name} ({t.rate}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <label htmlFor="est-revenue" className="text-xs font-semibold text-zinc-700">
              Harga Penawaran (Revenue)
              <span className="ml-1 font-normal text-zinc-400">— boleh dikosongkan bila belum diketahui</span>
            </label>
            <div className="relative max-w-xs">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden="true">
                {cur}
              </span>
              <Input
                id="est-revenue"
                type="number"
                min={0}
                inputMode="numeric"
                className="pl-10 font-semibold"
                value={form.revenue}
                onChange={(e) => setField("revenue", e.target.value)}
                disabled={disabled}
                placeholder="Belum diketahui"
                aria-label={`Harga penawaran (${cur})`}
              />
            </div>
            {/* Ronde 42 — saran harga dari katalog layanan brand */}
            {suggestion ? (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                <span className="text-emerald-800">
                  Saran harga katalog <strong>{suggestion.name}</strong>: {cur}{" "}
                  {new Intl.NumberFormat("id-ID").format(suggestion.suggestedPrice)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 border-emerald-300 px-2 text-[11px] text-emerald-800 hover:bg-emerald-100"
                  disabled={disabled}
                  onClick={() => setField("revenue", String(suggestion.suggestedPrice))}
                  aria-label={`Terapkan saran harga ${suggestion.suggestedPrice}`}
                >
                  Terapkan
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <CalcPanel calc={calc} form={form} currency={cur} taxName={taxName} fx={fx} />

      {/* Catatan + aksi */}
      <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label htmlFor="est-notes" className="text-xs font-medium text-zinc-600">
            Catatan
          </label>
          <Textarea
            id="est-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            disabled={disabled}
            placeholder="Asumsi harga, catatan negosiasi internal, dst. (opsional)"
            aria-label="Catatan estimasi"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            onClick={() => void persist(false)}
            disabled={disabled}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            Simpan Draft
          </Button>
          <Button
            className="bg-amber-500 text-white hover:bg-amber-600"
            onClick={() => setConfirmOpen(true)}
            disabled={disabled || revenueNum <= 0}
            aria-label="Ajukan approval estimasi ke Direktur"
          >
            <Send className="size-4" aria-hidden="true" />
            Ajukan Approval Direktur
          </Button>
        </div>
        {!locked && revenueNum <= 0 ? (
          <p className="text-xs text-zinc-400">
            Isi harga penawaran (lebih dari 0) untuk mengajukan approval — atau simpan draft dulu bila nilainya belum diketahui.
          </p>
        ) : null}
      </div>

      {/* Konfirmasi submit approval */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ajukan approval estimasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Estimasi dengan revenue {formatCurrencyFull(revenueNum, cur)} akan dikirim ke Direktur untuk
              diputuskan. Selama menunggu approval, field estimasi terkunci.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => void persist(true)}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Ya, Ajukan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Ronde 40-E — dialog tolak estimasi (dengan catatan keputusan opsional) */}
      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tolak estimasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Estimasi akan ditandai ditolak dan tim dapat merevisi lalu mengajukan ulang. Catatan keputusan
              bersifat opsional.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={3}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            disabled={deciding}
            placeholder="Catatan keputusan (opsional), mis. margin terlalu tipis — revisi harga vendor."
            aria-label="Catatan penolakan estimasi"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deciding}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void decide("reject", rejectNote)}
              disabled={deciding}
            >
              {deciding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Tolak Estimasi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Fase 2: tab Quotation ----------

type QuotationRow = { description: string; qty: string; unitPrice: string };

const QUOTATION_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-700 hover:bg-zinc-100" },
  sent: { label: "Terkirim", cls: "bg-violet-100 text-violet-700 hover:bg-violet-100" },
  accepted: { label: "Diterima", cls: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" },
  rejected: { label: "Ditolak", cls: "bg-rose-100 text-rose-700 hover:bg-rose-100" },
  expired: { label: "Kedaluwarsa", cls: "bg-slate-100 text-slate-600 hover:bg-slate-100" },
};

type QuotationAction = "send" | "accept" | "reject" | "convert_invoice";

function parseQuotationItems(items: string | QuotationItemDTO[]): QuotationItemDTO[] {
  if (Array.isArray(items)) return items;
  try {
    const parsed: unknown = JSON.parse(items);
    return Array.isArray(parsed) ? (parsed as QuotationItemDTO[]) : [];
  } catch {
    return [];
  }
}

function defaultValidUntil(): string {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Satu baris item pada form quotation (responsive: stack di mobile, grid di sm+). */
function ItemRow({
  index,
  row,
  currency,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  row: QuotationRow;
  currency: string;
  disabled: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<QuotationRow>) => void;
  onRemove: () => void;
}) {
  const subtotal = (toNum(row.qty) || 1) * toNum(row.unitPrice);
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-2 sm:grid-cols-[minmax(0,1fr)_72px_130px_110px_36px] sm:items-center sm:gap-2 sm:rounded-md sm:border-0 sm:bg-transparent sm:p-0">
      <div className="col-span-2 sm:col-span-1">
        <Input
          value={row.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder={`Deskripsi item ${index + 1}`}
          aria-label={`Deskripsi item ${index + 1}`}
          disabled={disabled}
          className="h-8 text-sm"
        />
      </div>
      <Input
        type="number"
        min={1}
        step="1"
        value={row.qty}
        onChange={(e) => onChange({ qty: e.target.value })}
        placeholder="Qty"
        aria-label={`Jumlah item ${index + 1}`}
        disabled={disabled}
        className="h-8 text-sm"
      />
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={row.unitPrice}
        onChange={(e) => onChange({ unitPrice: e.target.value })}
        placeholder="Harga satuan"
        aria-label={`Harga satuan item ${index + 1}`}
        disabled={disabled}
        className="h-8 text-sm"
      />
      <span className="self-center text-right text-xs tabular-nums text-zinc-600 sm:text-sm" aria-label={`Subtotal item ${index + 1}`}>
        {formatCurrency(subtotal, currency)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 justify-self-end text-zinc-400 hover:text-rose-600"
        onClick={onRemove}
        disabled={disabled || !canRemove}
        aria-label={`Hapus item ${index + 1}`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function QuotationFormDialog({
  open,
  onOpenChange,
  opportunityId,
  defaultCurrency,
  editing,
  reviseOf,
  actorName,
  actorRole,
  estimation,
  serviceName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opportunityId: string;
  defaultCurrency: string;
  editing: QuotationDTO | null;
  /** Ronde 39 — mode revisi: buat quotation BARU menyalin isi quotation sumber (tertolak). */
  reviseOf?: QuotationDTO | null;
  actorName: string;
  actorRole: string;
  /** Ronde 35 — estimasi detail sebagai sumber prefill item quotation. */
  estimation?: EstimationDTO | null;
  serviceName?: string | null;
  onSaved: () => void;
}) {
  const currency = editing?.currency ?? defaultCurrency;
  const [rows, setRows] = useState<QuotationRow[]>([{ description: "", qty: "1", unitPrice: "" }]);
  const [discountPct, setDiscountPct] = useState("0");
  const [taxPct, setTaxPct] = useState("11");
  // Ronde 40-E — pajak dari master: "" = belum ditentukan (default PPN pertama), "none" = tanpa pajak
  const [taxName, setTaxName] = useState("");
  const [taxOptions, setTaxOptions] = useState<TaxOption[] | null>(null);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [saving, setSaving] = useState(false);
  /** Ronde 35 — true bila item terisi otomatis dari estimasi detail (single-line revenue). */
  const prefilledFromEstimation = useRef(false);
  /** Ronde 40-E — true bila item terisi dari rincian costItems estimasi. */
  const prefilledFromCostItems = useRef(false);

  // Ronde 40-E — master pajak dimuat setiap kali dialog dibuka (cache per dialog instance).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .taxes()
      .then((res) => {
        if (!cancelled) setTaxOptions(res.taxes.map((t) => ({ name: t.name, rate: t.rate })));
      })
      .catch(() => {
        if (!cancelled) setTaxOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Prefill setiap kali dialog dibuka (mode buat / edit draft / revisi).
  useEffect(() => {
    if (!open) return;
    if (editing) {
      prefilledFromEstimation.current = false;
      prefilledFromCostItems.current = false;
      const items = parseQuotationItems(editing.items);
      setRows(
        items.length > 0
          ? items.map((it) => ({ description: it.description, qty: String(it.qty), unitPrice: String(it.unitPrice) }))
          : [{ description: "", qty: "1", unitPrice: "" }]
      );
      setDiscountPct(String(editing.discountPct ?? 0));
      setTaxPct(String(editing.taxName ? editing.taxPct ?? 0 : 0));
      setTaxName(editing.taxName ?? "none");
      setNotes(editing.notes ?? "");
      setValidUntil(editing.validUntil ? editing.validUntil.slice(0, 10) : defaultValidUntil());
    } else if (reviseOf) {
      // Ronde 39 — revisi: salin isi quotation sumber + catatan revisi otomatis.
      prefilledFromEstimation.current = false;
      prefilledFromCostItems.current = false;
      const items = parseQuotationItems(reviseOf.items);
      setRows(
        items.length > 0
          ? items.map((it) => ({ description: it.description, qty: String(it.qty), unitPrice: String(it.unitPrice) }))
          : [{ description: "", qty: "1", unitPrice: "" }]
      );
      setDiscountPct(String(reviseOf.discountPct ?? 0));
      setTaxPct(String(reviseOf.taxName ? reviseOf.taxPct ?? 0 : 0));
      setTaxName(reviseOf.taxName ?? "none");
      const revNote = `Revisi ke-${reviseOf.revisionNo ? reviseOf.revisionNo + 1 : 1} dari ${reviseOf.number}${reviseOf.notes ? ` — ${reviseOf.notes}` : ""}`;
      setNotes(revNote);
      setValidUntil(defaultValidUntil());
    } else {
      // Ronde 49 — estimasi detail (approved/pending) sebagai sumber prefill item:
      // RAB kategori→item → SATU baris per KATEGORI (harga kategori saja — rincian
      // item tidak diekspos ke klien); legacy costItems per item; terakhir fallback
      // single-line senilai revenue estimasi.
      const estCats = parseEstimationCategories(estimation);
      const estItems = parseEstimationCostItems(estimation);
      const estRevenue = Number(estimation?.revenue ?? 0);
      setDiscountPct(String(estimation?.discountPct ?? 0));
      if (estCats.length > 0) {
        prefilledFromEstimation.current = false;
        prefilledFromCostItems.current = true;
        setRows(
          estCats.map((cat) => ({
            description: cat.name,
            qty: "1",
            unitPrice: String(cat.total),
          }))
        );
        setTaxPct(String(estimation?.taxName ? estimation?.taxPct ?? 0 : 0));
        setTaxName(estimation?.taxName ?? "");
      } else if (estItems.length > 0) {
        prefilledFromEstimation.current = false;
        prefilledFromCostItems.current = true;
        setRows(
          estItems.map((it) => ({
            description: it.name + (it.days ? ` (${it.days} hari)` : ""),
            qty: String(it.qty ?? 0),
            unitPrice: String(it.unitPrice ?? 0),
          }))
        );
        setTaxPct(String(estimation?.taxName ? estimation?.taxPct ?? 0 : 0));
        setTaxName(estimation?.taxName ?? "");
      } else if (estRevenue > 0) {
        prefilledFromCostItems.current = false;
        const label = serviceName?.trim()
          ? `Layanan ${serviceName.trim()} — sesuai estimasi detail`
          : "Layanan utama — sesuai estimasi detail";
        setRows([{ description: label, qty: "1", unitPrice: String(estRevenue) }]);
        setTaxPct(String(estimation?.taxName ? estimation?.taxPct ?? 0 : 0));
        setTaxName(estimation?.taxName ?? "");
        prefilledFromEstimation.current = true;
      } else {
        prefilledFromEstimation.current = false;
        prefilledFromCostItems.current = false;
        setRows([{ description: "", qty: "1", unitPrice: "" }]);
        setDiscountPct("0");
        setTaxPct("0");
        setTaxName("");
      }
      setNotes("");
      setValidUntil(defaultValidUntil());
    }
  }, [open, editing, reviseOf, estimation, serviceName]);

  // Ronde 40-E — default pajak saat membuat baru tanpa taxName tersimpan:
  // pajak pertama yang namanya diawali "PPN", bila tidak ada pakai pajak pertama.
  useEffect(() => {
    if (!open || taxName !== "" || taxOptions === null) return;
    const ppn = taxOptions.find((t) => t.name.toUpperCase().startsWith("PPN"));
    const pick = ppn ?? taxOptions[0];
    if (pick) {
      setTaxName(pick.name);
      setTaxPct(String(pick.rate));
    } else {
      setTaxName("none");
      setTaxPct("0");
    }
  }, [open, taxName, taxOptions]);

  // Ronde 40-E — pajak efektif: ""/"none" = tanpa pajak (taxPct 0), selain itu pakai rate opsi
  const effectiveTaxName = taxName && taxName !== "none" ? taxName : null;
  // Ronde 36 (audit FIX): persen dipatok 0–100 di klien juga — dulu -10 DISKON
  // bisa menaikkan total dokumen resmi, 150% pajak juga lolos (server kini clamp juga).
  const discountPctNum = Math.min(100, Math.max(0, toNum(discountPct)));
  const taxPctNum = effectiveTaxName ? Math.min(100, Math.max(0, toNum(taxPct))) : 0;

  // Opsi Select pajak: master + nilai tersimpan bila tak ada di master (mis. diinput lama)
  const taxSelectOptions = useMemo(() => {
    const base = taxOptions === null ? [] : taxOptions.length > 0 ? taxOptions : FALLBACK_TAX_OPTIONS;
    if (effectiveTaxName && !base.some((t) => t.name === effectiveTaxName)) {
      return [...base, { name: effectiveTaxName, rate: toNum(taxPct) }];
    }
    return base;
  }, [taxOptions, effectiveTaxName, taxPct]);

  const totals = useMemo(() => {
    const items = rows.map((r) => {
      const qty = toNum(r.qty) || 1;
      const unitPrice = toNum(r.unitPrice);
      return { description: r.description.trim(), qty, unitPrice, subtotal: qty * unitPrice };
    });
    const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
    const discountAmount = Math.round((subtotal * discountPctNum) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = Math.round((afterDiscount * taxPctNum) / 100);
    return { items, subtotal, discountAmount, taxAmount, total: afterDiscount + taxAmount };
  }, [rows, discountPctNum, taxPctNum]);

  const filledItems = totals.items.filter((it) => it.description.length > 0);

  async function submit() {
    if (filledItems.length === 0) {
      toast.error("Minimal satu item dengan deskripsi wajib diisi");
      return;
    }
    if (toNum(discountPct) < 0 || toNum(discountPct) > 100 || toNum(taxPct) < 0 || toNum(taxPct) > 100) {
      toast.error("Diskon & PPN harus angka antara 0–100");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.quotationAction(editing.id, {
          action: "update",
          items: filledItems,
          discountPct: discountPctNum,
          // Ronde 40-E — nama pajak ikut tersimpan; null → taxPct dipaksa 0 di server
          taxName: effectiveTaxName,
          taxPct: taxPctNum,
          notes: notes.trim() || null,
          validUntil: validUntil || null,
          actorName,
          actorRole,
        });
        toast.success(`Quotation ${editing.number} diperbarui`);
      } else {
        await api.createQuotation({
          opportunityId,
          items: filledItems,
          discountPct: discountPctNum,
          taxName: effectiveTaxName,
          taxPct: taxPctNum,
          notes: notes.trim() || undefined,
          validUntil: validUntil || undefined,
          // Ronde 39 — kaitkan quotation baru sebagai revisi dari quotation sumber
          ...(reviseOf ? { revisionOfId: reviseOf.id } : {}),
          actorName,
          actorRole,
        });
        toast.success(reviseOf ? `Revisi quotation dibuat (menyusul ${reviseOf.number})` : "Quotation draft dibuat");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan quotation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Quotation ${editing.number}` : reviseOf ? `Revisi dari ${reviseOf.number}` : "Quotation Baru"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Perubahan hanya dapat dilakukan selama quotation masih berstatus draft."
              : reviseOf
                ? `Isi tersalin dari ${reviseOf.number} yang ditolak — sesuaikan penawaran lalu kirim ke klien sebagai versi baru.`
                : "Susun item penawaran. Quotation dibuat sebagai draft — kirim ke klien setelah selesai."}
          </DialogDescription>
        </DialogHeader>

        <div className="crm-scroll max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {prefilledFromCostItems.current ? (
            <p className="flex items-start gap-1.5 rounded-lg border bg-zinc-50 px-2.5 py-2 text-xs text-zinc-500" role="status">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Item mengikuti rincian estimasi — sesuaikan hingga total mendekati grand total estimasi ({" "}
                {formatCurrencyFull(Number(estimation?.grandTotal ?? 0), currency)}).
              </span>
            </p>
          ) : prefilledFromEstimation.current ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800" role="status">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Item diisi otomatis dari <strong>estimasi detail</strong> (revenue{" "}
                {formatCurrencyFull(Number(estimation?.revenue ?? 0), currency)}). Sesuaikan item bila penawaran dibagi per komponen.
              </span>
            </p>
          ) : null}
          <div className="space-y-2">
            <div className="hidden gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400 sm:grid sm:grid-cols-[minmax(0,1fr)_72px_130px_110px_36px]">
              <span>Deskripsi</span>
              <span>Qty</span>
              <span>Harga Satuan</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>
            {rows.map((row, idx) => (
              <ItemRow
                key={idx}
                index={idx}
                row={row}
                currency={currency}
                disabled={saving}
                canRemove={rows.length > 1}
                onChange={(patch) =>
                  setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
                }
                onRemove={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRows((rs) => [...rs, { description: "", qty: "1", unitPrice: "" }])}
              disabled={saving}
            >
              <Plus className="size-4" aria-hidden="true" />
              Tambah Item
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="q-disc" className="text-xs font-medium text-zinc-600">
                Discount %
              </label>
              <Input
                id="q-disc"
                type="number"
                min={0}
                max={100}
                step="0.5"
                className="h-8"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                disabled={saving}
                aria-label="Persentase diskon quotation"
              />
            </div>
            <div className="space-y-1">
              {/* Ronde 40-E — pajak dari master (bukan input PPN % bebas) */}
              <label htmlFor="q-tax" className="text-xs font-medium text-zinc-600">
                Pajak
              </label>
              <Select
                value={taxName === "" ? undefined : taxName}
                onValueChange={(v) => {
                  setTaxName(v);
                  if (v === "none") {
                    setTaxPct("0");
                    return;
                  }
                  const opt = taxSelectOptions.find((t) => t.name === v);
                  if (opt) setTaxPct(String(opt.rate));
                }}
                disabled={saving}
              >
                <SelectTrigger id="q-tax" size="sm" className="w-full text-sm" aria-label="Pilih pajak quotation">
                  <SelectValue placeholder="Pilih pajak" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa Pajak</SelectItem>
                  {taxSelectOptions.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name} ({t.rate}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <label htmlFor="q-valid" className="text-xs font-medium text-zinc-600">
                Berlaku Sampai
              </label>
              <Input
                id="q-valid"
                type="date"
                className="h-8"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                disabled={saving}
                aria-label="Tanggal berlaku sampai quotation"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="q-notes" className="text-xs font-medium text-zinc-600">
              Catatan
            </label>
            <Textarea
              id="q-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              placeholder="Catatan untuk klien (opsional)"
              aria-label="Catatan quotation"
            />
          </div>

          <div className="space-y-1 rounded-xl border bg-zinc-50 p-3 text-sm">
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCurrencyFull(totals.subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>Diskon {toNum(discountPct)}%</span>
              <span className="tabular-nums">-{formatCurrencyFull(totals.discountAmount, currency)}</span>
            </div>
            <div className="flex justify-between text-zinc-500">
              {/* Ronde 40-E — label pajak memakai nama master pajak */}
              <span>{effectiveTaxName ? `${effectiveTaxName} ${toNum(taxPct)}%` : "Tanpa Pajak"}</span>
              <span className="tabular-nums">{formatCurrencyFull(totals.taxAmount, currency)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-zinc-200 pt-1 font-semibold text-zinc-900">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrencyFull(totals.total, currency)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button
            className="bg-zinc-900 hover:bg-zinc-800"
            onClick={() => void submit()}
            disabled={saving || filledItems.length === 0}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            {editing ? "Simpan Perubahan" : "Buat Quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotationDetail({ quotation: q, items }: { quotation: QuotationDTO; items: QuotationItemDTO[] }) {
  return (
    <div className="border-t bg-zinc-50 px-3 py-3">
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400">Tidak ada item pada quotation ini.</p>
      ) : (
        <div className="crm-scroll overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400">
                <th scope="col" className="pb-1 font-medium">Deskripsi</th>
                <th scope="col" className="pb-1 text-right font-medium">Qty</th>
                <th scope="col" className="pb-1 text-right font-medium">Harga</th>
                <th scope="col" className="pb-1 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t border-zinc-200/70">
                  <td className="py-1 pr-2 text-zinc-700">{it.description}</td>
                  <td className="py-1 text-right tabular-nums text-zinc-600">{it.qty}</td>
                  <td className="py-1 text-right tabular-nums text-zinc-600">{formatCurrency(it.unitPrice, q.currency)}</td>
                  <td className="py-1 text-right font-medium tabular-nums text-zinc-800">{formatCurrency(it.subtotal, q.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 space-y-0.5 border-t border-dashed border-zinc-200 pt-2 text-xs">
        <div className="flex justify-between text-zinc-500">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatCurrencyFull(q.subtotal, q.currency)}</span>
        </div>
        <div className="flex justify-between text-zinc-500">
          <span>Diskon {q.discountPct}%</span>
          <span className="tabular-nums">-{formatCurrencyFull(q.discountAmount, q.currency)}</span>
        </div>
        <div className="flex justify-between text-zinc-500">
          <span>PPN {q.taxPct}%</span>
          <span className="tabular-nums">{formatCurrencyFull(q.taxAmount, q.currency)}</span>
        </div>
        <div className="flex justify-between font-semibold text-zinc-900">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrencyFull(q.total, q.currency)}</span>
        </div>
      </div>
    </div>
  );
}

function QuotationCard({
  quotation: q,
  brandColor,
  busy,
  expanded,
  onToggle,
  onEdit,
  onRevise,
  onPrint,
  onAction,
}: {
  quotation: QuotationDTO;
  brandColor?: string;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  /** Ronde 39 — revisi & kirim ulang (quotation ditolak). */
  onRevise?: () => void;
  onPrint: () => void;
  onAction: (action: QuotationAction) => void;
}) {
  const items = parseQuotationItems(q.items);
  const meta = QUOTATION_STATUS[q.status] ?? { label: q.status, cls: "bg-zinc-100 text-zinc-700 hover:bg-zinc-100" };
  const overdue = q.status === "sent" && isPastDate(q.validUntil);

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: brandColor ?? "#a1a1aa" }} aria-hidden="true" />
        <span className="font-mono text-sm font-semibold text-zinc-800">{q.number}</span>
        <Badge className={cn("border-transparent text-[10px]", meta.cls)}>{meta.label}</Badge>
        {(q.revisionNo ?? 0) > 0 ? (
          <Badge className="border-transparent bg-amber-100 text-[10px] text-amber-800 hover:bg-amber-100">Revisi ke-{q.revisionNo}</Badge>
        ) : null}
        <span className="ml-auto text-sm font-semibold tabular-nums text-zinc-900">
          {formatCurrencyFull(q.total, q.currency)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 pt-1 text-[11px] text-zinc-500">
        <span>{items.length} item</span>
        {q.sentAt ? <span>Dikirim {formatDate(q.sentAt)}</span> : null}
        {q.validUntil ? (
          <span className={cn(overdue && "font-medium text-red-600")}>
            Berlaku s.d. {formatDate(q.validUntil)}
            {overdue ? " · sudah lewat" : ""}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="ml-auto inline-flex items-center gap-1 rounded font-medium text-zinc-600 transition-colors hover:text-zinc-900"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          {expanded ? "Sembunyikan" : "Detail"}
        </button>
      </div>

      {expanded ? <QuotationDetail quotation={q} items={items} /> : null}

      <div className="flex flex-wrap gap-2 border-t px-3 py-2">
          {q.status === "draft" ? (
            <>
              <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={() => onAction("send")} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                Kirim ke Klien
              </Button>
              <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Button>
            </>
          ) : null}
          {q.status === "rejected" && onRevise ? (
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-50" onClick={onRevise} disabled={busy}>
              <Pencil className="size-4" aria-hidden="true" />
              Revisi & Kirim Ulang
            </Button>
          ) : null}
          {q.status === "sent" ? (
            <>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onAction("accept")} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="size-4" aria-hidden="true" />}
                Tandai Diterima
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={() => onAction("reject")}
                disabled={busy}
              >
                <XCircle className="size-4" aria-hidden="true" />
                Ditolak Klien
              </Button>
            </>
          ) : null}
          {q.status === "accepted" ? (
            <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={() => onAction("convert_invoice")} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ReceiptText className="size-4" aria-hidden="true" />}
              Konversi ke Invoice
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            aria-label={`Cetak quotation ${q.number}`}
            onClick={(e) => {
              e.stopPropagation();
              onPrint();
            }}
          >
            <Printer className="size-4" aria-hidden="true" />
            Cetak
          </Button>
      </div>
    </div>
  );
}

function QuotationTab({
  opportunityId,
  quotations,
  brandColors,
  defaultCurrency,
  actorName,
  actorRole,
  estimation,
  serviceName,
  defaultSendChannel,
  onPrint,
  onChanged,
}: {
  opportunityId: string;
  quotations: QuotationDTO[];
  brandColors: Record<string, string>;
  defaultCurrency: string;
  actorName: string;
  actorRole: string;
  /** Ronde 35 — estimasi detail utk prefill item quotation. */
  estimation: EstimationDTO | null;
  serviceName?: string | null;
  /** Ronde 40-E — kanal default dialog kirim (dari preferredChannel kontak). */
  defaultSendChannel?: string | null;
  onPrint: (q: QuotationDTO) => void;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuotationDTO | null>(null);
  // Ronde 39 — quotation sumber saat mode revisi
  const [reviseOf, setReviseOf] = useState<QuotationDTO | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Ronde 40-E — dialog pilih kanal sebelum kirim ke klien
  const [sendTarget, setSendTarget] = useState<QuotationDTO | null>(null);
  const [sendChannel, setSendChannel] = useState("email");

  async function runAction(q: QuotationDTO, action: QuotationAction, extra?: Record<string, unknown>) {
    setBusyId(q.id);
    try {
      const res = await api.quotationAction(q.id, { action, actorName, actorRole, ...extra });
      // Ronde 40-E — toast kirim menyebut kanal terpilih (tanda kirim, bukan pengiriman nyata)
      if (action === "send") toast.success(`Quotation ${q.number} dikirim via ${channelLabel(String(extra?.channel ?? "email"))} (tanda kirim)`);
      else if (action === "accept") toast.success(`Quotation ${q.number} diterima — stage jadi Verbal Agreement`);
      else if (action === "reject") toast.success(`Quotation ${q.number} ditandai ditolak klien`);
      else if (action === "convert_invoice" && res.invoice) toast.success(`Invoice ${res.invoice.number} dibuat`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Aksi quotation gagal");
    } finally {
      setBusyId(null);
    }
  }

  // Ronde 40-E — kartu draft "Kirim ke Klien" tidak langsung mengirim: buka dialog kanal dulu
  function openSendDialog(q: QuotationDTO) {
    const preferred = defaultSendChannel ?? "email";
    setSendChannel(CHANNELS.some((c) => c.key === preferred) ? preferred : "email");
    setSendTarget(q);
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(q: QuotationDTO) {
    setEditing(q);
    setReviseOf(null);
    setFormOpen(true);
  }

  // Ronde 39 — revisi: buat quotation BARU tersalin dari quotation yang ditolak.
  function openRevise(q: QuotationDTO) {
    setEditing(null);
    setReviseOf(q);
    setFormOpen(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">
          {quotations.length > 0 ? `${quotations.length} quotation pada opportunity ini.` : "Belum ada quotation."}
        </p>
        <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          Quotation Baru
        </Button>
      </div>

      {quotations.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <FileText className="mx-auto size-6 text-zinc-300" aria-hidden="true" />
          <p className="mt-1 text-sm text-zinc-400">
            Buat quotation dari estimasi yang sudah disepakati, lalu kirim ke klien.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {quotations.map((q) => (
            <QuotationCard
              key={q.id}
              quotation={q}
              brandColor={brandColors[q.brandId]}
              busy={busyId === q.id}
              expanded={expandedId === q.id}
              onToggle={() => setExpandedId((v) => (v === q.id ? null : q.id))}
              onEdit={() => openEdit(q)}
              onRevise={() => openRevise(q)}
              onPrint={() => onPrint(q)}
              onAction={(a) => {
                if (a === "send") {
                  openSendDialog(q);
                  return;
                }
                void runAction(q, a);
              }}
            />
          ))}
        </div>
      )}

      <QuotationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        opportunityId={opportunityId}
        defaultCurrency={defaultCurrency}
        editing={editing}
        reviseOf={reviseOf}
        actorName={actorName}
        actorRole={actorRole}
        estimation={estimation}
        serviceName={serviceName}
        onSaved={onChanged}
      />

      {/* Ronde 40-E — dialog pilih kanal kirim ke klien */}
      <Dialog open={!!sendTarget} onOpenChange={(v) => { if (!v) setSendTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kirim ke Klien</DialogTitle>
            <DialogDescription>
              Pilih kanal pengiriman (mode dev: dicatat sebagai tanda kirim di timeline &amp; memicu notifikasi —
              bukan pengiriman nyata):
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="q-send-channel" className="text-xs font-medium text-zinc-600">
              Kanal
            </label>
            <Select value={sendChannel} onValueChange={setSendChannel}>
              <SelectTrigger id="q-send-channel" className="w-full" aria-label="Kanal pengiriman quotation">
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
            {sendTarget ? (
              <p className="pt-1 text-xs text-zinc-400">
                Quotation {sendTarget.number} · {formatCurrencyFull(sendTarget.total, sendTarget.currency)}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTarget(null)} disabled={busyId === sendTarget?.id}>
              Batal
            </Button>
            <Button
              className="bg-zinc-900 hover:bg-zinc-800"
              onClick={() => {
                const q = sendTarget;
                setSendTarget(null);
                if (q) void runAction(q, "send", { channel: sendChannel });
              }}
              disabled={!sendTarget}
              aria-label="Kirim quotation ke klien"
            >
              <Send className="size-4" aria-hidden="true" />
              Kirim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Komponen utama ----------

export default function OpportunityDetail({ opportunityId, open, onOpenChange, onChanged }: OpportunityDetailProps) {
  const { user, brands } = useCrmStore();
  // Ronde 32 — tombol "Buka Percakapan di Inbox" dari drawer opportunity
  const setPendingFocus = useCrmStore((s) => s.setPendingFocus);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  // Ronde 39 — edit peluang dari drawer (pemilik/pimpinan)
  const [editOpen, setEditOpen] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(opportunityId);
  const [data, setData] = useState<DetailData | null>(null);
  const [related, setRelated] = useState<RelatedOpp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ronde 39 — editing sesuai user: pemilik opportunity atau pimpinan (super_admin/director)
  const canEditOpp = !!data && !!user && (user.role === "super_admin" || user.role === "director" || data.ownerName === user.name);

  // AI summary
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Form kirim pesan
  const [msgChannel, setMsgChannel] = useState<string>("whatsapp");
  const [msgContent, setMsgContent] = useState("");
  const [sending, setSending] = useState(false);

  // Task — Ronde 40-E: quick-add inline diganti dialog tugas bersama
  const [taskFormOpen, setTaskFormOpen] = useState(false);

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

  // Ronde 48 — dialog nurture (standar: segmen + tanggal follow-up wajib, server menegakkan)
  const [nurtureOpen, setNurtureOpen] = useState(false);
  const [nurtureSegmentDraft, setNurtureSegmentDraft] = useState("");
  const [nurtureDateDraft, setNurtureDateDraft] = useState("");

  // Dialog cross-sell
  const [crossOpen, setCrossOpen] = useState(false);
  const [crossBrand, setCrossBrand] = useState("");
  const [crossTitle, setCrossTitle] = useState("");
  const [crossValue, setCrossValue] = useState("");
  const [crossSaving, setCrossSaving] = useState(false);

  // Cetak quotation dari drawer (Task 12-b): target quotation + brand utk QuotationPrintArea.
  const [printTarget, setPrintTarget] = useState<QuotationDTO | null>(null);

  // Brief Builder (ronde 18): status brief utk dot pada tab trigger.
  const [briefStatus, setBriefStatus] = useState<BriefStatus | null>(null);
  const handleBriefStatus = useCallback((s: BriefStatus | null) => setBriefStatus(s), []);

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

  // Cetak quotation: render #print-area lalu panggil window.print, bersihkan setelah print selesai
  // (pola finance-module). Guard `open` agar tidak mencetak saat sheet ditutup.
  useEffect(() => {
    if (!printTarget || !open) return;
    const timer = setTimeout(() => window.print(), 100);
    const after = () => setPrintTarget(null);
    window.addEventListener("afterprint", after);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", after);
    };
  }, [printTarget, open]);

  // Bersihkan target cetak saat drawer ditutup.
  useEffect(() => {
    if (!open && printTarget) setPrintTarget(null);
  }, [open, printTarget]);

  // Reset state turunan ketika opportunity berubah / data baru masuk
  useEffect(() => {
    setStageSelect(data?.stage ?? "");
    setAiText(null);
    setAiError(null);
    setMsgContent("");
    setTaskFormOpen(false);
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

  // Peta warna brand untuk dot pada kartu quotation (detail API tidak include brand di quotations)
  const brandColors = useMemo(
    () => Object.fromEntries(brands.map((b) => [b.id, b.color])),
    [brands]
  );

  // Fase 4: skor lead dihitung ulang di klien dari data detail + counts (fallback panjang array)
  const leadScore = useMemo(() => {
    if (!data) return null;
    return computeLeadScore(data, {
      interactions: data._count?.interactions ?? data.interactions.length,
      tasks: data._count?.tasks ?? data.tasks.length,
    });
  }, [data]);

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

  // Ronde 36 (audit FIX): guard per-baris — dobel-klik checkbox tidak lagi
  // mengirim dua PATCH (dulu last-write-wins bisa balikin status).
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);

  async function toggleTask(task: TaskRow, done: boolean) {
    if (taskBusyId) return;
    setTaskBusyId(task.id);
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
    } finally {
      setTaskBusyId(null);
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
        // Ronde 38 — tombol aksi di toast: langsung buka detail project produksi.
        toast.success(
          res.createdProject
            ? `Deal Won! Project ${res.createdProject.code} otomatis dibuat beserta invoice DP`
            : "Stage diubah ke Won",
          res.createdProject
            ? {
                action: {
                  label: "Buka Project",
                  onClick: () => {
                    setPendingFocus({ module: "projects", id: res.createdProject!.id });
                    setActiveModule("projects");
                  },
                },
              }
            : undefined
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
    // Ronde 48 — nurture wajib segmen + tanggal follow-up (dialog, sama seperti lost)
    if (stageSelect === "nurture") {
      setNurtureSegmentDraft(data.nurtureSegment ?? "");
      setNurtureDateDraft("");
      setNurtureOpen(true);
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

  // ---------- Fase 2: handler estimasi & quotation ----------

  function handleEstimationSaved(estimation: EstimationDTO) {
    setData((prev) => (prev ? { ...prev, estimation } : prev));
    void load();
    onChanged?.();
  }

  // Ronde 40-E — reload detail penuh (dipakai setelah keputusan approval estimasi)
  function handleDetailChanged() {
    void load();
    onChanged?.();
  }

  function handleQuotationChanged() {
    void load();
    onChanged?.();
  }

  // ---------- Render ----------

  // Brand utk kop quotation yang dicetak (detail API tidak include brand di quotations — fallback null).
  const printBrand: Brand | null = printTarget
    ? printTarget.brand ?? brands.find((b) => b.id === printTarget.brandId) ?? null
    : null;

  return (
    <>
      {/* Area cetak quotation (hanya tampil saat window.print — lihat globals.css) */}
      {printTarget ? <QuotationPrintArea quotation={printTarget} brand={printBrand} /> : null}
      <Sheet open={open && !!activeId} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          {loading && !data ? (
            <div className="flex-1 space-y-4 p-4">
              {/* a11y: Radix DialogContent wajib memiliki Title juga saat state loading */}
              <SheetTitle className="sr-only">Detail opportunity</SheetTitle>
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
              {/* a11y: Title wajib ada juga di state error */}
              <SheetTitle className="sr-only">Detail opportunity gagal dimuat</SheetTitle>
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
                  {data.stage !== "won" && data.stage !== "lost" && leadScore ? (
                    <ScoreBadge score={leadScore.score} reasons={leadScore.reasons} />
                  ) : null}
                </div>
                <SheetTitle className="text-base leading-snug">{data.title}</SheetTitle>
                <SheetDescription>
                  {data.company?.name ?? "Tanpa perusahaan"} · {data.contact?.fullName ?? "Tanpa contact"}
                  {data.serviceName ? ` · ${data.serviceName}` : ""}
                </SheetDescription>
                {/* Ronde 39 — edit peluang sesuai user: pemilik atau pimpinan */}
                {canEditOpp ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8 w-fit gap-1.5"
                    onClick={() => setEditOpen(true)}
                    aria-label={`Edit peluang ${data.title}`}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit Peluang
                  </Button>
                ) : null}
                {/* Ronde 32 — pintasan bolak-balik Pipeline → Inbox: buka thread chat
                    opportunity ini di Lead Inbox (tab Semua Percakapan). */}
                {data.interactions.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8 w-fit gap-1.5 border-emerald-300 bg-white text-xs text-emerald-700 hover:bg-emerald-50"
                    onClick={() => {
                      setPendingFocus({ module: "inbox", id: data.id });
                      setActiveModule("inbox");
                      onOpenChange(false);
                    }}
                    aria-label={`Buka percakapan opportunity ${data.title} di Lead Inbox`}
                  >
                    <MessageSquare className="size-3.5" aria-hidden="true" />
                    Buka Percakapan di Inbox
                    <span className="font-normal opacity-70">({data.interactions.length} pesan)</span>
                  </Button>
                ) : null}
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

                {/* Ronde 34 — record Project produksi yang lahir dari deal Won:
                    dulu data ini SUDAH dikirim API tapi tidak pernah dirender —
                    sales tidak tahu deal won-nya sudah jadi project apa. */}
                {(data.projects ?? []).length > 0 ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      <FolderKanban className="size-3.5" aria-hidden="true" /> Project Produksi
                    </p>
                    {(data.projects ?? []).map((p) => (
                      <div key={p.id} className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-900">
                            <span className="font-mono text-xs text-zinc-500">{p.code}</span> · {p.name}
                          </p>
                          <p className="text-xs text-emerald-700">
                            {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                            {" · "}{p.progress}%
                            {" · "}{(p.milestones ?? []).filter((m) => m.status === "done").length}/{(p.milestones ?? []).length} milestone selesai
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 gap-1.5 border-emerald-300 bg-white text-xs text-emerald-700 hover:bg-emerald-100"
                          onClick={() => {
                            setPendingFocus({ module: "projects", id: p.id });
                            setActiveModule("projects");
                            onOpenChange(false);
                          }}
                          aria-label={`Buka project ${p.code} di modul Projects`}
                        >
                          Buka di Projects
                          <ArrowRight className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {data.lostReason ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <span className="font-semibold">Alasan lost:</span> {data.lostReason}
                    {data.competitor ? ` · Kompetitor: ${data.competitor}` : ""}
                    {data.lostNotes ? <p className="mt-1 text-red-600/80">{data.lostNotes}</p> : null}
                  </div>
                ) : null}

                {data.brief ? (
                  <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Brief awal (teks intake)</p>
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
                    <TabsTrigger value="brief" className="gap-1.5">
                      <ClipboardList className="size-3.5" aria-hidden="true" />
                      Brief
                      {briefStatus ? (
                        <span
                          className={cn("size-1.5 rounded-full", BRIEF_STATUS_META[briefStatus]?.dotCls ?? "bg-zinc-400")}
                          aria-label={`Brief berstatus ${BRIEF_STATUS_META[briefStatus]?.label ?? briefStatus}`}
                        />
                      ) : null}
                    </TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="tasks">Tugas</TabsTrigger>
                    <TabsTrigger value="estimation" className="gap-1.5">
                      <Calculator className="size-3.5" aria-hidden="true" />
                      Estimasi
                    </TabsTrigger>
                    <TabsTrigger value="quotation" className="gap-1.5">
                      <FileText className="size-3.5" aria-hidden="true" />
                      Quotation
                    </TabsTrigger>
                    <TabsTrigger value="notes">Catatan</TabsTrigger>
                    <TabsTrigger value="related">Terkait</TabsTrigger>
                  </TabsList>

                  {/* Brief (Fase 2 — ronde 18) */}
                  <TabsContent value="brief" className="mt-3">
                    {data && activeId ? (
                      <BriefPanel
                        opportunityId={activeId}
                        opportunityTitle={data.title}
                        brandSlug={data.brand?.slug ?? ""}
                        brandColor={data.brand?.color ?? "#f97316"}
                        open={open}
                        onBriefStatusChange={handleBriefStatus}
                        onChanged={() => {
                          void load();
                          onChanged?.();
                        }}
                      />
                    ) : null}
                  </TabsContent>

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
                          // Ronde 40-E — multi-assignee & lampiran (parse defensif)
                          const assigneeList = taskAssigneeList(task);
                          const attachments = taskAttachmentList(task.attachments);
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
                                  {assigneeList.length > 0 ? (
                                    <span
                                      className="inline-flex items-center gap-1"
                                      title={`Ditugaskan ke: ${assigneeList.join(", ")}`}
                                      aria-label={`Ditugaskan ke ${assigneeList.join(", ")}`}
                                    >
                                      <span className="inline-flex -space-x-1" aria-hidden="true">
                                        {assigneeList.slice(0, 3).map((name) => (
                                          <span
                                            key={name}
                                            className="flex size-4 items-center justify-center rounded-full bg-zinc-200 text-[7px] font-bold text-zinc-600 ring-1 ring-white"
                                          >
                                            {initials(name)}
                                          </span>
                                        ))}
                                      </span>
                                      <span className="max-w-[160px] truncate">{assigneeList.join(", ")}</span>
                                    </span>
                                  ) : null}
                                  {task.dueDate ? (
                                    <span className={cn(overdue && "font-medium text-red-600")}>
                                      Jatuh tempo {formatDate(task.dueDate)}
                                      {overdue ? " · terlambat" : ""}
                                    </span>
                                  ) : null}
                                  {/* Ronde 40-E — lampiran tugas (kompak: maks 2 + sisanya dihitung) */}
                                  {attachments.slice(0, 2).map((a, i) => (
                                    <a
                                      key={`${a.type}-${i}`}
                                      href={a.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={a.name}
                                      aria-label={`Buka lampiran ${a.name}`}
                                      className="inline-flex max-w-full items-center gap-0.5 rounded px-0.5 font-medium text-zinc-500 transition-colors hover:text-zinc-900"
                                    >
                                      {a.type === "link" ? (
                                        <Link2 className="size-3 shrink-0" aria-hidden="true" />
                                      ) : (
                                        <Paperclip className="size-3 shrink-0" aria-hidden="true" />
                                      )}
                                      <span className="max-w-[90px] truncate">{a.name}</span>
                                    </a>
                                  ))}
                                  {attachments.length > 2 ? (
                                    <span className="text-zinc-400">+{attachments.length - 2} lampiran</span>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        className="bg-zinc-900 hover:bg-zinc-800"
                        onClick={() => setTaskFormOpen(true)}
                        aria-label="Tambah tugas baru untuk opportunity ini"
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        Tambah Tugas
                      </Button>
                    </div>
                  </TabsContent>

                  {/* Estimasi (Fase 2) */}
                  <TabsContent value="estimation" className="mt-3">
                    <EstimationTab
                      opportunityId={data.id}
                      initialEstimation={data.estimation ?? null}
                      currency={data.currency}
                      actorName={actorMeta.actorName}
                      actorRole={actorMeta.actorRole}
                      pendingApprovals={data.pendingApprovals}
                      onSaved={handleEstimationSaved}
                      onChanged={handleDetailChanged}
                      serviceName={data.serviceName}
                      brandId={data.brandId}
                    />
                  </TabsContent>

                  {/* Quotation (Fase 2) */}
                  <TabsContent value="quotation" className="mt-3">
                    <QuotationTab
                      opportunityId={data.id}
                      quotations={data.quotations ?? []}
                      brandColors={brandColors}
                      defaultCurrency={data.currency}
                      actorName={actorMeta.actorName}
                      actorRole={actorMeta.actorRole}
                      estimation={data.estimation ?? null}
                      serviceName={data.serviceName}
                      defaultSendChannel={data.contact?.preferredChannel ?? "email"}
                      onPrint={setPrintTarget}
                      onChanged={handleQuotationChanged}
                    />
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
                {canEditOpp ? (
                  <>
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
                  </>
                ) : (
                  /* Ronde 39 — read-only utk role non-pemilik/non-pimpinan (server menolak PATCH 403). */
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <StageBadge stage={data.stage} />
                      <span className="text-[11px] text-zinc-400">Stage saat ini</span>
                    </div>
                    <p className="text-[11px] leading-snug text-zinc-400">
                      Hanya pemilik opportunity atau pimpinan yang dapat memindahkan stage.
                    </p>
                  </div>
                )}
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

      {/* Ronde 48 — Dialog nurture (dari footer stage): segmen + jadwal follow-up wajib */}
      <Dialog open={nurtureOpen} onOpenChange={setNurtureOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pindah ke Nurture</DialogTitle>
            <DialogDescription>
              Simpan kontak ini untuk dihubungi kembali — pilih segmen &amp; jadwal penawaran ulang.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={nurtureSegmentDraft} onValueChange={setNurtureSegmentDraft}>
              <SelectTrigger className="w-full" aria-label="Segmen nurture">
                <SelectValue placeholder="Pilih segmen nurture" />
              </SelectTrigger>
              <SelectContent>
                {NURTURE_SEGMENTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600" htmlFor="nurture-followup-date">
                Tanggal follow-up berikutnya
              </label>
              <Input
                id="nurture-followup-date"
                type="date"
                value={nurtureDateDraft}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setNurtureDateDraft(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNurtureOpen(false)}>
              Batal
            </Button>
            <Button
              className="bg-zinc-900 hover:bg-zinc-800"
              disabled={!nurtureSegmentDraft || !nurtureDateDraft || savingStage}
              onClick={() => {
                setNurtureOpen(false);
                void commitStage("nurture", {
                  nurtureSegment: nurtureSegmentDraft,
                  followUpDate: nurtureDateDraft ? new Date(nurtureDateDraft).toISOString() : undefined,
                });
              }}
            >
              {savingStage ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Simpan Nurture
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

      {/* Ronde 39 — dialog edit peluang (mode EDIT: prefill + PATCH) */}
      {data ? (
        <OpportunityFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editData={data}
          onSaved={() => { void load(); onChanged?.(); }}
        />
      ) : null}

      {/* Ronde 40-E — dialog tugas bersama: opportunity terkunci ke peluang ini */}
      {data ? (
        <TaskFormDialog
          open={taskFormOpen}
          onOpenChange={setTaskFormOpen}
          lockedOpportunity={{ id: data.id, title: data.title }}
          presetAssignees={user?.name ? [user.name] : undefined}
          onSaved={() => { void load(); }}
        />
      ) : null}
    </>
  );
}
