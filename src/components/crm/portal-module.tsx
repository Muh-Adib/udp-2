"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban, Building2, CalendarClock, CalendarDays, Check, CheckCircle2, CircleDotDashed, CircleDashed, Copy, Eye, ExternalLink,
  FileSignature, FileStack, FileText, FolderKanban, GitPullRequestArrow, Info, KeyRound, Link2, Loader2, Lock, PackageCheck,
  Paperclip, Pencil, Plus, RefreshCw, ReceiptText, RotateCcw, Trash2, X, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, portalApi } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type {
  ChangeRequestDTO, ClientDocumentDTO, CompanyRef, InvoiceDTO, MilestoneDTO, PortalTokenDTO, ProjectDeliverableDTO,
  ProjectDTO, QuotationDTO, QuotationItemDTO, SessionUser,
} from "@/lib/crm/types";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime, timeAgo } from "@/lib/crm/utils";

// ============ Meta ============

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  sent: { label: "Terkirim", cls: "bg-violet-100 text-violet-700" },
  partial: { label: "Sebagian", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Lunas", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Overdue", cls: "bg-rose-100 text-rose-700" },
};

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Perencanaan", cls: "bg-zinc-100 text-zinc-600" },
  in_progress: { label: "Berjalan", cls: "bg-amber-100 text-amber-700" },
  review: { label: "Review", cls: "bg-violet-100 text-violet-700" },
  completed: { label: "Selesai", cls: "bg-emerald-100 text-emerald-700" },
};

const CR_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu Persetujuan Anda", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Ditolak", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "Dibatalkan", cls: "bg-zinc-100 text-zinc-600" },
};

const QUOTATION_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  sent: { label: "Terkirim", cls: "bg-violet-100 text-violet-700" },
  accepted: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Ditolak", cls: "bg-rose-100 text-rose-700" },
  expired: { label: "Kedaluwarsa", cls: "bg-zinc-100 text-zinc-600" },
};

const MILESTONE_ICON: Record<string, LucideIcon> = {
  done: CheckCircle2,
  in_progress: CircleDotDashed,
  pending: CircleDashed,
};

// Task 22-4 — status deliverable (badge: pending=zinc, approved=emerald, revision=amber)
const DELIVERABLE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu Review", cls: "bg-zinc-100 text-zinc-600" },
  approved: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700" },
  revision: { label: "Revisi Diminta", cls: "bg-amber-100 text-amber-700" },
};

function dlvStatus(s: string) { return DELIVERABLE_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }

function formatSizeKb(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

/** fileData (base64 data URL) dikirim server tetapi tidak dideklarasikan di ProjectDeliverableDTO —
 *  types.ts tidak boleh diubah, jadi perluas secara lokal untuk keperluan unduh. */
type DeliverableRowData = ProjectDeliverableDTO & { fileData?: string | null };

function invStatus(s: string) { return INVOICE_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }
function projStatus(s: string) { return PROJECT_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }
function crStatus(s: string) { return CR_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }
function quoteStatus(s: string) { return QUOTATION_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }

/** Parse item quotation defensif — items bisa JSON string atau array. */
function parseQuoteItems(items: string | QuotationItemDTO[]): QuotationItemDTO[] {
  if (Array.isArray(items)) return items;
  try {
    const parsed: unknown = JSON.parse(items);
    return Array.isArray(parsed) ? (parsed as QuotationItemDTO[]) : [];
  } catch {
    return [];
  }
}

/** Domain dari URL/email sederhana, untuk mencocokkan akun client dengan perusahaannya. */
function domainOf(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split("@").pop() ?? "";
  return s.includes(".") ? s : null;
}

// ============ Sub-komponen kecil ============

function PortalProjectCard({ project }: { project: ProjectDTO }) {
  const st = projStatus(project.status);
  const ms = project.milestones ?? [];
  const doneCount = ms.filter((m) => m.status === "done").length;
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{project.name}</p>
          <p className="font-mono text-[11px] text-zinc-500">{project.code}</p>
        </div>
        <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Progress pengerjaan</span>
          <span className="font-semibold tabular-nums text-zinc-700">{project.progress}%</span>
        </div>
        <Progress value={project.progress} aria-label={`Progress project ${project.progress}%`} />
      </div>
      {ms.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Milestone ({doneCount}/{ms.length} selesai)
          </p>
          {ms.map((m) => {
            const Icon = MILESTONE_ICON[m.status] ?? CircleDashed;
            return (
              <div key={m.id} className="flex items-center gap-2 text-xs">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${m.status === "done" ? "text-emerald-600" : m.status === "in_progress" ? "text-amber-600" : "text-zinc-300"}`} aria-hidden />
                <span className={m.status === "done" ? "text-emerald-700 line-through decoration-emerald-500" : "text-zinc-600"}>
                  {m.name}
                </span>
                {m.dueDate ? <span className="ml-auto shrink-0 text-zinc-400">{formatDate(m.dueDate)}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ============ Deliverable & Review klien (Task 22-4) ============

/** Satu baris deliverable di portal klien: ikon jenis, meta, status, dan aksi review (Setujui / Minta Revisi). */
function PortalDeliverableRow({ d, user, canReview, onChanged }: {
  d: DeliverableRowData;
  user: SessionUser | null;
  canReview: boolean;
  onChanged: () => Promise<void>;
}) {
  const meta = dlvStatus(d.status);
  const [review, setReview] = useState<null | "approved" | "revision">(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const KindIcon = d.kind === "file" ? Paperclip : Link2;

  async function submitDecision() {
    if (!user || !review) return;
    setBusy(true);
    try {
      await api.decideDeliverable({
        id: d.id,
        decision: review,
        reviewComment: comment.trim() || undefined,
        reviewedBy: user.name,
        reviewedRole: user.role, // "client" saat klien login; role staf saat mode pratinjau
      });
      toast.success(
        review === "approved"
          ? `“${d.name}” disetujui — terima kasih`
          : `Revisi diminta untuk “${d.name}” — tim kami akan menindaklanjuti`
      );
      setReview(null);
      setComment("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan keputusan review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100" aria-hidden>
            <KindIcon className="h-3.5 w-3.5 text-zinc-500" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{d.name}</p>
            <p className="truncate text-[11px] text-zinc-500">
              {d.kind === "file"
                ? [d.fileName, d.sizeBytes ? formatSizeKb(d.sizeBytes) : null].filter(Boolean).join(" · ")
                : d.url}
            </p>
            {d.note ? <p className="mt-1 text-xs text-zinc-500">{d.note}</p> : null}
            <p className="mt-1 text-[11px] text-zinc-400">
              Dikirim {timeAgo(d.createdAt)}{d.createdBy ? ` oleh ${d.createdBy}` : ""}
            </p>
            {d.status !== "pending" && d.reviewedBy ? (
              <p className="mt-1 text-[11px] text-zinc-500">
                Anda sudah mereview{d.reviewedAt ? ` · ${timeAgo(d.reviewedAt)}` : ""}
              </p>
            ) : null}
            {d.reviewComment ? (
              <p className="mt-0.5 text-[11px] italic text-zinc-500">Catatan review: “{d.reviewComment}”</p>
            ) : null}
          </div>
        </div>
        <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 ${meta.cls}`}>{meta.label}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {d.kind === "link" && d.url ? (
          <a
            href={d.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Buka tautan
          </a>
        ) : null}
        {d.kind === "file" && d.fileData ? (
          <a
            href={d.fileData}
            download={d.fileName ?? undefined}
            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            <ReceiptText className="h-3.5 w-3.5" aria-hidden /> Unduh
          </a>
        ) : null}
        {canReview ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-emerald-200 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              disabled={busy}
              onClick={() => { setReview("approved"); setComment(d.reviewComment ?? ""); }}
              aria-label={`Setujui deliverable ${d.name}`}
            >
              <Check className="h-3.5 w-3.5" aria-hidden /> Setujui
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-amber-200 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"
              disabled={busy}
              onClick={() => { setReview("revision"); setComment(d.reviewComment ?? ""); }}
              aria-label={`Minta revisi deliverable ${d.name}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Minta Revisi
            </Button>
          </>
        ) : null}
      </div>

      {review !== null ? (
        <div className="mt-2.5 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={review === "approved" ? "Catatan persetujuan (opsional)…" : "Jelaskan bagian yang perlu direvisi…"}
            aria-label="Catatan review deliverable"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { setReview(null); setComment(""); }}
              aria-label="Batal review deliverable"
            >
              Batal
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void submitDecision()}
              className={review === "approved" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-amber-600 text-white hover:bg-amber-700"}
              aria-label="Konfirmasi keputusan review"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {review === "approved" ? "Konfirmasi Setujui" : "Kirim Permintaan Revisi"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Blok deliverable per project — lazy fetch saat dirender, refresh mandiri setelah review. */
function PortalProjectDeliverables({ project, user, canReview }: {
  project: ProjectDTO;
  user: SessionUser | null;
  canReview: boolean;
}) {
  const [deliverables, setDeliverables] = useState<ProjectDeliverableDTO[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  /** Fetch daftar deliverable project ini (dipakai effect awal & refresh setelah review). */
  const reload = useCallback(async () => {
    try {
      const res = await api.projectDeliverables(project.id);
      setDeliverables(res.deliverables);
      setLoadError(false);
    } catch {
      setDeliverables([]);
      setLoadError(true);
    }
  }, [project.id]);

  // Initial fetch — pola .then() agar setState tidak berjalan sinkron di body effect.
  useEffect(() => {
    let cancelled = false;
    api.projectDeliverables(project.id)
      .then((res) => { if (!cancelled) { setDeliverables(res.deliverables); setLoadError(false); } })
      .catch(() => { if (!cancelled) { setDeliverables([]); setLoadError(true); } });
    return () => { cancelled = true; };
  }, [project.id]);

  const pendingCount = (deliverables ?? []).filter((d) => d.status === "pending").length;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900">{project.name}</p>
          <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">{project.code}</span>
        </div>
        {deliverables !== null && deliverables.length > 0 ? (
          pendingCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              {pendingCount} menunggu review Anda
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              semua sudah direview
            </span>
          )
        ) : null}
      </div>
      <div className="mt-3">
        {deliverables === null ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            Gagal memuat deliverable.{" "}
            <button type="button" className="font-medium underline" onClick={() => void reload()}>
              Coba lagi
            </button>
          </div>
        ) : deliverables.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-center text-xs text-zinc-400">
            Belum ada deliverable untuk project ini.
          </p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll">
            {deliverables.map((d) => (
              <PortalDeliverableRow key={d.id} d={d} user={user} canReview={canReview} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PortalSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-14 rounded-xl" />
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

/** Isi sheet detail quotation — hanya lihat (meta, item, total, catatan). */
function QuotationDetailBody({ quote }: { quote: QuotationDTO }) {
  const items = parseQuoteItems(quote.items);
  const hasDiscount = quote.discountPct > 0 || quote.discountAmount > 0;
  return (
    <div className="mt-4 space-y-5 px-4 pb-8">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={`border-transparent px-1.5 ${quoteStatus(quote.status).cls}`}>
          {quoteStatus(quote.status).label}
        </Badge>
        <span className="text-sm font-bold tabular-nums text-zinc-900">{formatCurrencyFull(quote.total, quote.currency)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-zinc-500">Dibuat</p>
          <p className="mt-0.5 text-zinc-800">{formatDateTime(quote.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Dikirim</p>
          <p className="mt-0.5 text-zinc-800">{quote.sentAt ? formatDateTime(quote.sentAt) : "-"}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Berlaku s.d.</p>
          <p className="mt-0.5 text-zinc-800">{formatDate(quote.validUntil)}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Peluang</p>
          <p className="mt-0.5 truncate text-zinc-800">{quote.opportunity?.title ?? "-"}</p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Rincian Item ({items.length})
        </p>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400">
            Tidak ada item pada quotation ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-zinc-400">
                  <th scope="col" className="py-1.5 pr-2 font-medium">Item</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">Qty</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">Harga</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((it, idx) => (
                  <tr key={idx} className="align-top">
                    <td className="py-2 pr-2 text-zinc-800">{it.description ?? "-"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-zinc-600">{it.qty ?? 0}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-zinc-600">{formatCurrencyFull(it.unitPrice, quote.currency)}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-zinc-900">{formatCurrencyFull(it.subtotal, quote.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="space-y-1.5 border-t border-zinc-100 pt-3 text-sm">
        <div className="flex items-center justify-between gap-2 text-zinc-600">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatCurrencyFull(quote.subtotal, quote.currency)}</span>
        </div>
        {hasDiscount ? (
          <div className="flex items-center justify-between gap-2 text-zinc-600">
            <span>Diskon{quote.discountPct > 0 ? ` ${quote.discountPct}%` : ""}</span>
            <span className="tabular-nums text-emerald-600">-{formatCurrencyFull(quote.discountAmount, quote.currency)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-zinc-600">
          <span>PPN {quote.taxPct}%</span>
          <span className="tabular-nums">{formatCurrencyFull(quote.taxAmount, quote.currency)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-base font-bold text-zinc-900">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrencyFull(quote.total, quote.currency)}</span>
        </div>
      </div>
      {quote.notes ? (
        <blockquote className="border-l-2 border-zinc-200 pl-3 text-xs italic text-zinc-500">{quote.notes}</blockquote>
      ) : null}
    </div>
  );
}

// ============ Staf: Akses Klien — Secure Link (Task 23-c) ============

/** Batas ukuran file dokumen klien — sama dengan validasi API (1.2 MB). */
const MAX_PORTAL_FILE_BYTES = 1.2 * 1024 * 1024;

const DOC_KIND_META: Record<string, { label: string; icon: LucideIcon; iconCls: string }> = {
  mou: { label: "MoU", icon: FileSignature, iconCls: "bg-emerald-100 text-emerald-700" },
  meeting_note: { label: "Catatan Rapat", icon: CalendarDays, iconCls: "bg-amber-100 text-amber-700" },
  document: { label: "Dokumen", icon: FileText, iconCls: "bg-zinc-100 text-zinc-600" },
};

function docKind(kind: string) {
  return DOC_KIND_META[kind] ?? DOC_KIND_META.document;
}

/** Host dari URL — meta ringkas utk dokumen bertipe tautan. */
function urlHost(raw?: string | null): string {
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

/** Salin teks ke clipboard + toast. Return false bila clipboard gagal (non-secure context). */
async function copyWithToast(value: string, successMsg: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMsg);
    return true;
  } catch {
    toast.info("Gagal menyalin otomatis — salin manual dari layar");
    return false;
  }
}

/** Kotak berisi secure link (mono, truncate) + tombol salin ke clipboard. */
function CopyBox({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 p-2">
      <p className="min-w-0 flex-1 truncate font-mono text-xs text-orange-900" title={value}>{value}</p>
      <Button
        type="button"
        variant="outline"
        className="h-11 shrink-0 border-orange-300 bg-white px-3 text-xs font-medium text-orange-800 hover:bg-orange-100 hover:text-orange-900"
        onClick={async () => {
          const done = await copyWithToast(value, "Secure link disalin — kirim ke klien via WhatsApp/email");
          if (done) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          }
        }}
        aria-label={ariaLabel}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? "Tersalin" : "Salin"}
      </Button>
    </div>
  );
}

/** KARTU 1 — Secure Link Klien: buat token 48-hex, salin URL, cabut/aktifkan/hapus. */
function StaffPortalTokens({ companies, actorName, actorRole }: {
  companies: CompanyRef[];
  actorName: string;
  actorRole: string;
}) {
  const [companyId, setCompanyId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [tokens, setTokens] = useState<PortalTokenDTO[] | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await portalApi.tokens();
      setTokens(res.tokens);
    } catch {
      setTokens([]);
      toast.error("Gagal memuat daftar secure link");
    }
  }, []);

  // Lazy fetch daftar token saat staf membuka seksi ini.
  useEffect(() => {
    let cancelled = false;
    portalApi.tokens()
      .then((res) => { if (!cancelled) setTokens(res.tokens); })
      .catch(() => { if (!cancelled) setTokens([]); });
    return () => { cancelled = true; };
  }, []);

  async function createToken() {
    if (!companyId) {
      toast.error("Pilih perusahaan klien terlebih dahulu");
      return;
    }
    setCreating(true);
    try {
      const res = await portalApi.createToken({
        companyId,
        label: label.trim() || undefined,
        actorName,
        actorRole,
      });
      setNewUrl(`${window.location.origin}/?portal=${res.token.token}`);
      setLabel("");
      toast.success("Secure link dibuat — salin URL di bawah lalu bagikan ke klien");
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat secure link");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(t: PortalTokenDTO) {
    setBusyId(t.id);
    try {
      await portalApi.updateToken(t.id, { active: !t.active, actorName });
      toast.success(t.active ? "Secure link dicabut — URL tidak bisa diakses lagi" : "Secure link diaktifkan kembali");
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah status secure link");
    } finally {
      setBusyId(null);
    }
  }

  async function removeToken(t: PortalTokenDTO) {
    const name = t.label ?? t.company?.name ?? "secure link ini";
    if (!window.confirm(`Hapus secure link "${name}"? URL yang sudah dibagikan akan langsung mati.`)) return;
    setBusyId(t.id);
    try {
      await portalApi.deleteToken(t.id);
      toast.success("Secure link dihapus");
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus secure link");
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = (tokens ?? []).filter((t) => t.active).length;

  return (
    <div className="flex flex-col rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-orange-600" aria-hidden />
          <p className="text-sm font-semibold text-zinc-900">Secure Link Klien</p>
        </div>
        {tokens !== null ? (
          <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-700">
            {activeCount} aktif
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        URL rahasia tanpa login per perusahaan — klien membuka{" "}
        <span className="font-mono text-[11px]">/?portal=&lt;token&gt;</span> dan langsung melihat data perusahaannya.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="h-11 w-full" aria-label="Pilih perusahaan untuk secure link">
            <SelectValue placeholder="Pilih perusahaan…" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="cth. Hendra — PT Nusantara"
          aria-label="Label secure link (opsional)"
          className="h-11"
        />
      </div>
      <Button
        type="button"
        disabled={creating}
        onClick={() => void createToken()}
        className="mt-3 h-11 bg-orange-600 text-white hover:bg-orange-700"
        aria-label="Buat secure link baru"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        Buat Secure Link
      </Button>

      {newUrl ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Secure link baru — salin &amp; bagikan
          </p>
          <CopyBox value={newUrl} ariaLabel="Salin secure link yang baru dibuat" />
        </div>
      ) : null}

      <p className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        Daftar Secure Link ({(tokens ?? []).length})
      </p>
      {tokens === null ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : tokens.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-400">
          Belum ada secure link — buat di atas lalu bagikan ke klien.
        </p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll pr-1">
          {tokens.map((t) => {
            const tag = t.label ?? t.company?.name ?? "secure link";
            return (
              <div key={t.id} className="rounded-lg border bg-zinc-50/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{t.label ?? "Tanpa label"}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{t.company?.name ?? "-"}</p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Diakses {t.accessCount}×{t.lastAccessedAt ? ` · terakhir ${timeAgo(t.lastAccessedAt)}` : " · belum pernah"} · dibuat {timeAgo(t.createdAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className={`shrink-0 border-transparent px-1.5 ${t.active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                    {t.active ? "Aktif" : "Dicabut"}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="flex h-11 min-w-0 flex-1 items-center rounded-md border bg-white px-2.5">
                    <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500" title={`/?portal=${t.token}`}>
                      /?portal={t.token}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => void copyWithToast(`${window.location.origin}/?portal=${t.token}`, "Secure link disalin")}
                    aria-label={`Salin secure link ${tag}`}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyId === t.id}
                    onClick={() => void toggleActive(t)}
                    className={`h-11 shrink-0 px-3 text-xs ${t.active ? "border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"}`}
                    aria-label={t.active ? `Cabut secure link ${tag}` : `Aktifkan kembali secure link ${tag}`}
                  >
                    {t.active ? <Ban className="h-3.5 w-3.5" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                    {t.active ? "Cabut" : "Aktifkan"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={busyId === t.id}
                    onClick={() => void removeToken(t)}
                    className="h-11 w-11 shrink-0 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Hapus secure link ${tag}`}
                  >
                    {busyId === t.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type DocKind = "mou" | "meeting_note" | "document";
type DocSource = "link" | "file";
type PickedFile = { fileName: string; fileData: string; mimeType: string; sizeBytes: number };

/** KARTU 2 — Dokumen, MoU & Catatan Rapat: kelola isi secure link per perusahaan. */
function StaffPortalDocuments({ companies, actorName }: {
  companies: CompanyRef[];
  actorName: string;
}) {
  const [companyId, setCompanyId] = useState("");
  const [documents, setDocuments] = useState<ClientDocumentDTO[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form tambah dokumen
  const [kind, setKind] = useState<DocKind>("mou");
  const [source, setSource] = useState<DocSource>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [meetingAt, setMeetingAt] = useState("");
  const [attendees, setAttendees] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (cid: string) => {
    try {
      const res = await portalApi.documents(cid);
      setDocuments(res.documents);
    } catch {
      setDocuments([]);
      toast.error("Gagal memuat daftar dokumen");
    }
  }, []);

  // Fetch dokumen setiap kali perusahaan dipilih.
  useEffect(() => {
    if (!companyId) {
      setDocuments(null);
      return;
    }
    let cancelled = false;
    portalApi.documents(companyId)
      .then((res) => { if (!cancelled) setDocuments(res.documents); })
      .catch(() => { if (!cancelled) setDocuments([]); });
    return () => { cancelled = true; };
  }, [companyId]);

  function resetForm() {
    setKind("mou");
    setSource("link");
    setTitle("");
    setUrl("");
    setContent("");
    setMeetingAt("");
    setAttendees("");
    setFile(null);
  }

  function openDialog() {
    if (!companyId) {
      toast.error("Pilih perusahaan klien terlebih dahulu");
      return;
    }
    resetForm();
    setDialogOpen(true);
  }

  function handleFilePicked(f: File) {
    if (f.size > MAX_PORTAL_FILE_BYTES) {
      toast.error(`Ukuran file ${(f.size / 1024 / 1024).toFixed(2)} MB melebihi batas 1.2 MB — gunakan tautan (mis. Google Drive) untuk file besar`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) {
        toast.error("Gagal membaca file — coba file lain");
        return;
      }
      setFile({
        fileName: f.name,
        fileData: dataUrl,
        mimeType: f.type || "application/octet-stream",
        sizeBytes: f.size,
      });
    };
    reader.onerror = () => toast.error("Gagal membaca file — coba file lain");
    reader.readAsDataURL(f);
  }

  async function submitDocument() {
    if (!companyId) {
      toast.error("Pilih perusahaan klien terlebih dahulu");
      return;
    }
    const t = title.trim();
    if (!t) {
      toast.error("Judul wajib diisi");
      return;
    }

    const payload: Parameters<typeof portalApi.createDocument>[0] = { companyId, kind, title: t, actorName };

    if (kind === "meeting_note") {
      const body = content.trim();
      if (!body) {
        toast.error("Isi catatan rapat wajib diisi");
        return;
      }
      payload.content = body;
      if (meetingAt) payload.meetingAt = meetingAt; // "YYYY-MM-DD"
      if (attendees.trim()) payload.attendees = attendees.trim();
    } else if (source === "link") {
      const u = url.trim();
      if (!u) {
        toast.error("URL tautan wajib diisi");
        return;
      }
      if (!/^https?:\/\//i.test(u)) {
        toast.error("URL harus diawali http:// atau https://");
        return;
      }
      payload.url = u;
      if (content.trim()) payload.content = content.trim();
    } else {
      if (!file) {
        toast.error("Pilih file terlebih dahulu");
        return;
      }
      payload.fileData = file.fileData;
      payload.fileName = file.fileName;
      payload.mimeType = file.mimeType;
      payload.sizeBytes = file.sizeBytes;
      if (content.trim()) payload.content = content.trim();
    }

    setSaving(true);
    try {
      await portalApi.createDocument(payload);
      toast.success("Dokumen ditambahkan — langsung tampil di secure link klien");
      setDialogOpen(false);
      resetForm();
      void reload(companyId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menambahkan dokumen");
    } finally {
      setSaving(false);
    }
  }

  async function removeDocument(d: ClientDocumentDTO) {
    if (!window.confirm(`Hapus "${d.title}"? Dokumen akan hilang dari secure link klien.`)) return;
    setBusyId(d.id);
    try {
      await portalApi.deleteDocument(d.id);
      toast.success("Dokumen dihapus");
      if (companyId) void reload(companyId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus dokumen");
    } finally {
      setBusyId(null);
    }
  }

  const grouped = useMemo(() => {
    const list = documents ?? [];
    const order: DocKind[] = ["mou", "meeting_note", "document"];
    return order
      .map((k) => ({ kind: k, items: list.filter((d) => d.kind === k) }))
      .filter((g) => g.items.length > 0);
  }, [documents]);

  const selectedCompany = companies.find((c) => c.id === companyId);

  return (
    <div className="flex flex-col rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileStack className="h-4 w-4 text-orange-600" aria-hidden />
          <p className="text-sm font-semibold text-zinc-900">Dokumen, MoU &amp; Catatan Rapat</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-3 text-xs font-medium text-orange-700 hover:bg-orange-50 hover:text-orange-800"
          onClick={openDialog}
          aria-label="Tambah dokumen, MoU, atau catatan rapat"
        >
          <Plus className="h-4 w-4" aria-hidden /> Tambah
        </Button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Isi secure link klien — MoU bertautan/file kecil, notulen rapat, dan dokumen pendukung lainnya.
      </p>

      <Select value={companyId} onValueChange={setCompanyId}>
        <SelectTrigger className="mt-3 h-11 w-full" aria-label="Pilih perusahaan untuk mengelola dokumen klien">
          <SelectValue placeholder="Pilih perusahaan…" />
        </SelectTrigger>
        <SelectContent>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="mt-3 min-h-0 flex-1">
        {!companyId ? (
          <p className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-400">
            Pilih perusahaan untuk melihat dokumennya.
          </p>
        ) : documents === null ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        ) : documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-400">
            Belum ada dokumen untuk {selectedCompany?.name ?? "perusahaan ini"} — klik Tambah untuk mengunggah.
          </p>
        ) : (
          <div className="max-h-96 space-y-4 overflow-y-auto crm-scroll pr-1">
            {grouped.map((g) => {
              const meta = docKind(g.kind);
              const KindIcon = meta.icon;
              return (
                <div key={g.kind}>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <KindIcon className="h-3.5 w-3.5" aria-hidden /> {meta.label} ({g.items.length})
                  </p>
                  <div className="space-y-2">
                    {g.items.map((d) => {
                      const dmeta = docKind(d.kind);
                      const DIcon = dmeta.icon;
                      const metaText =
                        d.kind === "meeting_note"
                          ? [d.meetingAt ? formatDate(d.meetingAt) : null, d.attendees ? `Peserta: ${d.attendees}` : null]
                              .filter(Boolean)
                              .join(" · ") || "Catatan rapat"
                          : d.fileName
                            ? [d.fileName, formatSizeKb(d.sizeBytes)].filter(Boolean).join(" · ")
                            : d.url
                              ? urlHost(d.url)
                              : "Teks";
                      return (
                        <div key={d.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-zinc-50/60 p-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${dmeta.iconCls}`} aria-hidden>
                              <DIcon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-zinc-900">{d.title}</p>
                              <p className="truncate text-[11px] text-zinc-500">{metaText}</p>
                              {d.kind === "meeting_note" && d.content ? (
                                <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{d.content}</p>
                              ) : null}
                              <p className="mt-1 text-[11px] text-zinc-400">
                                {timeAgo(d.createdAt)}{d.createdByName ? ` · oleh ${d.createdByName}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {d.url ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-11 w-11"
                                onClick={() => window.open(d.url ?? "", "_blank", "noopener,noreferrer")}
                                aria-label={`Buka tautan dokumen ${d.title}`}
                              >
                                <ExternalLink className="h-4 w-4" aria-hidden />
                              </Button>
                            ) : null}
                            {d.fileData ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-11 w-11"
                                onClick={() => window.open(d.fileData ?? "", "_blank", "noopener,noreferrer")}
                                aria-label={`Unduh file dokumen ${d.title}`}
                              >
                                <ReceiptText className="h-4 w-4" aria-hidden />
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={busyId === d.id}
                              onClick={() => void removeDocument(d)}
                              className="h-11 w-11 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Hapus dokumen ${d.title}`}
                            >
                              {busyId === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialog tambah dokumen — segmented kind + sumber tautan/file */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Dokumen Klien</DialogTitle>
            <DialogDescription>
              {selectedCompany ? selectedCompany.name : "Pilih perusahaan"} — dokumen langsung tampil di secure link klien.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Segmented jenis dokumen */}
            <div className="grid grid-cols-3 gap-2">
              {(["mou", "meeting_note", "document"] as DocKind[]).map((k) => {
                const meta = docKind(k);
                const Icon = meta.icon;
                const on = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={on}
                    aria-label={`Jenis ${meta.label}`}
                    className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${on ? "border-orange-400 bg-orange-50 text-orange-800" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden /> {meta.label}
                  </button>
                );
              })}
            </div>

            {/* Judul (wajib) */}
            <div className="space-y-1.5">
              <label htmlFor="portal-doc-title" className="text-xs font-medium text-zinc-600">
                Judul <span className="text-rose-500">*</span>
              </label>
              <Input
                id="portal-doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === "mou" ? "cth. MoU Kerja Sama Konten 2025" : kind === "meeting_note" ? "cth. Rapat Kickoff Kampani Q3" : "cth. Brosur Produk Terbaru"}
                className="h-11"
              />
            </div>

            {kind !== "meeting_note" ? (
              <>
                {/* Segmented sumber: tautan atau file */}
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "link" as DocSource, label: "Tautan", icon: Link2 },
                    { key: "file" as DocSource, label: "File", icon: Paperclip },
                  ]).map((s) => {
                    const on = source === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setSource(s.key)}
                        aria-pressed={on}
                        aria-label={`Sumber ${s.label}`}
                        className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${on ? "border-orange-400 bg-orange-50 text-orange-800" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}
                      >
                        <s.icon className="h-4 w-4" aria-hidden /> {s.label}
                      </button>
                    );
                  })}
                </div>

                {source === "link" ? (
                  <div className="space-y-1.5">
                    <label htmlFor="portal-doc-url" className="text-xs font-medium text-zinc-600">
                      URL Tautan <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      id="portal-doc-url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://drive.google.com/…"
                      inputMode="url"
                      className="h-11"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-zinc-600">File (maks 1.2 MB) <span className="text-rose-500">*</span></p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFilePicked(f);
                        e.target.value = "";
                      }}
                      aria-label="Pilih file untuk diunggah"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Pilih file dari perangkat"
                    >
                      <Paperclip className="h-4 w-4" aria-hidden /> {file ? "Ganti File" : "Pilih File"}
                    </Button>
                    {file ? (
                      <p className="truncate rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">
                        {file.fileName} · {formatSizeKb(file.sizeBytes)} · siap diunggah
                      </p>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="portal-doc-date" className="text-xs font-medium text-zinc-600">Tanggal Rapat</label>
                  <Input
                    id="portal-doc-date"
                    type="date"
                    value={meetingAt}
                    onChange={(e) => setMeetingAt(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="portal-doc-attendees" className="text-xs font-medium text-zinc-600">Peserta (dipisah koma)</label>
                  <Input
                    id="portal-doc-attendees"
                    value={attendees}
                    onChange={(e) => setAttendees(e.target.value)}
                    placeholder="cth. Hendra, Rani, Tim Agency"
                    className="h-11"
                  />
                </div>
              </div>
            )}

            {/* Konten: wajib utk catatan rapat, opsional utk lainnya */}
            <div className="space-y-1.5">
              <label htmlFor="portal-doc-content" className="text-xs font-medium text-zinc-600">
                {kind === "meeting_note" ? (
                  <>Isi Catatan <span className="text-rose-500">*</span></>
                ) : (
                  "Konten / Deskripsi (opsional)"
                )}
              </label>
              <Textarea
                id="portal-doc-content"
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={kind === "meeting_note" ? "Poin pembahasan, keputusan, dan tindak lanjut…" : "Catatan singkat untuk klien…"}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => { setDialogOpen(false); resetForm(); }}
              aria-label="Batal tambah dokumen"
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void submitDocument()}
              className="h-11 bg-orange-600 text-white hover:bg-orange-700"
              aria-label="Simpan dokumen"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Simpan Dokumen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ Module utama ============

export default function PortalModule() {
  const user = useCrmStore((s) => s.user);
  const isClient = user?.role === "client";
  const canPreview = user?.role === "super_admin" || user?.role === "director";

  const [companies, setCompanies] = useState<CompanyRef[] | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [linkInfo, setLinkInfo] = useState<{ company: CompanyRef | null; resolved: boolean } | null>(null);

  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDTO[] | null>(null);
  const [changeRequests, setChangeRequests] = useState<ChangeRequestDTO[] | null>(null);
  const [quotations, setQuotations] = useState<QuotationDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<InvoiceDTO | null>(null);
  const [quoteDetail, setQuoteDetail] = useState<QuotationDTO | null>(null);
  const [crDecision, setCrDecision] = useState<{ cr: ChangeRequestDTO; decision: "approve" | "reject" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [savingDecide, setSavingDecide] = useState<string | null>(null);

  /** Untuk role client: cari perusahaan miliknya ( companyName → fallback domain email vs website perusahaan). */
  const resolveClientCompany = useCallback(async (): Promise<CompanyRef | null> => {
    const { companies: list } = await api.companies();
    setCompanies(list);
    const byName = user?.companyName
      ? list.find((c) => c.name.toLowerCase() === user.companyName?.toLowerCase())
      : undefined;
    if (byName) return byName;
    // Fallback demo: cocokkan domain email user dengan domain website perusahaan
    const emailDomain = domainOf(user?.email);
    if (emailDomain) {
      const byDomain = list.find((c) => domainOf(c.website) === emailDomain);
      if (byDomain) return byDomain;
    }
    return null;
  }, [user?.companyName, user?.email]);

  const loadCompanyData = useCallback(async (companyId: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [projRes, invRes, crRes, quoteRes] = await Promise.all([
        api.projects({ companyId }),
        api.invoices({ companyId }),
        api.changeRequests({ companyId }),
        api.quotations({ companyId }),
      ]);
      setProjects(projRes.projects);
      setInvoices(invRes.invoices);
      setChangeRequests(crRes.changeRequests);
      setQuotations(quoteRes.quotations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data portal");
      if (!silent) toast.error("Gagal memuat data portal klien");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (isClient) {
          const company = await resolveClientCompany();
          setLinkInfo({ company, resolved: company !== null });
          if (company) await loadCompanyData(company.id, true);
          else setLoading(false);
        } else if (canPreview) {
          const { companies: list } = await api.companies();
          setCompanies(list);
          // Jangan pilih otomatis — tunggu admin memilih perusahaan
          setLoading(false);
        } else {
          setLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memuat portal");
        setLoading(false);
      }
    })();
  }, [isClient, canPreview, resolveClientCompany, loadCompanyData]);

  const activeCompany = useMemo(() => {
    if (isClient) return linkInfo?.company ?? null;
    return companies?.find((c) => c.id === selectedCompanyId) ?? null;
  }, [isClient, linkInfo, companies, selectedCompanyId]);

  const invoiceSummary = useMemo(() => {
    const list = invoices ?? [];
    const outstanding = list
      .filter((i) => ["sent", "partial", "overdue"].includes(i.status))
      .reduce((s, i) => s + Math.max(0, i.total - (i.payments ?? []).reduce((ps, p) => ps + p.amount, 0)), 0);
    return { count: list.length, outstanding };
  }, [invoices]);

  function pickCompany(id: string) {
    setSelectedCompanyId(id);
    setProjects(null);
    setInvoices(null);
    setChangeRequests(null);
    setQuotations(null);
    setDetail(null);
    setQuoteDetail(null);
    void loadCompanyData(id);
  }

  const canDecide = isClient || canPreview; // client / director / super_admin

  const crSummary = useMemo(() => {
    const list = changeRequests ?? [];
    const approved = list.filter((c) => c.status === "approved");
    return {
      pendingCount: list.filter((c) => c.status === "pending").length,
      approvedCount: approved.length,
      approvedValue: approved.reduce((s, c) => s + (c.additionalCost ?? 0), 0),
    };
  }, [changeRequests]);

  /** Brand unik dari project yang dimuat — strip identitas agency di header konten. */
  const brandStrip = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; count: number }>();
    for (const p of projects ?? []) {
      if (!p.brand) continue;
      const cur = map.get(p.brand.id) ?? { id: p.brand.id, name: p.brand.name, color: p.brand.color, count: 0 };
      cur.count += 1;
      map.set(p.brand.id, cur);
    }
    return [...map.values()];
  }, [projects]);

  async function confirmDecision() {
    const target = crDecision;
    if (!target || !user) return;
    const { cr, decision } = target;
    setSavingDecide(cr.id);
    try {
      const res = await api.decideChangeRequest({
        id: cr.id,
        decision,
        decisionNote: decisionNote.trim() || undefined,
        actorName: user.name,
        actorRole: user.role,
      });
      if (decision === "approve") {
        toast.success(res.invoice?.number ? `Perubahan disetujui — invoice ${res.invoice.number} diterbitkan` : "Perubahan disetujui");
      } else {
        toast.info("Perubahan ditolak — tim kami akan mengikuti scope awal");
      }
      setCrDecision(null);
      setDecisionNote("");
      if (activeCompany) void loadCompanyData(activeCompany.id, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memutuskan permintaan perubahan");
    } finally {
      setSavingDecide(null);
    }
  }

  if (loading && projects === null && !isClient) return <PortalSkeleton />;
  if (loading && isClient && linkInfo === null) return <PortalSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-zinc-900">
            Client Portal
            {!isClient && activeCompany ? (
              <Badge className="border-transparent bg-amber-100 text-amber-700">Mode Pratinjau Klien</Badge>
            ) : null}
          </h1>
          <p className="text-sm text-zinc-500">Tampilan terbatas untuk klien — tanpa data internal</p>
        </div>
        {activeCompany ? (
          <Button variant="outline" size="sm" onClick={() => void loadCompanyData(activeCompany.id)} disabled={loading} aria-label="Muat ulang data portal">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Task 23-c — Akses Klien via secure link TANPA login: token + dokumen (khusus staf) */}
      {canPreview ? (
        <section aria-label="Akses Klien — Secure Link" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <KeyRound className="h-4 w-4 text-orange-600" aria-hidden /> Akses Klien — Secure Link
            </h2>
            <p className="text-xs text-zinc-500">
              Klien tidak perlu login — bagikan URL rahasia berisi MoU, catatan rapat, project, invoice &amp; deliverable.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StaffPortalTokens
              companies={companies ?? []}
              actorName={user?.name ?? "System"}
              actorRole={user?.role ?? "system"}
            />
            <StaffPortalDocuments
              companies={companies ?? []}
              actorName={user?.name ?? "System"}
            />
          </div>
        </section>
      ) : null}

      {/* Role client: penanganan akun belum terkait */}
      {isClient && linkInfo && !linkInfo.company ? (
        <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <Lock className="mx-auto h-8 w-8 text-zinc-300" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-zinc-900">Akun belum terkait dengan perusahaan</p>
          <p className="mt-1 text-sm text-zinc-500">Hubungi admin untuk mengaitkan akun Anda ke data perusahaan.</p>
        </div>
      ) : null}

      {/* Role lain (bukan client/director/super_admin): tidak punya akses */}
      {!isClient && !canPreview ? (
        <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <Lock className="mx-auto h-8 w-8 text-zinc-300" aria-hidden />
          <p className="mt-3 text-sm text-zinc-500">Modul ini hanya tersedia untuk klien dan manajemen.</p>
        </div>
      ) : null}

      {/* Pemilih perusahaan untuk super_admin/director */}
      {canPreview ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <Select value={selectedCompanyId} onValueChange={pickCompany}>
              <SelectTrigger className="w-full sm:w-[300px]" aria-label="Pilih perusahaan untuk pratinjau portal klien">
                <SelectValue placeholder="Pilih perusahaan klien…" />
              </SelectTrigger>
              <SelectContent>
                {(companies ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-zinc-500 sm:ml-auto">
            {activeCompany ? `Menampilkan portal untuk ${activeCompany.name}` : "Pilih perusahaan untuk melihat tampilan klien"}
          </p>
        </div>
      ) : null}

      {/* Konten portal */}
      {activeCompany ? (
        <>
          {/* Banner info */}
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Anda melihat data perusahaan Anda sendiri. File internal, margin, dan catatan tim tidak ditampilkan.
              {activeCompany.city || activeCompany.country ? (
                <span className="block text-xs text-emerald-700">
                  {activeCompany.industry ?? "-"} · {[activeCompany.city, activeCompany.country].filter(Boolean).join(", ")}
                </span>
              ) : null}
            </p>
          </div>

          {/* Strip brand yang mengerjakan project klien */}
          {brandStrip.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" role="list" aria-label="Brand yang mengerjakan project Anda">
              {brandStrip.map((b) => (
                <span key={b.id} role="listitem" className="flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-xs text-zinc-700">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                  <span className="font-medium">{b.name}</span>
                  <span className="text-zinc-400">· {b.count} project</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* Ringkasan invoice */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Project Aktif</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">
                {(projects ?? []).filter((p) => p.status !== "completed").length}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Invoice</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">{invoiceSummary.count}</p>
            </div>
            <div className="col-span-2 rounded-xl border bg-white p-4 shadow-sm lg:col-span-1">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Sisa Tagihan</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600">{formatCurrency(invoiceSummary.outstanding)}</p>
            </div>
          </div>

          {/* Project perusahaan */}
          <section aria-label="Project perusahaan" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <FolderKanban className="h-4 w-4 text-zinc-400" aria-hidden /> Project Perusahaan
            </h2>
            {projects === null ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-400 shadow-sm">
                Belum ada project untuk perusahaan ini.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {projects.map((p) => <PortalProjectCard key={p.id} project={p} />)}
              </div>
            )}
          </section>

          {/* Deliverable & Review (Task 22-4) — file/tautan dari tim untuk ditinjau klien */}
          <section aria-label="Deliverable dan review" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <PackageCheck className="h-4 w-4 text-zinc-400" aria-hidden /> Deliverable &amp; Review
            </h2>
            <p className="text-xs text-zinc-500">
              File dan tautan yang dikirim tim untuk Anda tinjau — buka tautannya, lalu Setujui atau minta revisi dengan catatan.
            </p>
            {projects === null ? (
              <Skeleton className="h-40 rounded-xl" aria-hidden />
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-400 shadow-sm">
                Belum ada deliverable — belum ada project berjalan untuk perusahaan ini.
              </div>
            ) : (
              <div className="space-y-4">
                {projects.map((p) => (
                  <PortalProjectDeliverables key={p.id} project={p} user={user} canReview={canDecide} />
                ))}
              </div>
            )}
          </section>

          {/* Permintaan Perubahan (Change Request) — persetujuan klien */}
          <section aria-label="Permintaan perubahan scope" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <GitPullRequestArrow className="h-4 w-4 text-zinc-400" aria-hidden /> Permintaan Perubahan (Change Request)
            </h2>
            {(crSummary.pendingCount > 0 || crSummary.approvedCount > 0 || crSummary.approvedValue > 0) ? (
              <div className="flex flex-wrap items-center gap-2">
                {crSummary.pendingCount > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                    {crSummary.pendingCount} menunggu persetujuan
                  </span>
                ) : null}
                {crSummary.approvedCount > 0 ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    {crSummary.approvedCount} disetujui
                  </span>
                ) : null}
                {crSummary.approvedValue > 0 ? (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium tabular-nums text-zinc-600">
                    Total nilai tambah {formatCurrency(crSummary.approvedValue)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {changeRequests === null ? (
              <Skeleton className="h-40 rounded-xl" aria-hidden />
            ) : changeRequests.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-400 shadow-sm">
                Tidak ada permintaan perubahan scope.
              </div>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto crm-scroll pr-1">
                {changeRequests.map((cr) => {
                  const st = crStatus(cr.status);
                  return (
                    <div key={cr.id} className="rounded-xl border bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-semibold text-zinc-900">{cr.number}</p>
                        <Badge variant="outline" className={`border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
                        {cr.project?.code ? (
                          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">{cr.project.code}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-zinc-900">{cr.title}</p>
                      <p className="mt-1 text-xs text-zinc-500">{cr.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                        <span className="font-bold tabular-nums text-emerald-600">+{formatCurrency(cr.additionalCost)}</span>
                        {cr.additionalDays > 0 ? (
                          <span className="flex items-center gap-1 text-zinc-600">
                            <CalendarClock className="h-3.5 w-3.5 text-zinc-400" aria-hidden /> +{cr.additionalDays} hari deadline
                          </span>
                        ) : null}
                        <span className="text-zinc-400">
                          Diajukan {timeAgo(cr.createdAt)}{cr.requestedBy ? ` oleh ${cr.requestedBy}` : ""}
                        </span>
                      </div>
                      {cr.status !== "pending" && cr.decidedBy ? (
                        <div className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
                          <p>Diputuskan oleh {cr.decidedBy}</p>
                          {cr.decisionNote ? <p className="mt-0.5 italic">“{cr.decisionNote}”</p> : null}
                        </div>
                      ) : null}
                      {cr.status === "pending" && canDecide ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="bg-zinc-900 text-white hover:bg-zinc-800"
                            disabled={savingDecide === cr.id}
                            onClick={() => { setDecisionNote(""); setCrDecision({ cr, decision: "approve" }); }}
                            aria-label={`Setujui permintaan perubahan ${cr.number}`}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden /> Setujui Perubahan
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            disabled={savingDecide === cr.id}
                            onClick={() => { setDecisionNote(""); setCrDecision({ cr, decision: "reject" }); }}
                            aria-label={`Tolak permintaan perubahan ${cr.number}`}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden /> Tolak
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Quotation perusahaan */}
          <section aria-label="Quotation perusahaan" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <FileSignature className="h-4 w-4 text-zinc-400" aria-hidden /> Quotation
            </h2>
            {quotations === null ? (
              <Skeleton className="h-40 rounded-xl" aria-hidden />
            ) : quotations.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-400 shadow-sm">
                Belum ada quotation untuk perusahaan ini.
              </div>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto crm-scroll pr-1">
                {quotations.map((q) => {
                  const st = quoteStatus(q.status);
                  return (
                    <div key={q.id} className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-semibold text-zinc-900">{q.number}</p>
                          <Badge variant="outline" className={`border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
                          {q.brand ? (
                            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: q.brand.color }} aria-hidden />
                              {q.brand.name}
                            </span>
                          ) : null}
                        </div>
                        {q.validUntil ? <p className="mt-1 text-xs text-zinc-500">Berlaku s.d. {formatDate(q.validUntil)}</p> : null}
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <p className="text-sm font-bold tabular-nums text-zinc-900">{formatCurrencyFull(q.total, q.currency)}</p>
                        <Button variant="outline" size="sm" onClick={() => setQuoteDetail(q)} aria-label={`Lihat detail quotation ${q.number}`}>
                          <Eye className="h-3.5 w-3.5" aria-hidden /> Lihat
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Invoice perusahaan */}
          <section aria-label="Invoice perusahaan" className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <ReceiptText className="h-4 w-4 text-zinc-400" aria-hidden /> Invoice
            </h2>
            {invoices === null ? (
              <Skeleton className="h-40 rounded-xl" aria-hidden />
            ) : invoices.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-400 shadow-sm">
                Belum ada invoice untuk perusahaan ini.
              </div>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto crm-scroll pr-1">
                {invoices.map((inv) => {
                  const st = invStatus(inv.status);
                  const paid = (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
                  return (
                    <div key={inv.id} className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-semibold text-zinc-900">{inv.number}</p>
                          <Badge variant="outline" className={`border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{inv.description ?? "-"}</p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                          <CalendarDays className="h-3 w-3" aria-hidden /> Jatuh tempo {formatDate(inv.dueDate)}
                          {inv.status !== "paid" ? ` · terbayar ${formatCurrency(paid, inv.currency)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <p className="text-sm font-bold tabular-nums text-zinc-900">{formatCurrencyFull(inv.total, inv.currency)}</p>
                        <Button variant="outline" size="sm" onClick={() => setDetail(inv)} aria-label={`Lihat detail invoice ${inv.number}`}>
                          <Eye className="h-3.5 w-3.5" aria-hidden /> Lihat
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      {/* Sheet detail invoice — khusus lihat saja, tanpa aksi pembayaran */}
      <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <SheetContent className="w-full overflow-y-auto crm-scroll sm:max-w-md">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{detail.number}</SheetTitle>
                <SheetDescription>{detail.company?.name ?? "-"} · {detail.brand?.name ?? "-"}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-5 px-4 pb-8">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={`border-transparent px-1.5 ${invStatus(detail.status).cls}`}>
                    {invStatus(detail.status).label}
                  </Badge>
                  <span className="text-sm font-bold tabular-nums text-zinc-900">{formatCurrencyFull(detail.total, detail.currency)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-zinc-500">Deskripsi</p>
                    <p className="mt-0.5 text-zinc-800">{detail.description ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Proyek</p>
                    <p className="mt-0.5 text-zinc-800">
                      {(projects ?? []).find((p) => p.id === detail.projectId)?.name ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Tanggal Terbit</p>
                    <p className="mt-0.5 text-zinc-800">{formatDate(detail.issueDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Jatuh Tempo</p>
                    <p className="mt-0.5 text-zinc-800">{formatDate(detail.dueDate)}</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Riwayat Pembayaran ({(detail.payments ?? []).length})
                  </p>
                  {(detail.payments ?? []).length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400">
                      Belum ada pembayaran tercatat.
                    </p>
                  ) : (
                    <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll">
                      {(detail.payments ?? []).map((p) => (
                        <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border bg-white p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold tabular-nums text-zinc-900">{formatCurrencyFull(p.amount, detail.currency)}</p>
                            <p className="text-xs text-zinc-500">{p.method}{p.reference ? ` · ${p.reference}` : ""}</p>
                          </div>
                          <span className="whitespace-nowrap text-xs text-zinc-400">{formatDateTime(p.paidAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
                  Pertanyaan tentang invoice ini? Hubungi tim account manager Anda — pembayaran diproses melalui tim keuangan.
                </p>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* AlertDialog keputusan change request (approve / reject) */}
      <AlertDialog
        open={crDecision !== null}
        onOpenChange={(open) => { if (!open) { setCrDecision(null); setDecisionNote(""); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {crDecision?.decision === "approve"
                ? `Setujui ${crDecision.cr.number}?`
                : `Tolak ${crDecision?.cr.number ?? ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  {crDecision?.decision === "approve" ? (
                    <>
                      Menyetujui berarti menambah nilai kontrak sebesar{" "}
                      <span className="font-semibold text-emerald-700">{formatCurrency(crDecision.cr.additionalCost)}</span>{" "}
                      dan memperpanjang deadline {crDecision.cr.additionalDays} hari. Invoice tambahan akan diterbitkan.
                    </>
                  ) : (
                    "Menolak berarti permintaan perubahan ini tidak diterapkan — scope, nilai kontrak, dan deadline tetap mengikuti kesepakatan awal."
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Catatan untuk tim (opsional)…"
            rows={3}
            aria-label="Catatan keputusan (opsional)"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingDecide !== null}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={crDecision?.decision === "approve" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-rose-600 text-white hover:bg-rose-700"}
              disabled={savingDecide !== null}
              onClick={(e) => { e.preventDefault(); void confirmDecision(); }}
            >
              {savingDecide !== null ? "Memproses…" : crDecision?.decision === "approve" ? "Ya, Setujui" : "Ya, Tolak"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sheet detail quotation — khusus lihat saja */}
      <Sheet open={quoteDetail !== null} onOpenChange={(open) => { if (!open) setQuoteDetail(null); }}>
        <SheetContent className="w-full overflow-y-auto crm-scroll sm:max-w-md">
          {quoteDetail ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{quoteDetail.number}</SheetTitle>
                <SheetDescription>
                  {quoteDetail.company?.name ?? "-"} · {quoteDetail.brand?.name ?? "-"}
                </SheetDescription>
              </SheetHeader>
              <QuotationDetailBody quote={quoteDetail} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
