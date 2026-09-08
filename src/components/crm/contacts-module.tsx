"use client";

// ============================================================
// Modul: Contacts & Companies (Task 3-b)
// Identitas calon klien global — terhubung ke seluruh brand.
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  Clock,
  CopyX,
  Download,
  ExternalLink,
  Facebook,
  FileUp,
  GitMerge,
  Globe,
  Info,
  Instagram,
  Languages,
  LayoutDashboard,
  Linkedin,
  Loader2,
  Mail,
  MailPlus,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Music2,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Video,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CountryCombobox, CurrencySelect } from "@/components/crm/country-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import { COUNTRIES } from "@/lib/crm/countries";
import { CHANNELS } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type {
  CompanyRef,
  ContactRef,
  DuplicatePairDTO,
  ImportCommitResponseDTO,
  ImportPreviewResponseDTO,
  ImportPreviewRowDTO,
  InteractionDTO,
  MatchCandidateDTO,
} from "@/lib/crm/types";
import { formatCurrency, formatDateTime, initials, normalizePhone, parseJsonArray } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";
import { emailError, nationalPhoneError, waMeLink } from "@/lib/crm/validate";
import { FieldHintInLabel } from "@/components/crm/field-hint";
// Ronde 44 — form contact & perusahaan BERSAMA (satu sumber dgn Konversi Lead & Peluang Baru)
import {
  ContactFields,
  CompanyDetailModal,
  buildPhonePayload,
  buildWhatsappPayload,
  EMPTY_CONTACT_FORM,
  NO_VALUE,
  splitPhoneParts,
  type CompanyOption,
  type ContactFormValues,
  type SavedCompany,
} from "@/components/crm/contact-company-forms";

// ---------- Tipe lokal ----------

type TabKey = "contacts" | "companies";

/** Contact dari API (payload berisi field lebih lengkap dari ContactRef). */
interface ContactRecord extends ContactRef {
  firstName: string;
  lastName?: string | null;
  emailAlt?: string | null;
  linkedin?: string | null;
  timezone?: string | null;
  socialProfile?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  notes?: string | null;
  _count?: { opportunities: number; interactions: number };
}

/** Company dari API (include contacts + _count). */
interface CompanyRecord extends CompanyRef {
  contacts?: ContactRef[];
  _count?: { opportunities: number; projects: number; invoices: number };
}

// Ronde 44 — ContactFormValues & CompanyFormValues pindah ke contact-company-forms.tsx (shared)

/** Satu baris hasil parse CSV — bentuk persis yang dikirim ke API impor massal. */
type ImportRowValues = {
  fullName: string;
  email: string;
  whatsapp: string;
  phone: string;
  company: string;
  position: string;
  country: string;
  city: string;
  instagram: string;
  facebook: string;
  tiktok: string;
};

// ---------- Konstanta & helper ----------

const AVATAR_PALETTE: readonly string[] = [
  "#18181b", // zinc-900
  "#ea580c", // Unimasi
  "#059669", // Segia Tech
  "#e11d48", // Erfo Multimedia
  "#7c3aed", // Unicam Studio
  "#b45309",
  "#0369a1",
];

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  email: Mail,
  instagram: Instagram,
  website: Globe,
  phone: Phone,
  meeting: Video,
  portal: LayoutDashboard,
};

/** Warna badge kanal pada header riwayat percakapan (tanpa indigo/blue). */
const CHANNEL_BADGE_CLASS: Record<string, string> = {
  whatsapp: "bg-emerald-100 text-emerald-700",
  email: "bg-amber-100 text-amber-700",
  instagram: "bg-rose-100 text-rose-700",
  website: "bg-violet-100 text-violet-700",
  phone: "bg-cyan-100 text-cyan-700",
  meeting: "bg-zinc-200 text-zinc-700",
};

const LANGUAGE_LABELS: Record<string, string> = { id: "Bahasa Indonesia", en: "English" };

const SIZE_LABELS: Record<string, string> = {
  enterprise: "Enterprise",
  government: "Government",
  sme: "SME",
  startup: "Startup",
};

// Ronde 44 — EMPTY_CONTACT_FORM / EMPTY_COMPANY_FORM / SIZE_OPTIONS / CURRENCY_OPTIONS /
// NO_VALUE pindah ke contact-company-forms.tsx (shared)

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function channelLabel(key?: string | null): string {
  return CHANNELS.find((c) => c.key === key)?.label ?? (key || "-");
}

function locationText(city?: string | null, country?: string | null): string {
  return [city, country].filter(Boolean).join(", ") || "-";
}

// Ronde 44 — buildWhatsappPayload / buildPhonePayload / splitPhoneParts / whatsappE164Preview
// pindah ke contact-company-forms.tsx (shared lintas form)

function consentMeta(status: string): { label: string; className: string } {
  if (status === "granted") return { label: "Consent: Disetujui", className: "bg-emerald-100 text-emerald-700" };
  if (status === "pending") return { label: "Consent: Menunggu", className: "bg-amber-100 text-amber-700" };
  if (status === "declined") return { label: "Consent: Ditolak", className: "bg-rose-100 text-rose-700" };
  return { label: status, className: "bg-zinc-100 text-zinc-600" };
}

function sizeBadgeClass(size?: string | null): string {
  switch (size) {
    case "enterprise":
      return "bg-violet-100 text-violet-700";
    case "government":
      return "bg-zinc-200 text-zinc-800";
    case "sme":
      return "bg-emerald-100 text-emerald-700";
    case "startup":
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

function scoreBadgeClass(score: number): string {
  if (score >= 85) return "bg-rose-100 text-rose-700";
  if (score >= 70) return "bg-amber-100 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

/** Skor pasangan duplikat lintas sumber: ≥90 emerald (nyaris pasti), 80–89 amber, sisanya zinc. */
function dupScoreBadgeClass(score: number): string {
  if (score >= 90) return "bg-emerald-100 text-emerald-700";
  if (score >= 80) return "bg-amber-100 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

function parseTagsText(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// ---------- Elemen kecil ----------

function AvatarBubble({
  name,
  size = "md",
  icon: Icon,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
}) {
  const cls =
    size === "sm"
      ? "size-7 text-[10px]"
      : size === "lg"
        ? "size-12 text-sm"
        : "size-10 text-xs";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        cls
      )}
      style={{ backgroundColor: hashColor(name) }}
    >
      {Icon ? <Icon className="size-4" /> : initials(name)}
    </span>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="truncate text-sm text-zinc-800">{value || "-"}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{children}</h3>;
}

function ChannelBadge({ channel }: { channel?: string | null }) {
  const Icon = CHANNEL_ICONS[channel ?? ""] ?? Globe;
  return (
    <Badge variant="secondary" className="shrink-0 bg-zinc-100 text-zinc-600">
      <Icon className="size-3" /> {channelLabel(channel)}
    </Badge>
  );
}

function ConsentBadge({ status }: { status: string }) {
  const meta = consentMeta(status);
  return (
    <Badge className={cn("border-transparent", meta.className)}>
      <ShieldCheck className="size-3" /> {meta.label}
    </Badge>
  );
}

function SizeBadge({ size }: { size?: string | null }) {
  return (
    <Badge className={cn("border-transparent capitalize", sizeBadgeClass(size))}>
      {SIZE_LABELS[size ?? ""] ?? size ?? "-"}
    </Badge>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <p className="text-xs text-zinc-400">Belum ada tag.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="bg-zinc-100 text-[11px] font-normal text-zinc-600">
          {t}
        </Badge>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-white px-6 py-16 text-center shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
        <Icon className="size-6" />
      </span>
      <div>
        <p className="font-semibold text-zinc-900">{title}</p>
        <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Gagal memuat data"
      description={message}
      action={
        <Button variant="outline" onClick={onRetry} aria-label="Coba muat ulang data">
          <RefreshCw className="size-4" /> Coba lagi
        </Button>
      }
    />
  );
}

function ContactCardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-14 rounded-md" />
      </div>
    </div>
  );
}

function ContactSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <ContactCardSkeleton key={i} />
      ))}
    </div>
  );
}

