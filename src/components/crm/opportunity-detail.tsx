"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  BadgeCheck,
  BedDouble,
  Calculator,
  Camera,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  FileText,
  Globe,
  Handshake,
  Hourglass,
  Instagram,
  Loader2,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  Monitor,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  Save,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  Truck,
  Users,
  Video,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { CHANNELS, LOST_REASONS, PIPELINE_STAGES, stageColor, stageLabel } from "@/lib/crm/constants";
import { computeLeadScore, scoreTier } from "@/lib/crm/scoring";
import { useCrmStore } from "@/lib/crm/store";
import type { EstimationDTO, QuotationDTO, QuotationItemDTO } from "@/lib/crm/types";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";
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

// ---------- Fase 2: helper estimasi & quotation ----------

function toNum(v: string): number {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? 0 : n;
}

type CostKey =
  | "laborInternal"
  | "vendorFreelance"
  | "equipment"
  | "transport"
  | "accommodation"
  | "talent"
  | "locationFee"
  | "softwareLicense"
  | "hostingDomain";

type PctKey = "contingencyPct" | "managementFeePct" | "discountPct" | "taxPct" | "targetMarginPct";

type EstimationForm = Record<CostKey | PctKey | "revenue" | "notes", string>;

const COST_CATEGORIES: { key: CostKey; label: string; Icon: LucideIcon }[] = [
  { key: "laborInternal", label: "Tenaga Internal", Icon: Users },
  { key: "vendorFreelance", label: "Vendor / Freelancer", Icon: Handshake },
  { key: "equipment", label: "Equipment", Icon: Camera },
  { key: "transport", label: "Transportasi", Icon: Truck },
  { key: "accommodation", label: "Akomodasi", Icon: BedDouble },
  { key: "talent", label: "Talent", Icon: Mic },
  { key: "locationFee", label: "Lokasi", Icon: MapPin },
  { key: "softwareLicense", label: "Software / Lisensi", Icon: Monitor },
  { key: "hostingDomain", label: "Hosting / Domain", Icon: Globe },
];

const PCT_PARAMETERS: { key: PctKey; label: string }[] = [
  { key: "contingencyPct", label: "Contingency %" },
  { key: "managementFeePct", label: "Management Fee %" },
  { key: "discountPct", label: "Discount %" },
  { key: "taxPct", label: "PPN %" },
];

/** Nilai default sama dengan default schema (contingency 5, mgmt fee 5, tax 11, target 30). */
const EMPTY_ESTIMATION_FORM: EstimationForm = {
  laborInternal: "0",
  vendorFreelance: "0",
  equipment: "0",
  transport: "0",
  accommodation: "0",
  talent: "0",
  locationFee: "0",
  softwareLicense: "0",
  hostingDomain: "0",
  contingencyPct: "5",
  managementFeePct: "5",
  discountPct: "0",
  taxPct: "11",
  targetMarginPct: "30",
  revenue: "0",
  notes: "",
};

