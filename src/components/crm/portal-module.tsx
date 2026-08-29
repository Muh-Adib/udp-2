"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, CalendarDays, CheckCircle2, CircleDotDashed, CircleDashed, Eye, FolderKanban,
  Info, Lock, RefreshCw, ReceiptText, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type { CompanyRef, InvoiceDTO, MilestoneDTO, ProjectDTO } from "@/lib/crm/types";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";

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

const MILESTONE_ICON: Record<string, LucideIcon> = {
  done: CheckCircle2,
  in_progress: CircleDotDashed,
  pending: CircleDashed,
};

function invStatus(s: string) { return INVOICE_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }
function projStatus(s: string) { return PROJECT_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" }; }

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<InvoiceDTO | null>(null);

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
      const [projRes, invRes] = await Promise.all([
        api.projects({ companyId }),
        api.invoices({ companyId }),
      ]);
      setProjects(projRes.projects);
      setInvoices(invRes.invoices);
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
    void loadCompanyData(id);
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
    </div>
  );
}
