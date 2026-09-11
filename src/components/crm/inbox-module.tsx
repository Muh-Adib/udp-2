"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  AlarmClock, AlertTriangle, ArrowLeft, Building2, Check, CheckCheck, CheckCircle2, CircleDashed, Clock, Copy,
  Fingerprint, File, FileArchive, FileImage, FileText, FolderKanban, GitMerge, Globe, Inbox, Instagram, LayoutDashboard, Loader2, Mail,
  MessagesSquare, Paperclip, Phone, PlugZap, RefreshCw, Reply, Send, ShieldAlert, Sparkles, Timer, TimerOff, User, UserPlus, UserPen, Video, X,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/crm/whatsapp-icon";
import { toast } from "sonner";
import { api, channelsApi } from "@/lib/crm/api-client";
import { canAccess, useCrmStore } from "@/lib/crm/store";
import { BRAND_SERVICES, CHANNELS, PRIORITIES, SERVICE_CATEGORIES, stageLabel } from "@/lib/crm/constants";
import { CHANNEL_TYPES } from "@/lib/crm/channels";
import { extractEmailFromText, formatDateTime, initials, isSocialHandle, timeAgo } from "@/lib/crm/utils";
import type {
  Brand, ContactRef, ConversationThreadDTO, FollowUpTemplateDTO, InboxLeadDTO, InteractionAttachment, InteractionDTO, MatchCandidateDTO, ServiceCategoryDTO, ServiceDTO, ThreadMessageDTO,
} from "@/lib/crm/types";
import { AddCatalogMenu } from "@/components/crm/catalog-add-buttons";
// Ronde 44 — form contact BERSAMA (identik dgn "Kontak Baru") + validasi + auto-estimasi
import {
  buildPhonePayload,
  buildWhatsappPayload,
  ContactFields,
  EMPTY_CONTACT_FORM,
  NO_VALUE,
  serviceSuggestedPrice,
  splitPhoneParts,
  validateContactValues,
  type ContactFormValues,
} from "@/components/crm/contact-company-forms";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

// ============ Tipe lokal ============

/** Task 24-a — lead inbox kini InboxLeadDTO dari backend: membawa threadKey + thread percakapan. */
type InboxLead = InboxLeadDTO;

// ============ Ronde 34-b — lampiran dokumen di chat ============

/** Draf lampiran di composer (data URL) sebelum dikirim. */
interface AttachmentDraft {
  name: string;
  url: string;
  size: number;
}

const MAX_ATTACH_FILES = 3;
const MAX_ATTACH_BYTES = 2 * 1024 * 1024; // 2 MB per file — sinkron dgn validasi API

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIconOf(name: string): LucideIcon {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return FileImage;
  if (["pdf", "doc", "docx", "txt", "csv", "ppt", "pptx", "xls", "xlsx"].includes(ext)) return FileText;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  return File;
}

/** Baca File browser → data URL (base64) utk dikirim sebagai lampiran. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

/** Cocokkan 9 digit terakhir nomor (awalan +62/0 sering beda antar sumber). */
function digitsMatch(a: string, b: string): boolean {
  const da = a.replace(/\D+/g, "");
  const db = b.replace(/\D+/g, "");
  return da.length >= 9 && db.length >= 9 && da.slice(-9) === db.slice(-9);
}

/**
 * Ronde 34-b — pencocokan identitas best-effort lead↔kontak (thread belum ter-link contactId):
 * email di sender/recipient, 9 digit nomor, handle IG, atau nama persis.
 */
function leadMatchesContactIdentity(lead: InboxLead, c: ContactRef): boolean {
  for (const raw of [(lead.senderName ?? "").trim(), (lead.recipientName ?? "").trim()]) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    if (c.email && lower.includes(c.email.toLowerCase())) return true;
    if (c.whatsapp && digitsMatch(lower, c.whatsapp)) return true;
    if (c.phone && digitsMatch(lower, c.phone)) return true;
    if (c.instagram && lower === c.instagram.toLowerCase()) return true;
    if (c.fullName && lower === c.fullName.toLowerCase()) return true;
  }
  return false;
}

/** Lead sudah direspons (respondedAt terisi dari alur Respons & Catat Fase 3). */
function isResponded(lead: InboxLead): boolean {
  return Boolean(lead.respondedAt);
}

/** Ronde 44 — form contact kini bentuk BERSAMA dari contact-company-forms.tsx (identik dgn Kontak Baru). */
type ContactFormState = ContactFormValues;
interface OpportunityFormState {
  brandId: string; title: string; serviceCategory: string; serviceName: string;
  estimatedValue: string; priority: string;
}

const EMPTY_OPP_FORM: OpportunityFormState = {
  brandId: "", title: "", serviceCategory: "", serviceName: "", estimatedValue: "", priority: "medium",
};

// ============ Mapping kanal (tanpa indigo/blue) ============

