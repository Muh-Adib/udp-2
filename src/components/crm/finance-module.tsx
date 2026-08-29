"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CircleDollarSign, Clock3, FileText, HandCoins, ReceiptText,
  RefreshCw, Wallet, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type { InvoiceDTO } from "@/lib/crm/types";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";

/** API mengirim relasi project, belum ada di tipe bersama — perluasan lokal defensif. */
export type InvoiceWithProject = InvoiceDTO & { project?: { id: string; name: string } | null };

// ============ Meta ============

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600" },
  sent: { label: "Terkirim", cls: "bg-violet-100 text-violet-700" },
  partial: { label: "Sebagian", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Lunas", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Overdue", cls: "bg-rose-100 text-rose-700" },
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

function paidAmount(inv: InvoiceDTO): number {
  return (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
}

function isPastDue(inv: InvoiceDTO): boolean {
  return inv.status !== "paid" && !!inv.dueDate && new Date(inv.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);
}

// ============ Sub-komponen kecil ============

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

// ============ Module utama ============

export default function FinanceModule() {
  const user = useCrmStore((s) => s.user);
  const storeBrands = useCrmStore((s) => s.brands);

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

  const summary = useMemo(() => {
    const list = invoices ?? [];
    let totalInvoiced = 0;
    let totalPaid = 0;
    let outstanding = 0;
    for (const inv of list) {
      totalInvoiced += inv.total;
      totalPaid += paidAmount(inv);
      if (["sent", "partial", "overdue"].includes(inv.status)) {
        outstanding += Math.max(0, inv.total - paidAmount(inv));
      }
    }
    return { totalInvoiced, totalPaid, outstanding };
  }, [invoices]);

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
      setInvoices((prev) => (prev ?? []).map((inv) => (inv.id === res.invoice.id ? res.invoice : inv)));
      setPayTarget(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setPaying(false);
    }
  }

  if (loading && invoices === null) return <InvoiceSkeleton />;

  const detailPaid = detail ? paidAmount(detail) : 0;
  const detailPct = detail && detail.total > 0 ? Math.min(100, Math.round((detailPaid / detail.total) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Finance</h1>
          <p className="text-sm text-zinc-500">Invoice, pembayaran, dan aging receivable</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang data invoice">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
        </Button>
      </div>

      {/* A. Aging receivable */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <AgingCard label="Belum Jatuh Tempo" value={aging.current} icon={Clock3} borderCls="border-emerald-200" iconCls="bg-emerald-100 text-emerald-600" valueCls="text-emerald-700" hint="Sisa tagihan belum due" />
        <AgingCard label="1–30 Hari" value={aging.d30} icon={CalendarDays} borderCls="border-amber-200" iconCls="bg-amber-100 text-amber-600" valueCls="text-amber-700" hint="Terlambat 1–30 hari" />
        <AgingCard label="31–60 Hari" value={aging.d60} icon={ReceiptText} borderCls="border-orange-200" iconCls="bg-orange-100 text-orange-600" valueCls="text-orange-700" hint="Terlambat 31–60 hari" />
        <AgingCard label="> 60 Hari" value={aging.d90} icon={CircleDollarSign} borderCls="border-rose-200" iconCls="bg-rose-100 text-rose-600" valueCls="text-rose-600" hint="Terlambat lebih dari 60 hari" />
      </div>

      {/* B. Filter */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter status invoice">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="sent">Terkirim</SelectItem>
            <SelectItem value="partial">Sebagian</SelectItem>
            <SelectItem value="paid">Lunas</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
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
                return (
                  <TableRow
                    key={inv.id}
                    onClick={() => setDetail(inv)}
                    className="cursor-pointer"
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
                      <Badge variant="outline" className={`border-transparent px-1.5 ${st.cls}`}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className={`whitespace-nowrap text-sm ${pastDue ? "font-medium text-rose-600" : "text-zinc-600"}`}>
                      {formatDate(inv.dueDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={inv.status === "paid" || inv.status === "draft"}
                        onClick={(e) => { e.stopPropagation(); openPayment(inv); }}
                        aria-label={`Catat pembayaran untuk invoice ${inv.number}`}
                      >
                        <HandCoins className="h-3.5 w-3.5" aria-hidden /> Catat Pembayaran
                      </Button>
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

      {/* D. Ringkasan */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <FileText className="h-3.5 w-3.5" aria-hidden /> Total Invoiced
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900">{formatCurrency(summary.totalInvoiced)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{formatCurrencyFull(summary.totalInvoiced)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <Wallet className="h-3.5 w-3.5" aria-hidden /> Total Paid
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">{formatCurrency(summary.totalPaid)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{formatCurrencyFull(summary.totalPaid)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <ReceiptText className="h-3.5 w-3.5" aria-hidden /> Outstanding
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-rose-600">{formatCurrency(summary.outstanding)}</p>
          <p className="mt-1 text-[11px] text-zinc-500">Sisa tagihan belum lunas</p>
        </div>
      </div>

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
    </div>
  );
}
