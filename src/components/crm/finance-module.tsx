"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CheckCheck, CircleDollarSign, Clock3, FileSignature, FileText,
  HandCoins, Layers, Loader2, Printer, ReceiptText, RefreshCw, Send, Wallet, XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type { Brand, InvoiceDTO, QuotationDTO, QuotationItemDTO } from "@/lib/crm/types";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";
import { QuotationPrintArea } from "@/components/crm/quotation-print";

/** API mengirim relasi project, belum ada di tipe bersama — perluasan lokal defensif. */
export type InvoiceWithProject = InvoiceDTO & { project?: { id: string; name: string } | null };

// ============ Meta ============

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  sent: { label: "Terkirim", cls: "bg-violet-100 text-violet-700" },
  partial: { label: "Sebagian", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Lunas", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Overdue", cls: "bg-rose-100 text-rose-700" },
  cancelled: { label: "Dibatalkan", cls: "border-rose-300 bg-white text-rose-600" },
};

const QUOTATION_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  sent: { label: "Terkirim", cls: "bg-violet-100 text-violet-700" },
  accepted: { label: "Diterima", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Ditolak", cls: "bg-rose-100 text-rose-700" },
  expired: { label: "Kedaluwarsa", cls: "bg-slate-100 text-slate-600" },
};

const PAYMENT_METHODS: { key: string; label: string }[] = [
  { key: "transfer", label: "Transfer Bank" },
  { key: "cash", label: "Tunai" },
  { key: "qris", label: "QRIS" },
  { key: "credit_card", label: "Kartu Kredit" },
];

function statusMeta(s: string) {
  return INVOICE_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" };
}

function quoteStatusMeta(s: string) {
  return QUOTATION_STATUS[s] ?? { label: s, cls: "bg-zinc-100 text-zinc-600" };
}

function paidAmount(inv: InvoiceDTO): number {
  return (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
}

function isPastDue(inv: InvoiceDTO): boolean {
  return inv.status !== "paid" && !!inv.dueDate && new Date(inv.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);
}

function isPastDate(d?: string | null): boolean {
  if (!d) return false;
  return new Date(d).getTime() < new Date().setHours(0, 0, 0, 0);
}

/** Parsing defensif item quotation (API bisa mengirim string JSON). */
function parseQuotationItems(items: string | QuotationItemDTO[]): QuotationItemDTO[] {
  if (Array.isArray(items)) return items;
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? (parsed as QuotationItemDTO[]) : [];
  } catch {
    return [];
  }
}

// ============ Sub-komponen kecil ============

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
      <Icon className="h-3.5 w-3.5" aria-hidden /> {children}
    </p>
  );
}

function AgingCard({ label, value, icon: Icon, borderCls, iconCls, valueCls, hint }: {
  label: string; value: number; icon: LucideIcon; borderCls: string; iconCls: string; valueCls: string; hint: string;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${borderCls}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <span className={`rounded-lg p-2 ${iconCls}`} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueCls}`}>{formatCurrency(value)}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>
    </div>
  );
}

function QuoteStatCard({ label, value, sub, icon: Icon, iconCls, valueCls }: {
  label: string; value: string; sub: string; icon: LucideIcon; iconCls: string; valueCls: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <span className={`rounded-lg p-2 ${iconCls}`} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueCls}`}>{value}</p>
      <p className="mt-1 truncate text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}

function BrandDot({ name, color }: { name?: string | null; color?: string | null }) {
  if (!name) return <span className="text-xs text-zinc-400">-</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? "#a1a1aa" }} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

function InvoiceSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function QuotationSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

// ============ Module utama ============

type QuotationAction = "send" | "accept" | "reject" | "convert_invoice";