const CHANNEL_STYLE: Record<string, { icon: LucideIcon; circle: string; badge: string }> = {
  whatsapp: { icon: WhatsAppIcon, circle: "bg-emerald-100 text-emerald-600", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
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

// ============ Ronde 25 — kanal balasan (hanya kanal yang punya alamat tujuan) ============

/** Kanal balasan yang dikenal backend (REPLY_CHANNELS di src/lib/crm/thread.ts). */
const REPLY_CHANNEL_KEYS = ["whatsapp", "email", "instagram", "phone"] as const;
type ReplyChannelKey = (typeof REPLY_CHANNEL_KEYS)[number];

const PHONE_LIKE_RE = /^\+?[\d][\d\s\-()+]{5,}$/;

function looksLikePhoneText(v?: string | null): boolean {
  return PHONE_LIKE_RE.test((v ?? "").trim());
}

/**
 * Ronde 25 — alamat tujuan satu kanal balasan dari data kontak/pengirim lead
 * (sumber sama dgn backend reachableAddress: kontak dulu, lalu fallback dari senderName).
 * socialProfile dibaca defensif — ada di model DB tapi belum ada di ContactRef DTO.
 */
function replyAddressFor(channel: string, lead: InboxLead): string | null {
  const sender = (lead.senderName ?? "").trim();
  const c = (lead.contact ?? null) as {
    email?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
    instagram?: string | null;
    socialProfile?: string | null;
  } | null;
  switch (channel) {
    case "email":
      return c?.email ?? extractEmailFromText(sender);
    case "whatsapp":
      return c?.whatsapp ?? (looksLikePhoneText(sender) ? sender : null);
    case "instagram":
      return c?.instagram
        ?? (c?.socialProfile && isSocialHandle(c.socialProfile) ? c.socialProfile : null)
        ?? (isSocialHandle(sender) || sender.startsWith("@") ? sender : null);
    case "phone":
      return c?.phone ?? c?.whatsapp ?? (looksLikePhoneText(sender) ? sender : null);
    default:
      return null;
  }
}

/** Daftar kanal balasan valid milik lead (whatsapp/email/instagram/phone) — urutan dari backend dipertahankan. */
function replyChannelsOf(lead: InboxLead): ReplyChannelKey[] {
  const raw = Array.isArray(lead.replyChannels) ? lead.replyChannels : [];
  return raw.filter((c): c is ReplyChannelKey =>
    (REPLY_CHANNEL_KEYS as readonly string[]).includes(c)
  );
}

/** Ronde 40-B — kanal yang bisa dipakai menghubungi kontak langsung (punya alamat tujuan). */
function contactReplyChannels(c: ContactRef): ReplyChannelKey[] {
  const out: ReplyChannelKey[] = [];
  if (c.whatsapp?.trim()) out.push("whatsapp");
  if (c.email?.trim()) out.push("email");
  if (c.instagram?.trim()) out.push("instagram");
  if (c.phone?.trim()) out.push("phone");
  return out;
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
  /** Ronde 32 — SEMUA anggota thread sudah dikonversi ke opportunity. */
  converted: boolean;
  /** Ronde 32 — ringkasan opportunity thread terkonversi (dari anggota mana pun). */
  opportunity: { id: string; title: string; stage: string } | null;
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
  // Ronde 32 — thread terkonversi: badge opportunity menggantikan SLA (bukan lagi "lead menunggu")
  const opp = group.opportunity;
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
        breached ? "border-l-4 border-l-rose-500" : group.converted ? "border-l-4 border-l-emerald-500" : group.allResponded ? "border-l-4 border-l-emerald-500" : "hover:border-zinc-300",
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
            {/* Ronde 32 — badge opportunity utk thread terkonversi (bisa coexist dgn SLA
                pada grup campuran: pesan lama terkonversi + pesan baru belum). */}
            {opp ? (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-50 text-emerald-700"
                aria-label="Thread sudah dikonversi menjadi opportunity"
                title={opp.title}
              >
                <FolderKanban aria-hidden="true" />
                {`Opportunity · ${stageLabel(opp.stage)}`}
              </Badge>
            ) : null}
            {group.converted ? null : group.allResponded ? (
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
          <p className="flex items-center gap-1.5"><WhatsAppIcon className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />{contact.whatsapp}</p>
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

// ============ Ronde 29 — identitas lead: sumber data, kelengkapan 0/5, pesan identifikasi ============

/** Data identitas lead — dari contact terhubung/kandidat terpilih ATAU form lokal (pra-konversi). */
interface IdentityData {
  firstName: string; lastName: string; companyName: string; position: string;
  email: string; whatsapp: string; instagram: string; city: string;
}

/** 5 data identitas yang dilacak: Nama, Perusahaan, Jabatan, Email, WhatsApp. */
const IDENTITY_FIELDS: { key: keyof IdentityData; label: string; messageLabel: string }[] = [
  { key: "firstName", label: "Nama", messageLabel: "Nama lengkap" },
  { key: "companyName", label: "Perusahaan", messageLabel: "Nama perusahaan" },
  { key: "position", label: "Jabatan", messageLabel: "Jabatan di perusahaan" },
  { key: "email", label: "Email", messageLabel: "Email aktif" },
  { key: "whatsapp", label: "WhatsApp", messageLabel: "Nomor WhatsApp aktif" },
];

/** ContactRef (terhubung/kandidat) → bentuk form BERSAMA — dipakai modal identitas & konversi. */
function contactToForm(c: ContactRef): ContactFormState {
  const parts = (c.fullName ?? "").trim().split(/\s+/);
  const wa = splitPhoneParts(c.whatsapp ?? "");
  const tel = splitPhoneParts(c.phone ?? "");
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
    position: c.position?.trim() ?? "",
    email: c.email?.trim() ?? "",
    whatsapp: wa.national,
    whatsappDial: wa.dial,
    phone: tel.national,
    phoneDial: tel.dial,
    companyName: c.company?.name?.trim() ?? "",
    companyId: c.companyId || NO_VALUE,
    city: c.city?.trim() ?? "",
    country: c.country?.trim() ?? "",
    currency: c.currency?.trim() ?? "",
    preferredChannel: c.preferredChannel || "whatsapp",
    instagram: c.instagram?.trim() ?? "",
    facebook: c.facebook?.trim() ?? "",
    tiktok: c.tiktok?.trim() ?? "",
    tagsText: "",
  };
}

function identityFromForm(f: ContactFormState): IdentityData {
  return {
    firstName: f.firstName, lastName: f.lastName, companyName: f.companyName, position: f.position,
    email: f.email, whatsapp: f.whatsapp, instagram: f.instagram, city: f.city,
  };
}

/** Kelengkapan identitas 0/5 — chips reaktif terhadap sumber data aktif. */
function identityCompleteness(d: IdentityData) {
  const fields = IDENTITY_FIELDS.map((f) => ({ ...f, filled: (d[f.key] ?? "").trim() !== "" }));
  const missing = fields.filter((f) => !f.filled);
  return {
    fields,
    missing,
    count: fields.length - missing.length,
    total: fields.length,
    complete: missing.length === 0,
  };
}

/** Pesan identifikasi — hanya menanyakan field yang masih kurang (siap tempel ke chat klien). */
function buildIdentityMessage(d: IdentityData, brandName: string, igHandleFallback?: string | null): string {
  const { missing } = identityCompleteness(d);
  const greetingName = d.firstName.trim() || (igHandleFallback ?? "").trim();
  return [
    `Halo${greetingName ? ` ${greetingName}` : ""}! Terima kasih sudah menghubungi ${brandName}. Sebelum kami lanjut, boleh dibantu lengkapi info berikut:`,
    ...missing.map((f) => `- ${f.messageLabel}`),
  ].join("\n");
}

/** Salin teks + fallback legacy; false = clipboard ditolak browser (butuh salin manual). */
async function copyTextSmart(text: string, successMsg: string): Promise<boolean> {
  const legacyCopy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
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
    await navigator.clipboard.writeText(text);
    toast.success(successMsg);
    return true;
  } catch {
    if (legacyCopy()) {
      toast.success(successMsg);
      return true;
    }
    return false;
  }
}

/** Label hari utk pemisah pesan chat: Hari ini / Kemarin / nama hari / tanggal. */
function dayLabelOf(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = startOfDay(new Date()) - startOfDay(d);
  const DAY = 86_400_000;
  if (diff === 0) return "Hari ini";
  if (diff === DAY) return "Kemarin";
  if (diff > 0 && diff < 7 * DAY) return d.toLocaleDateString("id-ID", { weekday: "long" });
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function DaySeparator({ label }: { label: string }) {
  return (
    <li className="flex justify-center py-1.5" role="presentation">
      <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-zinc-500 shadow-sm">
        {label}
      </span>
    </li>
  );
}

/** Teks identitas kanal lead utk subtitle header chat (nomor/handle → fallback contact). */
function leadAddressText(lead: InboxLead): string {
  const raw = (lead.senderName ?? "").trim();
  if (looksLikePhoneText(raw) || isSocialHandle(raw) || raw.startsWith("@")) return raw;
  if (lead.contact?.whatsapp) return lead.contact.whatsapp;
  if (lead.contact?.email) return lead.contact.email;
  return raw || "-";
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
        {message.attachments && message.attachments.length > 0 ? (
          <ul className="mt-1.5 space-y-1" aria-label="Lampiran pesan">
            {message.attachments.map((a, i) => {
              const AIcon = attachmentIconOf(a.name);
              return (
                <li key={`${a.name}-${i}`}>
                  <a
                    href={a.url}
                    download={a.name}
                    className={cn(
                      "flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                      isInbound
                        ? "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        : "bg-white/10 text-white hover:bg-white/20"
                    )}
                    aria-label={`Unduh lampiran ${a.name}`}
                  >
                    <AIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="shrink-0 opacity-70">{formatBytes(a.size)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
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

// ============ Ronde 29 — composer chat inline (menggantikan dialog Respons — satu pintu, anti-redundan) ============

/** Ganti placeholder template untuk konteks lead inbox. */
function renderLeadTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/{{\s*(\w+)\s*}}/g, (full, key: string) => vars[key] ?? full);
}

// ============ Ronde 40-B — kartu mulai percakapan (kontak belum punya thread) ============

/**
 * Tampil di area chat bila kontak difokuskan lintas modul tapi belum punya thread.
 * Mengirim pesan outbound pertama via POST /api/inbox/respond mode kontak.
 */
function StartConversationCard({
  contact, channels, channel, onChannelChange, body, onBodyChange, onSend, sending, sentCount, onClose,
}: {
  contact: ContactRef;
  channels: ReplyChannelKey[];
  channel: string;
  onChannelChange: (c: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  sentCount: number;
  onClose: () => void;
}) {
  const chMeta = channelMeta(channel);
  const ChIcon = chMeta.icon;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-zinc-200 px-3 py-2.5 sm:px-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white"
          aria-hidden="true"
        >
          {initials(contact.fullName.replace(/^@+/, ""))}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">Belum ada percakapan dengan {contact.fullName}</p>
          <p className="truncate text-xs text-zinc-500">Mulai chat outbound pertama — pesan tercatat di riwayat kontak.</p>
        </div>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onClose} aria-label="Tutup kartu mulai percakapan">
          <X className="size-4" />
        </Button>
      </div>

      <div className="crm-scroll min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 p-4 sm:p-6">
        <div className="mx-auto max-w-md space-y-3">
          <div className="rounded-xl border bg-white p-4 text-center shadow-sm">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-zinc-100" aria-hidden="true">
              <MessagesSquare className="size-6 text-zinc-400" />
            </span>
            <p className="mt-2 text-sm font-medium text-zinc-700">Pilih kanal yang bisa dihubungi</p>
            {channels.length > 0 ? (
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {channels.map((c) => {
                  const m = channelMeta(c);
                  const MIcon = m.icon;
                  return (
                    <Badge key={c} variant="outline" className={cn("gap-1 border", m.badge)}>
                      <MIcon className="size-3" aria-hidden="true" />
                      {channelLabel(c)}
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
                Kontak belum punya email/WhatsApp/handle sosial — lengkapi dulu di modul Contacts.
              </p>
            )}
          </div>
          {sentCount > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5" role="status">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-emerald-800">
                {sentCount} pesan terkirim & tercatat di riwayat kontak. Balasan dari kontak akan muncul sebagai thread baru di Inbox.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-zinc-200 bg-white p-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Select value={channel} onValueChange={onChannelChange} disabled={channels.length === 0 || sending}>
            <SelectTrigger className="h-10 w-[150px] shrink-0 bg-zinc-50 text-xs" aria-label="Kanal pesan">
              <SelectValue placeholder="Kanal" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c} value={c}>{channelLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {channel ? (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
              <ChIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">via {channelLabel(channel)}</span>
            </p>
          ) : null}
        </div>
        <Textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Tulis pesan pertama…"
          aria-label="Isi pesan"
          className="min-h-[80px] bg-zinc-50"
          disabled={sending || channels.length === 0}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            className="bg-zinc-900 text-white hover:bg-zinc-800"
            disabled={sending || channels.length === 0 || body.trim() === ""}
            onClick={onSend}
            aria-label="Kirim Pesan"
          >
            {sending ? (
              <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Mengirim…</>
            ) : (
              <><Send className="size-4" aria-hidden="true" /> Kirim Pesan</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatComposer({
  lead, channel, onChannelChange, body, onBodyChange, onSend, sending, respondContactName, onNeedIdentity,
  attachments, onAttachmentsChange,
}: {
  lead: InboxLead;
  channel: string;
  onChannelChange: (c: string) => void;
  body: string;
  onBodyChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Nama contact terhubung/kandidat terpilih — variabel template respons. */
  respondContactName: string | null;
  /** Belum ada kanal balasan → buka modal Identitas. */
  onNeedIdentity: () => void;
  /** Ronde 34-b — lampiran siap kirim (data URL) + pengubahnya (state diangkat ke modul). */
  attachments: AttachmentDraft[];
  onAttachmentsChange: (next: AttachmentDraft[]) => void;
}) {
  const user = useCrmStore((s) => s.user);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replyChannels = useMemo(() => replyChannelsOf(lead), [lead]);
  const addresses = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of replyChannels) {
      const addr = replyAddressFor(ch, lead);
      if (addr) map.set(ch, addr);
    }
    return map;
  }, [lead, replyChannels]);

  // Template follow-up brand ini — diakses via menu ✦ agar composer tetap ramping
  const [templates, setTemplates] = useState<FollowUpTemplateDTO[] | null>(null);
  useEffect(() => {
    let alive = true;
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
        if (alive) setTemplates([]);
      }
    })();
    return () => { alive = false; };
  }, [lead.brandId]);

  const senderDisplay = (lead.senderName ?? "").trim() || "Tanpa nama";
  const vars = useMemo<Record<string, string>>(() => ({
    contact_name: respondContactName ?? senderDisplay,
    company_name: "perusahaan Bapak/Ibu",
    brand_name: lead.brand?.name ?? "tim kami",
    marketing_name: user?.name ?? "Tim Sales",
  }), [lead.brand?.name, respondContactName, senderDisplay, user?.name]);

  function applyTemplate(id: string) {
    if (id === "__blank") { onBodyChange(""); return; }
    const tpl = templates?.find((t) => t.id === id);
    if (!tpl) return;
    // Kanal template dipakai hanya bila termasuk kanal balasan legal lead ini
    if (replyChannels.includes(tpl.channel as ReplyChannelKey)) onChannelChange(tpl.channel);
    onBodyChange(renderLeadTemplate(tpl.body, vars));
  }

  // Ronde 34-b — pilih file → data URL + validasi ukuran/jumlah (sinkron dgn batas API)
  async function handleFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_ATTACH_FILES - attachments.length;
    if (room <= 0) {
      toast.error(`Maksimal ${MAX_ATTACH_FILES} lampiran per pesan`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    const next: AttachmentDraft[] = [];
    for (const f of picked) {
      if (f.size > MAX_ATTACH_BYTES) {
        toast.error(`"${f.name}" melebihi 2 MB`, { description: "Pilih file yang lebih kecil" });
        continue;
      }
      try {
        const url = await readFileAsDataUrl(f);
        next.push({ name: f.name, url, size: f.size });
      } catch {
        toast.error(`Gagal membaca "${f.name}"`);
      }
    }
    if (next.length > 0) onAttachmentsChange([...attachments, ...next]);
  }

  const canSend = replyChannels.length > 0 && !sending && (body.trim() !== "" || attachments.length > 0);

  return (
    <div className="border-t border-zinc-200 bg-white p-3 sm:px-4">
      {replyChannels.length === 0 ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" role="alert">
          <p className="min-w-0 text-xs leading-snug text-amber-800">
            Belum ada kanal yang bisa dihubungi — lengkapi email / WhatsApp / Instagram lead ini dulu.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 border-amber-300 bg-white px-2 text-xs text-amber-700 hover:bg-amber-100"
            onClick={onNeedIdentity}
          >
            Lengkapi Identitas
          </Button>
        </div>
      ) : null}
      {/* Ronde 34-b — chip lampiran siap kirim */}
      {attachments.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Lampiran yang siap dikirim">
          {attachments.map((a, i) => {
            const AIcon = attachmentIconOf(a.name);
            return (
              <li
                key={`${a.name}-${i}`}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 py-1 pl-2 pr-1 text-xs"
              >
                <AIcon className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                <span className="max-w-[10rem] truncate font-medium text-zinc-700">{a.name}</span>
                <span className="shrink-0 text-zinc-400">{formatBytes(a.size)}</span>
                <button
                  type="button"
                  className="flex size-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700"
                  onClick={() => onAttachmentsChange(attachments.filter((_, j) => j !== i))}
                  aria-label={`Hapus lampiran ${a.name}`}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        {replyChannels.length > 0 ? (
          <Select value={channel} onValueChange={onChannelChange}>
            <SelectTrigger className="h-10 w-[122px] shrink-0 bg-zinc-50 text-xs sm:w-[160px]" aria-label="Kanal balasan">
              <SelectValue placeholder="Kanal" />
            </SelectTrigger>
            <SelectContent>
              {replyChannels.map((c) => {
                const CIcon = channelMeta(c).icon;
                return (
                  <SelectItem key={c} value={c}>
                    <span className="flex items-center gap-1.5">
                      <CIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      {channelLabel(c)}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : null}
        <Textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          onKeyDown={(e) => {
            // Balas satu-satu ala chat: Enter mengirim, Shift+Enter baris baru
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          rows={2}
          disabled={replyChannels.length === 0}
          placeholder={replyChannels.length > 0 ? `Balas via ${channelLabel(channel)}…` : "Tidak bisa membalas — lengkapi identitas dulu"}
          aria-label="Tulis pesan balasan"
          className="min-h-10 flex-1 resize-none bg-zinc-50 text-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0"
              disabled={replyChannels.length === 0}
              aria-label="Pakai template respons"
              title="Pakai template respons"
            >
              <Sparkles className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs">Template respons</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {templates === null ? (
              <div className="px-2 py-1.5" aria-hidden="true">
                <Skeleton className="h-4 w-full" />
              </div>
            ) : templates.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs">Belum ada template utk brand ini</DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem className="text-xs" onClick={() => applyTemplate("__blank")}>
                  <Send className="size-3.5" aria-hidden="true" />
                  Tulis sendiri
                </DropdownMenuItem>
                {templates.map((t) => {
                  const TIcon = channelMeta(t.channel).icon;
                  return (
                    <DropdownMenuItem key={t.id} className="text-xs" onClick={() => applyTemplate(t.id)}>
                      <TIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="shrink-0 text-[10px] text-zinc-400">H+{t.delayDays}</span>
                    </DropdownMenuItem>
                  );
                })}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Ronde 34-b — lampirkan dokumen/gambar */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={replyChannels.length === 0 || sending || attachments.length >= MAX_ATTACH_FILES}
          aria-label="Lampirkan dokumen"
          title={`Lampirkan dokumen (maks ${MAX_ATTACH_FILES} file @2 MB)`}
        >
          <Paperclip className="size-4" aria-hidden="true" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
          onChange={(e) => {
            void handleFilesPicked(e.target.files);
            e.target.value = ""; // izinkan pilih file yg sama lagi
          }}
        />
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0"
          onClick={onSend}
          disabled={!canSend}
          aria-label={replyChannels.length === 0 ? "Tidak ada kanal untuk membalas" : `Kirim via ${channelLabel(channel)}`}
        >
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
        </Button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">
        Enter kirim · Shift+Enter baris baru · Lampiran maks {MAX_ATTACH_FILES} file @2 MB
        {replyChannels.length > 0 && addresses.get(channel) ? (
          <> · Tujuan: <span className="font-medium text-zinc-500">{addresses.get(channel)}</span></>
        ) : null}
      </p>
    </div>
  );
}

/** Tombol ikon kecil utk tools header chat — ringkas dengan badge opsional. */
function ToolIconButton({
  icon: Icon, label, onClick, disabled, danger, badge,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  badge?: number;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "relative size-8 shrink-0",
        danger
          ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      )}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon className="size-4" aria-hidden="true" />
      {badge !== undefined && badge > 0 ? (
        <span
          className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white"
          aria-hidden="true"
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </Button>
  );
}

// ============ Ronde 29 — modal identitas lead: edit identitas + kelengkapan 0/5 + salin pesan ============

function IdentityModal({
  lead, linkedContactId, linkedContactForm, form, onFormChange, onClose, onContactSaved,
}: {
  lead: InboxLead | null;
  /** Contact target edit (terhubung/kandidat terpilih) — null = mode draft pra-konversi. */
  linkedContactId: string | null;
  /** Prefill form dari contact target (stabil via useMemo di pemanggil). */
  linkedContactForm: ContactFormState | null;
  form: ContactFormState;
  onFormChange: (f: ContactFormState) => void;
  onClose: () => void;
  onContactSaved: () => void;
}) {
  const [draft, setDraft] = useState<ContactFormState>(EMPTY_CONTACT_FORM);
  const [saving, setSaving] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setDraft(linkedContactId && linkedContactForm ? linkedContactForm : form);
  }, [lead, linkedContactId, linkedContactForm, form]);

  const identity = identityCompleteness(identityFromForm(draft));
  const igHandle = lead && lead.channel === "instagram" && isSocialHandle(lead.senderName ?? "") ? lead.senderName : null;
  const identityMessage = buildIdentityMessage(identityFromForm(draft), lead?.brand?.name ?? "tim kami", igHandle);
  const displayName =
    lead?.contact?.fullName?.trim()
    || (lead?.senderName ?? "").trim()
    || "Tanpa nama";

  async function handleSave() {
    if (!lead) return;
    if (!draft.firstName.trim()) { toast.error("Nama depan wajib diisi"); return; }
    if (linkedContactId) {
      // Sudah terhubung contact → simpan langsung ke contact (satu identitas utk semua kanal)
      setSaving(true);
      try {
        await api.updateContact(linkedContactId, {
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          position: draft.position.trim(),
          email: draft.email.trim(),
          // Ronde 44 — gabung kode dial + nomor nasional (form kini bentuk bersama)
          whatsapp: buildWhatsappPayload(draft.whatsappDial, draft.whatsapp) || draft.whatsapp.trim(),
          instagram: draft.instagram.trim(),
          city: draft.city.trim(),
          companyName: draft.companyName.trim(),
        });
        toast.success("Identitas contact diperbarui", {
          description: "Log percakapan & kanal balasan otomatis mengikuti data terbaru.",
        });
        onContactSaved();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan identitas");
      } finally {
        setSaving(false);
      }
    } else {
      // Belum terhubung → simpan ke draft konversi (jadi contact saat lead dikonversi)
      onFormChange(draft);
      toast.success("Identitas tersimpan", { description: "Data ini jadi contact sungguhan saat lead dikonversi." });
      onClose();
    }
  }

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="crm-scroll max-h-[92vh] overflow-y-auto sm:max-w-lg" aria-label="Identitas lead">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white" aria-hidden="true">
              <UserPen className="size-3.5" />
            </span>
            Identitas Lead
          </DialogTitle>
          <DialogDescription>
            {linkedContactId
              ? "Perubahan langsung tersimpan ke contact terhubung — log & kanal balasan mengikuti."
              : "Belum terhubung contact — data ini terpakai saat lead dikonversi jadi contact baru."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* profil lead — dari kanal masuk (WA/IG); sekali terisi mengikuti contact */}
          <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white"
              aria-hidden="true"
            >
              {initials(displayName.replace(/^@+/, ""))}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900">{displayName}</p>
              <p className="truncate text-xs text-zinc-500">
                {lead ? `${channelLabel(lead.channel)} · ${leadAddressText(lead)}` : ""}
              </p>
            </div>
          </div>

          {/* kelengkapan 0/5 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Kelengkapan Identitas</span>
            <Badge
              variant="outline"
              className={identity.complete
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-amber-300 bg-amber-50 text-amber-700"}
            >
              {`${identity.count}/${identity.total} lengkap`}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Status kelengkapan 5 data identitas">
            {identity.fields.map((f) => (
              <IdentityChip key={f.key} label={f.label} filled={f.filled} />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">
            Follow-up awal = identifikasi: lengkapi data kontak supaya log percakapan dari semua kanal mudah tergabung dengan lead ini.
          </p>

          {/* form identitas */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="identity-first-name" className="text-xs">Nama Depan <span className="text-rose-600">*</span></Label>
              <Input
                id="identity-first-name"
                value={draft.firstName}
                onChange={(e) => setDraft((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="cth. Dian"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-last-name" className="text-xs">Nama Belakang</Label>
              <Input
                id="identity-last-name"
                value={draft.lastName}
                onChange={(e) => setDraft((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="cth. Permata"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-company" className="text-xs">Perusahaan</Label>
              <Input
                id="identity-company"
                value={draft.companyName}
                onChange={(e) => setDraft((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="cth. PT Agro Makmur"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-position" className="text-xs">Jabatan di Perusahaan</Label>
              <Input
                id="identity-position"
                value={draft.position}
                onChange={(e) => setDraft((f) => ({ ...f, position: e.target.value }))}
                placeholder="cth. Marketing Manager"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-email" className="text-xs">Email</Label>
              <Input
                id="identity-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((f) => ({ ...f, email: e.target.value }))}
                placeholder="nama@perusahaan.co.id"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-whatsapp" className="text-xs">WhatsApp</Label>
              <Input
                id="identity-whatsapp"
                value={draft.whatsapp}
                onChange={(e) => setDraft((f) => ({ ...f, whatsapp: e.target.value }))}
                placeholder="+62 8xx xxxx xxxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-instagram" className="text-xs">Instagram</Label>
              <Input
                id="identity-instagram"
                value={draft.instagram}
                onChange={(e) => setDraft((f) => ({ ...f, instagram: e.target.value }))}
                placeholder="cth. @rani.creativehouse"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="identity-city" className="text-xs">Kota</Label>
              <Input
                id="identity-city"
                value={draft.city}
                onChange={(e) => setDraft((f) => ({ ...f, city: e.target.value }))}
                placeholder="cth. Medan"
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={identity.complete}
            onClick={async () => {
              const ok = await copyTextSmart(identityMessage, "Pesan identifikasi disalin — tempel di chat klien");
              if (!ok) setManualCopy(true);
            }}
            aria-label={identity.complete ? "Data kontak sudah lengkap" : "Salin pesan identifikasi untuk dikirim ke klien"}
          >
            {identity.complete ? (
              <><CheckCircle2 className="size-4" aria-hidden="true" /> Data lengkap</>
            ) : (
              <><Copy className="size-4" aria-hidden="true" /> Salin Pesan Identifikasi</>
            )}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !draft.firstName.trim()}>
            {saving ? (
              <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Menyimpan…</>
            ) : linkedContactId ? "Simpan ke Contact" : "Simpan Identitas"}
          </Button>
        </DialogFooter>

        {/* fallback salin manual bila clipboard ditolak browser */}
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
              <Button type="button" variant="outline" size="sm" onClick={() => setManualCopy(false)}>Tutup</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// ============ Ronde 29 — modal identifikasi identitas (kandidat merge lintas kanal) ============

function IdentifyModal({
  lead, selectedContactId, onToggle, onClose, onConvert, onLink, linking,
}: {
  lead: InboxLead | null;
  selectedContactId: string | null;
  onToggle: (contactId: string) => void;
  onClose: () => void;
  onConvert: () => void;
  /** Ronde 33 — gabungkan identitas ke contact TANPA konversi (aksi yang hilang). */
  onLink: () => void;
  linking: boolean;
}) {
  const count = lead?.candidates.length ?? 0;
  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="crm-scroll max-h-[92vh] overflow-y-auto sm:max-w-md" aria-label="Identifikasi identitas lead">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white" aria-hidden="true">
              <Fingerprint className="size-3.5" />
            </span>
            Identifikasi Identitas
          </DialogTitle>
          <DialogDescription>
            {selectedContactId
              ? "Kandidat dipilih — 'Gabungkan ke Contact' menyatukan log percakapan lintas kanal ke contact ini TANPA membuat opportunity. Bila sudah siap masuk pipeline, pakai 'Konversi jadi Opportunity'."
              : "Cocokkan lead dgn contact yang sudah ada supaya log percakapan lintas kanal tergabung."}
          </DialogDescription>
        </DialogHeader>

        {lead && count > 0 ? (
          <div className="space-y-3">
            {lead.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.contactId}
                candidate={candidate}
                selected={selectedContactId === candidate.contactId}
                onToggle={() => onToggle(candidate.contactId)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center">
            <p className="text-sm font-medium text-zinc-600">Tidak ada kemiripan</p>
            <p className="mt-1 text-xs text-zinc-400">
              Buat contact baru saat konversi — lengkapi identitasnya lewat modal Identitas.
            </p>
          </div>
        )}

        {/* Ronde 33 — footer SELALU vertikal: 3 tombol nowrap (~500px) melebihi max-w-md
            (448px) bila sebaris — dulu menyebabkan modal melebar/overflow. Perlu sm:flex-col
            eksplisit utk menimpa sm:flex-row bawaan DialogFooter. Urutan = urutan keputusan:
            gabung identitas dulu, konversi bila siap, tutup terakhir. */}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="outline"
            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            disabled={!selectedContactId || linking}
            onClick={onLink}
            aria-label="Gabungkan log percakapan ke contact terpilih tanpa membuat opportunity"
          >
            {linking ? (
              <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Menggabungkan…</>
            ) : (
              <><GitMerge className="size-4" aria-hidden="true" /> Gabungkan ke Contact</>
            )}
          </Button>
          <Button className="w-full" onClick={onConvert} disabled={linking}>
            <UserPlus className="size-4" aria-hidden="true" />
            Konversi jadi Opportunity
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Ronde 29 — modal konversi lead (contact baru/terpilih + opportunity) ============

function ConvertModal({
  lead, brands, mode, onModeToggle,
  linkTargetId, linkContactName,
  contactForm, onContactFormChange,
  oppForm, onOppFormChange,
  converting, onConvert, onClose,
}: {
  lead: InboxLead | null;
  brands: Brand[];
  /** "new" = buat contact baru, "link" = gabung ke contact terpilih/terhubung, null = belum dipilih. */
  mode: "new" | "link" | null;
  onModeToggle: () => void;
  /** Contact tujuan penggabungan (kandidat terpilih ATAU contact terhubung bawaan). */
  linkTargetId: string | null;
  linkContactName: string | null;
  contactForm: ContactFormState;
  onContactFormChange: (f: ContactFormState) => void;
  oppForm: OpportunityFormState;
  onOppFormChange: (f: OpportunityFormState) => void;
  converting: boolean;
  onConvert: () => void;
  onClose: () => void;
}) {
  const brandOptions = lead ? (brands.length > 0 ? brands : lead.brand ? [lead.brand] : []) : [];
  const selectedOppBrand = brandOptions.find((b) => b.id === oppForm.brandId);

  // Ronde 41 — katalog layanan LIVE dari DB brand (pola sama dgn OpportunityFormDialog):
  // state menyimpan brandId pemiliknya; catalog "aktif" diderive — mismatch brand → null
  // (fallback konstanta statis) TANPA setState sinkron di dalam effect.
  const [catalogState, setCatalogState] = useState<{ brandId: string; categories: ServiceCategoryDTO[]; services: ServiceDTO[] } | null>(null);
  useEffect(() => {
    if (!oppForm.brandId) return;
    let cancelled = false;
    const brandId = oppForm.brandId;
    api.brandServices(brandId)
      .then((res) => {
        if (!cancelled) setCatalogState({ brandId, categories: res.categories, services: res.services });
      })
      .catch(() => {
        if (!cancelled) setCatalogState((prev) => (prev?.brandId === brandId ? null : prev));
      });
    return () => {
      cancelled = true;
    };
  }, [oppForm.brandId]);
  const catalog = catalogState && catalogState.brandId === oppForm.brandId ? catalogState : null;

  // Ronde 42 — tambah kategori/layanan langsung dari modal konversi (Direktur/Admin)
  const user42 = useCrmStore((s) => s.user);
  const canEditCatalog = user42?.role === "director" || user42?.role === "super_admin";
  const reloadCatalog = useCallback(() => {
    if (!oppForm.brandId) return;
    api.brandServices(oppForm.brandId)
      .then((res) => setCatalogState({ brandId: oppForm.brandId, categories: res.categories, services: res.services }))
      .catch(() => {
        /* biarkan katalog lama */
      });
  }, [oppForm.brandId]);

  // Kategori: nama kategori live dari katalog brand; fallback konstanta statis.
  const kategoriOptions = useMemo(() => {
    const live = catalog && catalog.categories.length > 0
      ? catalog.categories.map((c) => c.name)
      : [...SERVICE_CATEGORIES];
    if (oppForm.serviceCategory && !live.includes(oppForm.serviceCategory)) live.unshift(oppForm.serviceCategory);
    return live;
  }, [catalog, oppForm.serviceCategory]);

  // Layanan: filter per kategori bila kategori cocok dgn katalog; fallback statis per brand slug.
  const serviceNameOptions = useMemo(() => {
    if (catalog) {
      const cat = catalog.categories.find((c) => c.name === oppForm.serviceCategory);
      const list = (cat
        ? catalog.services.filter((s) => s.categoryId === cat.id)
        : catalog.services
      ).map((s) => s.name);
      return oppForm.serviceName && !list.includes(oppForm.serviceName)
        ? [oppForm.serviceName, ...list]
        : list;
    }
    return selectedOppBrand ? BRAND_SERVICES[selectedOppBrand.slug] ?? [] : [];
  }, [catalog, oppForm.serviceCategory, oppForm.serviceName, selectedOppBrand]);

  // Ronde 41 — ganti kategori: reset layanan hanya bila nilai lama tak cocok dgn katalog
  function handleConvertCategoryChange(v: string) {
    let nextServiceName = "";
    if (catalog) {
      const cat = catalog.categories.find((c) => c.name === v);
      const list = (cat
        ? catalog.services.filter((s) => s.categoryId === cat.id)
        : catalog.services
      ).map((s) => s.name);
      if (oppForm.serviceName && list.includes(oppForm.serviceName)) nextServiceName = oppForm.serviceName;
    }
    onOppFormChange({ ...oppForm, serviceCategory: v, serviceName: nextServiceName });
  }

  // Ronde 44 — auto-fill Estimasi Nilai dari saran harga layanan (suggestedPrice ?? basePrice).
  // Menimpa hanya bila input kosong ATAU isian sebelumnya juga hasil auto-fill (tidak merampas isian manual).
  const [autoEstValue, setAutoEstValue] = useState("");
  function handleConvertServiceChange(v: string) {
    const serviceName = v === "none" ? "" : v;
    let estimatedValue = oppForm.estimatedValue;
    const suggestion = serviceSuggestedPrice(catalog?.services, serviceName);
    if (suggestion != null && (estimatedValue.trim() === "" || estimatedValue === autoEstValue)) {
      estimatedValue = String(suggestion);
      setAutoEstValue(estimatedValue);
    }
    onOppFormChange({ ...oppForm, serviceName, estimatedValue });
  }
  const estAutoFilled = oppForm.estimatedValue.trim() !== "" && oppForm.estimatedValue === autoEstValue;

  // Ronde 41 — mata uang estimasi mengikuti kontak (bila diisi) atau brand
  const estimasiCurrency = contactForm.currency || selectedOppBrand?.primaryCurrency || "IDR";

  const canConvert =
    mode !== null &&
    oppForm.brandId !== "" &&
    (mode !== "new" || contactForm.firstName.trim().length > 0);

  return (
    <Dialog open={lead !== null} onOpenChange={(open) => { if (!open && !converting) onClose(); }}>
      <DialogContent className="crm-scroll max-h-[92vh] overflow-y-auto sm:max-w-xl" aria-label="Konversi lead jadi opportunity">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white" aria-hidden="true">
              <UserPlus className="size-3.5" />
            </span>
            Konversi Lead
          </DialogTitle>
          <DialogDescription>
            Jadi contact + opportunity + draft brief awal — task follow-up otomatis dibuat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* target identitas */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            {mode === "new" ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-700">
                <UserPlus className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                <span className="min-w-0 truncate">Contact baru: {contactForm.firstName.trim() || "belum ada nama"}</span>
              </span>
            ) : mode === "link" && linkContactName ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">Gabung ke contact: {linkContactName}</span>
              </span>
            ) : (
              <span className="text-xs text-zinc-500">Pilih kandidat identitas atau buat contact baru.</span>
            )}
            <Button type="button" size="sm" variant={mode === "new" ? "default" : "outline"} onClick={onModeToggle}>
              {mode === "new" ? "Batal — pakai contact terpilih" : "Buat Contact Baru"}
            </Button>
          </div>

          {/* form contact baru — Ronde 44: field-set BERSAMA identik dgn "Kontak Baru" modul Contacts */}
          {mode === "new" ? (
            <div className="space-y-3 rounded-lg border border-zinc-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contact Baru</p>
              {lead && lead.channel === "instagram" && isSocialHandle(lead.senderName ?? "") ? (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                  <Instagram className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Lead ini datang dari <strong>Instagram</strong> (handle {lead.senderName}). Handle sosial <strong>tidak</strong> dimasukkan ke kolom email — isi email manual bila klien memberikannya.
                  </span>
                </p>
              ) : null}
              <ContactFields
                mode="create"
                values={contactForm}
                onChange={(patch) => onContactFormChange({ ...contactForm, ...patch })}
                companies={[]}
              />
            </div>
          ) : null}

          {/* form opportunity */}
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Opportunity</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Brand <span className="text-rose-600">*</span></Label>
                <Select value={oppForm.brandId} onValueChange={(v) => onOppFormChange({ ...oppForm, brandId: v, serviceName: "" })}>
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
                <Select value={oppForm.priority} onValueChange={(v) => onOppFormChange({ ...oppForm, priority: v })}>
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
              <Label htmlFor="convert-title" className="text-xs">Judul Opportunity</Label>
              <Input
                id="convert-title"
                value={oppForm.title}
                onChange={(e) => onOppFormChange({ ...oppForm, title: e.target.value })}
                placeholder="Judul opportunity"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <Label className="text-xs">Kategori Layanan</Label>
                  {/* Ronde 42 — tambah kategori/layanan baru langsung dari konversi (Direktur/Admin) */}
                  <AddCatalogMenu
                    brandId={oppForm.brandId}
                    categories={catalog?.categories ?? []}
                    onAdded={reloadCatalog}
                    canEdit={canEditCatalog && !!oppForm.brandId}
                    categoryNameHint={oppForm.serviceCategory || undefined}
                  />
                </div>
                {/* Ronde 41 — opsi dari katalog live brand (fallback statis) */}
                <Select value={oppForm.serviceCategory} onValueChange={handleConvertCategoryChange}>
                  <SelectTrigger className="w-full" aria-label="Kategori layanan">
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    {kategoriOptions.map((cat) => (
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
                    onValueChange={handleConvertServiceChange}
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
                {/* Ronde 41 — label & placeholder sadar mata uang; kosong = belum diketahui (null) */}
                <Label htmlFor="convert-value" className="text-xs">Estimasi Nilai ({estimasiCurrency})</Label>
                <Input
                  id="convert-value"
                  type="number"
                  min={0}
                  value={oppForm.estimatedValue}
                  onChange={(e) => onOppFormChange({ ...oppForm, estimatedValue: e.target.value })}
                  placeholder="Belum diketahui — kosongkan bila belum ada"
                />
                {estAutoFilled ? (
                  <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                    <Sparkles className="size-3" aria-hidden="true" />
                    Terisi otomatis dari saran harga layanan {oppForm.serviceName} — masih bisa diubah.
                  </p>
                ) : (
                  <p className="text-[11px] text-zinc-400">
                    Mata uang mengikuti kontak ({contactForm.country || "negara belum dipilih"}) / brand — dipakai brief, quotation &amp; invoice.
                  </p>
                )}
              </div>
            </div>
          </div>

          {!canConvert ? (
            <p className="text-center text-xs text-zinc-400">
              Pilih kandidat identitas (modal Identifikasi) atau buat contact baru untuk melanjutkan.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={converting}>Batal</Button>
          <Button
            onClick={onConvert}
            disabled={!canConvert || converting}
            aria-label="Konversi lead jadi opportunity"
          >
            {converting ? (
              <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Mengonversi…</>
            ) : "Konversi jadi Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/** Ronde 29 — tinggi panel list & chat (full chat): memenuhi viewport, scroll internal. */
const PANEL_H = "h-[600px] sm:h-[660px] lg:h-[calc(100vh-18rem)] lg:min-h-[560px] lg:max-h-[860px]";

export default function InboxModule() {
  const user = useCrmStore((s) => s.user);
  const brands = useCrmStore((s) => s.brands);
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);
  const setActiveBrandFilter = useCrmStore((s) => s.setActiveBrandFilter);
  // Ronde 32 — navigasi lintas modul (pendingFocus dari global search & tombol "Buka Percakapan")
  const pendingFocus = useCrmStore((s) => s.pendingFocus);
  const clearPendingFocus = useCrmStore((s) => s.clearPendingFocus);
  const setPendingFocus = useCrmStore((s) => s.setPendingFocus);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  // Ronde 34-b — cache detail kontak utk fallback pencocokan identitas (kind "contact")
  const contactDetailRef = useRef<{ id: string; contact: ContactRef | null } | null>(null);

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

  // Ronde 32 — tab percakapan: "open" = perlu tindakan (belum dikonversi),
  // "all" = termasuk thread terkonversi (chat lanjutan dgn klien aktif).
  const [view, setView] = useState<"open" | "all">("open");
  // Ronde 32 — setelah konversi: pilih otomatis thread yang kini tertaut opportunity ini.
  const [pendingSelectOppId, setPendingSelectOppId] = useState<string | null>(null);

  // Ronde 29 — full chat: tools jadi modal compact (satu pintu di header chat) + composer
  const [showIdentity, setShowIdentity] = useState(false);
  const [showIdentify, setShowIdentify] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  // Ronde 33 — proses aksi "Gabungkan ke Contact" (identitas saja, tanpa konversi)
  const [linking, setLinking] = useState(false);
  const [chatChannel, setChatChannel] = useState("");
  const [chatBody, setChatBody] = useState("");
  const [sending, setSending] = useState(false);
  // Ronde 34-b — lampiran dokumen di composer chat (data URL, state diangkat ke modul)
  const [chatAttachments, setChatAttachments] = useState<AttachmentDraft[]>([]);

  // Fase 3 — eskalasi SLA
  const [escalateTarget, setEscalateTarget] = useState<InboxLead | null>(null);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [escalatedIds, setEscalatedIds] = useState<Set<string>>(new Set());

  // Ronde 40-B — mulai percakapan baru utk kontak tanpa thread (fokus lintas modul)
  const [startConvContact, setStartConvContact] = useState<ContactRef | null>(null);
  const [startConvChannel, setStartConvChannel] = useState("");
  const [startConvBody, setStartConvBody] = useState("");
  const [startConvSending, setStartConvSending] = useState(false);
  const [startConvSentCount, setStartConvSentCount] = useState(0);

  const detailRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLUListElement | null>(null);

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
      // Ronde 32 — selalu muat view=all lalu filter klien: hitungan kedua tab
      // selalu akurat dgn SATU request (open = yang belum tertaut opportunity).
      const res = await api.inbox({ channel: channelFilter, brandId: activeBrandFilter, sweep: true, view: "all" });
      setLeads(res.leads);
      setError(null);
      if (res.autoEscalated && res.autoEscalated > 0) {
        toast.warning(`${res.autoEscalated} lead dieskalasi otomatis`, {
          description: "Sweep SLA menemukan lead melewati SLA + grace 4 jam — task urgent dibuat untuk Direktur.",
        });
      }
      return res.leads; // Ronde 40-B — dipakai utk auto-fokus thread setelah pesan pertama
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
    // Ronde 32 — metrik "perlu tindakan" hanya dihitung dari lead BELUM terkonversi:
    // thread terkonversi bukan lagi beban SLA (statusnya dipantau di Pipeline).
    const open = list.filter((l) => !l.opportunityId);
    // Jumlah thread unik + total pesan (thread.messageCount sama utk seluruh anggota thread)
    const perThread = new Map<string, number>();
    for (const l of list) {
      const key = l.threadKey || l.id;
      perThread.set(key, Math.max(perThread.get(key) ?? 0, l.thread?.messageCount ?? 1));
    }
    return {
      total: list.length,
      openTotal: open.length,
      convertedTotal: list.length - open.length,
      late: open.filter((l) => !isResponded(l) && (l.brand?.slaHours ?? 24) - l.slaHours <= 0).length,
      duplicate: open.filter((l) => l.candidates.length > 0).length,
      responded: open.filter((l) => isResponded(l)).length,
      conversations: perThread.size,
      threadMessages: [...perThread.values()].reduce((acc, n) => acc + n, 0),
    };
  }, [leads]);

  const sortedLeads = useMemo(() => {
    // Ronde 32 — tampilan "Perlu Tindakan" = hanya lead belum tertaut opportunity;
    // "Semua Percakapan" = seluruh pesan masuk (termasuk terkonversi).
    const all = [...(leads ?? [])];
    const scoped = view === "open" ? all.filter((l) => !l.opportunityId) : all;
    const list = scoped;
    if (sortBy === "late") {
      list.sort((a, b) => b.slaHours - a.slaHours);
    } else {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return list;
  }, [leads, sortBy, view]);

  // Grouping leads by threadKey → ThreadGroup, diurut sesuai sortBy
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
        // Ronde 32 — thread terkonversi bila SEMUA anggota sudah tertaut opportunity.
        converted: byNewest.length > 0 && byNewest.every((l) => Boolean(l.opportunityId)),
        opportunity: newest.opportunity ?? byNewest.find((l) => l.opportunity)?.opportunity ?? null,
      });
    }
    if (sortBy === "late") {
      // Ronde 32 — thread terkonversi selalu di bawah (bukan lagi beban SLA)
      groups.sort((a, b) => {
        if (a.converted !== b.converted) return a.converted ? 1 : -1;
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

  // Ronde 29 — contact identitas lead terpilih: terhubung (backend) → kandidat terpilih → null
  const linkedContact = useMemo<ContactRef | null>(() => {
    if (!selectedLead) return null;
    if (selectedLead.contact) return selectedLead.contact;
    if (linkedContactId) {
      return selectedLead.candidates.find((c) => c.contactId === linkedContactId)?.contact ?? null;
    }
    return null;
  }, [selectedLead, linkedContactId]);

  const identityData = useMemo<IdentityData>(
    () => (linkedContact ? identityFromForm(contactToForm(linkedContact)) : identityFromForm(contactForm)),
    [linkedContact, contactForm]
  );
  const identity = useMemo(() => identityCompleteness(identityData), [identityData]);

  // Prefill form identitas dari contact target — stabil (useMemo) utk effect di modal
  const linkedContactForm = useMemo(
    () => (linkedContact ? contactToForm(linkedContact) : null),
    [linkedContact]
  );

  const respondContactName = linkedContact?.fullName?.trim() ?? null;

  // Mode konversi: contact terpilih → link; contact terhubung bawaan → link; toggle → new
  const convertMode: "new" | "link" | null = showNewContact
    ? "new"
    : linkedContactId || selectedLead?.contactId
      ? "link"
      : null;
  const linkTargetId = showNewContact ? null : linkedContactId ?? selectedLead?.contactId ?? null;

  // Auto-scroll chat ke bawah saat percakapan berganti / pesan baru masuk
  const threadMessageCount = selectedLead?.thread.messageCount ?? 0;
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, threadMessageCount]);

  // Ronde 32 — setelah konversi + reload view=all, pilih thread yg tertaut opportunity target.
  useEffect(() => {
    if (!pendingSelectOppId || !leads) return;
    const target = leads.find((l) => l.opportunityId === pendingSelectOppId);
    if (target) {
      setSelectedId(target.id);
      setPendingSelectOppId(null);
    }
  }, [leads, pendingSelectOppId]);

  // Ronde 32 — fokus lintas modul: global search (lead inbox) & tombol "Buka Percakapan"
  // di detail opportunity. Cari by interaction id ATAU opportunityId; thread terkonversi
  // otomatis ditampilkan di tab "Semua Percakapan" agar kartu list & chat konsisten.
  useEffect(() => {
    if (!pendingFocus || pendingFocus.module !== "inbox" || !leads) return;
    const id = pendingFocus.id;
    // ===== Ronde 34-b — kind "contact": task follow-up → chat kontak =====
    // Urutan: link contactId di list (view=all memuat semua) → pencocokan identitas sender
    // (thread belum ter-link contactId) → longgarkan filter → feedback jelas.
    if (pendingFocus.kind === "contact") {
      let cancelled = false;
      void (async () => {
        const byNewest = (a: InboxLead, b: InboxLead) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        let target = leads.filter((l) => l.contact?.id === id).sort(byNewest)[0];
        // Fallback identitas: thread milik kontak tapi contactId-nya belum terisi
        if (!target && contactDetailRef.current?.id !== id) {
          contactDetailRef.current = { id, contact: null };
          try {
            const res = await api.contacts();
            if (cancelled) return;
            contactDetailRef.current = { id, contact: res.contacts.find((x) => x.id === id) ?? null };
          } catch {
            // gagal muat kontak → target tetap null
          }
        }
        const detailContact = contactDetailRef.current?.id === id ? contactDetailRef.current?.contact : null;
        if (!target && detailContact) {
          target = leads.filter((l) => leadMatchesContactIdentity(l, detailContact)).sort(byNewest)[0];
        }
        if (cancelled) return;
        if (target) {
          if (target.opportunityId && view === "open") setView("all");
          handleSelectLead(target);
          clearPendingFocus();
          return;
        }
        // List ter-filter bisa menyembunyikan target → longgarkan sekali (effect jalan lagi)
        if (channelFilter !== "all" || activeBrandFilter !== "all") {
          setChannelFilter("all");
          if (activeBrandFilter !== "all") setActiveBrandFilter("all");
          return;
        }
        // Ronde 40-B — kontak ada tapi TIDAK punya thread: tampilkan kartu "mulai
        // percakapan" (dulu dead-end toast) agar pesan outbound pertama bisa dikirim.
        if (detailContact) {
          const channels = contactReplyChannels(detailContact);
          const pref = detailContact.preferredChannel;
          setStartConvContact(detailContact);
          setStartConvBody("");
          setStartConvSentCount(0);
          setStartConvChannel(
            pref && channels.includes(pref as ReplyChannelKey) ? pref : (channels[0] ?? "")
          );
          clearPendingFocus();
          return;
        }
        toast.info("Kontak tidak ditemukan di sistem", {
          description: "Tidak bisa memulai percakapan — pastikan kontak masih ada di modul Contacts.",
          duration: 6000,
        });
        clearPendingFocus();
      })();
      return () => {
        cancelled = true;
      };
    }
    const target = leads.find((l) => l.id === id || l.opportunityId === id);
    if (target) {
      if (target.opportunityId && view === "open") setView("all");
      handleSelectLead(target);
      clearPendingFocus();
    } else {
      // Ronde 34 — feedback jelas bila target tak punya percakapan di Inbox
      // (mis. task follow-up untuk opportunity yang datang bukan dari chat):
      // dulu diam tanpa efek — user bingung "kok tidak terjadi apa-apa".
      toast.info("Tidak ada percakapan di Inbox untuk item ini", {
        description: "Opportunity ini kemungkinan dibuat manual / tanpa chat masuk. Lakukan tindak lanjut lewat Sales Pipeline atau kirim pesan baru dari kanal terhubung.",
        duration: 6000,
      });
      clearPendingFocus(); // lepas agar tidak loop
    }
  }, [pendingFocus, leads, view, channelFilter, activeBrandFilter, clearPendingFocus, setActiveBrandFilter]);

  function handleSelectLead(lead: InboxLead) {
    setSelectedId(lead.id);
    setShowNewContact(false);
    setLinkedContactId(null);
    setShowIdentity(false);
    setShowIdentify(false);
    setShowConvert(false);
    setChatBody("");
    setStartConvContact(null); // Ronde 40-B — tutup kartu mulai percakapan saat thread lain dipilih
    setChatAttachments([]); // Ronde 34-b — bersihkan draf lampiran saat ganti thread
    const avail = replyChannelsOf(lead);
    setChatChannel(avail.includes(lead.channel as ReplyChannelKey) ? lead.channel : (avail[0] ?? ""));

    const rawSender = (lead.senderName ?? "").trim();
    // Bila lead sudah terhubung contact, isi form dari contact (sumber kebenaran identitas)
    if (lead.contact) {
      setContactForm(contactToForm(lead.contact));
    } else {
      // FIX r22: email hanya diisi bila benar-benar alamat email valid — handle IG BUKAN email.
      const emailCandidate = extractEmailFromText(rawSender);
      const looksLikePhone = /^\+?[\d][\d\s\-()+]{5,}$/.test(rawSender);
      // Ronde 44 — nomor dari pengirim dipisah jadi kode dial + nasional (form bersama)
      const waParts = looksLikePhone ? splitPhoneParts(rawSender) : { dial: "", national: "" };
      setContactForm({
        ...EMPTY_CONTACT_FORM,
        email: emailCandidate ?? "",
        whatsapp: waParts.national,
        whatsappDial: waParts.dial,
        instagram: lead.channel === "instagram" && isSocialHandle(rawSender) ? rawSender : "",
      });
    }
    setOppForm({
      ...EMPTY_OPP_FORM,
      brandId: lead.brandId ?? lead.brand?.id ?? "",
      title: `Lead ${channelLabel(lead.channel)} — ${rawSender.slice(0, 48) || "Tanpa nama"}`,
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

  // Ronde 33 — AKSI YANG SEBELUMNYA HILANG: gabungkan identitas lead ke contact
  // existing TANPA membuat opportunity. Setelah memilih kandidat di modal Identifikasi,
  // dulu satu-satunya jalan adalah "Konversi jadi Opportunity" — marketing yang hanya
  // ingin menyatukan log percakapan lintas kanal tidak punya pintu lain.
  // Setelah berhasil: thread menyatu ke contact, lead TETAP di "Perlu Tindakan"
  // (belum opportunity), konversi bisa menyusul kapan saja lewat tool Konversi.
  async function handleLinkOnly() {
    if (!selectedLead || !user || !linkedContactId || linking) return;
    setLinking(true);
    try {
      const res = await api.linkLead({ interactionId: selectedLead.id, contactId: linkedContactId });
      setShowIdentify(false);
      setLinkedContactId(null);
      toast.success("Identitas digabungkan", {
        description: `Log percakapan lead ini kini menyatu dengan ${res.contactName ?? "contact terpilih"} — thread lintas kanal & kanal balasan mengikuti contact. Selanjutnya: balas pesannya, atau konversi ke opportunity saat sudah siap.`,
      });
      if (res.unifiedCount > 0) {
        toast.info(`${res.unifiedCount} pesan lain dari identitas sama ikut tertaut ke contact ini.`, {
          description: "Lead tetap di Perlu Tindakan — konversi ke opportunity bisa dilakukan kapan saja lewat tombol Konversi di header chat.",
          duration: 7000,
        });
      }
      await loadLeads(true); // reload — thread, replyChannels & identitas kini berbasis contact
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menggabungkan identitas.");
    } finally {
      setLinking(false);
    }
  }

  function handleToggleNewContact() {
    setLinkedContactId(null);
    setShowNewContact((prev) => !prev);
  }

  // Ronde 29 — kirim pesan langsung dari composer chat (balas satu per satu)
  async function handleChatSend() {
    if (!selectedLead || !user) return;
    const avail = replyChannelsOf(selectedLead);
    if (avail.length === 0 || !avail.includes(chatChannel as ReplyChannelKey)) {
      toast.error("Kanal balasan tidak tersedia — lengkapi identitas terlebih dulu");
      return;
    }
    const content = chatBody.trim();
    // Ronde 34-b — boleh kirim lampiran tanpa teks, tapi minimal salah satu ada
    if (!content && chatAttachments.length === 0) {
      toast.error("Tulis pesan atau lampirkan dokumen dulu");
      return;
    }
    setSending(true);
    try {
      const res = await api.inboxRespond({
        interactionId: selectedLead.id,
        channel: chatChannel,
        content,
        subject: chatChannel === "email" ? `Re: ${selectedLead.subject ?? "permintaan Anda"}` : undefined,
        contactId: linkTargetId ?? undefined,
        actorName: user.name,
        actorRole: user.role,
        attachments:
          chatAttachments.length > 0
            ? chatAttachments.map(({ name, url, size }) => ({ name, url, size }))
            : undefined,
      });
      // Sampaikan hasil pengiriman NYATA dengan jujur.
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
        toast.success(`Pesan ${channelLabel(chatChannel)} terkirim`, {
          description: "Lead ditandai sudah direspons — countdown SLA berhenti.",
        });
      }
      // Balasan baru langsung muncul di chat (digabung ke thread)
      setLeads((prev) => (prev ?? []).map((l) => {
        if (l.id !== selectedLead.id) return l;
        return {
          ...l,
          ...res.lead,
          slaHours: l.slaHours,
          candidates: l.candidates,
          thread: {
            ...l.thread,
            messageCount: l.thread.messageCount + 1,
            lastMessageAt: res.reply.createdAt,
            messages: [
              ...l.thread.messages,
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
                attachments: res.reply.attachments ?? null, // Ronde 34-b — lampiran ikut muncul di bubble
                createdAt: res.reply.createdAt,
              },
            ],
          },
        };
      }));
      setChatBody("");
      setChatAttachments([]); // Ronde 34-b — bersihkan draf lampiran setelah terkirim
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim pesan");
    } finally {
      setSending(false);
    }
  }

  // Ronde 40-B — kirim pesan PERTAMA ke kontak yang belum punya thread di Inbox.
  // api.inboxRespond menuntut interactionId (thread lead) — mode kontak tidak punya
  // thread, jadi POST /api/inbox/respond dipanggil langsung dgn konvensi wrapper
  // api-client (credentials same-origin + header JSON + error {error}).
  async function handleStartConvSend() {
    if (!startConvContact || !user || startConvSending) return;
    const channels = contactReplyChannels(startConvContact);
    if (channels.length === 0) {
      toast.error("Kontak belum punya email/WhatsApp/handle — lengkapi di modul Contacts");
      return;
    }
    if (!channels.includes(startConvChannel as ReplyChannelKey)) {
      toast.error("Pilih kanal yang tersedia untuk kontak ini");
      return;
    }
    const content = startConvBody.trim();
    if (!content) {
      toast.error("Tulis pesan dulu");
      return;
    }
    setStartConvSending(true);
    try {
      const res = await fetch("/api/inbox/respond", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: startConvContact.id,
          channel: startConvChannel,
          content,
          ...(activeBrandFilter !== "all" ? { brandId: activeBrandFilter } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Percakapan dimulai", {
        description: `Pesan ${channelLabel(startConvChannel)} tercatat untuk ${startConvContact.fullName} — balasan akan tampil sebagai thread di Inbox.`,
      });
      setStartConvBody("");
      setStartConvSentCount((n) => n + 1);
      // Muat ulang list; bila thread kontak kini muncul → pilih otomatis & tutup kartu
      const fresh = await loadLeads(true);
      const match = (fresh ?? [])
        .filter((l) => l.contact?.id === startConvContact.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (match) {
        if (match.opportunityId && view === "open") setView("all");
        handleSelectLead(match);
        setStartConvContact(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim pesan");
    } finally {
      setStartConvSending(false);
    }
  }

  async function handleConvert() {
    if (!selectedLead || !user || !convertMode) return;
    if (!oppForm.brandId) {
      toast.error("Brand wajib dipilih untuk opportunity.");
      return;
    }
    if (convertMode === "new") {
      // Ronde 44 — validasi IDENTIK dgn form Kontak Baru (nama, email, nomor WA/telepon)
      const vErr = validateContactValues(contactForm);
      if (vErr) {
        toast.error(vErr);
        return;
      }
    }

    const opportunity: Record<string, unknown> = {
      brandId: oppForm.brandId,
      title:
        oppForm.title.trim() ||
        `Lead ${channelLabel(selectedLead.channel)} — ${(selectedLead.senderName ?? "Tanpa nama").trim().slice(0, 48)}`,
      // Ronde 40: ownerName tidak lagi dari form — server memakai user sesi
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
    if (convertMode === "link" && linkTargetId) payload.contactId = linkTargetId;
    if (convertMode === "new") {
      payload.contact = {
        firstName: contactForm.firstName.trim(),
        ...(contactForm.lastName.trim() ? { lastName: contactForm.lastName.trim() } : {}),
        ...(contactForm.email.trim() ? { email: contactForm.email.trim() } : {}),
        // Ronde 44 — nomor digabung dgn kode dial (E.164) sebelum dikirim
        whatsapp: buildWhatsappPayload(contactForm.whatsappDial, contactForm.whatsapp) || undefined,
        phone: buildPhonePayload(contactForm.phoneDial, contactForm.phone) || undefined,
        // Ronde 44 — perusahaan: tertaut via modal Detail Perusahaan (companyId, detail lengkap)
        // ATAU cukup nama (server auto-buat/find)
        ...(contactForm.companyId && contactForm.companyId !== NO_VALUE
          ? { companyId: contactForm.companyId }
          : { ...(contactForm.companyName.trim() ? { companyName: contactForm.companyName.trim() } : {}) }),
        ...(contactForm.position.trim() ? { position: contactForm.position.trim() } : {}),
        ...(contactForm.instagram.trim() ? { instagram: contactForm.instagram.trim() } : {}),
        ...(contactForm.facebook.trim() ? { facebook: contactForm.facebook.trim() } : {}),
        ...(contactForm.tiktok.trim() ? { tiktok: contactForm.tiktok.trim() } : {}),
        ...(contactForm.city.trim() ? { city: contactForm.city.trim() } : {}),
        // Ronde 41 — negara + mata uang kontak: dasar mata uang opportunity/brief/quotation/invoice
        ...(contactForm.country.trim() ? { country: contactForm.country.trim() } : {}),
        ...(contactForm.currency.trim() ? { currency: contactForm.currency.trim() } : {}),
        ...(contactForm.preferredChannel ? { preferredChannel: contactForm.preferredChannel } : {}),
      };
    }

    setConverting(true);
    try {
      const res = await api.convertLead(payload);
      const unifiedNote =
        typeof res.unifiedCount === "number" && res.unifiedCount > 0
          ? ` ${res.unifiedCount} pesan lain dari identitas sama ikut disatukan ke opportunity ini.`
          : "";
      toast.success("Lead dikonversi", {
        description: `Opportunity ${res.opportunity?.title ?? ""} berhasil dibuat${res.briefCode ? ` beserta draft brief ${res.briefCode}` : ""} + task follow-up otomatis.${unifiedNote}`,
      });
      setShowConvert(false);
      setShowNewContact(false);
      setLinkedContactId(null);
      // Ronde 32 — percakapan TIDAK hilang setelah konversi: pindah ke tab
      // "Semua Percakapan" dan tetap pilih thread yang kini tertaut opportunity
      // (dulu thread menghilang total — sumber kebingungan alur).
      if (res.opportunity?.id) setPendingSelectOppId(res.opportunity.id);
      setView("all");
      setSelectedId(null); // sementara — effect pendingSelectOppId memilih ulang
      await loadLeads(true); // refresh list: thread kini membawa opportunity
      toast.info("Percakapan pindah ke tab Semua Percakapan", {
        description: "Lead kini menjadi opportunity — chat tetap berlanjut di sini, dan progres deal terpantau di Sales Pipeline.",
        duration: 7000,
      });
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

  // Ronde 29 — pesan chat + pemisah hari (inbound kiri, outbound kanan)
  const chatMessages = useMemo<ReactNode>(() => {
    if (!selectedLead) return null;
    const msgs = [...selectedLead.thread.messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const out: ReactNode[] = [];
    let lastDay = "";
    for (const m of msgs) {
      const day = dayLabelOf(m.createdAt);
      if (day !== lastDay) {
        out.push(<DaySeparator key={`d-${day}`} label={day} />);
        lastDay = day;
      }
      out.push(
        <ThreadMessageBubble
          key={m.id}
          message={m}
          highlight={false}
          fallbackOutboundAuthor={selectedLead.respondedBy}
        />
      );
    }
    return out;
  }, [selectedLead]);

  // Ronde 29 — pesan identifikasi utk tombol salin di header chat
  const igHandleFallback =
    selectedLead?.channel === "instagram" && isSocialHandle(selectedLead.senderName ?? "")
      ? selectedLead.senderName
      : null;
  const identityMessage = useMemo(
    () => buildIdentityMessage(identityData, selectedLead?.brand?.name ?? "tim kami", igHandleFallback),
    [identityData, selectedLead?.brand?.name, igHandleFallback]
  );

  async function handleCopyIdentity() {
    const ok = await copyTextSmart(identityMessage, "Pesan identifikasi disalin — tempel di chat klien");
    if (!ok) {
      toast.info("Clipboard diblokir browser", { description: "Buka modal Identitas untuk salin manual." });
      setShowIdentity(true);
    }
  }

  const selMeta = selectedLead ? channelMeta(selectedLead.channel) : null;
  const SelChannelIcon = selMeta?.icon;
  // Ronde 32 — thread terkonversi: sembunyikan tool konversi/eskalasi, tampilkan
  // identitas opportunity + pintasan ke Pipeline.
  const selectedOpp = selectedLead?.opportunity ?? null;

  return (
    <div className="space-y-4">
      {/* ===== Header ===== */}
      <div className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-900 sm:text-xl">Lead Inbox</h1>
              {leads ? (
                <Badge className="bg-zinc-900 text-white" aria-label="Jumlah percakapan">
                  {`${stats.conversations} percakapan · ${stats.threadMessages} pesan`}
                </Badge>
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-500">Chat omnichannel tiap brand — Instagram, WhatsApp, Email, Website</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500" aria-label="Legenda SLA">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />SLA Aman</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />Segera Jatuh Tempo</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />Terlambat</span>
              <span className="inline-flex items-center gap-1.5"><Reply className="size-3 text-emerald-600" aria-hidden="true" />Sudah Direspons</span>
            </div>
            {/* Ronde 32 — tab tampilan: "Perlu Tindakan" (belum dikonversi) vs "Semua Percakapan"
                (termasuk thread terkonversi — chat dengan klien aktif tetap bisa dilanjutkan). */}
            <div className="mt-3 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5" role="tablist" aria-label="Tampilan percakapan">
              <button
                type="button"
                role="tab"
                aria-selected={view === "open"}
                onClick={() => { if (view !== "open") { setView("open"); setSelectedId(null); } }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                  view === "open" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                <Inbox className="size-3.5" aria-hidden="true" />
                Perlu Tindakan{leads ? ` (${stats.openTotal})` : ""}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "all"}
                onClick={() => { if (view !== "all") { setView("all"); setSelectedId(null); } }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                  view === "all" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                <MessagesSquare className="size-3.5" aria-hidden="true" />
                Semua Percakapan{leads ? ` (${stats.total})` : ""}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
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

      {/* ===== Stat strip ===== */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={Inbox} label="Total Lead" value={stats.total} tone="zinc" />
        <StatCard icon={AlarmClock} label="Terlambat Respons" value={stats.late} tone={stats.late > 0 ? "rose" : "zinc"} />
        <StatCard icon={Reply} label="Sudah Direspons" value={stats.responded} tone="zinc" />
        <StatCard icon={AlertTriangle} label="Warning Duplikat" value={stats.duplicate} tone={stats.duplicate > 0 ? "amber" : "zinc"} />
        <StatCard icon={MessagesSquare} label="Percakapan" value={stats.conversations} tone="zinc" />
      </div>

      {/* ===== Layout full chat: list 1 kolom + chat 2 kolom ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* KIRI: daftar percakapan — di <lg disembunyikan saat chat terbuka (master–detail) */}
        <section
          aria-label="Daftar percakapan"
          className={cn("min-w-0 rounded-xl border bg-white shadow-sm", PANEL_H, "flex flex-col", (selectedLead || startConvContact) && "hidden lg:flex")}
        >
          {firstLoad ? (
            <div className="crm-scroll min-h-0 flex-1 overflow-y-auto p-3">
              <ListSkeleton />
            </div>
          ) : error && !leads ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-rose-100" aria-hidden="true">
                <AlertTriangle className="size-6 text-rose-600" />
              </span>
              <p className="text-sm font-medium text-zinc-700">Gagal memuat lead</p>
              <p className="text-xs text-zinc-400">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadLeads()}>Coba Lagi</Button>
            </div>
          ) : leads && leads.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100" aria-hidden="true">
                <Inbox className="size-6 text-zinc-400" />
              </span>
              {view === "open" ? (
                <>
                  <p className="text-sm font-medium text-zinc-700">Tidak ada lead baru — semua sudah ditangani</p>
                  <p className="text-xs text-zinc-400">Lead baru dari semua kanal akan muncul di sini.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-zinc-700">Belum ada percakapan</p>
                  <p className="text-xs text-zinc-400">Semua pesan masuk (termasuk yang sudah dikonversi) tampil di sini.</p>
                </>
              )}
            </div>
          ) : leads ? (
            <div className="crm-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
              {threadGroups.map((group) => (
                <ThreadCard
                  key={group.key}
                  group={group}
                  selected={group.members.some((l) => l.id === selectedId)}
                  onSelect={handleSelectLead}
                />
              ))}
            </div>
          ) : null}
        </section>

        {/* KANAN: FULL CHAT — profil lead di header, tools identitas compact, composer inline */}
        <section
          aria-label="Chat percakapan"
          className={cn("min-w-0 lg:col-span-2", !selectedLead && !startConvContact && "hidden lg:block")}
        >
          <div
            ref={detailRef}
            className={cn("flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm", PANEL_H)}
          >
            {!selectedLead ? (
              startConvContact ? (
                <StartConversationCard
                  contact={startConvContact}
                  channels={contactReplyChannels(startConvContact)}
                  channel={startConvChannel}
                  onChannelChange={setStartConvChannel}
                  body={startConvBody}
                  onBodyChange={setStartConvBody}
                  sending={startConvSending}
                  sentCount={startConvSentCount}
                  onSend={() => void handleStartConvSend()}
                  onClose={() => setStartConvContact(null)}
                />
              ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100" aria-hidden="true">
                  <MessagesSquare className="size-6 text-zinc-400" />
                </span>
                <p className="text-sm font-medium text-zinc-700">Pilih percakapan di kiri</p>
                <p className="max-w-xs text-xs text-zinc-400">
                  Balas satu per satu ala chat omnichannel — identitas, identifikasi, dan konversi tersedia lewat tools di header chat.
                </p>
              </div>
              )
            ) : (
              <>
                {/* ===== CHAT HEADER — profil lead + kelengkapan & tools identitas (minimalis) ===== */}
                <div className="border-b border-zinc-200 bg-white">
                  <div className="flex items-center gap-2 px-2.5 pt-2 sm:gap-2.5 sm:px-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 lg:hidden"
                      onClick={() => setSelectedId(null)}
                      aria-label="Kembali ke daftar percakapan"
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    {/* Profil lead (avatar dari WA/IG) — sekali identitas terisi, profil mengikuti contact */}
                    <span
                      className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white"
                      aria-hidden="true"
                    >
                      {initials(threadDisplayName(selectedLead).replace(/^@+/, ""))}
                      {SelChannelIcon ? (
                        <span className={cn("absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border-2 border-white", selMeta?.circle)}>
                          <SelChannelIcon className="size-2" />
                        </span>
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">{threadDisplayName(selectedLead)}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {channelLabel(selectedLead.channel)} · {leadAddressText(selectedLead)}
                        {selectedLead.brand ? ` · ${selectedLead.brand.name}` : ""}
                      </p>
                    </div>
                    {/* Tools identitas — SATU pintu compact di header */}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setShowIdentity(true)}
                        title={`Kelengkapan identitas ${identity.count}/${identity.total} — klik untuk lihat & edit`}
                        aria-label={`Kelengkapan identitas ${identity.count} dari ${identity.total} — buka editor identitas`}
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold transition-colors",
                          identity.complete
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        )}
                      >
                        {identity.complete ? (
                          <CheckCircle2 className="size-3" aria-hidden="true" />
                        ) : (
                          <CircleDashed className="size-3" aria-hidden="true" />
                        )}
                        {`${identity.count}/${identity.total}`}
                      </button>
                      {/* Ronde 33 — tool Identifikasi disembunyikan bila identitas sudah
                          tergabung ke contact (kandidat = kosong, tidak ada yg perlu diputuskan).
                          Edit data identitas tetap bisa lewat chip kelengkapan. */}
                      {!selectedLead.contact ? (
                        <ToolIconButton
                          icon={Fingerprint}
                          label="Identifikasi identitas"
                          onClick={() => setShowIdentify(true)}
                          badge={selectedLead.candidates.length}
                        />
                      ) : null}
                      {/* Ronde 32 — tool konversi disembunyikan untuk thread terkonversi */}
                      {!selectedOpp ? (
                        <ToolIconButton
                          icon={UserPlus}
                          label="Konversi jadi Opportunity"
                          onClick={() => setShowConvert(true)}
                        />
                      ) : null}
                      <ToolIconButton
                        icon={Copy}
                        label="Salin pesan identifikasi"
                        onClick={() => void handleCopyIdentity()}
                        disabled={identity.complete}
                      />
                      {!isResponded(selectedLead) && !selectedOpp ? (
                        <ToolIconButton
                          icon={ShieldAlert}
                          label="Eskalasi ke Direktur"
                          onClick={() => openEscalateDialog(selectedLead)}
                          danger
                        />
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hidden size-8 shrink-0 lg:inline-flex"
                        onClick={() => setSelectedId(null)}
                        aria-label="Tutup percakapan"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {/* badges ringkas */}
                  <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-1.5 sm:px-4">
                    {selMeta ? (
                      <Badge variant="outline" className={cn("border", selMeta.badge)}>
                        {channelLabel(selectedLead.channel)}
                      </Badge>
                    ) : null}
                    {selectedLead.brand ? (
                      <BrandChip name={selectedLead.brand.name} color={selectedLead.brand.color} />
                    ) : null}
                    {/* Ronde 32 — identitas opportunity + pintasan Pipeline utk thread terkonversi */}
                    {selectedOpp ? (
                      <Badge
                        variant="outline"
                        className="max-w-[240px] border-emerald-300 bg-emerald-50 text-emerald-700"
                        title={selectedOpp.title}
                      >
                        <FolderKanban className="size-3 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{selectedOpp.title}</span>
                        <span className="shrink-0 opacity-70">· {stageLabel(selectedOpp.stage)}</span>
                      </Badge>
                    ) : null}
                    {!selectedOpp ? (
                      <SlaBadge
                        brandSlaHours={selectedLead.brand?.slaHours ?? 24}
                        waitHours={selectedLead.slaHours}
                        respondedAt={selectedLead.respondedAt}
                      />
                    ) : null}
                    {selectedOpp ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-emerald-300 bg-white px-2.5 text-xs text-emerald-700 hover:bg-emerald-50"
                        onClick={() => {
                          setPendingFocus({ module: "pipeline", id: selectedOpp.id });
                          setActiveModule("pipeline");
                        }}
                        aria-label="Buka opportunity ini di Sales Pipeline"
                      >
                        <FolderKanban className="size-3.5" aria-hidden="true" />
                        Buka di Pipeline
                      </Button>
                    ) : null}
                    {selectedLead.thread.messageCount > 1 ? (
                      <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
                        {`${selectedLead.thread.messageCount} pesan`}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {/* ===== MESSAGES — bubble chat penuh (inbound kiri, outbound kanan, pemisah hari) ===== */}
                <ul
                  ref={messagesRef}
                  aria-label="Riwayat percakapan"
                  className="crm-scroll min-h-0 flex-1 space-y-2 overflow-y-auto bg-zinc-50/60 px-3 py-3 sm:px-4"
                >
                  {chatMessages}
                </ul>

                {/* ===== COMPOSER — balas satu per satu via kanal legal ===== */}
                <ChatComposer
                  lead={selectedLead}
                  channel={chatChannel}
                  onChannelChange={setChatChannel}
                  body={chatBody}
                  onBodyChange={setChatBody}
                  onSend={() => void handleChatSend()}
                  sending={sending}
                  respondContactName={respondContactName}
                  onNeedIdentity={() => setShowIdentity(true)}
                  attachments={chatAttachments}
                  onAttachmentsChange={setChatAttachments}
                />
              </>
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

      {/* ===== Ronde 29 — modal tools compact (satu pintu dari header chat) ===== */}
      <IdentityModal
        lead={showIdentity ? selectedLead : null}
        linkedContactId={linkedContact?.id ?? null}
        linkedContactForm={linkedContactForm}
        form={contactForm}
        onFormChange={setContactForm}
        onClose={() => setShowIdentity(false)}
        onContactSaved={() => void loadLeads(true)}
      />
      <IdentifyModal
        lead={showIdentify ? selectedLead : null}
        selectedContactId={linkedContactId}
        onToggle={handleToggleCandidate}
        onClose={() => setShowIdentify(false)}
        onConvert={() => { setShowIdentify(false); setShowConvert(true); }}
        onLink={() => void handleLinkOnly()}
        linking={linking}
      />
      <ConvertModal
        lead={showConvert ? selectedLead : null}
        brands={brands}
        mode={convertMode}
        onModeToggle={handleToggleNewContact}
        linkTargetId={linkTargetId}
        linkContactName={respondContactName}
        contactForm={contactForm}
        onContactFormChange={setContactForm}
        oppForm={oppForm}
        onOppFormChange={setOppForm}
        converting={converting}
        onConvert={() => void handleConvert()}
        onClose={() => setShowConvert(false)}
      />
    </div>
  );
}
