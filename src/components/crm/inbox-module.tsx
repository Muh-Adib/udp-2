"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock, AlertTriangle, Building2, Check, CheckCircle2, Fingerprint, Globe, Inbox,
  Instagram, LayoutDashboard, Loader2, Mail, MessageCircle, Phone, RefreshCw, ShieldAlert,
  Timer, TimerOff, User, UserPlus, Video, X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import { BRAND_SERVICES, CHANNELS, PRIORITIES, SERVICE_CATEGORIES } from "@/lib/crm/constants";
import { formatDateTime, initials, timeAgo } from "@/lib/crm/utils";
import type { InteractionDTO, MatchCandidateDTO } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

// ============ Tipe lokal ============

type InboxLead = InteractionDTO & { slaHours: number; candidates: MatchCandidateDTO[] };

interface ContactFormState {
  firstName: string; lastName: string; email: string; whatsapp: string; companyName: string; city: string;
}
interface OpportunityFormState {
  brandId: string; title: string; serviceCategory: string; serviceName: string;
  estimatedValue: string; ownerName: string; priority: string;
}

const EMPTY_CONTACT_FORM: ContactFormState = {
  firstName: "", lastName: "", email: "", whatsapp: "", companyName: "", city: "",
};
const EMPTY_OPP_FORM: OpportunityFormState = {
  brandId: "", title: "", serviceCategory: "", serviceName: "", estimatedValue: "", ownerName: "", priority: "medium",
};

// ============ Mapping kanal (tanpa indigo/blue) ============

const CHANNEL_STYLE: Record<string, { icon: LucideIcon; circle: string; badge: string }> = {
  whatsapp: { icon: MessageCircle, circle: "bg-emerald-100 text-emerald-600", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  email: { icon: Mail, circle: "bg-amber-100 text-amber-600", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  instagram: { icon: Instagram, circle: "bg-rose-100 text-rose-600", badge: "border-rose-200 bg-rose-50 text-rose-700" },
  website: { icon: Globe, circle: "bg-violet-100 text-violet-600", badge: "border-violet-200 bg-violet-50 text-violet-700" },
  phone: { icon: Phone, circle: "bg-cyan-100 text-cyan-600", badge: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  meeting: { icon: Video, circle: "bg-zinc-200 text-zinc-700", badge: "border-zinc-200 bg-zinc-100 text-zinc-700" },
  portal: { icon: LayoutDashboard, circle: "bg-orange-100 text-orange-600", badge: "border-orange-200 bg-orange-50 text-orange-700" },
};

function channelMeta(channel: string) {
  return CHANNEL_STYLE[channel] ?? { icon: Inbox, circle: "bg-zinc-100 text-zinc-600", badge: "border-zinc-200 bg-zinc-50 text-zinc-600" };
}
function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}
type SlaTone = "ok" | "warning" | "breach";

/** Fase 3 — SLA countdown per brand: sisa = SLA brand − jam tunggu (slaHours dari API). */
function slaBadgeInfo(brandSlaHours: number, waitHours: number): {
  label: string; className: string; tone: SlaTone;
} {
  const split = (hours: number) => {
    let h = Math.floor(hours);
    let m = Math.round((hours - h) * 60);
    if (m >= 60) { h += 1; m = 0; }
    return { h, m };
  };
  const fmt = (hours: number, prefix: string) => {
    const { h, m } = split(hours);
    if (h < 1) return `${prefix}${m}m`;
    if (m === 0) return `${prefix}${h}j`;
    return `${prefix}${h}j ${m}m`;
  };

  const remaining = brandSlaHours - waitHours;
  if (remaining <= 0) {
    return {
      label: fmt(Math.abs(remaining), "Terlambat "),
      className: "border-rose-200 bg-rose-50 text-rose-700",
      tone: "breach" as const,
    };
  }
  if (remaining <= brandSlaHours * 0.5) {
    return {
      label: fmt(remaining, "Segera: "),
      className: "border-amber-200 bg-amber-50 text-amber-700",
      tone: "warning" as const,
    };
  }
  return {
    label: fmt(remaining, "Sisa "),
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    tone: "ok" as const,
  };
}

const SLA_TONE_ICON: Record<SlaTone, LucideIcon> = {
  ok: Timer,
  warning: AlarmClock,
  breach: TimerOff,
};

/** Badge SLA dengan ikon + countdown, dipakai di kartu lead & panel detail. */
function SlaBadge({ brandSlaHours, waitHours }: { brandSlaHours: number; waitHours: number }) {
  const sla = slaBadgeInfo(brandSlaHours, waitHours);
  const Icon = SLA_TONE_ICON[sla.tone];
  return (
    <Badge variant="outline" className={cn("border", sla.className)} aria-label={`Status SLA: ${sla.label}`}>
      <Icon aria-hidden="true" />
      {sla.label}
    </Badge>
  );
}
function scoreTone(score: number): { bar: string; text: string } {
  if (score >= 75) return { bar: "bg-emerald-500", text: "text-emerald-600" };
  if (score >= 50) return { bar: "bg-amber-500", text: "text-amber-600" };
  return { bar: "bg-zinc-400", text: "text-zinc-500" };
}

const PRIORITY_LABELS: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi", urgent: "Urgent" };
const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  animation: "Animasi", website: "Website", video: "Video",
  immersive: "Immersive / AR-VR", digital_marketing: "Digital Marketing",
};

// ============ Sub-komponen internal ============

function ChannelAvatar({ channel, size = "md" }: { channel: string; size?: "sm" | "md" }) {
  const meta = channelMeta(channel);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        size === "md" ? "size-10" : "size-9",
        meta.circle
      )}
      aria-hidden="true"
    >
      <Icon className="size-4.5" />
    </span>
  );
}

function BrandChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {name}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: "zinc" | "amber" | "rose" }) {
  const tones: Record<string, string> = {
    zinc: "bg-zinc-100 text-zinc-600",
    amber: "bg-amber-100 text-amber-600",
    rose: "bg-rose-100 text-rose-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tones[tone])} aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="text-lg font-bold leading-tight text-zinc-900">{value}</p>
      </div>
    </div>
  );
}

function LeadCard({
  lead, escalated, selected, onSelect, onEscalate,
}: {
  lead: InboxLead;
  escalated: boolean;
  selected: boolean;
  onSelect: (lead: InboxLead) => void;
  onEscalate: (lead: InboxLead) => void;
}) {
  const sender = (lead.senderName ?? "").trim() || "Tanpa nama";
  const sla = slaBadgeInfo(lead.brand?.slaHours ?? 24, lead.slaHours);
  const breached = sla.tone === "breach";
  const meta = channelMeta(lead.channel);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(lead)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(lead);
        }
      }}
      aria-label={`Buka detail lead dari ${sender}`}
      className={cn(
        "w-full cursor-pointer rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        breached ? "border-l-4 border-l-rose-500" : "hover:border-zinc-300",
        selected && !breached && "border-zinc-900 ring-1 ring-zinc-900",
        selected && breached && "ring-1 ring-rose-500"
      )}
    >
      <div className="flex items-start gap-3">
        <ChannelAvatar channel={lead.channel} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-zinc-900">{sender}</span>
            <span className="text-xs text-zinc-300" aria-hidden="true">·</span>
            <span className="text-xs text-zinc-500">{formatDateTime(lead.createdAt)}</span>
            <span className="text-xs text-zinc-300" aria-hidden="true">·</span>
            <span className="text-xs text-zinc-400">{timeAgo(lead.createdAt)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-600">{lead.content}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn("border", meta.badge)}>{channelLabel(lead.channel)}</Badge>
            {lead.brand ? <BrandChip name={lead.brand.name} color={lead.brand.color} /> : null}
            <SlaBadge brandSlaHours={lead.brand?.slaHours ?? 24} waitHours={lead.slaHours} />
            {lead.candidates.length > 0 ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                <AlertTriangle aria-hidden="true" />
                {`Duplikat? ${lead.candidates.length} kandidat`}
              </Badge>
            ) : null}
            {escalated ? (
              <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                <CheckCircle2 aria-hidden="true" />
                Sudah dieskalasi
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={escalated}
              className={cn(
                "h-7 px-2.5 text-xs",
                breached && !escalated
                  ? "border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  : "text-zinc-600"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onEscalate(lead);
              }}
              aria-label={`Eskalasi lead dari ${sender}`}
            >
              <ShieldAlert className="size-3.5" aria-hidden="true" />
              Eskalasi
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({ candidate, selected, onToggle }: { candidate: MatchCandidateDTO; selected: boolean; onToggle: () => void }) {
  const tone = scoreTone(candidate.score);
  const contact = candidate.contact;
  const label = contact?.fullName?.trim() || `Contact #${candidate.contactId.slice(0, 8)}`;
  return (
    <div className={cn("rounded-lg border p-3 transition-colors", selected ? "border-emerald-300 bg-emerald-50/60" : "border-zinc-200 bg-white")}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600" aria-hidden="true">
          {initials(contact?.fullName ?? label)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{label}</span>
        <span className={cn("text-xs font-bold", tone.text)}>{candidate.score}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-valuenow={candidate.score} aria-valuemin={0} aria-valuemax={100} aria-label={`Skor kemiripan ${candidate.score} persen`}>
        <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${Math.min(100, Math.max(0, candidate.score))}%` }} />
      </div>
      {candidate.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {candidate.reasons.map((reason) => (
            <li key={reason} className="text-xs text-zinc-500">• {reason}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 space-y-1 text-xs text-zinc-600">
        {contact?.position ? (
          <p className="flex items-center gap-1.5"><User className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />{contact.position}</p>
        ) : null}
        {contact?.company?.name ? (
          <p className="flex items-center gap-1.5"><Building2 className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />{contact.company.name}</p>
        ) : null}
        {contact?.email ? (
          <p className="flex items-center gap-1.5"><Mail className="size-3 shrink-0 text-zinc-400" aria-hidden="true" /><span className="truncate">{contact.email}</span></p>
        ) : null}
        {contact?.whatsapp ? (
          <p className="flex items-center gap-1.5"><MessageCircle className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />{contact.whatsapp}</p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={selected ? "default" : "outline"}
        className="mt-3 w-full"
        onClick={onToggle}
      >
        {selected ? (
          <><Check className="size-3.5" aria-hidden="true" /> Dipilih — akan digabung ke contact ini</>
        ) : (
          "Gabungkan ke Contact Ini"
        )}
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============ Modul utama ============

export default function InboxModule() {
  const user = useCrmStore((s) => s.user);
  const brands = useCrmStore((s) => s.brands);
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);
  const setActiveBrandFilter = useCrmStore((s) => s.setActiveBrandFilter);

  const [leads, setLeads] = useState<InboxLead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "late">("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const [linkedContactId, setLinkedContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState<ContactFormState>(EMPTY_CONTACT_FORM);
  const [oppForm, setOppForm] = useState<OpportunityFormState>(EMPTY_OPP_FORM);
  // Fase 3 — eskalasi SLA
  const [escalateTarget, setEscalateTarget] = useState<InboxLead | null>(null);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [escalatedIds, setEscalatedIds] = useState<Set<string>>(new Set());
  const detailRef = useRef<HTMLDivElement | null>(null);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.inbox({ channel: channelFilter, brandId: activeBrandFilter });
      setLeads(res.leads);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan tak terduga");
      toast.error("Gagal memuat lead inbox");
    } finally {
      setLoading(false);
    }
  }, [channelFilter, activeBrandFilter]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const stats = useMemo(() => {
    const list = leads ?? [];
    return {
      total: list.length,
      // Breach baru (Fase 3): waktu tunggu melewati SLA brand masing-masing
      late: list.filter((l) => (l.brand?.slaHours ?? 24) - l.slaHours <= 0).length,
      duplicate: list.filter((l) => l.candidates.length > 0).length,
    };
  }, [leads]);

  const sortedLeads = useMemo(() => {
    const list = [...(leads ?? [])];
    if (sortBy === "late") {
      list.sort((a, b) => b.slaHours - a.slaHours);
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [leads, sortBy]);

  const selectedLead = useMemo(
    () => leads?.find((l) => l.id === selectedId) ?? null,
    [leads, selectedId]
  );

  const brandOptions = brands.length > 0 ? brands : selectedLead?.brand ? [selectedLead.brand] : [];
  const selectedOppBrand = brandOptions.find((b) => b.id === oppForm.brandId);
  const serviceNameOptions = selectedOppBrand ? BRAND_SERVICES[selectedOppBrand.slug] ?? [] : [];

  const convertMode: "new" | "link" | null = showNewContact ? "new" : linkedContactId ? "link" : null;
  const canConvert =
    convertMode !== null &&
    oppForm.brandId !== "" &&
    (convertMode !== "new" || contactForm.firstName.trim().length > 0);

  function handleSelectLead(lead: InboxLead) {
    setSelectedId(lead.id);
    setShowNewContact(false);
    setLinkedContactId(null);

    const rawSender = (lead.senderName ?? "").trim();
    const looksLikePhone = /^\+?\d/.test(rawSender);
    const looksLikeEmail = rawSender.includes("@");
    setContactForm({
      ...EMPTY_CONTACT_FORM,
      email: looksLikeEmail ? rawSender : "",
      whatsapp: looksLikePhone ? rawSender : "",
    });
    setOppForm({
      ...EMPTY_OPP_FORM,
      brandId: lead.brandId ?? lead.brand?.id ?? "",
      title: `Lead ${channelLabel(lead.channel)} — ${rawSender.slice(0, 48) || "Tanpa nama"}`,
      ownerName: user?.name ?? "",
    });
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      window.setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }

  function handleToggleCandidate(contactId: string) {
    setShowNewContact(false);
    setLinkedContactId((prev) => (prev === contactId ? null : contactId));
  }

  function handleToggleNewContact() {
    setLinkedContactId(null);
    setShowNewContact((prev) => !prev);
  }

  async function handleConvert() {
    if (!selectedLead || !user || !convertMode) return;
    if (!oppForm.brandId) {
      toast.error("Brand wajib dipilih untuk opportunity.");
      return;
    }
    if (convertMode === "new" && !contactForm.firstName.trim()) {
      toast.error("Nama depan contact wajib diisi.");
      return;
    }

    const opportunity: Record<string, unknown> = {
      brandId: oppForm.brandId,
      title:
        oppForm.title.trim() ||
        `Lead ${channelLabel(selectedLead.channel)} — ${(selectedLead.senderName ?? "Tanpa nama").trim().slice(0, 48)}`,
      ownerName: oppForm.ownerName.trim() || user.name,
      priority: oppForm.priority,
    };
    if (oppForm.serviceCategory) opportunity.serviceCategory = oppForm.serviceCategory;
    if (oppForm.serviceName) opportunity.serviceName = oppForm.serviceName;
    const est = Number(oppForm.estimatedValue);
    if (oppForm.estimatedValue.trim() !== "" && Number.isFinite(est) && est > 0) {
      opportunity.estimatedValue = est;
    }

    const payload: Record<string, unknown> = {
      interactionId: selectedLead.id,
      action: convertMode,
      opportunity,
      actorName: user.name,
      actorRole: user.role,
    };
    if (convertMode === "link" && linkedContactId) payload.contactId = linkedContactId;
    if (convertMode === "new") {
      payload.contact = {
        firstName: contactForm.firstName.trim(),
        ...(contactForm.lastName.trim() ? { lastName: contactForm.lastName.trim() } : {}),
        ...(contactForm.email.trim() ? { email: contactForm.email.trim() } : {}),
        ...(contactForm.whatsapp.trim() ? { whatsapp: contactForm.whatsapp.trim() } : {}),
        ...(contactForm.companyName.trim() ? { companyName: contactForm.companyName.trim() } : {}),
        ...(contactForm.city.trim() ? { city: contactForm.city.trim() } : {}),
      };
    }

    setConverting(true);
    try {
      const res = await api.convertLead(payload);
      toast.success("Lead dikonversi", {
        description: `Opportunity ${res.opportunity?.title ?? ""} berhasil dibuat beserta task follow-up otomatis.`,
      });
      setSelectedId(null);
      setShowNewContact(false);
      setLinkedContactId(null);
      await loadLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengonversi lead.");
    } finally {
      setConverting(false);
    }
  }

  /** Fase 3 — buka dialog eskalasi untuk sebuah lead. */
  function openEscalateDialog(lead: InboxLead) {
    setEscalateTarget(lead);
    setEscalateNote("");
  }

  async function handleEscalate() {
    if (!escalateTarget || !user || escalating) return;
    setEscalating(true);
    try {
      await api.escalateLead({
        interactionId: escalateTarget.id,
        ...(escalateNote.trim() ? { note: escalateNote.trim() } : {}),
        actorName: user.name,
        actorRole: user.role,
      });
      toast.success("Eskalasi dibuat — task urgent untuk Direktur");
      setEscalatedIds((prev) => {
        const next = new Set(prev);
        next.add(escalateTarget.id);
        return next;
      });
      setEscalateTarget(null);
      setEscalateNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat eskalasi.");
    } finally {
      setEscalating(false);
    }
  }

  const firstLoad = loading && leads === null;
  const escalateSla = escalateTarget
    ? slaBadgeInfo(escalateTarget.brand?.slaHours ?? 24, escalateTarget.slaHours)
    : null;

  return (
    <div className="space-y-4">
      {/* ===== Header ===== */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-900 sm:text-xl">Lead Inbox</h1>
              {leads ? (
                <Badge className="bg-zinc-900 text-white">{`${stats.total} lead belum dikonversi`}</Badge>
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-500">Semua lead baru lintas kanal — Instagram, WhatsApp, Email, Website</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500" aria-label="Legenda SLA">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />SLA Aman</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />Segera Jatuh Tempo</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />Terlambat</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={channelFilter}
              onValueChange={(v) => { setChannelFilter(v); setSelectedId(null); }}
            >
              <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter kanal">
                <SelectValue placeholder="Semua Kanal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kanal</SelectItem>
                {CHANNELS.map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={activeBrandFilter}
              onValueChange={(v) => { setActiveBrandFilter(v); setSelectedId(null); }}
            >
              <SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter brand">
                <SelectValue placeholder="Semua Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Brand</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v === "late" ? "late" : "newest")}>
              <SelectTrigger className="w-full sm:w-[160px]" aria-label="Urutkan lead">
                <SelectValue placeholder="Urutkan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Terbaru</SelectItem>
                <SelectItem value="late">Paling Terlambat</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={loading}
              onClick={() => void loadLeads()}
              aria-label="Muat ulang daftar lead"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </div>

      {/* ===== Stat strip ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Inbox} label="Total Lead" value={stats.total} tone="zinc" />
        <StatCard icon={AlarmClock} label="Terlambat Respons" value={stats.late} tone={stats.late > 0 ? "rose" : "zinc"} />
        <StatCard icon={AlertTriangle} label="Warning Duplikat" value={stats.duplicate} tone={stats.duplicate > 0 ? "amber" : "zinc"} />
      </div>

      {/* ===== Layout 2 kolom ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* KIRI: daftar lead */}
        <section aria-label="Daftar lead masuk">
          {firstLoad ? (
            <ListSkeleton />
          ) : error && !leads ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-white p-10 text-center shadow-sm">
              <span className="flex size-12 items-center justify-center rounded-full bg-rose-100" aria-hidden="true">
                <AlertTriangle className="size-6 text-rose-600" />
              </span>
              <p className="text-sm font-medium text-zinc-700">Gagal memuat lead</p>
              <p className="text-xs text-zinc-400">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadLeads()}>Coba Lagi</Button>
            </div>
          ) : leads && leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-white p-10 text-center shadow-sm">
              <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100" aria-hidden="true">
                <Inbox className="size-6 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-700">Tidak ada lead baru — semua sudah ditangani</p>
              <p className="text-xs text-zinc-400">Lead baru dari semua kanal akan muncul di sini.</p>
            </div>
          ) : leads ? (
            <div className="max-h-96 space-y-3 overflow-y-auto pr-1 crm-scroll">
              {sortedLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  escalated={escalatedIds.has(lead.id)}
                  selected={lead.id === selectedId}
                  onSelect={handleSelectLead}
                  onEscalate={openEscalateDialog}
                />
              ))}
            </div>
          ) : null}
        </section>

        {/* KANAN: panel detail (sticky) */}
        <section aria-label="Detail lead">
          <div
            ref={detailRef}
            className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto crm-scroll"
          >
            {!selectedLead ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-white p-10 text-center shadow-sm">
                <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100" aria-hidden="true">
                  <Inbox className="size-6 text-zinc-400" />
                </span>
                <p className="text-sm font-medium text-zinc-700">Belum ada lead dipilih</p>
                <p className="text-xs text-zinc-400">Pilih lead dari daftar untuk melihat detail dan mengonversinya.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                {/* Header panel */}
                <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <ChannelAvatar channel={selectedLead.channel} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {(selectedLead.senderName ?? "").trim() || "Tanpa nama"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDateTime(selectedLead.createdAt)} · {timeAgo(selectedLead.createdAt)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={cn("border", channelMeta(selectedLead.channel).badge)}>
                          {channelLabel(selectedLead.channel)}
                        </Badge>
                        {selectedLead.brand ? (
                          <BrandChip name={selectedLead.brand.name} color={selectedLead.brand.color} />
                        ) : null}
                        <SlaBadge brandSlaHours={selectedLead.brand?.slaHours ?? 24} waitHours={selectedLead.slaHours} />
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => setSelectedId(null)}
                    aria-label="Tutup detail lead"
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                {/* Isi pesan + metadata */}
                <div className="p-4">
                  {selectedLead.subject ? (
                    <p className="mb-2 text-sm font-medium text-zinc-800">{selectedLead.subject}</p>
                  ) : null}
                  <div className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700">
                    {selectedLead.content}
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-zinc-400">ID Eksternal</dt>
                      <dd className="truncate font-mono text-zinc-700">{selectedLead.externalId ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Waktu Masuk</dt>
                      <dd className="text-zinc-700">{formatDateTime(selectedLead.createdAt)}</dd>
                    </div>
                  </dl>
                </div>

                {/* Identifikasi Identitas */}
                <div className="border-t border-zinc-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
                      <Fingerprint className="size-4 text-zinc-500" aria-hidden="true" />
                      Identifikasi Identitas
                    </div>
                    {selectedLead.candidates.length > 0 ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                        {`${selectedLead.candidates.length} kandidat`}
                      </Badge>
                    ) : null}
                  </div>
                  {selectedLead.candidates.length === 0 ? (
                    <p className="mt-3 text-sm text-zinc-500">Tidak ada kemiripan — buat contact baru.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {selectedLead.candidates.map((candidate) => (
                        <CandidateCard
                          key={candidate.contactId}
                          candidate={candidate}
                          selected={linkedContactId === candidate.contactId}
                          onToggle={() => handleToggleCandidate(candidate.contactId)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Form konversi */}
                <div className="border-t border-zinc-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
                      <UserPlus className="size-4 text-zinc-500" aria-hidden="true" />
                      Data Konversi
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={showNewContact ? "default" : "outline"}
                      onClick={handleToggleNewContact}
                    >
                      {showNewContact ? "Batal — pakai contact terpilih" : "Buat Contact Baru"}
                    </Button>
                  </div>

                  {showNewContact ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contact Baru</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-first-name" className="text-xs">Nama Depan <span className="text-rose-600">*</span></Label>
                          <Input
                            id="inbox-first-name"
                            value={contactForm.firstName}
                            onChange={(e) => setContactForm((f) => ({ ...f, firstName: e.target.value }))}
                            placeholder="cth. Dian"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-last-name" className="text-xs">Nama Belakang</Label>
                          <Input
                            id="inbox-last-name"
                            value={contactForm.lastName}
                            onChange={(e) => setContactForm((f) => ({ ...f, lastName: e.target.value }))}
                            placeholder="cth. Permata"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-email" className="text-xs">Email</Label>
                          <Input
                            id="inbox-email"
                            type="email"
                            value={contactForm.email}
                            onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                            placeholder="nama@perusahaan.co.id"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-whatsapp" className="text-xs">WhatsApp</Label>
                          <Input
                            id="inbox-whatsapp"
                            value={contactForm.whatsapp}
                            onChange={(e) => setContactForm((f) => ({ ...f, whatsapp: e.target.value }))}
                            placeholder="+62 8xx xxxx xxxx"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-company" className="text-xs">Perusahaan</Label>
                          <Input
                            id="inbox-company"
                            value={contactForm.companyName}
                            onChange={(e) => setContactForm((f) => ({ ...f, companyName: e.target.value }))}
                            placeholder="cth. PT Agro Makmur"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-city" className="text-xs">Kota</Label>
                          <Input
                            id="inbox-city"
                            value={contactForm.city}
                            onChange={(e) => setContactForm((f) => ({ ...f, city: e.target.value }))}
                            placeholder="cth. Medan"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Opportunity</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Brand <span className="text-rose-600">*</span></Label>
                        <Select
                          value={oppForm.brandId}
                          onValueChange={(v) => setOppForm((f) => ({ ...f, brandId: v, serviceName: "" }))}
                        >
                          <SelectTrigger className="w-full" aria-label="Brand opportunity">
                            <SelectValue placeholder="Pilih brand" />
                          </SelectTrigger>
                          <SelectContent>
                            {brandOptions.map((b) => (
                              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Prioritas</Label>
                        <Select
                          value={oppForm.priority}
                          onValueChange={(v) => setOppForm((f) => ({ ...f, priority: v }))}
                        >
                          <SelectTrigger className="w-full" aria-label="Prioritas opportunity">
                            <SelectValue placeholder="Pilih prioritas" />
                          </SelectTrigger>
                          <SelectContent>
                            {PRIORITIES.map((p) => (
                              <SelectItem key={p} value={p}>{PRIORITY_LABELS[p] ?? p}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="inbox-title" className="text-xs">Judul Opportunity</Label>
                      <Input
                        id="inbox-title"
                        value={oppForm.title}
                        onChange={(e) => setOppForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="Judul opportunity"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Kategori Layanan</Label>
                        <Select
                          value={oppForm.serviceCategory}
                          onValueChange={(v) => setOppForm((f) => ({ ...f, serviceCategory: v, serviceName: "" }))}
                        >
                          <SelectTrigger className="w-full" aria-label="Kategori layanan">
                            <SelectValue placeholder="Pilih kategori" />
                          </SelectTrigger>
                          <SelectContent>
                            {SERVICE_CATEGORIES.map((cat) => (
                              <SelectItem key={cat} value={cat}>{SERVICE_CATEGORY_LABELS[cat] ?? cat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {serviceNameOptions.length > 0 ? (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Layanan</Label>
                          <Select
                            value={oppForm.serviceName || "none"}
                            onValueChange={(v) => setOppForm((f) => ({ ...f, serviceName: v === "none" ? "" : v }))}
                          >
                            <SelectTrigger className="w-full" aria-label="Layanan">
                              <SelectValue placeholder="Pilih layanan" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Tanpa layanan spesifik</SelectItem>
                              {serviceNameOptions.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Layanan</Label>
                          <p className="text-xs text-zinc-400">Pilih brand dengan katalog layanan terlebih dahulu.</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="inbox-value" className="text-xs">Estimasi Nilai (Rp)</Label>
                        <Input
                          id="inbox-value"
                          type="number"
                          min={0}
                          value={oppForm.estimatedValue}
                          onChange={(e) => setOppForm((f) => ({ ...f, estimatedValue: e.target.value }))}
                          placeholder="cth. 25000000"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="inbox-owner" className="text-xs">Owner</Label>
                        <Input
                          id="inbox-owner"
                          value={oppForm.ownerName}
                          onChange={(e) => setOppForm((f) => ({ ...f, ownerName: e.target.value }))}
                          placeholder="Nama owner"
                        />
                      </div>
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="mt-4 w-full bg-zinc-900 text-white hover:bg-zinc-800"
                    disabled={!canConvert || converting}
                    onClick={() => void handleConvert()}
                  >
                    {converting ? (
                      <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Mengonversi…</>
                    ) : (
                      "Konversi jadi Opportunity"
                    )}
                  </Button>
                  {!canConvert ? (
                    <p className="mt-2 text-center text-xs text-zinc-400">
                      Pilih kandidat identitas di atas atau buat contact baru untuk melanjutkan.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ===== Dialog eskalasi SLA (Fase 3) ===== */}
      <Dialog
        open={escalateTarget !== null}
        onOpenChange={(open) => {
          if (!open && !escalating) {
            setEscalateTarget(null);
            setEscalateNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4.5 text-rose-600" aria-hidden="true" />
              Eskalasi Lead ke Direktur
            </DialogTitle>
            <DialogDescription>
              Membuat task urgent (deadline 2 jam) yang ditugaskan ke Direktur untuk follow-up segera.
            </DialogDescription>
          </DialogHeader>

          {escalateTarget ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-zinc-400">Pengirim</dt>
                  <dd className="truncate font-medium text-zinc-800">
                    {(escalateTarget.senderName ?? "").trim() || "Tanpa nama"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Kanal</dt>
                  <dd className="text-zinc-800">{channelLabel(escalateTarget.channel)}</dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Brand</dt>
                  <dd className="text-zinc-800">{escalateTarget.brand?.name ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Waktu Tunggu</dt>
                  <dd className={cn(
                    "font-semibold tabular-nums",
                    escalateSla?.tone === "breach" ? "text-rose-600" : "text-amber-600"
                  )}>
                    {escalateSla?.label ?? "-"}
                  </dd>
                </div>
              </dl>
              <p className="line-clamp-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-600">
                {escalateTarget.content}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="escalate-note" className="text-xs">Catatan (opsional)</Label>
                <Textarea
                  id="escalate-note"
                  value={escalateNote}
                  onChange={(e) => setEscalateNote(e.target.value)}
                  placeholder="cth. Klien menunggu penawaran segera, mohon prioritas."
                  rows={3}
                  disabled={escalating}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={escalating}
              onClick={() => { setEscalateTarget(null); setEscalateNote(""); }}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={escalating}
              onClick={() => void handleEscalate()}
            >
              {escalating ? (
                <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Mengirim…</>
              ) : (
                <><ShieldAlert className="size-4" aria-hidden="true" /> Buat Task Eskalasi</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