export default function FinanceModule() {
  const user = useCrmStore((s) => s.user);
  const storeBrands = useCrmStore((s) => s.brands);
  const pendingFocus = useCrmStore((s) => s.pendingFocus);
  const clearPendingFocus = useCrmStore((s) => s.clearPendingFocus);

  const [activeTab, setActiveTab] = useState("invoice");

  // --- Invoice state ---
  const [invoices, setInvoices] = useState<InvoiceWithProject[] | null>(null);
  const [aging, setAging] = useState<{ current: number; d30: number; d60: number; d90: number }>({ current: 0, d30: 0, d60: 0, d90: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");

  const [detail, setDetail] = useState<InvoiceWithProject | null>(null);
  const [payTarget, setPayTarget] = useState<InvoiceWithProject | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "transfer", reference: "" });
  const [paying, setPaying] = useState(false);
  const [sendTarget, setSendTarget] = useState<InvoiceWithProject | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceWithProject | null>(null);
  const [invBusy, setInvBusy] = useState(false);

  // --- Quotation state ---
  const [quotations, setQuotations] = useState<QuotationDTO[] | null>(null);
  const [quotationsLoading, setQuotationsLoading] = useState(false);
  const [quotationsError, setQuotationsError] = useState<string | null>(null);
  const [quoteDetail, setQuoteDetail] = useState<QuotationDTO | null>(null);
  const [quoteBusyId, setQuoteBusyId] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<QuotationDTO | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.invoices({
        status: statusFilter !== "all" ? statusFilter : undefined,
        brandId: brandFilter !== "all" ? brandFilter : undefined,
      });
      setInvoices(res.invoices as InvoiceWithProject[]);
      setAging(res.aging);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat invoice");
      if (!silent) toast.error("Gagal memuat data invoice");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, brandFilter]);

  useEffect(() => { void load(); }, [load]);

  // Global search (ronde 26) — buka sheet detail invoice hasil pencarian (⌘K).
  // Bila daftar belum termuat (null), pendingFocus dipertahankan — effect berjalan lagi
  // saat data tiba; sudah termuat tapi id tak ketemu → cukup pindah modul (clear).
  useEffect(() => {
    if (!pendingFocus || pendingFocus.module !== "finance") return;
    if (!invoices) return; // menunggu load pertama selesai
    const target = invoices.find((i) => i.id === pendingFocus.id);
    if (target) setDetail(target);
    clearPendingFocus();
  }, [pendingFocus, invoices, clearPendingFocus]);

  /** Quotation dimuat lazy saat tab Quotation pertama dibuka; refetch saat brand filter berubah. */
  const loadQuotations = useCallback(async () => {
    setQuotationsLoading(true);
    setQuotationsError(null);
    try {
      const res = await api.quotations({ brandId: brandFilter !== "all" ? brandFilter : undefined });
      setQuotations(res.quotations);
    } catch (err) {
      setQuotationsError(err instanceof Error ? err.message : "Gagal memuat quotation");
    } finally {
      setQuotationsLoading(false);
    }
  }, [brandFilter]);

  useEffect(() => {
    if (activeTab === "quotation") void loadQuotations();
  }, [activeTab, loadQuotations]);

  // Cetak quotation: render #print-area lalu panggil window.print, bersihkan setelah print selesai.
  useEffect(() => {
    if (!printTarget) return;
    const timer = setTimeout(() => window.print(), 100);
    const after = () => setPrintTarget(null);
    window.addEventListener("afterprint", after);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", after);
    };
  }, [printTarget]);

  const summary = useMemo(() => {
    const list = invoices ?? [];
    let totalInvoiced = 0;
    let totalPaid = 0;
    let outstanding = 0;
    let cancelledCount = 0;
    // Ronde 41 — mata uang ringkasan: bila semua invoice terlihat SATU mata uang, pakai itu;
    // bila campuran, tetap dijumlahkan tapi label tanda "campuran" (format default IDR).
    const currencies = new Set<string>();
    for (const inv of list) {
      if (inv.status === "cancelled") {
        cancelledCount += 1;
        continue; // invoice dibatalkan tidak dihitung ke total invoiced
      }
      currencies.add(inv.currency || "IDR");
      totalInvoiced += inv.total;
      totalPaid += paidAmount(inv);
      if (["sent", "partial", "overdue"].includes(inv.status)) {
        outstanding += Math.max(0, inv.total - paidAmount(inv));
      }
    }
    const summaryCurrency = currencies.size === 1 ? [...currencies][0] : "IDR";
    return { totalInvoiced, totalPaid, outstanding, cancelledCount, summaryCurrency, mixedCurrency: currencies.size > 1 };
  }, [invoices]);

  const quoteStats = useMemo(() => {
    const list = quotations ?? [];
    let totalValue = 0;
    let sentCount = 0;
    let sentValue = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;
    let attentionCount = 0;
    for (const q of list) {
      totalValue += q.total;
      if (q.status === "sent") {
        sentCount += 1;
        sentValue += q.total;
        if (isPastDate(q.validUntil)) attentionCount += 1;
      }
      if (q.status === "accepted") acceptedCount += 1;
      if (q.status === "rejected") rejectedCount += 1;
    }
    const decided = acceptedCount + rejectedCount;
    const winRate = decided > 0 ? Math.round((acceptedCount / decided) * 100) : null;
    return { count: list.length, totalValue, sentCount, sentValue, acceptedCount, winRate, attentionCount };
  }, [quotations]);

  function openPayment(inv: InvoiceWithProject) {
    setPayTarget(inv);
    setPayForm({ amount: String(Math.max(0, inv.total - paidAmount(inv))), method: "transfer", reference: "" });
  }

  async function submitPayment(e: React.FormEvent) {
    e?.preventDefault();
    if (!payTarget) return;
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal pembayaran tidak valid");
      return;
    }
    // Ronde 36 (audit FIX): blokir kelebihan bayar (fat-finger nol ekstra bisa
    // langsung menutup invoice Rp jutaan sbg "paid"). Sisa tagihan = total - terbayar.
    const outstanding = Math.max(0, payTarget.total - paidAmount(payTarget));
    if (amount > outstanding) {
      toast.error(
        `Nominal melebihi sisa tagihan (sisa: ${formatCurrencyFull(outstanding, payTarget.currency)}). Catat pembayaran bertahap atau sesuaikan nominal.`,
      );
      return;
    }
    setPaying(true);
    try {
      const res = await api.addPayment({
        invoiceId: payTarget.id,
        amount,
        method: payForm.method,
        reference: payForm.reference.trim() || undefined,
        actorName: user?.name ?? "System",
      });
      toast.success(`Pembayaran ${formatCurrencyFull(amount, payTarget.currency)} dicatat`);
      setInvoices((prev) => (prev ?? []).map((inv) => (inv.id === res.invoice.id ? (res.invoice as InvoiceWithProject) : inv)));
      setPayTarget(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setPaying(false);
    }
  }

  async function confirmSendInvoice() {
    if (!sendTarget) return;
    setInvBusy(true);
    try {
      const res = await api.invoiceAction({
        invoiceId: sendTarget.id,
        action: "send_invoice",
        actorName: user?.name ?? "finance",
        actorRole: user?.role ?? "finance",
      });
      toast.success(`Invoice ${res.invoice.number} terkirim`);
      setInvoices((prev) => (prev ?? []).map((inv) => (inv.id === res.invoice.id ? (res.invoice as InvoiceWithProject) : inv)));
      setSendTarget(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim invoice");
    } finally {
      setInvBusy(false);
    }
  }

  async function confirmCancelInvoice() {
    if (!cancelTarget) return;
    setInvBusy(true);
    try {
      const res = await api.invoiceAction({
        invoiceId: cancelTarget.id,
        action: "cancel_invoice",
        actorName: user?.name ?? "finance",
        actorRole: user?.role ?? "finance",
      });
      toast.success(`Invoice ${res.invoice.number} dibatalkan`);
      setInvoices((prev) => (prev ?? []).map((inv) => (inv.id === res.invoice.id ? (res.invoice as InvoiceWithProject) : inv)));
      setCancelTarget(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membatalkan invoice");
    } finally {
      setInvBusy(false);
    }
  }

  async function runQuotationAction(q: QuotationDTO, action: QuotationAction) {
    setQuoteBusyId(q.id);
    try {
      const res = await api.quotationAction(q.id, {
        action,
        actorName: user?.name ?? "System",
        actorRole: user?.role ?? "finance",
      });
      if (action === "send") toast.success(`Quotation ${q.number} dikirim ke klien`);
      else if (action === "accept") toast.success(`Quotation ${q.number} diterima — stage jadi Verbal Agreement`);
      else if (action === "reject") toast.success(`Quotation ${q.number} ditandai ditolak klien`);
      else if (action === "convert_invoice" && res.invoice) toast.success(`Invoice ${res.invoice.number} dibuat`);
      // Sinkronkan state list + sheet detail tanpa menutup apa pun, lalu refresh invoice (aging bisa berubah).
      const fresh = res.quotation ?? null;
      setQuotations((prev) => (prev ?? []).map((x) => (x.id === q.id ? (fresh ?? x) : x)));
      if (fresh && quoteDetail?.id === fresh.id) setQuoteDetail(fresh);
      await Promise.all([loadQuotations(), load(true)]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aksi quotation gagal");
    } finally {
      setQuoteBusyId(null);
    }
  }

  if (loading && invoices === null) return <InvoiceSkeleton />;

  const detailPaid = detail ? paidAmount(detail) : 0;
  const detailPct = detail && detail.total > 0 ? Math.min(100, Math.round((detailPaid / detail.total) * 100)) : 0;

  const qDetailItems = quoteDetail ? parseQuotationItems(quoteDetail.items) : [];
  const printBrand: Brand | null = printTarget
    ? printTarget.brand ?? storeBrands.find((b) => b.id === printTarget.brandId) ?? null
    : null;

  return (
    <div className="space-y-6">
      {/* Area cetak quotation (hanya tampil saat window.print) */}
      {printTarget ? <QuotationPrintArea quotation={printTarget} brand={printBrand} /> : null}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Finance</h1>
          <p className="text-sm text-zinc-500">Invoice, pembayaran, quotation, dan aging receivable</p>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => { if (activeTab === "quotation") void loadQuotations(); else void load(); }}
          disabled={loading || quotationsLoading}
          aria-label="Muat ulang data finance"
        >
          <RefreshCw className={`h-4 w-4 ${loading || quotationsLoading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList aria-label="Navigasi finance">
          <TabsTrigger value="invoice" className="gap-1.5">
            <ReceiptText className="h-4 w-4" aria-hidden /> Invoice
          </TabsTrigger>
          <TabsTrigger value="quotation" className="gap-1.5">
            <FileSignature className="h-4 w-4" aria-hidden /> Quotation
          </TabsTrigger>
        </TabsList>

        {/* ================= TAB INVOICE ================= */}
        <TabsContent value="invoice" className="mt-6 space-y-6">
          {/* A. Aging receivable */}
          <section className="space-y-3">
            <SectionTitle icon={Clock3}>Aging Receivable</SectionTitle>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <AgingCard label="Belum Jatuh Tempo" value={aging.current} icon={Clock3} borderCls="border-emerald-200" iconCls="bg-emerald-100 text-emerald-600" valueCls="text-emerald-700" hint="Sisa tagihan belum due" />
              <AgingCard label="1–30 Hari" value={aging.d30} icon={CalendarDays} borderCls="border-amber-200" iconCls="bg-amber-100 text-amber-600" valueCls="text-amber-700" hint="Terlambat 1–30 hari" />
              <AgingCard label="31–60 Hari" value={aging.d60} icon={ReceiptText} borderCls="border-orange-200" iconCls="bg-orange-100 text-orange-600" valueCls="text-orange-700" hint="Terlambat 31–60 hari" />
              <AgingCard label="> 60 Hari" value={aging.d90} icon={CircleDollarSign} borderCls="border-rose-200" iconCls="bg-rose-100 text-rose-600" valueCls="text-rose-600" hint="Terlambat lebih dari 60 hari" />
            </div>
          </section>

          {/* B. Filter */}
          <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter status invoice">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Terkirim</SelectItem>
                <SelectItem value="partial">Sebagian</SelectItem>
                <SelectItem value="paid">Lunas</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Dibatalkan</SelectItem>
              </SelectContent>
            </Select>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filter brand invoice">
                <SelectValue placeholder="Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Brand</SelectItem>
                {storeBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-zinc-500 sm:ml-auto">{invoices?.length ?? 0} invoice</span>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          ) : null}

          {/* C. Tabel invoice */}
          <section className="space-y-3">
            <SectionTitle icon={ReceiptText}>Daftar Invoice</SectionTitle>
            <div className="rounded-xl border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Number</TableHead>
                      <TableHead>Perusahaan</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(invoices ?? []).map((inv) => {
                      const st = statusMeta(inv.status);
                      const pastDue = isPastDue(inv);
                      const invPct = inv.total > 0 ? Math.min(100, Math.round((paidAmount(inv) / inv.total) * 100)) : 0;
                      const canSend = inv.status === "draft";
                      const canCancel = inv.status === "draft" || inv.status === "sent" || inv.status === "overdue";
                      return (
                        <TableRow
                          key={inv.id}
                          onClick={() => setDetail(inv)}
                          className={`cursor-pointer ${inv.status === "overdue" ? "bg-rose-50/40" : ""}`}
                          aria-label={`Lihat detail invoice ${inv.number}`}
                        >
                          <TableCell className="font-mono text-sm font-semibold text-zinc-900">{inv.number}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-sm">{inv.company?.name ?? "-"}</TableCell>
                          <TableCell><BrandDot name={inv.brand?.name} color={inv.brand?.color} /></TableCell>
                          <TableCell className="max-w-[220px]">
                            <span className="block truncate text-xs text-zinc-600" title={inv.description ?? undefined}>
                              {inv.description ?? "-"}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm font-medium tabular-nums">
                            {formatCurrencyFull(inv.total, inv.currency)}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge variant="outline" className={`border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
                              {inv.status === "partial" ? (
                                <Progress
                                  value={invPct}
                                  className="h-1.5 w-10"
                                  aria-label={`Terbayar ${invPct}% dari total`}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className={`whitespace-nowrap text-sm ${pastDue ? "font-medium text-rose-600" : "text-zinc-600"}`}>
                            {formatDate(inv.dueDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {canSend ? (
                                <Button
                                  variant="outline" size="sm"
                                  className="border-amber-200 text-amber-700 hover:bg-amber-50"
                                  disabled={invBusy}
                                  onClick={(e) => { e.stopPropagation(); setSendTarget(inv); }}
                                  aria-label={`Kirim invoice ${inv.number}`}
                                >
                                  <Send className="h-3.5 w-3.5" aria-hidden /> Kirim
                                </Button>
                              ) : null}
                              {canCancel ? (
                                <Button
                                  variant="outline" size="sm"
                                  className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                  disabled={invBusy}
                                  onClick={(e) => { e.stopPropagation(); setCancelTarget(inv); }}
                                  aria-label={`Batalkan invoice ${inv.number}`}
                                >
                                  <XCircle className="h-3.5 w-3.5" aria-hidden /> Batalkan
                                </Button>
                              ) : null}
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={inv.status === "paid" || inv.status === "draft" || inv.status === "cancelled"}
                                onClick={(e) => { e.stopPropagation(); openPayment(inv); }}
                                aria-label={`Catat pembayaran untuk invoice ${inv.number}`}
                              >
                                <HandCoins className="h-3.5 w-3.5" aria-hidden /> Catat Pembayaran
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {invoices?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-zinc-400">
                          Tidak ada invoice untuk filter ini.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>

          {/* D. Ringkasan */}
          <section className="space-y-3">
            <SectionTitle icon={Wallet}>Ringkasan</SectionTitle>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <FileText className="h-3.5 w-3.5" aria-hidden /> Total Invoiced
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900">{formatCurrency(summary.totalInvoiced, summary.summaryCurrency)}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {summary.mixedCurrency ? "Total campuran beberapa mata uang" : formatCurrencyFull(summary.totalInvoiced, summary.summaryCurrency)}
                </p>
              </div>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <Wallet className="h-3.5 w-3.5" aria-hidden /> Total Paid
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">{formatCurrency(summary.totalPaid, summary.summaryCurrency)}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {summary.mixedCurrency ? "Total campuran beberapa mata uang" : formatCurrencyFull(summary.totalPaid, summary.summaryCurrency)}
                </p>
              </div>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <ReceiptText className="h-3.5 w-3.5" aria-hidden /> Outstanding
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-rose-600">{formatCurrency(summary.outstanding, summary.summaryCurrency)}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Sisa tagihan belum lunas
                  {summary.cancelledCount > 0 ? ` · ${summary.cancelledCount} invoice dibatalkan` : ""}
                </p>
              </div>
            </div>
          </section>

          {/* Sheet detail invoice */}
          <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
            <SheetContent className="w-full overflow-y-auto crm-scroll sm:max-w-md">
              {detail ? (
                <>
                  <SheetHeader>
                    <SheetTitle className="font-mono">{detail.number}</SheetTitle>
                    <SheetDescription>
                      {detail.company?.name ?? "-"} · {detail.brand?.name ?? "-"}
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 space-y-5 px-4 pb-8">
                    {detail.status === "cancelled" ? (
                      <div role="status" className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                        <XCircle className="h-4 w-4 shrink-0" aria-hidden /> Invoice dibatalkan
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className={`border-transparent px-1.5 ${statusMeta(detail.status).cls}`}>
                        {statusMeta(detail.status).label}
                      </Badge>
                      <span className="text-sm font-bold tabular-nums text-zinc-900">
                        {formatCurrencyFull(detail.total, detail.currency)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-zinc-500">Deskripsi</p>
                        <p className="mt-0.5 text-zinc-800">{detail.description ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Proyek</p>
                        <p className="mt-0.5 text-zinc-800">{detail.project?.name ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Tanggal Terbit</p>
                        <p className="mt-0.5 text-zinc-800">{formatDate(detail.issueDate)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Jatuh Tempo</p>
                        <p className={`mt-0.5 ${isPastDue(detail) ? "font-medium text-rose-600" : "text-zinc-800"}`}>
                          {formatDate(detail.dueDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Subtotal</p>
                        <p className="mt-0.5 tabular-nums text-zinc-800">{formatCurrencyFull(detail.amount, detail.currency)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Pajak ({detail.taxRate}%)</p>
                        <p className="mt-0.5 tabular-nums text-zinc-800">{formatCurrencyFull(detail.taxAmount, detail.currency)}</p>
                      </div>
                    </div>

                    {detail.notes ? (
                      <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">{detail.notes}</div>
                    ) : null}

                    {/* Status pembayaran */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-zinc-500">
                        <span className="font-medium uppercase tracking-wide">Status Pembayaran</span>
                        <span className="tabular-nums">
                          {formatCurrencyFull(detailPaid, detail.currency)} / {formatCurrencyFull(detail.total, detail.currency)} ({detailPct}%)
                        </span>
                      </div>
                      <Progress value={detailPct} aria-label={`Pembayaran ${detailPct}% dari total`} />
                    </div>

                    {/* Riwayat pembayaran */}
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
                                <p className="text-sm font-semibold tabular-nums text-zinc-900">
                                  {formatCurrencyFull(p.amount, detail.currency)}
                                </p>
                                <p className="text-xs text-zinc-500">
                                  {PAYMENT_METHODS.find((m) => m.key === p.method)?.label ?? p.method}
                                  {p.reference ? ` · ${p.reference}` : ""}
                                </p>
                              </div>
                              <span className="whitespace-nowrap text-xs text-zinc-400">{formatDateTime(p.paidAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </SheetContent>
          </Sheet>

          {/* Dialog catat pembayaran */}
          <Dialog open={payTarget !== null} onOpenChange={(open) => { if (!open) setPayTarget(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Catat Pembayaran</DialogTitle>
                <DialogDescription>
                  {payTarget ? `Invoice ${payTarget.number} · sisa tagihan ${formatCurrencyFull(Math.max(0, payTarget.total - paidAmount(payTarget)), payTarget.currency)}` : ""}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitPayment} className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="pay-amount">Nominal *</Label>
                  <Input
                    id="pay-amount" type="number" min={1} step="any" required
                    value={payForm.amount}
                    onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pay-method">Metode</Label>
                  <Select value={payForm.method} onValueChange={(v) => setPayForm((f) => ({ ...f, method: v }))}>
                    <SelectTrigger id="pay-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pay-ref">Referensi</Label>
                  <Input
                    id="pay-ref" value={payForm.reference}
                    onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))}
                    placeholder="Contoh: TRF-BCA-8821"
                  />
                </div>
                <DialogFooter className="mt-2">
                  <Button type="button" variant="outline" onClick={() => setPayTarget(null)}>Batal</Button>
                  <Button type="submit" disabled={paying} aria-label="Simpan pembayaran">
                    {paying ? "Menyimpan…" : "Simpan Pembayaran"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* AlertDialog konfirmasi kirim invoice */}
          <AlertDialog open={sendTarget !== null} onOpenChange={(open) => { if (!open) setSendTarget(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Kirim Invoice</AlertDialogTitle>
                <AlertDialogDescription>
                  Kirim invoice {sendTarget?.number} ke klien? Due date akan diset +14 hari jika kosong.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={invBusy}>Batal</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-amber-600 hover:bg-amber-700"
                  disabled={invBusy}
                  onClick={(e) => { e.preventDefault(); void confirmSendInvoice(); }}
                  aria-label="Konfirmasi kirim invoice"
                >
                  {invBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  Kirim Invoice
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* AlertDialog konfirmasi batalkan invoice */}
          <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Batalkan Invoice</AlertDialogTitle>
                <AlertDialogDescription>
                  Yakin membatalkan invoice {cancelTarget?.number}? Invoice yang sudah dibatalkan tidak bisa digunakan lagi.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={invBusy}>Kembali</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-rose-600 hover:bg-rose-700"
                  disabled={invBusy}
                  onClick={(e) => { e.preventDefault(); void confirmCancelInvoice(); }}
                  aria-label="Konfirmasi batalkan invoice"
                >
                  {invBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
                  Ya, Batalkan
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* ================= TAB QUOTATION ================= */}
        <TabsContent value="quotation" className="mt-6 space-y-6">
          {quotations === null && quotationsLoading ? (
            <QuotationSkeleton />
          ) : quotationsError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
              <p className="text-sm font-medium text-rose-700">{quotationsError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadQuotations()} aria-label="Coba lagi memuat quotation">
                <RefreshCw className="h-4 w-4" aria-hidden /> Coba lagi
              </Button>
            </div>
          ) : (
            <>
              {/* Statistik quotation */}
              <section className="space-y-3">
                <SectionTitle icon={Layers}>Statistik Quotation</SectionTitle>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <QuoteStatCard
                    label="Total Quotation" value={String(quoteStats.count)}
                    sub={formatCurrency(quoteStats.totalValue)}
                    icon={FileSignature} iconCls="bg-zinc-100 text-zinc-600" valueCls="text-zinc-900"
                  />
                  <QuoteStatCard
                    label="Terkirim" value={String(quoteStats.sentCount)}
                    sub={formatCurrency(quoteStats.sentValue)}
                    icon={Send} iconCls="bg-violet-100 text-violet-600" valueCls="text-violet-700"
                  />
                  <QuoteStatCard
                    label="Diterima" value={String(quoteStats.acceptedCount)}
                    sub={quoteStats.winRate !== null ? `Win rate ${quoteStats.winRate}%` : "Win rate -"}
                    icon={CheckCheck} iconCls="bg-emerald-100 text-emerald-600" valueCls="text-emerald-700"
                  />
                  <QuoteStatCard
                    label="Perlu Perhatian" value={String(quoteStats.attentionCount)}
                    sub="Terkirim & masa berlaku lewat"
                    icon={AlertTriangle} iconCls="bg-amber-100 text-amber-600" valueCls="text-amber-700"
                  />
                </div>
              </section>

              {/* Daftar quotation */}
              <section className="space-y-3">
                <SectionTitle icon={FileText}>Daftar Quotation</SectionTitle>
                {quotations !== null && quotations.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
                    <FileSignature className="mx-auto h-8 w-8 text-zinc-300" aria-hidden />
                    <p className="mt-3 text-sm font-medium text-zinc-500">
                      Belum ada quotation — buat dari detail opportunity di Sales Pipeline.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-white shadow-sm">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>Number</TableHead>
                            <TableHead>Perusahaan</TableHead>
                            <TableHead>Brand</TableHead>
                            <TableHead>Opportunity</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Berlaku s.d.</TableHead>
                            <TableHead className="text-right">Aksi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(quotations ?? []).map((q) => {
                            const qm = quoteStatusMeta(q.status);
                            const qExpired = q.status === "sent" && isPastDate(q.validUntil);
                            return (
                              <TableRow
                                key={q.id}
                                onClick={() => setQuoteDetail(q)}
                                className="cursor-pointer"
                                aria-label={`Lihat detail quotation ${q.number}`}
                              >
                                <TableCell className="font-mono text-sm font-semibold text-zinc-900">{q.number}</TableCell>
                                <TableCell className="max-w-[160px] truncate text-sm">{q.company?.name ?? "-"}</TableCell>
                                <TableCell><BrandDot name={q.brand?.name} color={q.brand?.color} /></TableCell>
                                <TableCell className="max-w-[200px]">
                                  <span className="block truncate text-xs text-zinc-600" title={q.opportunity?.title ?? undefined}>
                                    {q.opportunity?.title ?? "-"}
                                  </span>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right text-sm font-medium tabular-nums">
                                  {formatCurrencyFull(q.total, q.currency)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`border-transparent px-1.5 ${qm.cls}`}>{qm.label}</Badge>
                                </TableCell>
                                <TableCell className={`whitespace-nowrap text-sm ${qExpired ? "font-medium text-rose-600" : "text-zinc-600"}`}>
                                  {formatDate(q.validUntil)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="outline" size="sm"
                                    onClick={(e) => { e.stopPropagation(); setPrintTarget(q); }}
                                    aria-label={`Cetak quotation ${q.number}`}
                                  >
                                    <Printer className="h-3.5 w-3.5" aria-hidden /> Cetak
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* Sheet detail quotation */}
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
                  <div className="mt-4 space-y-5 px-4 pb-8">
                    {/* Strip warna brand */}
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ backgroundColor: quoteDetail.brand?.color ?? "#a1a1aa" }}
                      aria-hidden
                    />

                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className={`border-transparent px-1.5 ${quoteStatusMeta(quoteDetail.status).cls}`}>
                        {quoteStatusMeta(quoteDetail.status).label}
                      </Badge>
                      <span className="text-sm font-bold tabular-nums text-zinc-900">
                        {formatCurrencyFull(quoteDetail.total, quoteDetail.currency)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-zinc-500">Dibuat</p>
                        <p className="mt-0.5 text-zinc-800">{formatDate(quoteDetail.createdAt)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Dikirim</p>
                        <p className="mt-0.5 text-zinc-800">{quoteDetail.sentAt ? formatDate(quoteDetail.sentAt) : "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Berlaku s.d.</p>
                        <p className={`mt-0.5 ${quoteDetail.status === "sent" && isPastDate(quoteDetail.validUntil) ? "font-medium text-rose-600" : "text-zinc-800"}`}>
                          {formatDate(quoteDetail.validUntil)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Perusahaan</p>
                        <p className="mt-0.5 truncate text-zinc-800">{quoteDetail.company?.name ?? "-"}</p>
                      </div>
                    </div>

                    {/* Item quotation */}
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Item ({qDetailItems.length})
                      </p>
                      {qDetailItems.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-400">
                          Tidak ada item pada quotation ini.
                        </p>
                      ) : (
                        <div className="crm-scroll overflow-x-auto">
                          <table className="w-full min-w-[360px] text-xs">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400">
                                <th scope="col" className="pb-1 font-medium">Deskripsi</th>
                                <th scope="col" className="pb-1 text-right font-medium">Qty</th>
                                <th scope="col" className="pb-1 text-right font-medium">Harga</th>
                                <th scope="col" className="pb-1 text-right font-medium">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {qDetailItems.map((it, idx) => (
                                <tr key={idx} className="border-t border-zinc-200/70">
                                  <td className="py-1 pr-2 text-zinc-700">{it.description}</td>
                                  <td className="py-1 text-right tabular-nums text-zinc-600">{it.qty}</td>
                                  <td className="py-1 text-right tabular-nums text-zinc-600">{formatCurrencyFull(it.unitPrice, quoteDetail.currency)}</td>
                                  <td className="py-1 text-right font-medium tabular-nums text-zinc-800">{formatCurrencyFull(it.subtotal, quoteDetail.currency)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Ringkasan */}
                    <div className="space-y-0.5 border-t border-dashed border-zinc-200 pt-2 text-xs">
                      <div className="flex justify-between text-zinc-500">
                        <span>Subtotal</span>
                        <span className="tabular-nums">{formatCurrencyFull(quoteDetail.subtotal, quoteDetail.currency)}</span>
                      </div>
                      <div className="flex justify-between text-zinc-500">
                        <span>Diskon {quoteDetail.discountPct}%</span>
                        <span className="tabular-nums">-{formatCurrencyFull(quoteDetail.discountAmount, quoteDetail.currency)}</span>
                      </div>
                      <div className="flex justify-between text-zinc-500">
                        <span>PPN {quoteDetail.taxPct}%</span>
                        <span className="tabular-nums">{formatCurrencyFull(quoteDetail.taxAmount, quoteDetail.currency)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-zinc-900">
                        <span>Total</span>
                        <span className="tabular-nums">{formatCurrencyFull(quoteDetail.total, quoteDetail.currency)}</span>
                      </div>
                    </div>

                    {quoteDetail.notes ? (
                      <blockquote className="rounded-lg border-l-4 border-zinc-300 bg-zinc-50 p-3 text-xs italic leading-relaxed text-zinc-600">
                        {quoteDetail.notes}
                      </blockquote>
                    ) : null}

                    {quoteDetail.opportunity ? (
                      <p className="text-xs text-zinc-500">
                        Opportunity: <span className="font-medium text-zinc-700">{quoteDetail.opportunity.title}</span>
                      </p>
                    ) : null}

                    {/* Aksi per status */}
                    {quoteDetail.status === "draft" || quoteDetail.status === "sent" || quoteDetail.status === "accepted" ? (
                      <div className="flex flex-wrap gap-2 border-t pt-4">
                        {quoteDetail.status === "draft" ? (
                          <Button
                            size="sm" className="bg-zinc-900 hover:bg-zinc-800"
                            disabled={quoteBusyId === quoteDetail.id}
                            onClick={() => void runQuotationAction(quoteDetail, "send")}
                            aria-label={`Kirim quotation ${quoteDetail.number} ke klien`}
                          >
                            {quoteBusyId === quoteDetail.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                            Kirim ke Klien
                          </Button>
                        ) : null}
                        {quoteDetail.status === "sent" ? (
                          <>
                            <Button
                              size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                              disabled={quoteBusyId === quoteDetail.id}
                              onClick={() => void runQuotationAction(quoteDetail, "accept")}
                              aria-label={`Tandai quotation ${quoteDetail.number} diterima`}
                            >
                              {quoteBusyId === quoteDetail.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCheck className="h-4 w-4" aria-hidden />}
                              Tandai Diterima
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              disabled={quoteBusyId === quoteDetail.id}
                              onClick={() => void runQuotationAction(quoteDetail, "reject")}
                              aria-label={`Tandai quotation ${quoteDetail.number} ditolak`}
                            >
                              <XCircle className="h-4 w-4" aria-hidden /> Ditolak
                            </Button>
                          </>
                        ) : null}
                        {quoteDetail.status === "accepted" ? (
                          <Button
                            size="sm" className="bg-zinc-900 hover:bg-zinc-800"
                            disabled={quoteBusyId === quoteDetail.id}
                            onClick={() => void runQuotationAction(quoteDetail, "convert_invoice")}
                            aria-label={`Konversi quotation ${quoteDetail.number} ke invoice`}
                          >
                            {quoteBusyId === quoteDetail.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ReceiptText className="h-4 w-4" aria-hidden />}
                            Konversi ke Invoice
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </SheetContent>
          </Sheet>
        </TabsContent>
      </Tabs>
    </div>
  );
}