function CompanyTableSkeleton() {
  return (
    <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm" aria-hidden="true">
      <Skeleton className="h-5 w-44" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-28 sm:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// ---------- Kartu contact ----------

function ContactCard({ contact, onOpen }: { contact: ContactRecord; onOpen: () => void }) {
  const tags = parseJsonArray(contact.tags);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Buka detail ${contact.fullName}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30"
    >
      <div className="flex items-start gap-3">
        <AvatarBubble name={contact.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-900">{contact.fullName}</p>
          <p className="truncate text-xs text-zinc-500">{contact.position || "Tanpa jabatan"}</p>
        </div>
        <ChannelBadge channel={contact.preferredChannel} />
      </div>

      {contact.company && (
        <p className="flex items-center gap-1.5 text-xs text-zinc-600">
          <Building2 className="size-3.5 shrink-0 text-zinc-400" />
          <span className="truncate">{contact.company.name}</span>
        </p>
      )}

      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <MapPin className="size-3.5 shrink-0 text-zinc-400" />
        <span className="truncate">{locationText(contact.city, contact.country)}</span>
      </p>

      <div className="space-y-1 border-t border-zinc-100 pt-2.5 text-xs text-zinc-500">
        <p className="flex items-center gap-1.5">
          <Mail className="size-3.5 shrink-0 text-zinc-400" />
          <span className="truncate">{contact.email || "—"}</span>
        </p>
        <p className="flex items-center gap-1.5">
          <MessageCircle className="size-3.5 shrink-0 text-zinc-400" />
          <span className="truncate">{contact.whatsapp || "—"}</span>
        </p>
        {typeof contact._count?.interactions === "number" && contact._count.interactions > 0 && (
          <p className="flex items-center gap-1.5">
            <MessagesSquare className="size-3.5 shrink-0 text-zinc-400" />
            <span className="truncate">
              {contact._count.interactions} pesan percakapan
            </span>
          </p>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-[11px] font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Form fields contact (dipakai create & edit) ----------

function FormField({
  label,
  required,
  className,
  children,
}: {
  /** Ronde 42 — label bisa berupa string ATAU ReactNode (utk menyematkan FieldHint). */
  label: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1 text-xs font-medium text-zinc-600">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      {children}
    </div>
  );
}

// ---------- Ronde 44 — field-set contact & combobox dial pindah ke contact-company-forms.tsx (shared) ----------

// ---------- Riwayat percakapan (Task 24-b): timeline chat bubble per kontak ----------

/** Tick status kirim pesan outbound: read/delivered emerald, sent zinc, failed rose. */
function DeliveryTick({ status }: { status?: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const meta =
    s === "read" || s === "delivered"
      ? { Icon: CheckCheck, cls: "text-emerald-400", label: "Pesan dibaca" }
      : s === "sent"
        ? { Icon: Check, cls: "text-zinc-400", label: "Pesan terkirim" }
        : s === "failed"
          ? { Icon: AlertTriangle, cls: "text-rose-400", label: "Pesan gagal terkirim" }
          : null;
  if (!meta) return null;
  const { Icon, cls, label } = meta;
  return <Icon className={cn("size-3.5 shrink-0", cls)} role="img" aria-label={label} />;
}

/** Satu gelembung chat: inbound rata kiri (zinc-100), outbound rata kanan (zinc-900). */
function ConversationBubble({ item, contactName }: { item: InteractionDTO; contactName: string }) {
  const outbound = item.direction === "outbound";
  const ChannelIcon = CHANNEL_ICONS[item.channel] ?? Globe;
  const author = outbound ? item.respondedBy || "Tim CRM" : item.senderName || contactName || "Kontak";
  const isReply = Boolean(outbound && item.externalId?.startsWith("inbox-reply:"));
  const hasOpp = Boolean(item.opportunity);

  return (
    <li className={cn("flex max-w-[85%] flex-col", outbound ? "self-end items-end" : "self-start items-start")}>
      <div
        className={cn(
          "min-w-0 space-y-1 rounded-2xl px-3.5 py-2.5",
          outbound ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900"
        )}
      >
        <p
          className={cn(
            "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium",
            outbound ? "text-zinc-400" : "text-zinc-500"
          )}
        >
          <span className={cn("truncate", outbound ? "text-zinc-200" : "text-zinc-700")}>{author}</span>
          <ChannelIcon className="size-3 shrink-0 opacity-70" aria-label={`Kanal ${channelLabel(item.channel)}`} />
          <span>{formatDateTime(item.createdAt)}</span>
          {outbound && <DeliveryTick status={item.deliveryStatus} />}
        </p>
        {item.subject && (
          <p className={cn("truncate text-xs font-semibold", outbound ? "text-zinc-300" : "text-zinc-600")}>
            {item.subject}
          </p>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.content}</p>
        {isReply && (
          <p>
            <span className="inline-block rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
              Balasan inbox
            </span>
          </p>
        )}
      </div>
      {hasOpp && (
        <span
          className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600"
          aria-label={`Terkait opportunity: ${item.opportunity?.title ?? ""}`}
        >
          {item.brand?.color && (
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.brand.color }} aria-hidden="true" />
          )}
          <span className="truncate">Opp: {item.opportunity?.title}</span>
        </span>
      )}
    </li>
    );
}

function ConversationSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {["self-start w-3/4", "self-end w-2/3", "self-start w-2/3"].map((pos, i) => (
        <div key={i} className={cn("flex flex-col", pos)}>
          <Skeleton className="h-3 w-1/3 rounded-full" />
          <Skeleton className="mt-1.5 h-10 rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

/**
 * Seksi "Riwayat Percakapan" pada detail kontak — menggabungkan log interaksi
 * lintas kanal (WhatsApp/Instagram/Email/Website/Telepon/Meeting) satu kontak.
 * Urutan tampil: terbaru di atas (API orderBy createdAt desc).
 */
function ConversationHistorySection({ contactId, contactName }: { contactId: string; contactName: string }) {
  const [items, setItems] = useState<InteractionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Komponen di-remount per kontak (key=contact.id) → loading awal cukup dari useState.
    // Reset loading/error saat "Muat ulang" dilakukan lewat handler reload() (bukan di sini).
    let alive = true; // guard race: respons fetch lama diabaikan setelah unmount/ganti kontak
    api
      .interactions({ contactId })
      .then((res) => {
        if (!alive) return;
        setItems(res.interactions);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Gagal memuat riwayat percakapan");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [contactId, reloadKey]);

  function reload() {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }

  const uniqueChannels = useMemo(
    () => Array.from(new Set(items.map((i) => i.channel).filter((ch): ch is string => Boolean(ch)))),
    [items]
  );

  return (
    <section aria-label="Riwayat percakapan">
      <div className="flex flex-wrap items-center gap-2">
        <MessagesSquare className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Riwayat Percakapan</h3>
        <Badge variant="secondary" className="border-transparent bg-zinc-100 text-[11px] font-normal text-zinc-600">
          {loading ? "…" : `${items.length} pesan`}
        </Badge>
        {uniqueChannels.map((ch) => {
          const Icon = CHANNEL_ICONS[ch] ?? Globe;
          return (
            <Badge
              key={ch}
              variant="secondary"
              className={cn(
                "border-transparent px-1.5 text-[10px]",
                CHANNEL_BADGE_CLASS[ch] ?? "bg-zinc-100 text-zinc-600"
              )}
              aria-label={`Ada percakapan via ${channelLabel(ch)}`}
            >
              <Icon className="size-3" />
            </Badge>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1 px-2 text-xs text-zinc-500"
          onClick={reload}
          disabled={loading}
          aria-label="Muat ulang riwayat percakapan"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Muat ulang
        </Button>
      </div>

      <div className="crm-scroll mt-2 max-h-96 overflow-y-auto rounded-xl border bg-white p-3 shadow-sm">
        {loading ? (
          <ConversationSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-6 text-center">
            <AlertTriangle className="size-4 text-rose-600" />
            <p className="text-xs text-rose-700">{error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={reload}
              aria-label="Coba muat ulang riwayat percakapan"
            >
              <RefreshCw className="size-3.5" /> Coba lagi
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-400">Belum ada percakapan tercatat untuk kontak ini.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <ConversationBubble key={item.id} item={item} contactName={contactName} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------- Detail contact (Sheet) ----------

function ContactDetailBody({
  contact,
  companies,
  onSaved,
  onDeleted,
  onOpenCompany,
  onCompanyUpserted,
}: {
  contact: ContactRecord;
  companies: CompanyRecord[];
  onSaved: (contact: ContactRef) => void;
  onDeleted: () => void;
  onOpenCompany: (company: CompanyRef) => void;
  /** Ronde 45 — perusahaan diedit dari dalam form contact → modul ikut refresh. */
  onCompanyUpserted?: (company: SavedCompany) => void;
}) {
  const user = useCrmStore((s) => s.user);
  const setPendingFocus = useCrmStore((s) => s.setPendingFocus);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Ronde 40-B — nomor tersimpan dipisah jadi dial + nasional utk prefill form
  const waInit = splitPhoneParts(contact.whatsapp ?? "");
  const phoneInit = splitPhoneParts(contact.phone ?? "");
  const [form, setForm] = useState<ContactFormValues>({
    firstName: contact.firstName ?? "",
    lastName: contact.lastName ?? "",
    position: contact.position ?? "",
    email: contact.email ?? "",
    whatsapp: waInit.national,
    whatsappDial: waInit.dial,
    phone: phoneInit.national,
    phoneDial: phoneInit.dial,
    companyName: contact.company?.name ?? "",
    companyId: contact.companyId || NO_VALUE,
    city: contact.city ?? "",
    country: contact.country ?? "",
    currency: contact.currency ?? "",
    preferredChannel: contact.preferredChannel || "whatsapp",
    instagram: contact.instagram ?? "",
    facebook: contact.facebook ?? "",
    tiktok: contact.tiktok ?? "",
    tagsText: "",
  });
  const [tags, setTags] = useState<string[]>(() => parseJsonArray(contact.tags));
  const [tagInput, setTagInput] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const PreferredIcon = CHANNEL_ICONS[contact.preferredChannel] ?? Globe;
  const company = contact.company ?? null;
  const oppCount = contact._count?.opportunities;

  function patchForm(p: Partial<ContactFormValues>) {
    setForm((v) => ({ ...v, ...p }));
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.firstName.trim()) {
      toast.error("Nama depan wajib diisi");
      return;
    }
    // Ronde 42 — validasi format email & nomor (WhatsApp/Telepon) sebelum simpan
    const vEmail = emailError(form.email);
    if (vEmail) {
      toast.error(vEmail);
      return;
    }
    const vWa = nationalPhoneError(form.whatsapp, !form.whatsappDial);
    if (vWa) {
      toast.error(`WhatsApp: ${vWa}`);
      return;
    }
    const vPhone = nationalPhoneError(form.phone, !form.phoneDial);
    if (vPhone) {
      toast.error(`Telepon: ${vPhone}`);
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateContact(contact.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || null,
        position: form.position.trim() || null,
        email: form.email.trim() || null,
        whatsapp: buildWhatsappPayload(form.whatsappDial, form.whatsapp) || null,
        phone: buildPhonePayload(form.phoneDial, form.phone) || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        currency: form.currency.trim() || null,
        preferredChannel: form.preferredChannel,
        instagram: form.instagram.trim() || null,
        facebook: form.facebook.trim() || null,
        tiktok: form.tiktok.trim() || null,
        companyId: form.companyId === NO_VALUE ? null : form.companyId,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      toast.success("Perubahan contact tersimpan");
      setEditing(false);
      onSaved(res.contact);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan perubahan");
    } finally {
      setSaving(false);
    }
  }

  async function patchTags(next: string[]) {
    setTagBusy(true);
    try {
      const res = await api.updateContact(contact.id, {
        tags: next,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      setTags(next);
      onSaved(res.contact);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui tag");
    } finally {
      setTagBusy(false);
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTagInput("");
    void patchTags([...tags, t]);
  }

  function removeTag(t: string) {
    void patchTags(tags.filter((x) => x !== t));
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Contact "${contact.fullName}" dihapus`);
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus contact");
      setDeleting(false);
    }
  }

  /** Ronde 40-B — fokus kontak ini di Lead Inbox (thread lama atau mulai percakapan baru). */
  function openContactInInbox() {
    setPendingFocus({ module: "inbox", id: contact.id, kind: "contact" });
    setActiveModule("inbox");
  }

  return (
    <div className="flex flex-1 flex-col">
      <SheetHeader className="border-b border-zinc-100">
        <div className="flex items-start gap-3 pr-8">
          <AvatarBubble name={contact.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="leading-tight">{contact.fullName}</SheetTitle>
            <SheetDescription className="truncate">
              {contact.position || "Tanpa jabatan"}
              {company ? ` · ${company.name}` : ""}
            </SheetDescription>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
            {/* Ronde 42 — klik-ke-WhatsApp langsung (wa.me) — cepat utk marketing */}
            {waMeLink(contact.whatsapp) ? (
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  window.open(waMeLink(contact.whatsapp) as string, "_blank", "noopener");
                }}
                title={`Chat WhatsApp ke ${contact.whatsapp}`}
                aria-label="Buka WhatsApp untuk kontak ini"
              >
                <MessageCircle className="size-3.5" /> WhatsApp
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={openContactInInbox}
              title="Lanjutkan percakapan dengan kontak ini di Inbox"
              aria-label="Buka Chat di Inbox"
            >
              <MessageCircle className="size-3.5" /> Buka Chat di Inbox
            </Button>
            <Button
              size="sm"
              variant={editing ? "outline" : "secondary"}
              onClick={() => setEditing((v) => !v)}
              aria-label={editing ? "Batal edit contact" : "Edit contact"}
            >
              <Pencil className="size-3.5" /> {editing ? "Batal" : "Edit"}
            </Button>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-5 p-4">
        {editing ? (
          <form onSubmit={handleSave} className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-zinc-900">Edit Contact</p>
            <ContactFields
              mode="edit"
              values={form}
              onChange={patchForm}
              disabled={saving}
              companies={companies}
              onCompanyUpserted={onCompanyUpserted}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Batal
              </Button>
              <Button type="submit" className="bg-zinc-900 text-white hover:bg-zinc-800" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />} Simpan Perubahan
              </Button>
            </div>
          </form>
        ) : (
          <section aria-label="Informasi contact">
            <SectionTitle>Informasi</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoRow icon={Mail} label="Email" value={contact.email} />
              {contact.emailAlt ? <InfoRow icon={MailPlus} label="Email alternatif" value={contact.emailAlt} /> : null}
              <InfoRow icon={MessageCircle} label="WhatsApp" value={contact.whatsapp} />
              <InfoRow icon={Phone} label="Telepon" value={contact.phone} />
              <InfoRow icon={MapPin} label="Lokasi" value={locationText(contact.city, contact.country)} />
              {contact.currency ? <InfoRow icon={Wallet} label="Mata uang" value={contact.currency} /> : null}
              <InfoRow icon={Clock} label="Zona waktu" value={contact.timezone} />
              <InfoRow icon={Languages} label="Bahasa" value={LANGUAGE_LABELS[contact.language] ?? contact.language} />
              <InfoRow icon={PreferredIcon} label="Kanal preferensi" value={channelLabel(contact.preferredChannel)} />
              {contact.linkedin ? <InfoRow icon={Linkedin} label="LinkedIn" value={contact.linkedin} /> : null}
              {contact.instagram ? <InfoRow icon={Instagram} label="Instagram" value={contact.instagram} /> : null}
              {contact.facebook ? <InfoRow icon={Facebook} label="Facebook" value={contact.facebook} /> : null}
              {contact.tiktok ? <InfoRow icon={Music2} label="TikTok" value={contact.tiktok} /> : null}
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                  <ShieldCheck className="size-4" />
                </span>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Consent</p>
                  <div className="mt-0.5">
                    <ConsentBadge status={contact.consentStatus} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <ConversationHistorySection contactId={contact.id} contactName={contact.fullName} />

        <section aria-label="Tag contact">
          <SectionTitle>Tag</SectionTitle>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && <p className="text-xs text-zinc-400">Belum ada tag — tambahkan untuk segmentasi.</p>}
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 bg-zinc-100 text-zinc-700">
                  {t}
                  <button
                    type="button"
                    aria-label={`Hapus tag ${t}`}
                    disabled={tagBusy}
                    onClick={() => removeTag(t)}
                    className="rounded-full p-0.5 transition-colors hover:bg-zinc-200"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <form
              className="mt-2.5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
            >
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Tambah tag…"
                aria-label="Tag baru"
                className="h-8 text-xs"
                disabled={tagBusy}
              />
              <Button type="submit" size="sm" variant="outline" className="h-8" disabled={tagBusy || !tagInput.trim()}>
                <Plus className="size-3.5" /> Tambah
              </Button>
            </form>
          </div>
        </section>

        {company && (
          <section aria-label="Perusahaan terkait">
            <SectionTitle>Perusahaan</SectionTitle>
            <button
              type="button"
              onClick={() => company && onOpenCompany(company)}
              aria-label={`Buka detail perusahaan ${company.name}`}
              className="flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
            >
              <AvatarBubble name={company.name} icon={Building2} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-zinc-900">{company.name}</span>
                <span className="block truncate text-xs text-zinc-500">
                  {company.industry || "Industri belum diisi"}
                  {company.website ? ` · ${company.website}` : ""}
                </span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-zinc-400" />
            </button>
          </section>
        )}
      </div>

      <div className="mt-auto space-y-3 border-t border-zinc-100 bg-zinc-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          {typeof oppCount === "number" ? (
            <p className="flex items-center gap-2 text-sm text-zinc-600">
              <Briefcase className="size-4 text-zinc-400" />
              Total <span className="font-semibold text-zinc-900">{oppCount}</span> opportunity
            </p>
          ) : (
            <span />
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={deleting}
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                aria-label="Hapus contact"
              >
                <Trash2 className="size-4" /> Hapus Contact
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus contact ini?</AlertDialogTitle>
                <AlertDialogDescription>
                  &ldquo;{contact.fullName}&rdquo; akan dihapus (soft delete) dan tidak lagi muncul di daftar. Riwayat opportunity dan interaksi tetap tersimpan di database.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Ya, hapus
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function ContactDetailSheet({
  contact,
  open,
  onOpenChange,
  companies,
  onSaved,
  onDeleted,
  onOpenCompany,
  onCompanyUpserted,
}: {
  contact: ContactRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyRecord[];
  onSaved: (contact: ContactRef) => void;
  onDeleted: () => void;
  onOpenCompany: (company: CompanyRef) => void;
  onCompanyUpserted?: (company: SavedCompany) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto crm-scroll sm:max-w-xl">
        {contact && (
          <ContactDetailBody
            key={contact.id}
            contact={contact}
            companies={companies}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onOpenCompany={onOpenCompany}
            onCompanyUpserted={onCompanyUpserted}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Detail perusahaan (Sheet, read-only) ----------

function CompanyDetailBody({
  company,
  contacts,
  onOpenContact,
  onEdit,
}: {
  company: CompanyRecord;
  contacts: ContactRecord[];
  onOpenContact: (contact: ContactRecord) => void;
  /** Ronde 45 — buka modal Edit Perusahaan dari detail sheet. */
  onEdit?: (company: CompanyRecord) => void;
}) {
  const tags = parseJsonArray(company.tags);
  const websiteHref = company.website
    ? company.website.startsWith("http")
      ? company.website
      : `https://${company.website}`
    : null;

  return (
    <div className="flex flex-1 flex-col">
      <SheetHeader className="border-b border-zinc-100">
        <div className="flex items-start gap-3 pr-8">
          <AvatarBubble name={company.name} size="lg" icon={Building2} />
          <div className="min-w-0 flex-1">
            <SheetTitle className="leading-tight">{company.name}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{company.industry || "Industri belum diisi"}</span>
              {websiteHref && (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
                  aria-label={`Buka website ${company.name}`}
                >
                  {company.website} <ExternalLink className="size-3" />
                </a>
              )}
            </SheetDescription>
          </div>
          {onEdit ? (
            <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onEdit(company)}
                aria-label={`Edit perusahaan ${company.name}`}
                title="Edit detail perusahaan (industri, website, negara…)"
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            </div>
          ) : null}
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-5 p-4">
        <section aria-label="Informasi perusahaan">
          <SectionTitle>Informasi</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow icon={Globe} label="Website" value={company.website} />
            <InfoRow icon={Building2} label="Industri" value={company.industry} />
            <InfoRow icon={MapPin} label="Lokasi" value={locationText(company.city, company.country)} />
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                <Users className="size-4" />
              </span>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Ukuran</p>
                <div className="mt-0.5">
                  <SizeBadge size={company.size} />
                </div>
              </div>
            </div>
            <InfoRow icon={Banknote} label="Mata uang default" value={company.defaultCurrency} />
            <InfoRow
              icon={Banknote}
              label="Lifetime value"
              value={formatCurrency(company.lifetimeValue, company.defaultCurrency)}
            />
          </div>
        </section>

        <section aria-label="Tag perusahaan">
          <SectionTitle>Tag</SectionTitle>
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <TagList tags={tags} />
          </div>
        </section>

        <section aria-label="Contact perusahaan">
          <SectionTitle>
            Kontak ({contacts.length}
            {contacts.length === 5 ? "+" : ""})
          </SectionTitle>
          {contacts.length === 0 ? (
            <p className="rounded-xl border bg-white p-3 text-xs text-zinc-400 shadow-sm">
              Belum ada contact yang terhubung ke perusahaan ini.
            </p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto crm-scroll pr-1">
              {contacts.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpenContact(c)}
                    aria-label={`Buka detail contact ${c.fullName}`}
                    className="flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    <AvatarBubble name={c.fullName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900">{c.fullName}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {c.position || c.email || "-"}
                        {c.instagram ? (
                          <span className="ml-1.5 inline-flex max-w-[45%] items-center gap-1 align-middle text-zinc-400">
                            <Instagram className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{c.instagram}</span>
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <ChannelBadge channel={c.preferredChannel} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-auto space-y-2 border-t border-zinc-100 bg-zinc-50/70 p-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="bg-zinc-200/70 text-zinc-700">
            {company._count?.opportunities ?? 0} opportunity
          </Badge>
          <Badge variant="secondary" className="bg-zinc-200/70 text-zinc-700">
            {company._count?.projects ?? 0} project
          </Badge>
          <Badge variant="secondary" className="bg-zinc-200/70 text-zinc-700">
            {company._count?.invoices ?? 0} invoice
          </Badge>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Info className="size-3.5" /> Data perusahaan bersifat read-only di UI — perubahan dilakukan via API.
        </p>
      </div>
    </div>
  );
}

function CompanyDetailSheet({
  company,
  open,
  onOpenChange,
  contacts,
  onOpenContact,
  onEdit,
}: {
  company: CompanyRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: ContactRecord[];
  onOpenContact: (contact: ContactRecord) => void;
  /** Ronde 45 — buka modal Edit Perusahaan. */
  onEdit?: (company: CompanyRecord) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto crm-scroll sm:max-w-xl">
        {company && <CompanyDetailBody key={company.id} company={company} contacts={contacts} onOpenContact={onOpenContact} onEdit={onEdit} />}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Dialog: Contact baru ----------

function CreateContactDialog({
  open,
  onOpenChange,
  onCreated,
  companies = [],
  onCompanyUpserted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (contact: ContactRef, duplicates: MatchCandidateDTO[]) => void;
  /** Ronde 45 — daftar perusahaan utk autocomplete auto-text di form contact. */
  companies?: CompanyOption[];
  onCompanyUpserted?: (company: SavedCompany) => void;
}) {
  const user = useCrmStore((s) => s.user);
  const [values, setValues] = useState<ContactFormValues>(EMPTY_CONTACT_FORM);
  const [candidates, setCandidates] = useState<MatchCandidateDTO[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(EMPTY_CONTACT_FORM);
      setCandidates(null);
    }
  }, [open]);

  function patchForm(p: Partial<ContactFormValues>) {
    setValues((v) => ({ ...v, ...p }));
  }

  /** Ronde 40-B — WhatsApp final utk payload: dial terpilih → E.164, tanpa dial → raw (legacy server). */
  function finalWhatsapp(): string {
    return buildWhatsappPayload(values.whatsappDial, values.whatsapp) ?? "";
  }

  /** Ronde 42 — validasi format email + nomor (dipakai sebelum cek duplikat & sebelum buat). */
  function validateForm(): boolean {
    if (!values.firstName.trim()) {
      toast.error("Nama depan wajib diisi");
      return false;
    }
    const vEmail = emailError(values.email);
    if (vEmail) {
      toast.error(vEmail);
      return false;
    }
    const vWa = nationalPhoneError(values.whatsapp, !values.whatsappDial);
    if (vWa) {
      toast.error(`WhatsApp: ${vWa}`);
      return false;
    }
    const vPhone = nationalPhoneError(values.phone, !values.phoneDial);
    if (vPhone) {
      toast.error(`Telepon: ${vPhone}`);
      return false;
    }
    return true;
  }

  async function createNow() {
    if (!validateForm()) return;
    setCreating(true);
    try {
      // Ronde 44 — perusahaan tertaut dari modal Detail Perusahaan dipakai langsung (companyId);
      // tanpa tautan → biarkan server membuat/menautkan by companyName seperti sebelumnya.
      const linkedCompany = values.companyId && values.companyId !== NO_VALUE;
      const res = await api.createContact({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim() || undefined,
        position: values.position.trim() || undefined,
        email: values.email.trim() || undefined,
        whatsapp: finalWhatsapp() || undefined,
        phone: buildPhonePayload(values.phoneDial, values.phone) || undefined,
        ...(linkedCompany
          ? { companyId: values.companyId }
          : { companyName: values.companyName.trim() || undefined }),
        city: values.city.trim() || undefined,
        country: values.country.trim() || undefined,
        currency: values.currency.trim() || undefined,
        preferredChannel: values.preferredChannel,
        instagram: values.instagram.trim() || undefined,
        facebook: values.facebook.trim() || undefined,
        tiktok: values.tiktok.trim() || undefined,
        tags: parseTagsText(values.tagsText),
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      toast.success(`Contact "${res.contact.fullName}" berhasil dibuat`);
      onCreated(res.contact, res.duplicateCandidates ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat contact");
    } finally {
      setCreating(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validateForm()) return;
    setChecking(true);
    try {
      const res = await api.identify({
        email: values.email.trim() || undefined,
        whatsapp: finalWhatsapp() || undefined,
        fullName: `${values.firstName.trim()} ${values.lastName.trim()}`.trim(),
        companyName: values.companyName.trim() || undefined,
      });
      if (res.candidates.length > 0) {
        setCandidates(res.candidates);
        return;
      }
      await createNow();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memeriksa duplikat");
    } finally {
      setChecking(false);
    }
  }

  function pickExisting() {
    toast.info("Menggunakan contact existing");
    onOpenChange(false);
  }

  const busy = checking || creating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Contact Baru</DialogTitle>
          <DialogDescription>
            Tambah identitas calon klien. Sistem otomatis memeriksa kemungkinan duplikat sebelum menyimpan.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ContactFields mode="create" values={values} onChange={patchForm} disabled={busy} companies={companies} onCompanyUpserted={onCompanyUpserted} />

          {candidates && candidates.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="size-4 text-amber-600" />
              <AlertTitle className="text-amber-800">Kemungkinan duplikat</AlertTitle>
              <AlertDescription className="text-amber-700">
                <span className="block text-xs">
                  Contact berikut mirip dengan data yang Anda masukkan. Gunakan data existing, atau tetap buat baru.
                </span>
                <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto crm-scroll pr-1">
                  {candidates.map((c) => (
                    <li
                      key={c.contactId}
                      className="flex items-start justify-between gap-2 rounded-lg border border-amber-200 bg-white p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-zinc-900">
                          <span className="truncate">{c.contact?.fullName ?? "Contact tanpa nama"}</span>
                          <Badge className={cn("border-transparent", scoreBadgeClass(c.score))}>{c.score}% mirip</Badge>
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          {c.contact?.email || "-"}
                          {c.contact?.company?.name ? ` · ${c.contact.company.name}` : ""}
                        </p>
                        {c.reasons.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-amber-700">Alasan: {c.reasons.join(" · ")}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100"
                        onClick={pickExisting}
                      >
                        Pilih ini
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2.5 bg-zinc-900 text-white hover:bg-zinc-800"
                  onClick={() => void createNow()}
                  disabled={busy}
                >
                  {creating && <Loader2 className="size-3.5 animate-spin" />} Tetap buat baru
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Batal
            </Button>
            <Button type="submit" className="bg-zinc-900 text-white hover:bg-zinc-800" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              {checking ? "Memeriksa duplikat…" : creating ? "Menyimpan…" : "Simpan Contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog: Perusahaan baru ----------

function CreateCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  // Ronde 44 — dialog Perusahaan Baru kini memakai modal Detail Perusahaan bersama
  // (CompanyDetailModal) — field identik dengan modal di Konversi Lead & Peluang Baru,
  // plus anti-duplikat by name (pakai existing bila perusahaan sudah terdaftar).
  return (
    <CompanyDetailModal
      open={open}
      onOpenChange={onOpenChange}
      initial={{}}
      onSaved={() => onCreated()}
    />
  );
}

// ---------- Impor CSV (Task 11-a): parser murni & helper ----------

const IMPORT_MAX_ROWS = 200;

const IMPORT_TEMPLATE = [
  "nama,email,whatsapp,perusahaan,jabatan,kota,instagram",
  "Hendra Wijaya,hendra@nusantaranet.com,,PT Nusantara Digital Raya,Direktur Digital,Jakarta,@hendra.wjy",
  "Budi Santoso,,+6281398765432,CV Karya Mandiri,Owner,Surabaya,",
  "Budi Santoso,,+6281398765432,CV Karya Mandiri,Creative Director,Surabaya,",
  "Tanpa Kontak,,,PT Contoh Saja,,",
].join("\n");

const IMPORT_FIELD_ORDER: readonly (keyof ImportRowValues)[] = [
  "fullName",
  "email",
  "whatsapp",
  "phone",
  "company",
  "position",
  "country",
  "city",
  "instagram",
  "facebook",
  "tiktok",
];

const IMPORT_HEADER_SYNONYMS: Record<string, keyof ImportRowValues> = {
  nama: "fullName",
  name: "fullName",
  fullname: "fullName",
  email: "email",
  whatsapp: "whatsapp",
  wa: "whatsapp",
  telepon: "phone",
  telp: "phone",
  phone: "phone",
  perusahaan: "company",
  company: "company",
  jabatan: "position",
  position: "position",
  negara: "country",
  country: "country",
  kota: "city",
  city: "city",
  instagram: "instagram",
  ig: "instagram",
  instagram_handle: "instagram",
  handle_ig: "instagram",
  facebook: "facebook",
  fb: "facebook",
  facebook_url: "facebook",
  tiktok: "tiktok",
  tt: "tiktok",
};

function emptyImportRow(): ImportRowValues {
  return {
    fullName: "",
    email: "",
    whatsapp: "",
    phone: "",
    company: "",
    position: "",
    country: "",
    city: "",
    instagram: "",
    facebook: "",
    tiktok: "",
  };
}

function isHeaderRow(cells: string[]): boolean {
  return cells.some((c) => ["nama", "name", "email", "whatsapp"].includes(c.trim().toLowerCase()));
}

/** Deteksi separator dari baris pertama: titik koma (hasil ekspor Excel locale Indonesia) atau koma. */
function detectCsvSeparator(firstLine: string): string {
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

/** Parser CSV murni (tanpa dep): quoted field dengan escape "", \r\n/\n, separator koma atau titik koma. */
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

/** Petakan baris hasil parse ke bentuk API: via header sinonim, atau posisi kolom bila tanpa header. */
function mapCsvRows(rows: string[][]): ImportRowValues[] {
  if (rows.length === 0) return [];
  const header = isHeaderRow(rows[0]);
  const cols = header
    ? rows[0].map((c) => IMPORT_HEADER_SYNONYMS[c.trim().toLowerCase()] ?? null)
    : IMPORT_FIELD_ORDER;
  const body = header ? rows.slice(1) : rows;
  return body.map((cells) => {
    const out = emptyImportRow();
    cols.forEach((key, colIdx) => {
      if (key) out[key] = (cells[colIdx] ?? "").trim();
    });
    return out;
  });
}

function importActionBorderClass(action: ImportPreviewRowDTO["action"]): string {
  if (action === "auto_create") return "border-l-emerald-500";
  if (action === "review") return "border-l-amber-500";
  return "border-l-rose-500";
}

// ---------- Dialog: Impor CSV (3 langkah) ----------

function ImportCsvDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const user = useCrmStore((s) => s.user);
  const [step, setStep] = useState<"input" | "review" | "done">("input");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponseDTO | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<ImportCommitResponseDTO | null>(null);

  useEffect(() => {
    if (open) {
      setStep("input");
      setCsvText("");
      setFileName(null);
      setPreview(null);
      setDecisions({});
      setExpanded({});
      setAnalyzing(false);
      setCommitting(false);
      setCommitResult(null);
    }
  }, [open]);

  const parsedRows = useMemo(() => mapCsvRows(parseCsv(csvText)), [csvText]);
  const overLimit = parsedRows.length > IMPORT_MAX_ROWS;

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => toast.error("Gagal membaca file CSV");
    reader.readAsText(file);
    e.target.value = ""; // agar file yang sama bisa diunggah ulang
  }

  async function analyze() {
    if (parsedRows.length === 0) {
      toast.error("Tidak ada baris untuk dianalisis — unggah file atau tempel data CSV");
      return;
    }
    if (overLimit) {
      toast.error(`Maksimal ${IMPORT_MAX_ROWS} baris per impor (terdeteksi ${parsedRows.length})`);
      return;
    }
    setAnalyzing(true);
    try {
      const res = await api.importContacts({
        rows: parsedRows,
        commit: false,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      const data = res as ImportPreviewResponseDTO;
      const nextDecisions: Record<string, string> = {};
      const nextExpanded: Record<string, boolean> = {};
      for (const row of data.preview) {
        nextDecisions[String(row.index)] = row.status === "invalid" ? "skip" : row.suggested;
        nextExpanded[String(row.index)] = row.action === "review";
      }
      setDecisions(nextDecisions);
      setExpanded(nextExpanded);
      setPreview(data);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menganalisis data impor");
    } finally {
      setAnalyzing(false);
    }
  }

  function setDecision(index: number, value: string) {
    setDecisions((d) => ({ ...d, [String(index)]: value }));
  }

  function toggleExpanded(index: number) {
    setExpanded((e) => ({ ...e, [String(index)]: !e[String(index)] }));
  }

  const importCount = preview
    ? preview.preview.filter((r) => (decisions[String(r.index)] ?? r.suggested) !== "skip").length
    : 0;

  async function commit() {
    if (!preview) return;
    setCommitting(true);
    try {
      const res = await api.importContacts({
        rows: parsedRows,
        decisions,
        commit: true,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "system",
      });
      const data = res as ImportCommitResponseDTO;
      setCommitResult(data);
      setStep("done");
      if (data.summary.created + data.summary.linked > 0) {
        toast.success(`Impor selesai — ${data.summary.created} baru, ${data.summary.linked} digabung`);
      } else {
        toast.info("Impor selesai — tidak ada kontak yang dibuat atau digabung");
      }
      onImported(); // segarkan daftar kontak di belakang dialog
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengimpor kontak");
    } finally {
      setCommitting(false);
    }
  }

  function backToInput() {
    setPreview(null);
    setDecisions({});
    setExpanded({});
    setStep("input");
  }

  function importAgain() {
    setStep("input");
    setCsvText("");
    setFileName(null);
    setPreview(null);
    setDecisions({});
    setExpanded({});
    setCommitResult(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-2xl">
        {step === "input" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="size-5 text-zinc-900" /> Impor CSV
              </DialogTitle>
              <DialogDescription>
                Unggah atau tempel daftar kontak. Sistem mendeteksi duplikat (email, WhatsApp, telepon, nama) sebelum
                menyimpan.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* 1a. Unggah file */}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-100",
                  analyzing && "pointer-events-none opacity-60"
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-200/70 text-zinc-500">
                  <Upload className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800">
                    {fileName ?? "Pilih file CSV dari komputer"}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Header kolom dipetakan otomatis · maksimal {IMPORT_MAX_ROWS} baris
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700">
                  Pilih File
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFile}
                  aria-label="Unggah file CSV"
                />
              </label>

              {/* 1b. Tempel data */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-600">atau tempel data CSV</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCsvText(IMPORT_TEMPLATE);
                      setFileName(null);
                    }}
                    aria-label="Isi area tempel dengan contoh data CSV"
                  >
                    Isi contoh
                  </Button>
                </div>
                <Textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={IMPORT_TEMPLATE}
                  aria-label="Tempel data CSV"
                  disabled={analyzing}
                  className="min-h-36 font-mono text-xs"
                />
              </div>

              {/* Contoh format */}
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Contoh format</p>
                <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-600 crm-scroll">
                  {IMPORT_TEMPLATE}
                </pre>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Kolom didukung: nama, email, whatsapp, telepon, perusahaan, jabatan, negara, kota, instagram (juga
                  "ig"), facebook ("fb"), tiktok ("tt"). Tanpa header, urutan kolom mengikuti contoh di atas.
                </p>
              </div>

              {/* Statistik hasil parse + analisis */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-3 shadow-sm">
                {parsedRows.length === 0 ? (
                  <p className="text-sm text-zinc-400">Belum ada data untuk dianalisis.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border-transparent",
                        overLimit ? "bg-rose-100 text-rose-700" : "bg-zinc-200/70 text-zinc-700"
                      )}
                    >
                      {parsedRows.length} baris terdeteksi
                    </Badge>
                    {overLimit && (
                      <Badge className="border-transparent bg-rose-100 text-rose-700">
                        Melebihi batas {IMPORT_MAX_ROWS} baris
                      </Badge>
                    )}
                  </div>
                )}
                <Button
                  type="button"
                  className="bg-zinc-900 text-white hover:bg-zinc-800"
                  onClick={() => void analyze()}
                  disabled={analyzing || parsedRows.length === 0 || overLimit}
                  aria-label="Analisis duplikat sebelum impor"
                >
                  {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  {analyzing ? "Menganalisis…" : "Analisis Duplikat"}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={analyzing}>
                Batal
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "review" && preview && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitMerge className="size-5 text-zinc-900" /> Tinjau &amp; Keputusan
              </DialogTitle>
              <DialogDescription>
                Putuskan tiap baris: buat baru, gabungkan ke kontak existing, atau lewati. Baris invalid otomatis
                dilewati.
              </DialogDescription>
            </DialogHeader>

            {/* Ringkasan */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="border-transparent bg-zinc-200/70 text-zinc-700">
                Total {preview.summary.total}
              </Badge>
              <Badge className="border-transparent bg-emerald-100 text-emerald-700">
                {preview.summary.valid} valid
              </Badge>
              <Badge className="border-transparent bg-amber-100 text-amber-700">
                {preview.summary.review} perlu keputusan
              </Badge>
              <Badge className="border-transparent bg-rose-100 text-rose-700">
                {preview.summary.invalid} invalid
              </Badge>
            </div>

            {/* Daftar baris */}
            <div className="max-h-[420px] space-y-2 overflow-y-auto crm-scroll pr-1">
              {preview.preview.map((row) => {
                const decision = decisions[String(row.index)] ?? row.suggested;
                const isInvalid = row.status === "invalid";
                const hasCandidates = row.candidates.length > 0;
                const isOpen = Boolean(expanded[String(row.index)]);
                return (
                  <div
                    key={row.index}
                    className={cn("rounded-lg border border-l-4 p-3", importActionBorderClass(row.action))}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-zinc-400">#{row.index + 1}</span>
                          <span className="truncate text-sm font-semibold text-zinc-900">{row.fullName || "—"}</span>
                          {isInvalid && <Badge className="border-transparent bg-rose-100 text-rose-700">Invalid</Badge>}
                        </p>
                        {row.company && <p className="mt-0.5 truncate text-xs text-zinc-500">{row.company}</p>}
                        {row.intraBatch && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                            <AlertTriangle className="size-3.5 shrink-0" /> {row.intraBatch}
                          </p>
                        )}
                        {row.errors.length > 0 && <p className="mt-1 text-xs text-rose-600">{row.errors.join(" · ")}</p>}
                        {hasCandidates && (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(row.index)}
                            aria-label={`${isOpen ? "Sembunyikan" : "Lihat"} kandidat kecocokan baris ${row.index + 1}`}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                          >
                            <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                            {row.candidates.length} kandidat kecocokan
                          </button>
                        )}
                      </div>
                      {!isInvalid && (
                        <Select
                          value={decision}
                          onValueChange={(v) => setDecision(row.index, v)}
                          disabled={committing}
                        >
                          <SelectTrigger
                            className="w-[170px] shrink-0"
                            aria-label={`Keputusan baris ${row.index + 1}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="create">Buat baru</SelectItem>
                            {row.candidates.map((c) => (
                              <SelectItem key={c.contactId} value={`link:${c.contactId}`}>
                                Gabung: {c.name ?? "Contact"} ({c.score}%)
                              </SelectItem>
                            ))}
                            <SelectItem value="skip">Lewati</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    {hasCandidates && isOpen && (
                      <ul className="mt-2 space-y-1.5 border-t border-zinc-100 pt-2">
                        {row.candidates.map((c) => (
                          <li key={c.contactId} className="flex items-start gap-2">
                            <Badge
                              className={cn(
                                "shrink-0 border-transparent",
                                c.score >= 85 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                              )}
                            >
                              Skor {c.score}
                            </Badge>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-zinc-700">
                                {c.name ?? "Contact"}
                                {c.company ? ` · ${c.company}` : ""}
                              </p>
                              {c.reasons.length > 0 && (
                                <p className="truncate text-[11px] text-zinc-400">
                                  {c.reasons.slice(0, 2).join(" · ")}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={backToInput} disabled={committing}>
                Kembali
              </Button>
              <Button
                type="button"
                className="bg-zinc-900 text-white hover:bg-zinc-800"
                onClick={() => void commit()}
                disabled={committing || importCount === 0}
                aria-label={`Impor ${importCount} kontak`}
              >
                {committing ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {committing ? "Mengimpor…" : `Impor ${importCount} kontak`}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && commitResult && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-600" /> Impor Selesai
              </DialogTitle>
              <DialogDescription>Ringkasan hasil impor kontak dari CSV.</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold tabular-nums text-emerald-600">{commitResult.summary.created}</p>
                <p className="text-xs text-zinc-500">Baru</p>
              </div>
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold tabular-nums text-violet-600">{commitResult.summary.linked}</p>
                <p className="text-xs text-zinc-500">Digabung</p>
              </div>
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold tabular-nums text-zinc-600">{commitResult.summary.skipped}</p>
                <p className="text-xs text-zinc-500">Dilewati</p>
              </div>
              <div className="rounded-xl border bg-white p-3 text-center shadow-sm">
                <p className="text-xl font-bold tabular-nums text-rose-600">{commitResult.summary.invalid}</p>
                <p className="text-xs text-zinc-500">Invalid</p>
              </div>
            </div>

            {commitResult.summary.companiesCreated > 0 && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Building2 className="size-4" /> ＋{commitResult.summary.companiesCreated} perusahaan baru dibuat
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={importAgain}>
                <RotateCcw className="size-4" /> Impor lagi
              </Button>
              <Button
                type="button"
                className="bg-zinc-900 text-white hover:bg-zinc-800"
                onClick={() => onOpenChange(false)}
              >
                Selesai
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Ekspor CSV (Task 12-b): kebalikan impor, dari data kontak yang sedang tampil ----------

/** Header persis sesuai kontrak impor (urutan tetap), separator titik-koma. */
const EXPORT_CSV_HEADERS = [
  "fullName",
  "email",
  "whatsapp",
  "phone",
  "company",
  "position",
  "country",
  "city",
  "consentStatus",
  "tags",
] as const;

/** Escape field CSV: kutip ganda + doubling bila mengandung ; " \r \n. */
function escapeCsvField(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Bangun isi CSV: BOM + CRLF + separator titik-koma (kompatibel dgn parser impor & Excel Indonesia). */
function buildContactsCsv(contacts: ContactRecord[]): string {
  const lines: string[] = [EXPORT_CSV_HEADERS.join(";")];
  for (const c of contacts) {
    const fields: string[] = [
      c.fullName ?? "",
      c.email ?? "",
      c.whatsapp ?? "",
      c.phone ?? "",
      c.company?.name ?? "",
      c.position ?? "",
      c.country ?? "",
      c.city ?? "",
      c.consentStatus ?? "",
      parseJsonArray(c.tags).join("; "),
    ];
    lines.push(fields.map(escapeCsvField).join(";"));
  }
  return "\uFEFF" + lines.join("\r\n");
}

// ---------- Dialog: Deteksi & gabung duplikat lintas sumber (Ronde 22) ----------

/** Identitas ringkas satu sisi pasangan duplikat (email / WA / perusahaan). */
function DuplicateIdentity({
  email,
  whatsapp,
  company,
}: {
  email?: string | null;
  whatsapp?: string | null;
  company?: string | null;
}) {
  return (
    <div className="mt-1.5 space-y-1">
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Mail className="size-3.5 shrink-0 text-zinc-400" />
        <span className="truncate">{email || "—"}</span>
      </p>
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <MessageCircle className="size-3.5 shrink-0 text-zinc-400" />
        <span className="truncate">{whatsapp || "—"}</span>
      </p>
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Building2 className="size-3.5 shrink-0 text-zinc-400" />
        <span className="truncate">{company || "—"}</span>
      </p>
    </div>
  );
}

function DuplicatePairSkeletonRow() {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm" aria-hidden="true">
      <Skeleton className="h-5 w-20 rounded-md" />
      <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="mx-auto size-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    </div>
  );
}

function DuplicateScanDialog({
  open,
  onOpenChange,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}) {
  const user = useCrmStore((s) => s.user);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairs, setPairs] = useState<DuplicatePairDTO[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConfirmingId(null);
    try {
      const res = await api.scanDuplicates();
      setPairs(res.pairs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memindai duplikat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setPairs([]);
      setMergingId(null);
      void runScan();
    }
  }, [open, runScan]);

  async function confirmMerge(pair: DuplicatePairDTO) {
    setMergingId(pair.duplicateId);
    try {
      await api.mergeContacts(pair.primaryId, pair.duplicateId, user?.name ?? "System");
      toast.success("Kontak digabungkan");
      // Optimistic: hapus pasangan dari daftar, lalu muat ulang data kontak di modul.
      setPairs((list) => list.filter((p) => p.duplicateId !== pair.duplicateId));
      setConfirmingId(null);
      onMerged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menggabungkan kontak");
    } finally {
      setMergingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CopyX className="size-5 text-zinc-900" /> Gabungkan Lead Lintas Sumber
          </DialogTitle>
          <DialogDescription>
            Kontak yang datang dari WhatsApp, Instagram, Email, atau import CSV bisa tercatat ganda. Sistem mencocokkan
            email, WhatsApp, telepon, sosial media, domain perusahaan, dan kemiripan nama.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2" aria-live="polite" aria-label="Memindai duplikat">
            <DuplicatePairSkeletonRow />
            <DuplicatePairSkeletonRow />
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertTriangle className="size-5" />
            </span>
            <p className="max-w-sm text-sm text-rose-700">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void runScan()} aria-label="Coba pindai ulang duplikat">
              <RefreshCw className="size-4" /> Coba lagi
            </Button>
          </div>
        )}

        {!loading && !error && pairs.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border bg-white px-4 py-10 text-center shadow-sm">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="size-6" />
            </span>
            <p className="text-sm font-medium text-zinc-700">Tidak ada duplikat terdeteksi — data kontak bersih.</p>
          </div>
        )}

        {!loading && !error && pairs.length > 0 && (
          <>
            <p className="text-xs text-zinc-500">
              Ditemukan <span className="font-semibold text-zinc-800">{pairs.length}</span> pasangan kemiripan.
              Periksa lalu gabungkan yang benar-benar orang yang sama.
            </p>
            <ul className="max-h-96 space-y-2 overflow-y-auto crm-scroll pr-1">
              {pairs.map((pair) => {
                const confirming = confirmingId === pair.duplicateId;
                const busy = mergingId !== null;
                return (
                  <li key={pair.duplicateId} className="rounded-xl border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Badge className={cn("border-transparent", dupScoreBadgeClass(pair.score))}>
                        Skor {pair.score}
                      </Badge>
                    </div>

                    <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                          Usulan Utama
                        </p>
                        <p className="mt-0.5 truncate text-sm font-bold text-zinc-900">{pair.primaryName}</p>
                        <DuplicateIdentity
                          email={pair.primaryEmail}
                          whatsapp={pair.primaryWhatsapp}
                          company={pair.primaryCompany}
                        />
                      </div>
                      <div className="flex items-center justify-center" aria-hidden="true">
                        <span className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
                          <ArrowLeftRight className="size-4" />
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Duplikat</p>
                        <p className="mt-0.5 truncate text-sm font-bold text-zinc-900">{pair.duplicateName}</p>
                        <DuplicateIdentity
                          email={pair.duplicateEmail}
                          whatsapp={pair.duplicateWhatsapp}
                          company={pair.duplicateCompany}
                        />
                      </div>
                    </div>

                    {pair.reasons.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {pair.reasons.map((r, i) => (
                          <Badge
                            key={`${pair.duplicateId}-${i}`}
                            variant="outline"
                            className="text-[11px] font-normal text-zinc-500"
                          >
                            {r}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {!confirming && (
                      <div className="mt-3 flex justify-end border-t border-zinc-100 pt-3">
                        <Button
                          size="sm"
                          className="bg-zinc-900 text-white hover:bg-zinc-800"
                          disabled={busy}
                          onClick={() => setConfirmingId(pair.duplicateId)}
                          aria-label={`Gabungkan ${pair.duplicateName} ke ${pair.primaryName}`}
                        >
                          <GitMerge className="size-3.5" /> Gabungkan
                        </Button>
                      </div>
                    )}

                    {confirming && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs leading-relaxed text-amber-800">
                          Data <span className="font-semibold">{pair.duplicateName}</span> akan digabungkan ke{" "}
                          <span className="font-semibold">{pair.primaryName}</span>. Opportunity &amp; interaksi
                          dipindah, kontak duplikat diarsipkan.
                        </p>
                        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmingId(null)}
                            disabled={busy}
                            aria-label="Batal menggabungkan"
                          >
                            Batal
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void confirmMerge(pair)}
                            disabled={busy}
                            aria-label={`Ya, gabungkan ${pair.duplicateName} ke ${pair.primaryName}`}
                          >
                            {mergingId === pair.duplicateId ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <GitMerge className="size-3.5" />
                            )}
                            Ya, gabungkan
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void runScan()}
            disabled={loading}
            aria-label="Pindai ulang duplikat"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Pindai ulang
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Modul utama ----------

export default function ContactsModule() {
  const user = useCrmStore((s) => s.user);
  const pendingFocus = useCrmStore((s) => s.pendingFocus);
  const clearPendingFocus = useCrmStore((s) => s.clearPendingFocus);

  const [tab, setTab] = useState<TabKey>("contacts");
  const [contactInput, setContactInput] = useState("");
  const [companyInput, setCompanyInput] = useState("");
  const contactQuery = useDebounced(contactInput, 300);
  const companyQuery = useDebounced(companyInput, 300);

  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [allContacts, setAllContacts] = useState<ContactRecord[]>([]);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [allCompanies, setAllCompanies] = useState<CompanyRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [errorContacts, setErrorContacts] = useState<string | null>(null);
  const [errorCompanies, setErrorCompanies] = useState<string | null>(null);

  const [contactSheet, setContactSheet] = useState<{ open: boolean; contact: ContactRecord | null }>({
    open: false,
    contact: null,
  });
  const [companySheet, setCompanySheet] = useState<{ open: boolean; company: CompanyRecord | null }>({
    open: false,
    company: null,
  });
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  // Ronde 45 — target Edit Perusahaan (modal shared) dari tabel & detail sheet
  const [companyEditTarget, setCompanyEditTarget] = useState<CompanyRecord | null>(null);
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [mergeState, setMergeState] = useState<{ newContactId: string; candidates: MatchCandidateDTO[] } | null>(null);
  const [merging, setMerging] = useState(false);

  const loadContacts = useCallback(async (q?: string) => {
    setLoadingContacts(true);
    try {
      const res = await api.contacts(q || undefined);
      const list = res.contacts as ContactRecord[];
      setContacts(list);
      if (!q) setAllContacts(list);
      setErrorContacts(null);
    } catch (err) {
      setErrorContacts(err instanceof Error ? err.message : "Gagal memuat contact");
      toast.error("Gagal memuat contact");
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const loadCompanies = useCallback(async (q?: string) => {
    setLoadingCompanies(true);
    try {
      const res = await api.companies(q || undefined);
      const list = res.companies as CompanyRecord[];
      setCompanies(list);
      if (!q) setAllCompanies(list);
      setErrorCompanies(null);
    } catch (err) {
      setErrorCompanies(err instanceof Error ? err.message : "Gagal memuat perusahaan");
      toast.error("Gagal memuat perusahaan");
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  // Fetch awal + saat query berubah (debounce 300ms).
  useEffect(() => {
    void loadContacts(contactQuery);
  }, [contactQuery, loadContacts]);
  useEffect(() => {
    void loadCompanies(companyQuery);
  }, [companyQuery, loadCompanies]);

  /** Refetch master (tanpa filter) + ulangi query aktif, berurutan agar tidak balapan. */
  const refreshAll = useCallback(async () => {
    await loadContacts("");
    if (contactQuery) await loadContacts(contactQuery);
    await loadCompanies("");
    if (companyQuery) await loadCompanies(companyQuery);
  }, [contactQuery, companyQuery, loadContacts, loadCompanies]);

  const retryAll = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);

  const openContact = useCallback((c: ContactRecord) => {
    setContactSheet({ open: true, contact: c });
  }, []);

  const openCompany = useCallback(
    (company: CompanyRef) => {
      const full = allCompanies.find((x) => x.id === company.id) ?? company;
      setContactSheet((s) => ({ ...s, open: false }));
      setCompanySheet({ open: true, company: full });
    },
    [allCompanies]
  );

  const openContactFromCompany = useCallback(
    (c: ContactRecord) => {
      setCompanySheet((s) => ({ ...s, open: false }));
      openContact(c);
    },
    [openContact]
  );

  // Global search (ronde 26) — buka detail kontak / perusahaan hasil pencarian (⌘K).
  // Menunggu data master termuat dulu (effect berjalan lagi saat data tiba); id tak ketemu
  // → cukup pindah modul (clear) tanpa membuka sheet apa pun.
  useEffect(() => {
    if (!pendingFocus || pendingFocus.module !== "contacts") return;
    if (loadingContacts || loadingCompanies) return; // tunggu list master termuat
    const contact = allContacts.find((c) => c.id === pendingFocus.id);
    if (contact) {
      openContact(contact);
      clearPendingFocus();
      return;
    }
    const company = allCompanies.find((c) => c.id === pendingFocus.id);
    if (company) openCompany(company);
    clearPendingFocus();
  }, [pendingFocus, allContacts, allCompanies, loadingContacts, loadingCompanies, openContact, openCompany, clearPendingFocus]);

  const handleContactSaved = useCallback(
    (updated: ContactRef) => {
      setContactSheet((s) => ({
        ...s,
        contact: s.contact ? ({ ...s.contact, ...updated } as ContactRecord) : s.contact,
      }));
      void refreshAll();
    },
    [refreshAll]
  );

  const handleContactDeleted = useCallback(() => {
    setContactSheet({ open: false, contact: null });
    void refreshAll();
  }, [refreshAll]);

  /** Ronde 45 — perusahaan baru/diedit dari form contact mana pun → segarkan daftar & sheet. */
  const handleCompanyUpserted = useCallback(
    (updated: SavedCompany) => {
      setCompanyEditTarget((t) => (t ? ({ ...t, ...updated } as CompanyRecord) : t));
      setCompanySheet((s) => ({
        ...s,
        company: s.company && s.company.id === updated.id ? ({ ...s.company, ...updated } as CompanyRecord) : s.company,
      }));
      void refreshAll();
    },
    [refreshAll]
  );

  const handleContactCreated = useCallback(
    (contact: ContactRef, duplicates: MatchCandidateDTO[]) => {
      setCreateContactOpen(false);
      void refreshAll();
      if (duplicates.length > 0) {
        setMergeState({ newContactId: contact.id, candidates: duplicates });
      }
    },
    [refreshAll]
  );

  const handleCompanyCreated = useCallback(() => {
    setCreateCompanyOpen(false);
    void refreshAll();
  }, [refreshAll]);

  // Ekspor CSV (Task 12-b): unduh daftar kontak yang sedang tampil (hasil filter pencarian server).
  const handleExportCsv = useCallback(() => {
    if (contacts.length === 0) return;
    const csv = buildContactsCsv(contacts);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `kontak-grupcrm-${ymd}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Ekspor CSV selesai — ${contacts.length} kontak diunduh`);
  }, [contacts]);

  async function handleMerge(candidate: MatchCandidateDTO) {
    if (!mergeState) return;
    setMerging(true);
    try {
      await api.mergeContacts(mergeState.newContactId, candidate.contactId, user?.name ?? "System");
      toast.success(
        `Contact digabungkan dengan ${candidate.contact?.fullName ?? "kandidat terpilih"}`
      );
      setMergeState(null);
      void refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menggabungkan contact");
    } finally {
      setMerging(false);
    }
  }

  // Jumlah contact per perusahaan (dari master contact, akurat meski API company hanya include 5).
  const contactCountByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allContacts) {
      if (c.companyId) m.set(c.companyId, (m.get(c.companyId) ?? 0) + 1);
    }
    return m;
  }, [allContacts]);

  const companySheetContacts = useMemo(() => {
    const company = companySheet.company;
    if (!company) return [] as ContactRecord[];
    const owned = allContacts.filter((c) => c.companyId === company.id);
    return owned.length > 0 ? owned : ((company.contacts ?? []) as ContactRecord[]);
  }, [companySheet.company, allContacts]);

  const contactEmpty = (
    <EmptyState
      icon={Users}
      title={contactQuery ? "Tidak ada hasil" : "Belum ada contact"}
      description={
        contactQuery
          ? `Tidak ada contact yang cocok dengan pencarian "${contactQuery}". Coba kata kunci lain.`
          : "Mulai bangun basis data calon klien lintas brand dengan menambahkan contact baru."
      }
      action={
        contactQuery ? (
          <Button variant="outline" onClick={() => setContactInput("")} aria-label="Reset pencarian contact">
            <X className="size-4" /> Reset pencarian
          </Button>
        ) : (
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => setCreateContactOpen(true)}>
            <Plus className="size-4" /> Contact Baru
          </Button>
        )
      }
    />
  );

  const companyEmpty = (
    <EmptyState
      icon={Building2}
      title={companyQuery ? "Tidak ada hasil" : "Belum ada perusahaan"}
      description={
        companyQuery
          ? `Tidak ada perusahaan yang cocok dengan pencarian "${companyQuery}". Coba kata kunci lain.`
          : "Daftarkan perusahaan calon klien agar contact dapat terhubung ke akun yang tepat."
      }
      action={
        companyQuery ? (
          <Button variant="outline" onClick={() => setCompanyInput("")} aria-label="Reset pencarian perusahaan">
            <X className="size-4" /> Reset pencarian
          </Button>
        ) : (
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => setCreateCompanyOpen(true)}>
            <Plus className="size-4" /> Perusahaan Baru
          </Button>
        )
      }
    />
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">Contacts &amp; Companies</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Identitas calon klien global — terhubung ke seluruh brand</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              value={tab === "contacts" ? contactInput : companyInput}
              onChange={(e) => (tab === "contacts" ? setContactInput(e.target.value) : setCompanyInput(e.target.value))}
              placeholder={tab === "contacts" ? "Cari nama, email, WA, jabatan…" : "Cari nama perusahaan…"}
              aria-label={tab === "contacts" ? "Cari contact" : "Cari perusahaan"}
              className="w-full pl-9 sm:w-72"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDedupeOpen(true)}
            aria-label="Deteksi duplikat lead lintas sumber"
          >
            <CopyX className="size-4" /> Deteksi Duplikat
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportCsvOpen(true)}
            aria-label="Impor kontak dari file CSV"
          >
            <FileUp className="size-4" /> Impor CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={contacts.length === 0}
            aria-label="Ekspor kontak ke file CSV"
          >
            <Download className="size-4" /> Ekspor CSV
          </Button>
          {tab === "contacts" ? (
            <Button
              onClick={() => setCreateContactOpen(true)}
              className="bg-zinc-900 text-white hover:bg-zinc-800"
              aria-label="Tambah contact baru"
            >
              <Plus className="size-4" /> Contact Baru
            </Button>
          ) : (
            <Button
              onClick={() => setCreateCompanyOpen(true)}
              className="bg-zinc-900 text-white hover:bg-zinc-800"
              aria-label="Tambah perusahaan baru"
            >
              <Plus className="size-4" /> Perusahaan Baru
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="contacts" className="gap-1.5">
            Kontak
            <Badge variant="secondary" className="ml-0.5 bg-zinc-200/70 text-zinc-700">
              {contacts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="companies" className="gap-1.5">
            Perusahaan
            <Badge variant="secondary" className="ml-0.5 bg-zinc-200/70 text-zinc-700">
              {companies.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* TAB KONTAK */}
        <TabsContent value="contacts" className="mt-4">
          {errorContacts ? (
            <ErrorState message={errorContacts} onRetry={retryAll} />
          ) : loadingContacts && contacts.length === 0 ? (
            <ContactSkeletonGrid />
          ) : contacts.length === 0 ? (
            contactEmpty
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {contacts.map((c) => (
                <ContactCard key={c.id} contact={c} onOpen={() => openContact(c)} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB PERUSAHAAN */}
        <TabsContent value="companies" className="mt-4">
          {errorCompanies ? (
            <ErrorState message={errorCompanies} onRetry={retryAll} />
          ) : loadingCompanies && companies.length === 0 ? (
            <CompanyTableSkeleton />
          ) : companies.length === 0 ? (
            companyEmpty
          ) : (
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-50 hover:bg-zinc-50">
                      <TableHead>Perusahaan</TableHead>
                      <TableHead>Industri</TableHead>
                      <TableHead>Lokasi</TableHead>
                      <TableHead>Ukuran</TableHead>
                      <TableHead className="text-center">Kontak</TableHead>
                      <TableHead className="text-center">Opportunities</TableHead>
                      <TableHead className="text-right">Lifetime Value</TableHead>
                      <TableHead className="text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companies.map((c) => (
                      <TableRow
                        key={c.id}
                        tabIndex={0}
                        aria-label={`Buka detail ${c.name}`}
                        onClick={() => openCompany(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openCompany(c);
                          }
                        }}
                        className="cursor-pointer"
                      >
                        <TableCell>
                          <span className="block font-semibold text-zinc-900">{c.name}</span>
                          {c.website && <span className="block text-xs text-zinc-500">{c.website}</span>}
                        </TableCell>
                        <TableCell className="text-zinc-600">{c.industry || "-"}</TableCell>
                        <TableCell className="text-zinc-600">{locationText(c.city, c.country)}</TableCell>
                        <TableCell>
                          <SizeBadge size={c.size} />
                        </TableCell>
                        <TableCell className="text-center text-zinc-600">
                          {contactCountByCompany.get(c.id) ?? 0}
                        </TableCell>
                        <TableCell className="text-center text-zinc-600">{c._count?.opportunities ?? 0}</TableCell>
                        <TableCell className="text-right font-medium text-zinc-900">
                          {formatCurrency(c.lifetimeValue, c.defaultCurrency)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 px-2.5"
                            onClick={(e) => {
                              // stopPropagation: jangan buka detail sheet, langsung modal Edit
                              e.stopPropagation();
                              setCompanyEditTarget(c);
                            }}
                            aria-label={`Edit perusahaan ${c.name}`}
                            title="Edit detail perusahaan"
                          >
                            <Pencil className="size-3.5" /> Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Sheets & dialogs */}
      <ContactDetailSheet
        contact={contactSheet.contact}
        open={contactSheet.open}
        onOpenChange={(open) => setContactSheet((s) => ({ ...s, open }))}
        companies={allCompanies}
        onSaved={handleContactSaved}
        onDeleted={handleContactDeleted}
        onOpenCompany={openCompany}
        onCompanyUpserted={handleCompanyUpserted}
      />

      <CompanyDetailSheet
        company={companySheet.company}
        open={companySheet.open}
        onOpenChange={(open) => setCompanySheet((s) => ({ ...s, open }))}
        contacts={companySheetContacts}
        onOpenContact={openContactFromCompany}
        onEdit={(c) => setCompanyEditTarget(c)}
      />

      {/* Ronde 45 — modal Edit Perusahaan (dari tabel & detail sheet) */}
      <CompanyDetailModal
        open={!!companyEditTarget}
        onOpenChange={(o) => {
          if (!o) setCompanyEditTarget(null);
        }}
        editCompany={companyEditTarget}
        initial={{}}
        onSaved={() => {
          /* refresh ditangani onCompanyUpserted */
        }}
        onCompanyUpserted={handleCompanyUpserted}
      />

      <CreateContactDialog
        open={createContactOpen}
        onOpenChange={setCreateContactOpen}
        onCreated={handleContactCreated}
        companies={allCompanies}
        onCompanyUpserted={handleCompanyUpserted}
      />

      <CreateCompanyDialog
        open={createCompanyOpen}
        onOpenChange={setCreateCompanyOpen}
        onCreated={handleCompanyCreated}
      />

      {/* Dialog impor CSV massal dengan dedupe */}
      <ImportCsvDialog
        open={importCsvOpen}
        onOpenChange={setImportCsvOpen}
        onImported={() => {
          void refreshAll();
        }}
      />

      {/* Dialog deteksi & gabung duplikat lintas sumber (Ronde 22) */}
      <DuplicateScanDialog open={dedupeOpen} onOpenChange={setDedupeOpen} onMerged={() => void refreshAll()} />

      {/* Dialog merge pasca-create */}
      <Dialog open={!!mergeState} onOpenChange={(o) => !o && setMergeState(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto crm-scroll sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="size-5 text-zinc-900" /> Mungkin duplikat?
            </DialogTitle>
            <DialogDescription>
              Contact baru berhasil dibuat, namun sistem menemukan data existing yang mirip. Gabungkan agar data tidak
              terpecah, atau biarkan terpisah.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-96 space-y-2 overflow-y-auto crm-scroll pr-1">
            {mergeState?.candidates.map((c) => (
              <li
                key={c.contactId}
                className="flex items-start justify-between gap-3 rounded-xl border bg-white p-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-zinc-900">
                    <span className="truncate">{c.contact?.fullName ?? "Contact tanpa nama"}</span>
                    <Badge className={cn("border-transparent", scoreBadgeClass(c.score))}>{c.score}% mirip</Badge>
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {c.contact?.email || "-"}
                    {c.contact?.company?.name ? ` · ${c.contact.company.name}` : ""}
                  </p>
                  {c.reasons.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-zinc-400">Alasan: {c.reasons.join(" · ")}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="shrink-0 bg-zinc-900 text-white hover:bg-zinc-800"
                  disabled={merging}
                  onClick={() => void handleMerge(c)}
                >
                  {merging ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />} Gabungkan
                </Button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={merging}
              onClick={() => {
                setMergeState(null);
                void refreshAll();
              }}
            >
              Tetap terpisah
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
