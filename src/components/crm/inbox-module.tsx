"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock, AlertTriangle, Building2, Check, CheckCheck, CheckCircle2, CircleDashed, ClipboardList, Clock, Copy,
  Fingerprint, Globe, Inbox, Instagram, LayoutDashboard, Link2, Link2Off, List, Loader2, Mail, MessageCircle,
  MessagesSquare, Phone, PlugZap, RefreshCw, Reply, Send, ShieldAlert, Timer, TimerOff, User, UserPlus, Video, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, channelsApi } from "@/lib/crm/api-client";
import { canAccess, useCrmStore } from "@/lib/crm/store";
import { BRAND_SERVICES, CHANNELS, PRIORITIES, SERVICE_CATEGORIES } from "@/lib/crm/constants";
import { CHANNEL_TYPES } from "@/lib/crm/channels";
import { extractEmailFromText, formatDateTime, initials, isSocialHandle, timeAgo } from "@/lib/crm/utils";
import type {
  ConversationThreadDTO, FollowUpTemplateDTO, InboxLeadDTO, InteractionDTO, MatchCandidateDTO, ThreadMessageDTO,
} from "@/lib/crm/types";
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

/** Task 24-a — lead inbox kini InboxLeadDTO dari backend: membawa threadKey + thread percakapan. */
type InboxLead = InboxLeadDTO;

/** Lead sudah direspons (respondedAt terisi dari alur Respons & Catat Fase 3). */
function isResponded(lead: InboxLead): boolean {
  return Boolean(lead.respondedAt);
}

interface ContactFormState {
  firstName: string; lastName: string; email: string; whatsapp: string; companyName: string; city: string;
  /** Ronde 23 — jabatan di perusahaan + handle Instagram (lead kerap datang dari IG). */
  position: string; instagram: string;
}
interface OpportunityFormState {
  brandId: string; title: string; serviceCategory: string; serviceName: string;
  estimatedValue: string; ownerName: string; priority: string;
}

const EMPTY_CONTACT_FORM: ContactFormState = {
  firstName: "", lastName: "", email: "", whatsapp: "", companyName: "", city: "", position: "", instagram: "",
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
function SlaBadge({ brandSlaHours, waitHours, respondedAt }: { brandSlaHours: number; waitHours: number; respondedAt?: string | null }) {
  // Sudah direspons → SLA terpenuhi, tampilkan status emerald alih-alih countdown
  if (respondedAt) {
    return (
      <Badge variant="outline" className="border border-emerald-200 bg-emerald-50 text-emerald-700" aria-label="Lead sudah direspons">
        <Reply aria-hidden="true" />
        {`Direspons ${timeAgo(respondedAt)}`}
      </Badge>
    );
  }
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
  const responded = isResponded(lead);
  const sla = slaBadgeInfo(lead.brand?.slaHours ?? 24, lead.slaHours);
  const breached = sla.tone === "breach" && !responded;
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
        breached ? "border-l-4 border-l-rose-500" : responded ? "border-l-4 border-l-emerald-500" : "hover:border-zinc-300",
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
            <SlaBadge brandSlaHours={lead.brand?.slaHours ?? 24} waitHours={lead.slaHours} respondedAt={lead.respondedAt} />
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
              disabled={escalated || responded}
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

// ============ Task 24-a — grouping percakapan per kontak (thread) ============

/** Thread dari backend; fallback sintetis bila lead lama belum membawa thread (aman runtime). */
function threadOf(lead: InboxLead): ConversationThreadDTO {
  if (lead.thread) return lead.thread;
  return {
    key: lead.threadKey || lead.id,
    messageCount: 1,
    channels: [lead.channel],
    lastMessageAt: lead.createdAt,
    messages: [{
      id: lead.id, channel: lead.channel, direction: lead.direction, subject: lead.subject ?? null,
      content: lead.content, senderName: lead.senderName ?? null, recipientName: lead.recipientName ?? null,
      respondedBy: lead.respondedBy ?? null, deliveryStatus: lead.deliveryStatus ?? null,
      externalId: lead.externalId ?? null, createdAt: lead.createdAt,
    }],
  };
}

/** Pesan terakhir thread (maks createdAt) — dipakai utk preview kartu. */
function lastThreadMessage(thread: ConversationThreadDTO): ThreadMessageDTO | null {
  const msgs = thread.messages;
  if (msgs.length === 0) return null;
  return msgs.reduce(
    (acc, m) => (new Date(m.createdAt).getTime() > new Date(acc.createdAt).getTime() ? m : acc),
    msgs[0]
  );
}

/** Kanal paling sering muncul dalam thread — warna avatar kartu thread. */
function dominantChannelOf(thread: ConversationThreadDTO, fallback: string): string {
  const counts = new Map<string, number>();
  for (const m of thread.messages) counts.set(m.channel, (counts.get(m.channel) ?? 0) + 1);
  let best = fallback;
  let bestN = -1;
  for (const [ch, n] of counts) {
    if (n > bestN) { best = ch; bestN = n; }
  }
  return best;
}

/** Nama tampilan thread: nama contact (bila tertaut) → senderName apa adanya (handle IG utuh). */
function threadDisplayName(lead: InboxLead): string {
  const fromContact = lead.contact?.fullName?.trim();
  if (fromContact) return fromContact;
  return (lead.senderName ?? "").trim() || "Tanpa nama";
}

/** Hasil grouping leads by threadKey (useMemo di modul utama). */
interface ThreadGroup {
  key: string;
  /** Anggota thread, terbaru dulu. */
  members: InboxLead[];
  /** Lead terbaru — sumber nama tampilan & target seleksi. */
  newest: InboxLead;
  thread: ConversationThreadDTO;
  /** Lead belum-direspons dgn sisa SLA paling kritis (null bila semua sudah direspons). */
  worstPending: InboxLead | null;
  /** Sisa SLA terburuk grup (brandSla − wait); null bila semua responded. */
  worstRemaining: number | null;
  maxCandidates: number;
  allResponded: boolean;
}

function ThreadCard({ group, selected, onSelect }: {
  group: ThreadGroup;
  selected: boolean;
  onSelect: (lead: InboxLead) => void;
}) {
  const { newest, thread } = group;
  const name = threadDisplayName(newest);
  const breached = group.worstRemaining !== null && group.worstRemaining <= 0;
  const lastMsg = lastThreadMessage(thread);
  const preview = (lastMsg?.content ?? newest.content).trim();
  const avatarMeta = channelMeta(dominantChannelOf(thread, newest.channel));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(newest)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(newest);
        }
      }}
      aria-label={`Buka percakapan dengan ${name}`}
      className={cn(
        "w-full cursor-pointer rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        breached ? "border-l-4 border-l-rose-500" : group.allResponded ? "border-l-4 border-l-emerald-500" : "hover:border-zinc-300",
        selected && !breached && "border-zinc-900 ring-1 ring-zinc-900",
        selected && breached && "ring-1 ring-rose-500"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            avatarMeta.circle
          )}
          aria-hidden="true"
        >
          {initials(name.replace(/^@+/, ""))}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">{name}</span>
            <span className="shrink-0 text-xs text-zinc-400">{timeAgo(thread.lastMessageAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {thread.channels.map((ch) => {
              const ChMeta = channelMeta(ch);
              const ChIcon = ChMeta.icon;
              return (
                <span
                  key={ch}
                  role="img"
                  aria-label={`Kanal ${channelLabel(ch)}`}
                  title={channelLabel(ch)}
                  className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full", ChMeta.circle)}
                >
                  <ChIcon className="size-3" aria-hidden="true" />
                </span>
              );
            })}
            {thread.messageCount > 1 ? (
              <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">{`${thread.messageCount} pesan`}</Badge>
            ) : null}
            {thread.channels.length > 1 ? (
              <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{`${thread.channels.length} kanal`}</Badge>
            ) : null}
            {newest.brand ? <BrandChip name={newest.brand.name} color={newest.brand.color} /> : null}
          </div>
          <p className="mt-1.5 line-clamp-1 text-sm leading-relaxed text-zinc-600">{preview}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {group.allResponded ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-700"
                aria-label="Semua pesan di grup sudah direspons"
              >
                <Reply aria-hidden="true" />
                Sudah Direspons
              </Badge>
            ) : group.worstPending ? (
              <SlaBadge brandSlaHours={group.worstPending.brand?.slaHours ?? 24} waitHours={group.worstPending.slaHours} />
            ) : null}
            {group.maxCandidates > 0 ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                <AlertTriangle aria-hidden="true" />
                {`Duplikat? ${group.maxCandidates} kandidat`}
              </Badge>
            ) : null}
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