function formFromEstimation(est: EstimationDTO): EstimationForm {
  return {
    laborInternal: String(est.laborInternal ?? 0),
    vendorFreelance: String(est.vendorFreelance ?? 0),
    equipment: String(est.equipment ?? 0),
    transport: String(est.transport ?? 0),
    accommodation: String(est.accommodation ?? 0),
    talent: String(est.talent ?? 0),
    locationFee: String(est.locationFee ?? 0),
    softwareLicense: String(est.softwareLicense ?? 0),
    hostingDomain: String(est.hostingDomain ?? 0),
    contingencyPct: String(est.contingencyPct ?? 0),
    managementFeePct: String(est.managementFeePct ?? 0),
    discountPct: String(est.discountPct ?? 0),
    taxPct: String(est.taxPct ?? 0),
    targetMarginPct: String(est.targetMarginPct ?? 0),
    revenue: String(est.revenue ?? 0),
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

/** Rumus identik dengan server (src/app/api/opportunities/[id]/estimation). */
function computeEstimation(form: EstimationForm): EstimationCalc {
  const totalCost = COST_CATEGORIES.reduce((s, c) => s + toNum(form[c.key]), 0);
  const contingency = Math.round((totalCost * toNum(form.contingencyPct)) / 100);
  const managementFee = Math.round((totalCost * toNum(form.managementFeePct)) / 100);
  const costWithFees = totalCost + contingency + managementFee;
  const revenue = toNum(form.revenue);
  const discountAmount = Math.round((revenue * toNum(form.discountPct)) / 100);
  const netRevenue = revenue - discountAmount;
  const taxAmount = Math.round((netRevenue * toNum(form.taxPct)) / 100);
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

function CalcPanel({ calc, form, currency }: { calc: EstimationCalc; form: EstimationForm; currency: string }) {
  const target = toNum(form.targetMarginPct);
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
        <CalcRow label={`PPN (${toNum(form.taxPct)}%)`} value={calc.taxAmount} currency={currency} muted />
        <CalcRow label="Grand Total" value={calc.grandTotal} currency={currency} />
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
  onSaved,
}: {
  opportunityId: string;
  initialEstimation: EstimationDTO | null;
  currency: string;
  actorName: string;
  actorRole: string;
  onSaved: (estimation: EstimationDTO) => void;
}) {
  const [est, setEst] = useState<EstimationDTO | null>(initialEstimation);
  const [form, setForm] = useState<EstimationForm>(() =>
    initialEstimation ? formFromEstimation(initialEstimation) : EMPTY_ESTIMATION_FORM
  );
  const [loading, setLoading] = useState(!initialEstimation);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const locked = est?.status === "pending_approval" || est?.status === "approved";
  const calc = useMemo(() => computeEstimation(form), [form]);
  const revenueNum = toNum(form.revenue);
  const disabled = loading || locked || saving;

  function setField(key: keyof EstimationForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function persist(submit: boolean) {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        submit,
        actorName,
        actorRole,
        notes: form.notes.trim() || null,
        revenue: revenueNum,
      };
      for (const c of COST_CATEGORIES) payload[c.key] = toNum(form[c.key]);
      for (const p of PCT_PARAMETERS) payload[p.key] = toNum(form[p.key]);
      payload.targetMarginPct = toNum(form.targetMarginPct);

      const res = await api.saveEstimation(opportunityId, payload);
      setEst(res.estimation);
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
          <div className="min-w-0">
            <p className="font-medium">{banner.text}</p>
            {banner.sub ? <p className="text-xs opacity-80">{banner.sub}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Cost breakdown */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Cost Breakdown</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {COST_CATEGORIES.map((c) => (
            <div key={c.key} className="space-y-1">
              <label htmlFor={`est-cost-${c.key}`} className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                <c.Icon className="size-3.5 text-zinc-400" aria-hidden="true" />
                {c.label}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden="true">
                  Rp
                </span>
                <Input
                  id={`est-cost-${c.key}`}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="pl-8"
                  value={form[c.key]}
                  onChange={(e) => setField(c.key, e.target.value)}
                  disabled={disabled}
                  placeholder="0"
                  aria-label={`${c.label} (Rupiah)`}
                />
              </div>
            </div>
          ))}
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
          </div>
          <div className="mt-3 space-y-1">
            <label htmlFor="est-revenue" className="text-xs font-semibold text-zinc-700">
              Harga Penawaran (Revenue)
            </label>
            <div className="relative max-w-xs">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400" aria-hidden="true">
                Rp
              </span>
              <Input
                id="est-revenue"
                type="number"
                min={0}
                inputMode="numeric"
                className="pl-8 font-semibold"
                value={form.revenue}
                onChange={(e) => setField("revenue", e.target.value)}
                disabled={disabled}
                placeholder="0"
                aria-label="Harga penawaran (Rupiah)"
              />
            </div>
          </div>
        </div>
      </div>

      <CalcPanel calc={calc} form={form} currency={currency} />

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
          <p className="text-xs text-zinc-400">Harga penawaran harus lebih dari 0 untuk mengajukan approval.</p>
        ) : null}
      </div>

      {/* Konfirmasi submit approval */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ajukan approval estimasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Estimasi dengan revenue {formatCurrencyFull(revenueNum, currency)} akan dikirim ke Direktur untuk
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
  actorName,
  actorRole,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opportunityId: string;
  defaultCurrency: string;
  editing: QuotationDTO | null;
  actorName: string;
  actorRole: string;
  onSaved: () => void;
}) {
  const currency = editing?.currency ?? defaultCurrency;
  const [rows, setRows] = useState<QuotationRow[]>([{ description: "", qty: "1", unitPrice: "" }]);
  const [discountPct, setDiscountPct] = useState("0");
  const [taxPct, setTaxPct] = useState("11");
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [saving, setSaving] = useState(false);

  // Prefill setiap kali dialog dibuka (mode buat / edit draft).
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const items = parseQuotationItems(editing.items);
      setRows(
        items.length > 0
          ? items.map((it) => ({ description: it.description, qty: String(it.qty), unitPrice: String(it.unitPrice) }))
          : [{ description: "", qty: "1", unitPrice: "" }]
      );
      setDiscountPct(String(editing.discountPct ?? 0));
      setTaxPct(String(editing.taxPct ?? 11));
      setNotes(editing.notes ?? "");
      setValidUntil(editing.validUntil ? editing.validUntil.slice(0, 10) : defaultValidUntil());
    } else {
      setRows([{ description: "", qty: "1", unitPrice: "" }]);
      setDiscountPct("0");
      setTaxPct("11");
      setNotes("");
      setValidUntil(defaultValidUntil());
    }
  }, [open, editing]);

  const totals = useMemo(() => {
    const items = rows.map((r) => {
      const qty = toNum(r.qty) || 1;
      const unitPrice = toNum(r.unitPrice);
      return { description: r.description.trim(), qty, unitPrice, subtotal: qty * unitPrice };
    });
    const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
    const discountAmount = Math.round((subtotal * toNum(discountPct)) / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = Math.round((afterDiscount * toNum(taxPct)) / 100);
    return { items, subtotal, discountAmount, taxAmount, total: afterDiscount + taxAmount };
  }, [rows, discountPct, taxPct]);

  const filledItems = totals.items.filter((it) => it.description.length > 0);

  async function submit() {
    if (filledItems.length === 0) {
      toast.error("Minimal satu item dengan deskripsi wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.quotationAction(editing.id, {
          action: "update",
          items: filledItems,
          discountPct: toNum(discountPct),
          taxPct: toNum(taxPct),
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
          discountPct: toNum(discountPct),
          taxPct: toNum(taxPct),
          notes: notes.trim() || undefined,
          validUntil: validUntil || undefined,
          actorName,
          actorRole,
        });
        toast.success("Quotation draft dibuat");
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
          <DialogTitle>{editing ? `Edit Quotation ${editing.number}` : "Quotation Baru"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Perubahan hanya dapat dilakukan selama quotation masih berstatus draft."
              : "Susun item penawaran. Quotation dibuat sebagai draft — kirim ke klien setelah selesai."}
          </DialogDescription>
        </DialogHeader>

        <div className="crm-scroll max-h-[60vh] space-y-3 overflow-y-auto pr-1">
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
              <label htmlFor="q-tax" className="text-xs font-medium text-zinc-600">
                PPN %
              </label>
              <Input
                id="q-tax"
                type="number"
                min={0}
                max={100}
                step="0.5"
                className="h-8"
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
                disabled={saving}
                aria-label="Persentase PPN quotation"
              />
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
              <span>PPN {toNum(taxPct)}%</span>
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
  onAction,
}: {
  quotation: QuotationDTO;
  brandColor?: string;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
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

      {q.status === "draft" || q.status === "sent" || q.status === "accepted" ? (
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
        </div>
      ) : null}
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
  onChanged,
}: {
  opportunityId: string;
  quotations: QuotationDTO[];
  brandColors: Record<string, string>;
  defaultCurrency: string;
  actorName: string;
  actorRole: string;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuotationDTO | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runAction(q: QuotationDTO, action: QuotationAction) {
    setBusyId(q.id);
    try {
      const res = await api.quotationAction(q.id, { action, actorName, actorRole });
      if (action === "send") toast.success(`Quotation ${q.number} dikirim ke klien`);
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

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(q: QuotationDTO) {
    setEditing(q);
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
              onAction={(a) => void runAction(q, a)}
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
        actorName={actorName}
        actorRole={actorRole}
        onSaved={onChanged}
      />
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

  // ---------- Fase 2: handler estimasi & quotation ----------

  function handleEstimationSaved(estimation: EstimationDTO) {
    setData((prev) => (prev ? { ...prev, estimation } : prev));
    void load();
    onChanged?.();
  }

  function handleQuotationChanged() {
    void load();
    onChanged?.();
  }

  // ---------- Render ----------

  return (
    <>
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

                  {/* Estimasi (Fase 2) */}
                  <TabsContent value="estimation" className="mt-3">
                    <EstimationTab
                      opportunityId={data.id}
                      initialEstimation={data.estimation ?? null}
                      currency={data.currency}
                      actorName={actorMeta.actorName}
                      actorRole={actorMeta.actorRole}
                      onSaved={handleEstimationSaved}
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
