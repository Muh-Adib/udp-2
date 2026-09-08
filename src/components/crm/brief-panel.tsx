"use client";

/**
 * Ronde 18 — Brief Builder (Fase 2): panel brief terstruktur pada detail opportunity.
 *
 * Alur: Brief → Estimasi → Quotation. Brief dibuat/diisi dari katalog layanan brand,
 * diberi skor kelengkapan 9 bagian, lalu melalui status:
 *   draft → in_review (kirim review) → approved | revision → in_review | draft (reopen).
 * Semua aksi menulis audit log di server; panel ini murni menampilkan & memanggil API.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  CircleAlert,
  ClipboardList,
  Link2,
  Loader2,
  MessageSquareQuote,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Target,
  Trash2,
  Undo2,
  Users,
  Wallet,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api, briefsApi } from "@/lib/crm/api-client";
import { BRIEF_STATUS_META, computeBriefCompleteness } from "@/lib/crm/brief";
import { BRAND_SERVICES } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type { BriefDeliverable, BriefReference, BriefStatus, ClientBriefDTO } from "@/lib/crm/types";
import { formatCurrencyFull, formatDate } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ---------- Tipe & helper ----------

interface BriefPanelProps {
  opportunityId: string;
  opportunityTitle: string;
  brandSlug: string;
  brandColor: string;
  /** Sheet detail terbuka — panel fetch hanya saat terbuka. */
  open: boolean;
  /** Laporkan status brief ke parent (untuk dot pada tab trigger). */
  onBriefStatusChange?: (status: BriefStatus | null) => void;
  /** Beri tahu parent bahwa data opportunity berubah (urutan list ikut segar). */
  onChanged?: () => void;
}

interface DeliverableRow {
  name: string;
  qty: string;
}
interface ReferenceRow {
  label: string;
  url: string;
}

function isoToDateInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function parseBudget(v: string): number | null {
  const digits = v.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Label durasi hari antara dua tanggal (inklusif kasar). */
function durationLabel(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const s = start ? new Date(start).getTime() : null;
  const e = end ? new Date(end).getTime() : null;
  if (s && e && e >= s) {
    const days = Math.round((e - s) / 86_400_000);
    return `± ${days} hari kerja kalender`;
  }
  return null;
}

// ---------- Sub-komponen kecil ----------

function SectionCard({
  icon: Ic,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md", className)}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        <Ic className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      {children}
    </div>
  );
}

function SectionText({ value, empty }: { value?: string | null; empty: string }) {
  if (!value || !value.trim()) return <p className="text-sm italic text-zinc-300">{empty}</p>;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{value}</p>;
}

/** Stepper status: Draft → Review → Disetujui (revision ditandai alert terpisah). */
function StatusStepper({ status }: { status: BriefStatus }) {
  const steps = [
    { key: "draft", label: "Draft", icon: ClipboardList },
    { key: "in_review", label: "Review", icon: Send },
    { key: "approved", label: "Disetujui", icon: BadgeCheck },
  ];
  const reachedIdx = status === "approved" ? 2 : status === "in_review" ? 1 : 0;
  return (
    <ol className="flex items-center gap-1.5" aria-label="Status brief">
      {steps.map((s, i) => {
        const active = i <= reachedIdx && (status !== "revision" || i === 0);
        const current = status === "in_review" ? i === 1 : status === "approved" ? i === 2 : i === 0;
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            {i > 0 ? <span className={cn("h-px w-4 sm:w-6", i <= reachedIdx ? "bg-emerald-300" : "bg-zinc-200")} aria-hidden="true" /> : null}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                status === "revision" && i === 0
                  ? "border-red-200 bg-red-50 text-red-600"
                  : active
                    ? current
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-emerald-100 bg-emerald-50/60 text-emerald-600"
                    : "border-zinc-200 bg-white text-zinc-400"
              )}
            >
              <s.icon className="size-3" aria-hidden="true" />
              {s.label}
            </span>
          </li>
        );
      })}
      {status === "revision" ? (
        <li className="ml-1 flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
          <CircleAlert className="size-3" aria-hidden="true" />
          Revisi
        </li>
      ) : null}
    </ol>
  );
}