/** Ronde 23 — chip status satu data identitas: Check emerald bila terisi, CircleDashed amber + "kurang" bila kosong. */
function IdentityChip({ label, filled }: { label: string; filled: boolean }) {
  if (filled) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700"
        aria-label={`${label}: sudah ada`}
      >
        <Check className="size-3" aria-hidden="true" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-300 bg-amber-50 text-amber-700"
      aria-label={`${label}: kurang`}
    >
      <CircleDashed className="size-3" aria-hidden="true" />
      {`${label} · kurang`}
    </Badge>
  );
}

/**
 * Ronde 23 — seksi "Kelengkapan Identitas": chips status 5 data kontak (Nama, Perusahaan,
 * Jabatan, Email, WhatsApp) yang reaktif terhadap ketikan form konversi, teks bantu
 * follow-up awal, dan tombol salin "Pesan Identifikasi" yang hanya meminta field yang
 * masih kurang (siap ditempel ke chat WhatsApp/Instagram).
 * Mode link (contact kandidat terpilih) → data form tidak dinilai, tampil teks singkat.
 */
function IdentityReadinessCard({
  lead,
  contactForm,
  linkMode,
}: {
  lead: InboxLead;
  contactForm: ContactFormState;
  linkMode: boolean;
}) {
  const rawSender = (lead.senderName ?? "").trim();
  // Lead IG dengan handle → pesan menyapa pakai handle (nama belum tentu diketahui).
  const igHandle = lead.channel === "instagram" && isSocialHandle(rawSender) ? rawSender : null;

  const fields = [
    { key: "nama", label: "Nama", messageLabel: "Nama lengkap", filled: contactForm.firstName.trim() !== "" },
    { key: "perusahaan", label: "Perusahaan", messageLabel: "Nama perusahaan", filled: contactForm.companyName.trim() !== "" },
    { key: "jabatan", label: "Jabatan", messageLabel: "Jabatan di perusahaan", filled: contactForm.position.trim() !== "" },
    { key: "email", label: "Email", messageLabel: "Email aktif", filled: contactForm.email.trim() !== "" },
    { key: "whatsapp", label: "WhatsApp", messageLabel: "Nomor WhatsApp aktif", filled: contactForm.whatsapp.trim() !== "" },
  ];
  const missing = fields.filter((f) => !f.filled);
  const complete = missing.length === 0;

  const greetingName = igHandle ?? contactForm.firstName.trim();
  const brandName = lead.brand?.name ?? "tim kami";
  const identityMessage = [
    `Halo${greetingName ? ` ${greetingName}` : ""}! Terima kasih sudah menghubungi ${brandName}. Sebelum kami lanjut, boleh dibantu lengkapi info berikut:`,
    ...missing.map((f) => `- ${f.messageLabel}`),
  ].join("\n");

  // Fallback: bila clipboard ditolak browser (izin/konteks non-secure), tampilkan pesan
  // di dialog agar tetap bisa disalin manual — fitur tidak pernah buntu.
  const [manualCopy, setManualCopy] = useState(false);

  async function handleCopyMessage() {
    const legacyCopy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = identityMessage;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };
    try {
      await navigator.clipboard.writeText(identityMessage);
      toast.success("Pesan identifikasi disalin — tempel di chat klien");
    } catch {
      if (legacyCopy()) {
        toast.success("Pesan identifikasi disalin — tempel di chat klien");
      } else {
        setManualCopy(true);
      }
    }
  }

  return (
    <div className="border-t border-zinc-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <ClipboardList className="size-4 text-zinc-500" aria-hidden="true" />
          Kelengkapan Identitas
        </div>
        {!linkMode ? (
          <Badge
            variant="outline"
            className={cn(
              "border",
              complete
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-amber-300 bg-amber-50 text-amber-700"
            )}
          >
            {`${fields.length - missing.length}/${fields.length} lengkap`}
          </Badge>
        ) : null}
      </div>

      {linkMode ? (
        <p className="mt-3 text-xs text-zinc-500">
          Pakai contact terpilih — kelengkapan data mengikuti kontak yang digabungkan, bukan form ini.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Status kelengkapan 5 data identitas">
            {fields.map((f) => (
              <IdentityChip key={f.key} label={f.label} filled={f.filled} />
            ))}
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-zinc-500">
            Follow-up awal = identifikasi: lengkapi data kontak supaya log percakapan dari semua kanal mudah tergabung dengan lead ini.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={complete}
            onClick={() => void handleCopyMessage()}
            aria-label={complete ? "Data kontak sudah lengkap" : "Salin pesan identifikasi untuk dikirim ke klien"}
          >
            {complete ? (
              <><CheckCircle2 className="size-4" aria-hidden="true" /> Data lengkap</>
            ) : (
              <><Copy className="size-4" aria-hidden="true" /> Salin Pesan Identifikasi</>
            )}
          </Button>
          <Dialog open={manualCopy} onOpenChange={setManualCopy}>
            <DialogContent className="sm:max-w-md" aria-label="Salin pesan identifikasi secara manual">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Copy className="size-4 text-zinc-500" aria-hidden="true" /> Salin Manual Pesan Identifikasi
                </DialogTitle>
                <DialogDescription>
                  Browser menolak akses clipboard — salin teks di bawah secara manual (blok semua lalu Ctrl/Cmd+C).
                </DialogDescription>
              </DialogHeader>
              <Textarea
                readOnly
                rows={7}
                value={identityMessage}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Teks pesan identifikasi"
                className="text-sm"
              />
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => setManualCopy(false)}>
                  Tutup
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

// ============ Task 24-a — Riwayat Percakapan (bubble chat thread per kontak) ============

function ThreadMessageBubble({ message, highlight, fallbackOutboundAuthor }: { message: ThreadMessageDTO; highlight: boolean; fallbackOutboundAuthor?: string | null }) {
  const isInbound = message.direction !== "outbound";
  const MIcon = channelMeta(message.channel).icon;
  const author = isInbound
    ? (message.senderName ?? "").trim() || "Pengirim"
    : (message.respondedBy ?? "").trim() || (fallbackOutboundAuthor ?? "").trim() || "Tim CRM";
  const isOwnReply = typeof message.externalId === "string" && message.externalId.startsWith("inbox-reply:");
  return (
    <li className={cn("flex w-full", isInbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5",
          isInbound ? "bg-zinc-100 text-zinc-800" : "bg-zinc-900 text-white",
          highlight && "ring-2 ring-amber-400"
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]",
            isInbound ? "text-zinc-500" : "text-white/70"
          )}
        >
          <MIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="max-w-[10rem] truncate font-semibold">{author}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatDateTime(message.createdAt)}</span>
          {!isInbound ? <DeliveryTick status={message.deliveryStatus} channel={message.channel} /> : null}
        </div>
        {message.subject ? (
          <p className={cn("mt-1 truncate text-xs font-medium", isInbound ? "text-zinc-600" : "text-white/80")}>
            {message.subject}
          </p>
        ) : null}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        {isOwnReply ? (
          <span
            className={cn(
              "mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
              isInbound ? "bg-zinc-200 text-zinc-600" : "bg-white/10 text-white/80"
            )}
          >
            Balasan kamu
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** Riwayat percakapan per kontak (thread backend) — inbound kiri zinc-100, outbound kanan zinc-900. */
function ThreadHistorySection({ lead }: { lead: InboxLead }) {
  const messages = useMemo(() => {
    const msgs = [...lead.thread.messages];
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return msgs;
  }, [lead.thread]);
  if (messages.length === 0) return null;
  return (
    <div className="border-t border-zinc-200 p-4" aria-label="Riwayat percakapan dengan kontak ini">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <MessagesSquare className="size-4 text-zinc-500" aria-hidden="true" />
          Riwayat Percakapan
        </div>
        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
          {`${lead.thread.messageCount} pesan · ${lead.thread.channels.length} kanal`}
        </Badge>
      </div>
      <ul className="crm-scroll mt-3 max-h-80 space-y-2.5 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3">
        {messages.map((m) => (
          <ThreadMessageBubble key={m.id} message={m} highlight={m.id === lead.id} fallbackOutboundAuthor={lead.respondedBy} />
        ))}
      </ul>
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

// ============ Respons & Catat (Fase 3): balas lead dengan template ============

const RESPOND_CHANNELS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "email", label: "Email", icon: Mail },
  { key: "phone", label: "Telepon", icon: Phone },
];

/** Ganti placeholder template untuk konteks lead inbox. */
function renderLeadTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/{{\s*(\w+)\s*}}/g, (full, key: string) => vars[key] ?? full);
}

function RespondDialog({ lead, linkedContactId, linkedContactName, onClose, onResponded }: {
  lead: InboxLead | null;
  /** Kontak terpilih di panel detail (identifikasi) — dipakai sebagai pilihan awal bila ada di kandidat. */
  linkedContactId: string | null;
  linkedContactName: string | null;
  onClose: () => void;
  onResponded: (updated: InboxLead) => void;
}) {
  const user = useCrmStore((s) => s.user);
  const [templates, setTemplates] = useState<FollowUpTemplateDTO[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [channel, setChannel] = useState("whatsapp");
  const [templateId, setTemplateId] = useState<string>("blank");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // Task 15-c — kontak yang ditautkan ke respons (null = "Tidak menautkan")
  const [contactChoice, setContactChoice] = useState<string | null>(null);

  const senderDisplay = (lead?.senderName ?? "").trim() || "Tanpa nama";
  // Opsi = kandidat identifikasi yang punya contactId
  const candidates = useMemo(
    () => (lead?.candidates ?? []).filter((c) => Boolean(c.contactId)),
    [lead?.candidates]
  );

  // Muat template + set kanal & kontak default saat dialog dibuka
  useEffect(() => {
    if (!lead) return;
    let alive = true;
    setLoadingTpl(true);
    setTemplates([]);
    setTemplateId("blank");
    setBody("");
    setChannel(["whatsapp", "email", "phone"].includes(lead.channel) ? lead.channel : "whatsapp");
    const cands = lead.candidates.filter((c) => Boolean(c.contactId));
    // Default: pilihan di panel detail bila cocok, jika tidak → kandidat pertama
    setContactChoice(
      linkedContactId && cands.some((c) => c.contactId === linkedContactId)
        ? linkedContactId
        : cands[0]?.contactId ?? null
    );
    (async () => {
      try {
        const res = await api.followUpTemplates("all");
        if (!alive) return;
        setTemplates(
          res.templates
            .filter((t) => !t.brandId || t.brandId === lead.brandId)
            .sort((a, b) => a.delayDays - b.delayDays)
        );
      } catch {
        if (alive) toast.error("Gagal memuat template follow-up");
      } finally {
        if (alive) setLoadingTpl(false);
      }
    })();
    return () => { alive = false; };
  }, [lead, linkedContactId]);

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.contactId === contactChoice) ?? null,
    [candidates, contactChoice]
  );
  const respondContactName = selectedCandidate?.contact?.fullName?.trim() || linkedContactName || null;

  const vars = useMemo<Record<string, string>>(() => ({
    contact_name: respondContactName ?? senderDisplay,
    company_name: "perusahaan Bapak/Ibu",
    brand_name: lead?.brand?.name ?? "tim kami",
    marketing_name: user?.name ?? "Tim Sales",
  }), [lead?.brand?.name, respondContactName, senderDisplay, user?.name]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    if (id === "blank") { setBody(""); return; }
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setChannel(tpl.channel);
    setBody(renderLeadTemplate(tpl.body, vars));
  }

  const unknownPlaceholders = useMemo(() => {
    const found = body.match(/{{\s*(\w+)\s*}}/g) ?? [];
    return Array.from(new Set(found));
  }, [body]);

  async function handleSend() {
    if (!lead || !user) return;
    const content = body.trim();
    if (!content) { toast.error("Isi respons tidak boleh kosong"); return; }
    setSending(true);
    try {
      const res = await api.inboxRespond({
        interactionId: lead.id,
        channel,
        content,
        subject: channel === "email" ? `Re: ${lead.subject ?? "permintaan Anda"}` : undefined,
        contactId: contactChoice ?? undefined,
        actorName: user.name,
        actorRole: user.role,
      });
      // Ronde 21 — sampaikan hasil pengiriman NYATA dengan jujur.
      const st = res.reply?.deliveryStatus;
      if (st === "failed") {
        toast.error("Email GAGAL terkirim", { description: res.reply?.deliveryNote ?? "Periksa koneksi kanal email", duration: 8000 });
      } else if (st === "sent") {
        toast.success("Email terkirim nyata via SMTP", { description: res.reply?.deliveryNote ?? undefined });
      } else if (st === "simulated") {
        toast.info("Respons tercatat (simulasi — email tidak terkirim)", {
          description: res.reply?.deliveryNote ?? "Hubungkan email asli di Saluran & Integrasi agar terkirim nyata",
          duration: 7000,
        });
      } else {
        toast.success(`Respons ${channel === "email" ? "email" : channel} tercatat`, {
          description: "Lead ditandai sudah direspons — countdown SLA berhenti.",
        });
      }
      // Task 24-a — balasan baru langsung digabung ke thread supaya Riwayat Percakapan mutakhir.
      onResponded({
        ...lead,
        ...res.lead,
        slaHours: lead.slaHours,
        candidates: lead.candidates,
        thread: {
          ...lead.thread,
          messageCount: lead.thread.messageCount + 1,
          lastMessageAt: res.reply.createdAt,
          messages: [
            ...lead.thread.messages,
            {
              id: res.reply.id,
              channel: res.reply.channel,
              direction: "outbound",
              subject: res.reply.subject ?? null,
              content: res.reply.content,
              senderName: res.reply.senderName ?? null,
              recipientName: res.reply.recipientName ?? null,
              respondedBy: res.reply.respondedBy ?? null,
              deliveryStatus: res.reply.deliveryStatus ?? null,
              externalId: res.reply.externalId ?? null,
              createdAt: res.reply.createdAt,
            },
          ],
        },
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat respons");
    } finally {
      setSending(false);
    }
  }

  const chMeta = (key: string) => RESPOND_CHANNELS.find((c) => c.key === key) ?? RESPOND_CHANNELS[0];
  const ChIcon = chMeta(channel).icon;

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto crm-scroll sm:max-w-xl" aria-label="Respons lead">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white" aria-hidden>
              <Reply className="h-3.5 w-3.5" />
            </span>
            Respons &amp; Catat
          </DialogTitle>
          <DialogDescription>
            Balas pesan <span className="font-medium text-zinc-700">{senderDisplay}</span> — tercatat sebagai Interaction outbound dan menghentikan countdown SLA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Kutipan pesan masuk */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="line-clamp-3 text-xs leading-relaxed text-zinc-600">{lead?.content}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
              <span>{lead ? formatDateTime(lead.createdAt) : ""}</span>
              {lead?.brand ? (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lead.brand.color }} aria-hidden />
                  {lead.brand.name}
                </span>
              ) : null}
              {respondContactName ? <span className="font-medium text-emerald-600">≡ {respondContactName}</span> : null}
            </div>
          </div>

          {/* Task 15-c — pilih kontak yang ditautkan ke respons (kandidat identifikasi) */}
          {candidates.length > 0 ? (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5" id="respond-contact-label">
                <Link2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                Tautkan kontak
              </Label>
              <div
                role="radiogroup"
                aria-labelledby="respond-contact-label"
                aria-label="Tautkan kontak ke respons"
                className="crm-scroll max-h-40 space-y-1.5 overflow-y-auto pr-1"
              >
                {candidates.map((c) => {
                  const label = c.contact?.fullName?.trim() || `Contact #${c.contactId.slice(0, 8)}`;
                  const selected = contactChoice === c.contactId;
                  return (
                    <label
                      key={c.contactId}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors",
                        selected
                          ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600" aria-hidden="true">
                        {initials(label)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-zinc-900">{label}</span>
                        {c.contact?.company?.name ? (
                          <span className="block truncate text-[10px] text-zinc-400">{c.contact.company.name}</span>
                        ) : null}
                      </span>
                      <span className={cn("shrink-0 text-[10px] font-bold", scoreTone(c.score).text)}>{c.score}%</span>
                      {selected ? <Check className="size-3.5 shrink-0 text-zinc-900" aria-hidden="true" /> : null}
                      <input
                        type="radio"
                        name="respond-contact-link"
                        className="sr-only"
                        checked={selected}
                        onChange={() => setContactChoice(c.contactId)}
                        aria-label={`Tautkan kontak ${label}`}
                      />
                    </label>
                  );
                })}
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors",
                    contactChoice === null
                      ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
                      : "border-zinc-200 bg-white hover:bg-zinc-50"
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-300 bg-white text-zinc-400" aria-hidden="true">
                    <Link2Off className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium text-zinc-700">Tidak menautkan</span>
                  <input
                    type="radio"
                    name="respond-contact-link"
                    className="sr-only"
                    checked={contactChoice === null}
                    onChange={() => setContactChoice(null)}
                    aria-label="Tidak menautkan kontak"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {/* Template */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">Template respons</Label>
            {loadingTpl ? (
              <Skeleton className="h-16 w-full rounded-lg" />
            ) : templates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-200 p-2.5 text-xs text-zinc-400">
                Belum ada template untuk brand ini — tulis pesan manual.
              </p>
            ) : (
              <div className="crm-scroll max-h-36 space-y-1.5 overflow-y-auto pr-1">
                <label className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                  templateId === "blank" ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-300"
                )}>
                  <Send className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                  <span className="font-medium text-zinc-900">Tulis respons sendiri</span>
                  <input type="radio" className="sr-only" checked={templateId === "blank"} onChange={() => pickTemplate("blank")} aria-label="Tulis respons sendiri" />
                </label>
                {templates.map((t) => {
                  const TplIcon = chMeta(t.channel).icon;
                  return (
                    <label key={t.id} className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                      templateId === t.id ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-300"
                    )}>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-zinc-900">
                          {t.name}
                          {!t.approved ? <Badge variant="outline" className="border-amber-200 bg-amber-50 px-1 text-[9px] text-amber-700">review</Badge> : null}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                          <span className="inline-flex items-center gap-1"><TplIcon className="h-3 w-3" aria-hidden />{chMeta(t.channel).label}</span>
                          <span aria-hidden>·</span>
                          <span>H+{t.delayDays}</span>
                        </span>
                      </span>
                      <input type="radio" className="sr-only" checked={templateId === t.id} onChange={() => pickTemplate(t.id)} aria-label={`Pakai template ${t.name}`} />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Kanal + isi */}
          <div className="grid gap-3 sm:grid-cols-[170px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="respond-channel">Kanal respons</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger id="respond-channel" className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESPOND_CHANNELS.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      <span className="flex items-center gap-2"><c.icon className="h-3.5 w-3.5" aria-hidden /> {c.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-body">Isi respons</Label>
              <Textarea
                id="respond-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                placeholder="Tulis respons untuk lead ini…"
                className="bg-white text-sm"
              />
              {unknownPlaceholders.length > 0 ? (
                <p className="text-[11px] text-amber-600">
                  Placeholder belum terisi: {unknownPlaceholders.join(", ")} — lengkapi manual sebelum kirim.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Batal</Button>
          <Button
            onClick={() => void handleSend()}
            disabled={sending || !body.trim()}
            aria-label="Kirim dan catat respons lead"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ChIcon className="h-4 w-4" aria-hidden />}
            {sending ? "Mencatat…" : `Kirim via ${chMeta(channel).label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  // Task 24-a — mode tampilan daftar: "thread" (grup per kontak, DEFAULT) | "message" (daftar flat lama)
  const [viewMode, setViewMode] = useState<"thread" | "message">("thread");
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
  // Fase 3 — respons & catat lead
  const [respondTarget, setRespondTarget] = useState<InboxLead | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  // Ronde 19 — status koneksi kanal utk banner "kanal belum terhubung"
  const [connectedChannels, setConnectedChannels] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await channelsApi.list();
        if (!alive) return;
        setConnectedChannels(new Set(res.configs.filter((c) => c.status === "connected").map((c) => c.channel)));
      } catch {
        if (alive) setConnectedChannels(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  const loadLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // sweep:1 → picu SLA auto-sweep server (throttle 5 menit di API)
      const res = await api.inbox({ channel: channelFilter, brandId: activeBrandFilter, sweep: true });
      setLeads(res.leads);
      setError(null);
      if (res.autoEscalated && res.autoEscalated > 0) {
        toast.warning(`${res.autoEscalated} lead dieskalasi otomatis`, {
          description: "Sweep SLA menemukan lead melewati SLA + grace 4 jam — task urgent dibuat untuk Direktur.",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan tak terduga");
      if (!silent) toast.error("Gagal memuat lead inbox");
    } finally {
      setLoading(false);
    }
  }, [channelFilter, activeBrandFilter]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  // Ronde 21 — tarik email masuk nyata via IMAP (kanal email terhubung & non-demo).
  const [emailSyncing, setEmailSyncing] = useState(false);
  async function handleEmailSync() {
    setEmailSyncing(true);
    try {
      const res = await channelsApi.emailSync();
      if (res.created > 0) {
        toast.success(`${res.created} email masuk ditarik via IMAP`, {
          description: `${res.skipped} duplikat dilewati · sejak ${new Date(res.since).toLocaleDateString("id-ID")}`,
        });
        await loadLeads(true);
      } else {
        toast.info("Tidak ada email baru", { description: `${res.skipped} email sudah pernah disinkron.` });
      }
    } catch (err) {
      toast.error("Sinkron IMAP gagal", { description: err instanceof Error ? err.message : "Cek koneksi email di Saluran & Integrasi" });
    } finally {
      setEmailSyncing(false);
    }
  }

  const stats = useMemo(() => {
    const list = leads ?? [];
    // Task 24-a — jumlah thread unik + total pesan (thread.messageCount sama utk seluruh anggota thread)
    const perThread = new Map<string, number>();
    for (const l of list) {
      const key = l.threadKey || l.id;
      perThread.set(key, Math.max(perThread.get(key) ?? 0, l.thread?.messageCount ?? 1));
    }
    return {
      total: list.length,
      // Breach baru (Fase 3): waktu tunggu melewati SLA brand — lead yang sudah direspons tidak dihitung
      late: list.filter((l) => !isResponded(l) && (l.brand?.slaHours ?? 24) - l.slaHours <= 0).length,
      duplicate: list.filter((l) => l.candidates.length > 0).length,
      responded: list.filter((l) => isResponded(l)).length,
      conversations: perThread.size,
      threadMessages: [...perThread.values()].reduce((acc, n) => acc + n, 0),
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

  // Task 24-a — grouping leads by threadKey → ThreadGroup, diurut sesuai sortBy
  const threadGroups = useMemo<ThreadGroup[]>(() => {
    const map = new Map<string, InboxLead[]>();
    for (const lead of sortedLeads) {
      const key = lead.threadKey || `lead:${lead.id}`;
      const arr = map.get(key);
      if (arr) arr.push(lead);
      else map.set(key, [lead]);
    }
    const groups: ThreadGroup[] = [];
    for (const [key, members] of map) {
      const byNewest = [...members].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const newest = byNewest[0];
      const thread = threadOf(newest);
      const pending = byNewest.filter((l) => !isResponded(l));
      let worstPending: InboxLead | null = null;
      let worstRemaining: number | null = null;
      for (const l of pending) {
        const remaining = (l.brand?.slaHours ?? 24) - l.slaHours;
        if (worstRemaining === null || remaining < worstRemaining) {
          worstPending = l;
          worstRemaining = remaining;
        }
      }
      groups.push({
        key,
        members: byNewest,
        newest,
        thread,
        worstPending,
        worstRemaining,
        maxCandidates: byNewest.reduce((acc, l) => Math.max(acc, l.candidates.length), 0),
        allResponded: pending.length === 0,
      });
    }
    if (sortBy === "late") {
      // Thread dgn SLA terburuk dulu (sisa paling kecil / minus); thread semua-responded di akhir
      groups.sort((a, b) => {
        const ra = a.worstRemaining ?? Number.POSITIVE_INFINITY;
        const rb = b.worstRemaining ?? Number.POSITIVE_INFINITY;
        if (ra !== rb) return ra - rb;
        return new Date(b.thread.lastMessageAt).getTime() - new Date(a.thread.lastMessageAt).getTime();
      });
    } else {
      groups.sort((a, b) => new Date(b.thread.lastMessageAt).getTime() - new Date(a.thread.lastMessageAt).getTime());
    }
    return groups;
  }, [sortedLeads, sortBy]);

  const selectedLead = useMemo(
    () => leads?.find((l) => l.id === selectedId) ?? null,
    [leads, selectedId]
  );

  // Task 17-c — riwayat respons outbound utk lead terpilih (match externalId `inbox-reply:<leadId>`)
  const [replies, setReplies] = useState<InteractionDTO[]>([]);
  const repliesLeadId = selectedLead?.id ?? null;
  const repliesLeadContactId = selectedLead?.contactId ?? null;
  const repliesRespondedAt = selectedLead?.respondedAt ?? null;
  useEffect(() => {
    if (!repliesLeadId) {
      setReplies([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await api.interactions(
          repliesLeadContactId ? { contactId: repliesLeadContactId } : undefined
        );
        if (!alive) return;
        const marker = `inbox-reply:${repliesLeadId}`;
        setReplies(
          res.interactions.filter((i) => i.direction === "outbound" && i.externalId === marker)
        );
      } catch {
        if (alive) setReplies([]);
      }
    })();
    return () => { alive = false; };
  }, [repliesLeadId, repliesLeadContactId, repliesRespondedAt]);

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
    // FIX r22: email hanya diisi bila benar-benar alamat email valid (x@y.tld).
    // Handle Instagram seperti "@rani.creativehouse" BUKAN email — jangan diprefill ke kolom email.
    const emailCandidate = extractEmailFromText(rawSender);
    const looksLikePhone = /^\+?[\d][\d\s\-()+]{5,}$/.test(rawSender);
    setContactForm({
      ...EMPTY_CONTACT_FORM,
      email: emailCandidate ?? "",
      whatsapp: looksLikePhone ? rawSender : "",
      // Ronde 23: lead IG dgn handle → handle masuk kolom Instagram (perilaku email r22 tetap).
      instagram: lead.channel === "instagram" && isSocialHandle(rawSender) ? rawSender : "",
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
        // Ronde 23 — jabatan + Instagram (lead berasal dari IG) ikut dikirim saat konversi.
        ...(contactForm.position.trim() ? { position: contactForm.position.trim() } : {}),
        ...(contactForm.instagram.trim() ? { instagram: contactForm.instagram.trim() } : {}),
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

  // Ronde 19 — kanal dgn lead masuk tapi belum ada koneksi aktif
  const unconnectedInbound = useMemo(() => {
    if (connectedChannels === null || !leads) return [];
    const used = new Set(leads.map((l) => l.channel).filter((c) => c in CHANNEL_TYPES));
    return [...used].filter((c) => !connectedChannels.has(c));
  }, [connectedChannels, leads]);

  return (
    <div className="space-y-4">
      {/* ===== Header ===== */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-900 sm:text-xl">Lead Inbox</h1>
              {leads ? (
                viewMode === "thread" ? (
                  <Badge className="bg-zinc-900 text-white" aria-label="Jumlah percakapan">
                    {`${stats.conversations} percakapan · ${stats.threadMessages} pesan`}
                  </Badge>
                ) : (
                  <Badge className="bg-zinc-900 text-white">{`${stats.total} lead belum dikonversi`}</Badge>
                )
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-500">Semua lead baru lintas kanal — Instagram, WhatsApp, Email, Website</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500" aria-label="Legenda SLA">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />SLA Aman</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />Segera Jatuh Tempo</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />Terlambat</span>
              <span className="inline-flex items-center gap-1.5"><Reply className="size-3 text-emerald-600" aria-hidden="true" />Sudah Direspons</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            {/* Task 24-a — toggle mode tampilan: Percakapan (grup per kontak, default) vs Per Pesan (flat) */}
            <div
              role="group"
              aria-label="Mode tampilan inbox"
              className="flex w-full items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 sm:w-fit"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={viewMode === "thread"}
                onClick={() => setViewMode("thread")}
                className={cn(
                  "min-h-10 flex-1 justify-center gap-1.5 rounded-md px-3 text-xs font-medium sm:flex-none",
                  viewMode === "thread"
                    ? "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white"
                    : "text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                )}
              >
                <MessagesSquare className="size-4" aria-hidden="true" />
                Percakapan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={viewMode === "message"}
                onClick={() => setViewMode("message")}
                className={cn(
                  "min-h-10 flex-1 justify-center gap-1.5 rounded-md px-3 text-xs font-medium sm:flex-none",
                  viewMode === "message"
                    ? "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white"
                    : "text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900"
                )}
              >
                <List className="size-4" aria-hidden="true" />
                Per Pesan
              </Button>
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
                className="size-10 shrink-0"
                disabled={loading}
                onClick={() => void loadLeads()}
                aria-label="Muat ulang daftar lead"
              >
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 shrink-0"
                disabled={emailSyncing}
                onClick={() => void handleEmailSync()}
                aria-label="Tarik email masuk via IMAP"
                title="Tarik email masuk via IMAP (kanal email)"
              >
                <Mail className={cn("size-4", emailSyncing && "animate-pulse")} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Ronde 19 — banner kanal belum terhubung ===== */}
      {unconnectedInbound.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="status">
          <PlugZap className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-800">
            <span className="font-semibold">Kanal belum terhubung: {unconnectedInbound.map((c) => CHANNEL_TYPES[c]?.label ?? c).join(", ")}.</span>{" "}
            {canAccess("channels", user?.role ?? "")
              ? "Balasan manual masih bisa dikirim, tetapi sinkronisasi otomatis & status pesan baru aktif setelah kanal disambungkan."
              : "Minta admin (Direktur) menghubungkannya di menu Saluran & Integrasi."}
          </p>
          {canAccess("channels", user?.role ?? "") ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-amber-300 bg-white px-2 text-xs text-amber-700 hover:bg-amber-100"
              onClick={() => useCrmStore.getState().setActiveModule("channels")}
            >
              Hubungkan sekarang
              <Send className="size-3" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ===== Stat strip (Task 24-a: + kartu Percakapan) ===== */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={Inbox} label="Total Lead" value={stats.total} tone="zinc" />
        <StatCard icon={AlarmClock} label="Terlambat Respons" value={stats.late} tone={stats.late > 0 ? "rose" : "zinc"} />
        <StatCard icon={Reply} label="Sudah Direspons" value={stats.responded} tone={stats.responded > 0 ? "zinc" : "zinc"} />
        <StatCard icon={AlertTriangle} label="Warning Duplikat" value={stats.duplicate} tone={stats.duplicate > 0 ? "amber" : "zinc"} />
        <StatCard icon={MessagesSquare} label="Percakapan" value={stats.conversations} tone="zinc" />
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
            viewMode === "thread" ? (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1 crm-scroll">
                {threadGroups.map((group) => (
                  <ThreadCard
                    key={group.key}
                    group={group}
                    selected={group.members.some((l) => l.id === selectedId)}
                    onSelect={handleSelectLead}
                  />
                ))}
              </div>
            ) : (
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
            )
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
                        <SlaBadge brandSlaHours={selectedLead.brand?.slaHours ?? 24} waitHours={selectedLead.slaHours} respondedAt={selectedLead.respondedAt} />
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

                  {/* Fase 3 — Respons & catat */}
                  <div className={cn(
                    "mt-3 rounded-lg border p-3",
                    selectedLead.respondedAt ? "border-emerald-200 bg-emerald-50/60" : "border-dashed border-zinc-300"
                  )}>
                    {selectedLead.respondedAt ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                          <Reply className="size-3.5 shrink-0" aria-hidden="true" />
                          Direspons oleh {selectedLead.respondedBy ?? "-"} · {timeAgo(selectedLead.respondedAt)}
                        </span>
                        <span className="text-[10px] text-emerald-600">SLA terpenuhi</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-zinc-500">
                          Belum direspons — balas dengan template agar SLA tercatat terpenuhi.
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 gap-1.5 rounded-lg bg-zinc-900 text-xs text-white hover:bg-zinc-800"
                          onClick={() => setRespondTarget(selectedLead)}
                          aria-label="Respons lead dengan template"
                        >
                          <Reply className="size-3" aria-hidden="true" />
                          Respons
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Task 17-c — Riwayat respons outbound + indikator tick status pengiriman */}
                  {replies.length > 0 ? (
                    <div className="mt-3 rounded-lg border border-zinc-200 p-3" aria-label="Riwayat respons">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
                          <Reply className="size-4 text-zinc-500" aria-hidden="true" />
                          Riwayat Respons
                        </span>
                        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
                          {`${replies.length} respons`}
                        </Badge>
                      </div>
                      <ul className="mt-2.5 space-y-2">
                        {replies.map((r) => {
                          const RIcon = channelMeta(r.channel).icon;
                          return (
                            <li key={r.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-2.5">
                              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                                <RIcon className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="font-medium text-zinc-600">{channelLabel(r.channel)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatDateTime(r.createdAt)}</span>
                                <DeliveryTick status={r.deliveryStatus} channel={r.channel} />
                              </div>
                              <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-700">
                                {r.content}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {/* Task 24-a — Riwayat Percakapan per kontak (thread) */}
                {selectedLead.thread.messageCount > 1 ? <ThreadHistorySection lead={selectedLead} /> : null}

                {/* Ronde 23 — Kelengkapan Identitas + pesan identifikasi */}
                <IdentityReadinessCard
                  lead={selectedLead}
                  contactForm={contactForm}
                  linkMode={convertMode === "link"}
                />

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
                      {selectedLead && selectedLead.channel === "instagram" && isSocialHandle(selectedLead.senderName) ? (
                        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                          <Instagram className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            Lead ini datang dari <strong>Instagram</strong> (handle {selectedLead.senderName}). Handle sosial <strong>tidak</strong> dimasukkan ke kolom email — isi email manual bila klien memberikannya.
                          </span>
                        </p>
                      ) : null}
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
                          <Label htmlFor="inbox-position" className="text-xs">Jabatan di Perusahaan</Label>
                          <Input
                            id="inbox-position"
                            value={contactForm.position}
                            onChange={(e) => setContactForm((f) => ({ ...f, position: e.target.value }))}
                            placeholder="cth. Marketing Manager"
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
                        <div className="space-y-1.5">
                          <Label htmlFor="inbox-instagram" className="text-xs">Instagram</Label>
                          <Input
                            id="inbox-instagram"
                            value={contactForm.instagram}
                            onChange={(e) => setContactForm((f) => ({ ...f, instagram: e.target.value }))}
                            placeholder="cth. @rani.creativehouse"
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

      {/* Fase 3 — dialog Respons & Catat lead */}
      <RespondDialog
        lead={respondTarget}
        linkedContactId={linkedContactId}
        linkedContactName={
          respondTarget && linkedContactId
            ? respondTarget.candidates.find((c) => c.contactId === linkedContactId)?.contact?.fullName ?? null
            : null
        }
        onClose={() => setRespondTarget(null)}
        onResponded={(updated) => {
          setLeads((prev) => (prev ?? []).map((l) => (l.id === updated.id ? updated : l)));
        }}
      />
    </div>
  );
}