/** Diagram alur komersial utk empty state: Brief → Estimasi → Quotation. */
function FlowDiagram({ brandColor }: { brandColor: string }) {
  const items = [
    { label: "Brief", icon: ClipboardList, active: true },
    { label: "Estimasi", icon: Wallet, active: false },
    { label: "Quotation", icon: BadgeCheck, active: false },
  ];
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden="true">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-center gap-2">
          {i > 0 ? <ArrowRight className="size-3.5 text-zinc-300" /> : null}
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              it.active ? "border-transparent text-white shadow-sm" : "border-zinc-200 bg-white text-zinc-400"
            )}
            style={it.active ? { backgroundColor: brandColor } : undefined}
          >
            <it.icon className="size-3.5" />
            {it.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Komponen utama ----------

export default function BriefPanel({
  opportunityId,
  opportunityTitle,
  brandSlug,
  brandColor,
  open,
  onBriefStatusChange,
  onChanged,
}: BriefPanelProps) {
  const brands = useCrmStore((s) => s.brands);
  const { user } = useCrmStore();

  const [brief, setBrief] = useState<ClientBriefDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // aksi yang sedang jalan

  // Dialog edit
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    objectives: "",
    targetAudience: "",
    keyMessages: "",
    serviceTypes: [] as string[],
    deliverables: [] as DeliverableRow[],
    references: [] as ReferenceRow[],
    start: "",
    end: "",
    budgetMin: "",
    budgetMax: "",
    attachmentsNote: "",
  });

  // Dialog aksi
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionError, setRevisionError] = useState<string | null>(null);

  // Ronde 40-C — layanan chips dari katalog live DB brand (fallback konstanta statis).
  const [liveServices, setLiveServices] = useState<string[] | null>(null);
  const brandId = useMemo(
    () => brands.find((b) => b.slug === brandSlug)?.id ?? null,
    [brands, brandSlug]
  );

  useEffect(() => {
    if (!brandId) {
      setLiveServices(null);
      return;
    }
    let cancelled = false;
    api.brandServices(brandId)
      .then((res) => {
        if (!cancelled) setLiveServices(res.services.map((s) => s.name));
      })
      .catch(() => {
        if (!cancelled) setLiveServices(null); // gagal → fallback statis
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const catalog = useMemo(() => {
    if (liveServices && liveServices.length > 0) return liveServices;
    return BRAND_SERVICES[brandSlug] ?? [];
  }, [liveServices, brandSlug]);
  const catalogLive = !!liveServices && liveServices.length > 0;

  const load = useCallback(async () => {
    if (!open || !opportunityId) return;
    setLoading(true);
    try {
      const res = await briefsApi.list({ opportunityId });
      const first = res.briefs[0] ?? null;
      setBrief(first);
      onBriefStatusChange?.(first ? first.status : null);
    } catch {
      setBrief(null);
      onBriefStatusChange?.(null);
    } finally {
      setLoading(false);
    }
    // onBriefStatusChange sengaja tidak masuk dep (callback parent stabil via useCallback)
  }, [open, opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(b: ClientBriefDTO) {
    setForm({
      title: b.title,
      objectives: b.objectives ?? "",
      targetAudience: b.targetAudience ?? "",
      keyMessages: b.keyMessages ?? "",
      serviceTypes: [...b.serviceTypes],
      deliverables: b.deliverables.map((d) => ({ name: d.name, qty: String(d.qty) })),
      references: b.references.map((r) => ({ label: r.label, url: r.url })),
      start: isoToDateInput(b.timelineStart),
      end: isoToDateInput(b.timelineEnd),
      budgetMin: b.budgetMin ? String(b.budgetMin) : "",
      budgetMax: b.budgetMax ? String(b.budgetMax) : "",
      attachmentsNote: b.attachmentsNote ?? "",
    });
    setEditOpen(true);
  }

  async function handleCreate() {
    setBusy("create");
    try {
      const res = await briefsApi.create({
        opportunityId,
        title: opportunityTitle,
        actorName: user?.name,
        actorRole: user?.role,
      });
      setBrief(res.brief);
      onBriefStatusChange?.(res.brief.status);
      onChanged?.();
      openEdit(res.brief);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!brief) return;
    setBusy("save");
    try {
      const res = await briefsApi.update(brief.id, {
        action: "save",
        title: form.title,
        objectives: form.objectives || null,
        targetAudience: form.targetAudience || null,
        keyMessages: form.keyMessages || null,
        serviceTypes: form.serviceTypes,
        deliverables: form.deliverables
          .filter((d) => d.name.trim())
          .map<BriefDeliverable>((d) => ({ name: d.name.trim(), qty: Math.max(1, Number(d.qty) || 1) })),
        references: form.references.filter((r) => r.url.trim()).map<BriefReference>((r) => ({ label: r.label.trim() || r.url.trim(), url: r.url.trim() })),
        timelineStart: form.start ? new Date(form.start).toISOString() : null,
        timelineEnd: form.end ? new Date(form.end).toISOString() : null,
        budgetMin: parseBudget(form.budgetMin),
        budgetMax: parseBudget(form.budgetMax),
        attachmentsNote: form.attachmentsNote || null,
        actorName: user?.name,
        actorRole: user?.role,
      });
      setBrief(res.brief);
      onBriefStatusChange?.(res.brief.status);
      setEditOpen(false);
      onChanged?.();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function handleAction(action: "submit" | "approve" | "reopen" | "request_revision", note?: string) {
    if (!brief) return;
    setBusy(action);
    try {
      const res = await briefsApi.update(brief.id, {
        action,
        revisionNote: note,
        actorName: user?.name,
        actorRole: user?.role,
      });
      setBrief(res.brief);
      onBriefStatusChange?.(res.brief.status);
      onChanged?.();
      setRevisionOpen(false);
      setRevisionNote("");
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!brief) return;
    setBusy("delete");
    try {
      await briefsApi.remove(brief.id);
      setBrief(null);
      onBriefStatusChange?.(null);
      onChanged?.();
      setDeleteOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  }

  const completeness = useMemo(
    () =>
      computeBriefCompleteness({
        title: brief?.title ?? "",
        serviceTypes: brief?.serviceTypes ?? [],
        objectives: brief?.objectives,
        targetAudience: brief?.targetAudience,
        keyMessages: brief?.keyMessages,
        deliverables: brief?.deliverables ?? [],
        timelineStart: brief?.timelineStart,
        timelineEnd: brief?.timelineEnd,
        budgetMin: brief?.budgetMin,
        budgetMax: brief?.budgetMax,
        references: brief?.references ?? [],
      }),
    [brief]
  );

  const formCompleteness = useMemo(
    () =>
      computeBriefCompleteness({
        title: form.title,
        serviceTypes: form.serviceTypes,
        objectives: form.objectives,
        targetAudience: form.targetAudience,
        keyMessages: form.keyMessages,
        deliverables: form.deliverables.map((d) => ({ name: d.name, qty: Number(d.qty) || 1 })),
        timelineStart: form.start || null,
        timelineEnd: form.end || null,
        budgetMin: parseBudget(form.budgetMin),
        budgetMax: parseBudget(form.budgetMax),
        references: form.references,
      }),
    [form]
  );

  // ---------- Loading & empty state ----------

  if (loading) {
    return (
      <div className="space-y-3 py-2" aria-busy="true" aria-label="Memuat brief">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-zinc-100" />
        <div className="h-16 animate-pulse rounded-xl bg-zinc-100" />
        <div className="h-40 animate-pulse rounded-xl bg-zinc-100" />
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="py-2">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-10 text-center">
          <div
            className="flex size-12 items-center justify-center rounded-2xl text-white shadow-md"
            style={{ backgroundColor: brandColor }}
            aria-hidden="true"
          >
            <ClipboardList className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-800">Belum ada brief terstruktur</p>
            <p className="max-w-md text-xs leading-relaxed text-zinc-500">
              Susun brief per layanan sebelum estimasi: tujuan kampanye, audiens, deliverables, timeline, dan rentang
              budget. Brief lengkap mempercepat penyusunan estimasi &amp; quotation.
            </p>
          </div>
          <FlowDiagram brandColor={brandColor} />
          <Button
            size="sm"
            className="mt-1 text-white shadow-sm hover:opacity-90"
            style={{ backgroundColor: brandColor }}
            onClick={() => void handleCreate()}
            disabled={busy === "create"}
          >
            {busy === "create" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            Buat Brief
          </Button>
        </div>
      </div>
    );
  }

  const statusMeta = BRIEF_STATUS_META[brief.status] ?? BRIEF_STATUS_META.draft;
  const canEdit = brief.status === "draft" || brief.status === "revision";
  const dur = durationLabel(brief.timelineStart, brief.timelineEnd);

  // ---------- Tampilan brief ----------

  return (
    <div className="space-y-3 py-2">
      {/* Header: kode + status + aksi */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-600">{brief.code}</span>
        <Badge variant="outline" className={statusMeta.badgeCls}>
          {statusMeta.label}
        </Badge>
        <span className="text-xs text-zinc-400">Diperbarui {formatDate(brief.updatedAt)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canEdit ? (
            <>
              <Button size="sm" variant="outline" onClick={() => openEdit(brief)}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
              <Button
                size="sm"
                className="text-white hover:opacity-90"
                style={{ backgroundColor: brandColor }}
                onClick={() => void handleAction("submit")}
                disabled={busy === "submit"}
              >
                {busy === "submit" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
                Kirim Review
              </Button>
              {brief.status === "draft" ? (
                <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Hapus
                </Button>
              ) : null}
            </>
          ) : brief.status === "in_review" ? (
            <>
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => void handleAction("approve")}
                disabled={busy === "approve"}
              >
                {busy === "approve" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <BadgeCheck className="size-3.5" aria-hidden="true" />}
                Setujui
              </Button>
              <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => { setRevisionNote(""); setRevisionError(null); setRevisionOpen(true); }}>
                <CircleAlert className="size-3.5" aria-hidden="true" />
                Minta Revisi
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void handleAction("reopen")} disabled={busy === "reopen"}>
              {busy === "reopen" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="size-3.5" aria-hidden="true" />}
              Buka Ulang
            </Button>
          )}
        </div>
      </div>

      {/* Kelengkapan + stepper */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-3.5 shadow-sm">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Kelengkapan</p>
            <p className={cn("text-sm font-bold", completeness.pct === 100 ? "text-emerald-600" : completeness.pct >= 60 ? "text-amber-600" : "text-zinc-500")}>
              {completeness.pct}%
            </p>
          </div>
          <Progress value={completeness.pct} className="h-2" aria-label={`Kelengkapan brief ${completeness.pct}%`} />
          <p className="mt-1.5 text-xs text-zinc-500">
            {completeness.filled} dari {completeness.total} bagian terisi
            {completeness.missing.length > 0 ? ` — lengkapi: ${completeness.missing.slice(0, 3).join(", ")}` : " — siap direview ✓"}
          </p>
        </div>
        <div className="flex items-center rounded-xl border bg-white p-3.5 shadow-sm">
          <StatusStepper status={brief.status} />
        </div>
      </div>

      {/* Alert revisi */}
      {brief.status === "revision" && brief.revisionNote ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Catatan revisi</p>
            <p className="whitespace-pre-wrap text-red-600/90">{brief.revisionNote}</p>
          </div>
        </div>
      ) : null}

      {/* Isi brief */}
      <div className="grid gap-3 md:grid-cols-2">
        <SectionCard icon={ClipboardList} label="Layanan" className="md:col-span-2">
          {brief.serviceTypes.length === 0 ? (
            <p className="text-sm italic text-zinc-300">Belum ada layanan dipilih</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {brief.serviceTypes.map((s) => (
                <span
                  key={s}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{ borderColor: `${brandColor}55`, backgroundColor: `${brandColor}14`, color: "#3f3f46" }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Target} label="Tujuan Kampanye">
          <SectionText value={brief.objectives} empty="Jelaskan tujuan & target terukur" />
        </SectionCard>

        <SectionCard icon={Users} label="Audiens Sasaran">
          <SectionText value={brief.targetAudience} empty="Siapa yang ingin dijangkau?" />
        </SectionCard>

        <SectionCard icon={MessageSquareQuote} label="Pesan Kunci">
          <SectionText value={brief.keyMessages} empty="Pesan utama yang harus tersampaikan" />
        </SectionCard>

        <SectionCard icon={CalendarRange} label="Timeline">
          {brief.timelineStart || brief.timelineEnd ? (
            <div className="space-y-0.5">
              <p className="text-sm text-zinc-700">
                {formatDate(brief.timelineStart) ?? "—"} <span className="text-zinc-300">→</span> {formatDate(brief.timelineEnd) ?? "—"}
              </p>
              {dur ? <p className="text-xs text-zinc-400">{dur}</p> : null}
            </div>
          ) : (
            <p className="text-sm italic text-zinc-300">Tentukan periode pengerjaan</p>
          )}
        </SectionCard>

        <SectionCard icon={Wallet} label="Rentang Budget" className="md:col-span-2">
          {brief.budgetMin || brief.budgetMax ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-semibold text-zinc-800">
                {brief.budgetMin ? formatCurrencyFull(brief.budgetMin, brief.currency) : "—"}
                <span className="mx-1.5 text-zinc-300">–</span>
                {brief.budgetMax ? formatCurrencyFull(brief.budgetMax, brief.currency) : "—"}
              </p>
              <span className="text-xs text-zinc-400">{brief.currency}</span>
            </div>
          ) : (
            <p className="text-sm italic text-zinc-300">Rentang budget belum diisi</p>
          )}
        </SectionCard>

        <SectionCard icon={Plus} label="Deliverables">
          {brief.deliverables.length === 0 ? (
            <p className="text-sm italic text-zinc-300">Rinci output yang dijanjikan</p>
          ) : (
            <ul className="space-y-1.5">
              {brief.deliverables.map((d, i) => (
                <li key={`${d.name}-${i}`} className="flex items-center gap-2 text-sm">
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                    style={{ backgroundColor: brandColor }}
                    aria-label={`Jumlah ${d.qty}`}
                  >
                    {d.qty}×
                  </span>
                  <span className="truncate text-zinc-700">{d.name}</span>
                  {d.notes ? <span className="ml-auto shrink-0 text-xs text-zinc-400">{d.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard icon={Link2} label="Referensi">
          {brief.references.length === 0 ? (
            <p className="text-sm italic text-zinc-300">Tautan contoh/inspirasi (opsional)</p>
          ) : (
            <ul className="space-y-1">
              {brief.references.map((r, i) => (
                <li key={`${r.url}-${i}`} className="truncate text-sm">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500"
                  >
                    <Link2 className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />
                    <span className="truncate">{r.label || r.url}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {brief.attachmentsNote ? (
          <SectionCard icon={Paperclip} label="Catatan Lampiran" className="md:col-span-2">
            <SectionText value={brief.attachmentsNote} empty="" />
          </SectionCard>
        ) : null}
      </div>

      {/* Jejak status */}
      <p className="text-xs text-zinc-400">
        Dibuat oleh {brief.createdBy ?? "—"} · {formatDate(brief.createdAt)}
        {brief.submittedAt ? ` · dikirim review ${formatDate(brief.submittedAt)}` : ""}
        {brief.approvedBy ? ` · disetujui ${brief.approvedBy} ${formatDate(brief.approvedAt)}` : ""}
      </p>

      {/* ---------- Dialog edit brief ---------- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="size-4" style={{ color: brandColor }} aria-hidden="true" />
              Edit Brief <span className="font-mono text-xs text-zinc-400">{brief.code}</span>
            </DialogTitle>
            <DialogDescription>
              Isi sebanyak mungkin bagian — kelengkapan brief mempercepat estimasi &amp; quotation.
            </DialogDescription>
          </DialogHeader>

          <div className="crm-scroll -mx-1 flex-1 space-y-3.5 overflow-y-auto px-1 py-1">
            <div className="space-y-1">
              <label htmlFor="brief-title" className="text-xs font-medium text-zinc-600">Judul brief</label>
              <Input
                id="brief-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Mis. Brief animasi company profile 2026"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-600">Layanan (pilih salah satu / lebih)</p>
              {catalogLive ? (
                <p className="text-[10px] text-zinc-400">Layanan dari katalog brand</p>
              ) : null}
              {catalog.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {catalog.map((s) => {
                    const active = form.serviceTypes.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            serviceTypes: active ? f.serviceTypes.filter((x) => x !== s) : [...f.serviceTypes, s],
                          }))
                        }
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          active ? "border-transparent text-white shadow-sm" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                        )}
                        style={active ? { backgroundColor: brandColor } : undefined}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs italic text-zinc-400">Katalog layanan brand tidak tersedia</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="brief-audience" className="text-xs font-medium text-zinc-600">Audiens sasaran</label>
                <Input
                  id="brief-audience"
                  value={form.targetAudience}
                  onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value }))}
                  placeholder="Mis. HRD BUMN, usia 30-45"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-600">Timeline pengerjaan</p>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    aria-label="Tanggal mulai"
                    value={form.start}
                    onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                  />
                  <span className="text-zinc-300">→</span>
                  <Input
                    type="date"
                    aria-label="Tanggal selesai"
                    value={form.end}
                    onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="brief-objectives" className="text-xs font-medium text-zinc-600">Tujuan kampanye</label>
              <Textarea
                id="brief-objectives"
                rows={2}
                value={form.objectives}
                onChange={(e) => setForm((f) => ({ ...f, objectives: e.target.value }))}
                placeholder="Tujuan & target terukur (awareness, leads, launch produk…)"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="brief-messages" className="text-xs font-medium text-zinc-600">Pesan kunci</label>
              <Textarea
                id="brief-messages"
                rows={2}
                value={form.keyMessages}
                onChange={(e) => setForm((f) => ({ ...f, keyMessages: e.target.value }))}
                placeholder="Pesan utama yang harus tersampaikan ke audiens"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-600">Deliverables</p>
              <div className="space-y-1.5">
                {form.deliverables.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={d.name}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          deliverables: f.deliverables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        }))
                      }
                      placeholder="Mis. Video animasi 60 detik"
                      aria-label={`Nama deliverable ${i + 1}`}
                    />
                    <Input
                      type="number"
                      min={1}
                      value={d.qty}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          deliverables: f.deliverables.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)),
                        }))
                      }
                      className="w-16 shrink-0"
                      aria-label={`Jumlah deliverable ${i + 1}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Hapus deliverable ${i + 1}`}
                      onClick={() => setForm((f) => ({ ...f, deliverables: f.deliverables.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setForm((f) => ({ ...f, deliverables: [...f.deliverables, { name: "", qty: "1" }] }))}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Tambah deliverable
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="brief-bmin" className="text-xs font-medium text-zinc-600">Budget minimum (IDR)</label>
                <Input
                  id="brief-bmin"
                  inputMode="numeric"
                  value={form.budgetMin}
                  onChange={(e) => setForm((f) => ({ ...f, budgetMin: e.target.value }))}
                  placeholder="Mis. 50000000"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="brief-bmax" className="text-xs font-medium text-zinc-600">Budget maksimum (IDR)</label>
                <Input
                  id="brief-bmax"
                  inputMode="numeric"
                  value={form.budgetMax}
                  onChange={(e) => setForm((f) => ({ ...f, budgetMax: e.target.value }))}
                  placeholder="Mis. 80000000"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-600">Referensi / tautan</p>
              <div className="space-y-1.5">
                {form.references.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={r.label}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          references: f.references.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        }))
                      }
                      placeholder="Label (mis. Contoh style)"
                      className="w-2/5 shrink-0"
                      aria-label={`Label referensi ${i + 1}`}
                    />
                    <Input
                      value={r.url}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          references: f.references.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        }))
                      }
                      placeholder="https://…"
                      aria-label={`URL referensi ${i + 1}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Hapus referensi ${i + 1}`}
                      onClick={() => setForm((f) => ({ ...f, references: f.references.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setForm((f) => ({ ...f, references: [...f.references, { label: "", url: "" }] }))}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Tambah referensi
              </Button>
            </div>

            <div className="space-y-1">
              <label htmlFor="brief-attach" className="text-xs font-medium text-zinc-600">Catatan lampiran (opsional)</label>
              <Input
                id="brief-attach"
                value={form.attachmentsNote}
                onChange={(e) => setForm((f) => ({ ...f, attachmentsNote: e.target.value }))}
                placeholder="Mis. Logo & footage tersedia di Drive — link dikirim via WA"
              />
            </div>
          </div>

          <DialogFooter className="items-center gap-3 border-t pt-3 sm:justify-between">
            <div className="flex flex-1 items-center gap-2">
              <Progress value={formCompleteness.pct} className="h-1.5 w-24 sm:w-32" aria-label="Kelengkapan form" />
              <span className="text-xs text-zinc-500">
                {formCompleteness.pct}%{formCompleteness.missing.length > 0 ? ` · kurang: ${formCompleteness.missing[0]}` : " · lengkap"}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
                Batal
              </Button>
              <Button
                size="sm"
                className="text-white hover:opacity-90"
                style={{ backgroundColor: brandColor }}
                onClick={() => void handleSave()}
                disabled={busy === "save" || !form.title.trim()}
              >
                {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Pencil className="size-4" aria-hidden="true" />}
                Simpan
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Dialog minta revisi ---------- */}
      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Minta revisi brief</DialogTitle>
            <DialogDescription>
              Brief kembali ke status <span className="font-medium text-red-600">Perlu Revisi</span> — owner akan
              diminta memperbaiki sesuai catatan.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={revisionNote}
            onChange={(e) => {
              setRevisionNote(e.target.value);
              setRevisionError(null);
            }}
            placeholder="Tulis catatan revisi (wajib)…"
            aria-label="Catatan revisi"
          />
          {revisionError ? <p className="text-xs text-red-600">{revisionError}</p> : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRevisionOpen(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy === "request_revision"}
              onClick={() => {
                if (!revisionNote.trim()) {
                  setRevisionError("Catatan revisi wajib diisi");
                  return;
                }
                void handleAction("request_revision", revisionNote.trim());
              }}
            >
              {busy === "request_revision" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              Kirim Revisi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Konfirmasi hapus ---------- */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus brief {brief.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Brief berstatus draft dapat dihapus permanen. Tindakan ini tercatat pada audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {busy === "delete" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
