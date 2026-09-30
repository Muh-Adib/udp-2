"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight, Banknote, BookOpen, CalendarRange, Check, ChevronDown, ChevronUp,
  ClipboardList, Coins, Landmark, Plus, ReceiptText, RefreshCw, Scale,
  Send, Trash2, Wallet, X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime, timeAgo } from "@/lib/crm/utils";
import { useCrmStore } from "@/lib/crm/store";
import {
  accountingApi,
  type AccountDTO, type AccountingPeriodDTO, type ExpenseClaimDTO, type ExpenseMeDTO,
  type FinanceSummaryDTO, type FinancialObligationDTO, type JournalEntryDTO,
} from "@/lib/erp/accounting-client";

// ===== Role gates (mirror matriks ModulePermission "accounting") =====
const FINANCE_TEAM = ["finance", "director", "super_admin"];
const WRITE_ROLES = ["finance", "director"];
const CLOSE_ROLES = ["director", "super_admin"];

// ===== Label & warna =====
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: "Aset", liability: "Liabilitas", equity: "Ekuitas", revenue: "Pendapatan", expense: "Beban",
};
const ACCOUNT_TYPE_CLS: Record<string, string> = {
  asset: "bg-emerald-50 text-emerald-700 border-emerald-200",
  liability: "bg-amber-50 text-amber-700 border-amber-200",
  equity: "bg-zinc-100 text-zinc-700 border-zinc-200",
  revenue: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expense: "bg-rose-50 text-rose-700 border-rose-200",
};
const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual", invoice: "Invoice", payment: "Pembayaran", expense: "Reimbursement", payroll: "Payroll",
};
const OBLIGATION_SOURCE_LABEL: Record<string, string> = {
  payroll: "Payroll", expense: "Reimbursement", intern_settlement: "Settlement Magang",
  point_redemption: "Penukaran Poin", travel_settlement: "Settlement Dinas",
};
const OBLIGATION_SOURCE_CLS: Record<string, string> = {
  payroll: "bg-amber-50 text-amber-700 border-amber-200",
  expense: "bg-emerald-50 text-emerald-700 border-emerald-200",
  intern_settlement: "bg-zinc-100 text-zinc-700 border-zinc-200",
  point_redemption: "bg-rose-50 text-rose-700 border-rose-200",
  travel_settlement: "bg-zinc-100 text-zinc-700 border-zinc-200",
};
const CATEGORY_LABEL: Record<string, string> = {
  transport: "Transportasi", meals: "Makan & Minum", accommodation: "Penginapan", material: "Material", other: "Lainnya",
};
const JOURNAL_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  posted: { label: "Posted", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};
const CLAIM_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  submitted: { label: "Diajukan", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  approved: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rejected: { label: "Ditolak", cls: "bg-rose-100 text-rose-700 border-rose-200" },
  paid: { label: "Dibayar", cls: "bg-emerald-600 text-white border-emerald-600" },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ===== Elemen kecil =====

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: typeof BookOpen; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 p-8 text-center">
      <Icon className="h-8 w-8 text-zinc-400" aria-hidden="true" />
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {subtitle ? <p className="text-xs text-zinc-500">{subtitle}</p> : null}
    </div>
  );
}

function JournalStatusBadge({ status }: { status: string }) {
  const meta = JOURNAL_STATUS_META[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-600 border-zinc-200" };
  return <Badge variant="outline" className={`text-[11px] ${meta.cls}`}>{meta.label}</Badge>;
}

function ClaimStatusBadge({ status }: { status: string }) {
  const meta = CLAIM_STATUS_META[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-600 border-zinc-200" };
  return <Badge variant="outline" className={`text-[11px] ${meta.cls}`}>{meta.label}</Badge>;
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-xs text-zinc-400">—</span>;
  return (
    <Badge variant="outline" className="text-[11px] bg-zinc-50 text-zinc-600 border-zinc-200">
      {SOURCE_LABEL[source] ?? source}
    </Badge>
  );
}

function ObligationSourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className={`text-[11px] ${OBLIGATION_SOURCE_CLS[source] ?? "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
      {OBLIGATION_SOURCE_LABEL[source] ?? source}
    </Badge>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className={`text-[11px] ${ACCOUNT_TYPE_CLS[type] ?? "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
      {ACCOUNT_TYPE_LABEL[type] ?? type}
    </Badge>
  );
}

function KpiCard({
  icon: Icon, label, value, badge, onClick,
}: {
  icon: typeof BookOpen; label: string; value: string; badge?: React.ReactNode; onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { onClick, type: "button" as const, "aria-label": label } : {})}
      className={`flex w-full items-center gap-3 rounded-xl border bg-white p-4 text-left shadow-sm ${onClick ? "transition-colors hover:bg-zinc-50" : ""}`}
    >
      <span className="rounded-lg bg-zinc-100 p-2">
        <Icon className="h-4 w-4 text-zinc-700" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="block truncate text-lg font-bold text-zinc-900">{value}</span>
        {badge ? <span className="mt-0.5 inline-flex">{badge}</span> : null}
      </span>
    </Wrapper>
  );
}

// ===== Tab: Jurnal Umum =====

type DraftLine = { accountId: string; debit: string; credit: string };

function JournalFormDialog({
  open, onOpenChange, accounts, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: AccountDTO[];
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ accountId: "", debit: "", credit: "" }]);
  const [saving, setSaving] = useState<"draft" | "post" | null>(null);

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const c = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { d, c, diff: d - c };
  }, [lines]);
  const touched = totals.d > 0 || totals.c > 0;
  const balanced = touched && Math.abs(totals.diff) <= 0.01;
  const activeAccounts = accounts.filter((a) => a.active);

  const setLine = (idx: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const reset = useCallback(() => {
    setDate(todayIso());
    setMemo("");
    setLines([{ accountId: "", debit: "", credit: "" }]);
  }, []);

  const submit = async (postNow: boolean) => {
    if (!memo.trim()) {
      toast.error("Memo jurnal wajib diisi");
      return;
    }
    const payload = lines
      .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
    if (payload.length === 0) {
      toast.error("Isi minimal satu baris: pilih akun + nilai debit atau kredit");
      return;
    }
    const d = payload.reduce((s, l) => s + l.debit, 0);
    const c = payload.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(d - c) > 0.01) {
      toast.error(`Jurnal belum seimbang — debit ${formatCurrency(d)} vs kredit ${formatCurrency(c)}`);
      return;
    }
    setSaving(postNow ? "post" : "draft");
    try {
      await accountingApi.createJournal({ date, memo: memo.trim(), lines: payload, postNow });
      toast.success(postNow ? "Jurnal berhasil diposting" : "Draft jurnal disimpan");
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan jurnal");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Jurnal Umum Baru</DialogTitle>
          <DialogDescription>
            Total debit harus sama dengan total kredit (toleransi Rp 1). Jurnal posted tidak bisa diedit — koreksi dengan jurnal pembalik.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="journal-date">Tanggal</Label>
            <Input id="journal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal-memo">Memo</Label>
            <Input id="journal-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Contoh: Pembelian ATK produksi" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Baris Jurnal</Label>
          <div className="max-h-64 overflow-y-auto crm-scroll rounded-lg border">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_110px_110px_36px] items-center gap-2 border-b p-2 last:border-b-0">
                <Select value={line.accountId || undefined} onValueChange={(v) => setLine(idx, { accountId: v })}>
                  <SelectTrigger size="sm" aria-label={`Akun baris ${idx + 1}`}>
                    <SelectValue placeholder="Pilih akun…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number" min="0" step="any" inputMode="decimal"
                  aria-label={`Debit baris ${idx + 1}`}
                  placeholder="Debit"
                  value={line.debit}
                  onChange={(e) => setLine(idx, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                />
                <Input
                  type="number" min="0" step="any" inputMode="decimal"
                  aria-label={`Kredit baris ${idx + 1}`}
                  placeholder="Kredit"
                  value={line.credit}
                  onChange={(e) => setLine(idx, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                />
                <Button
                  variant="ghost" size="icon" aria-label={`Hapus baris ${idx + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4 text-rose-600" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => setLines((prev) => [...prev, { accountId: "", debit: "", credit: "" }])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah Baris
          </Button>
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm ${balanced ? "bg-emerald-50" : touched ? "bg-rose-50" : "bg-zinc-50"}`}>
          <div className="flex gap-4">
            <span>Debit: <strong className="font-mono">{formatCurrencyFull(totals.d)}</strong></span>
            <span>Kredit: <strong className="font-mono">{formatCurrencyFull(totals.c)}</strong></span>
          </div>
          {balanced ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <Scale className="h-4 w-4" aria-hidden="true" /> Seimbang
            </span>
          ) : touched ? (
            <span className="inline-flex items-center gap-1 font-medium text-rose-700">
              <X className="h-4 w-4" aria-hidden="true" /> Selisih {formatCurrencyFull(Math.abs(totals.diff))}
            </span>
          ) : (
            <span className="text-zinc-400">Belum ada nilai</span>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving !== null}>Batal</Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={saving !== null}>
            {saving === "draft" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ClipboardList className="h-4 w-4" aria-hidden="true" />}
            Simpan Draft
          </Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => submit(true)} disabled={saving !== null || !balanced}>
            {saving === "post" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Posting Langsung
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JournalsTab({
  journals, accounts, canWrite, onChanged,
}: {
  journals: JournalEntryDTO[] | null;
  accounts: AccountDTO[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<JournalEntryDTO | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);

  const filtered = useMemo(() => {
    if (!journals) return null;
    const needle = q.trim().toLowerCase();
    return journals.filter((j) => {
      if (status !== "all" && j.status !== status) return false;
      if (needle && !j.memo.toLowerCase().includes(needle) && !j.createdBy.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [journals, status, q]);

  const post = async (entry: JournalEntryDTO) => {
    setPostingId(entry.id);
    try {
      await accountingApi.postJournal(entry.id);
      toast.success("Jurnal diposting");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memposting jurnal");
    } finally {
      setPostingId(null);
    }
  };

  const reverse = async () => {
    if (!reverseTarget) return;
    setReversing(true);
    try {
      await accountingApi.reverseJournal(reverseTarget.id);
      toast.success("Jurnal pembalik dibuat — entry asli tidak berubah");
      setReverseTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat jurnal pembalik");
    } finally {
      setReversing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]" size="sm" aria-label="Filter status jurnal">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Cari memo / pembuat…" className="w-full sm:w-64" aria-label="Cari jurnal"
          />
        </div>
        {canWrite ? (
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Jurnal Baru
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-white shadow-sm">
        {filtered === null ? (
          <ListSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <div className="p-4"><EmptyState icon={BookOpen} title="Belum ada jurnal" subtitle="Buat jurnal manual atau posting otomatis dari reimbursement." /></div>
        ) : (
          <div className="max-h-96 overflow-y-auto crm-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Kredit</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((j) => {
                  const totalD = j.totalDebit ?? j.lines.reduce((s, l) => s + l.debit, 0);
                  const totalC = j.totalCredit ?? j.lines.reduce((s, l) => s + l.credit, 0);
                  const isOpen = expanded === j.id;
                  return (
                    <Fragment key={j.id}>
                      <TableRow className={isOpen ? "bg-zinc-50/60" : undefined}>
                        <TableCell>
                          <button
                            type="button"
                            aria-label={isOpen ? `Tutup detail ${j.memo}` : `Lihat detail baris ${j.memo}`}
                            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                            onClick={() => setExpanded(isOpen ? null : j.id)}
                          >
                            {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                          </button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{formatDate(j.date)}</TableCell>
                        <TableCell className="max-w-56">
                          <span className="block truncate font-medium" title={j.memo}>{j.memo}</span>
                          <span className="text-xs text-zinc-400">{j.createdBy}</span>
                        </TableCell>
                        <TableCell><SourceBadge source={j.sourceType} /></TableCell>
                        <TableCell><JournalStatusBadge status={j.status} /></TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatCurrencyFull(totalD)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatCurrencyFull(totalC)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {j.status === "draft" && canWrite ? (
                              <Button
                                size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                disabled={postingId === j.id}
                                onClick={() => post(j)}
                                aria-label={`Posting jurnal ${j.memo}`}
                              >
                                {postingId === j.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                                Posting
                              </Button>
                            ) : null}
                            {j.status === "posted" && canWrite ? (
                              <Button
                                size="sm" variant="outline" className="h-8 border-amber-200 text-amber-700 hover:bg-amber-50"
                                onClick={() => setReverseTarget(j)}
                                aria-label={`Balik jurnal ${j.memo}`}
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                                Balik
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isOpen ? (
                        <TableRow key={`${j.id}-detail`} className="bg-zinc-50/60 hover:bg-zinc-50/60">
                          <TableCell colSpan={8} className="px-10 pb-4">
                            <div className="overflow-hidden rounded-lg border bg-white">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Kode</TableHead>
                                    <TableHead>Akun</TableHead>
                                    <TableHead>Tipe</TableHead>
                                    <TableHead className="text-right">Debit</TableHead>
                                    <TableHead className="text-right">Kredit</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {j.lines.map((l) => (
                                    <TableRow key={l.id}>
                                      <TableCell className="font-mono text-xs">{l.account.code}</TableCell>
                                      <TableCell>{l.account.name}</TableCell>
                                      <TableCell><TypeBadge type={l.account.type} /></TableCell>
                                      <TableCell className="text-right font-mono text-xs">{l.debit > 0 ? formatCurrencyFull(l.debit) : "—"}</TableCell>
                                      <TableCell className="text-right font-mono text-xs">{l.credit > 0 ? formatCurrencyFull(l.credit) : "—"}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            {j.postedAt ? (
                              <p className="mt-2 text-xs text-zinc-500">Diposting {formatDateTime(j.postedAt)}</p>
                            ) : (
                              <p className="mt-2 text-xs text-amber-600">Draft — belum diposting ke buku besar.</p>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <JournalFormDialog open={createOpen} onOpenChange={setCreateOpen} accounts={accounts} onSaved={onChanged} />

      <AlertDialog open={reverseTarget !== null} onOpenChange={(v) => !v && setReverseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buat jurnal pembalik?</AlertDialogTitle>
            <AlertDialogDescription>
              Jurnal &ldquo;{reverseTarget?.memo}&rdquo; sudah diposting dan tidak bisa diedit. Sistem akan membuat
              entry pembalik baru (semua debit menjadi kredit dan sebaliknya) berstatus posted. Entry asli tetap tersimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reversing}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={reversing}
              onClick={(e) => { e.preventDefault(); reverse(); }}
            >
              {reversing ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />}
              Ya, Balik Jurnal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== Tab: Pengeluaran (Reimbursement) =====

type DraftItem = { purchaseDate: string; description: string; category: string; amount: string; receiptRef: string };

function ExpenseFormDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { purchaseDate: todayIso(), description: "", category: "transport", amount: "", receiptRef: "" },
  ]);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);

  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const setItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const reset = useCallback(() => {
    setTitle("");
    setItems([{ purchaseDate: todayIso(), description: "", category: "transport", amount: "", receiptRef: "" }]);
  }, []);

  const submit = async (submitNow: boolean) => {
    if (!title.trim()) {
      toast.error("Judul klaim wajib diisi");
      return;
    }
    const payload = items
      .filter((i) => i.description.trim() && (Number(i.amount) || 0) > 0)
      .map((i) => ({ purchaseDate: i.purchaseDate, description: i.description.trim(), category: i.category, amount: Number(i.amount) || 0, receiptRef: i.receiptRef.trim() || undefined }));
    if (payload.length === 0) {
      toast.error("Isi minimal satu item: deskripsi + jumlah lebih dari nol");
      return;
    }
    setSaving(submitNow ? "submit" : "draft");
    try {
      await accountingApi.createExpense({ title: title.trim(), items: payload, submitNow });
      toast.success(submitNow ? "Klaim diajukan — menunggu persetujuan keuangan" : "Draft klaim disimpan");
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan klaim");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Klaim Reimbursement Baru</DialogTitle>
          <DialogDescription>
            Klaim dibuat atas nama Anda. Setelah diajukan, keuangan akan menyetujui lalu membayar — jurnal otomatis terposting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="claim-title">Judul Klaim</Label>
          <Input id="claim-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contoh: Reimbursement kunjungan klien Surabaya" />
        </div>

        <div className="space-y-2">
          <Label>Item Pengeluaran</Label>
          <div className="max-h-72 overflow-y-auto crm-scroll space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 rounded-lg border p-2 sm:grid-cols-[130px_1fr_130px_110px_110px_36px] sm:items-center">
                <Input type="date" value={item.purchaseDate} onChange={(e) => setItem(idx, { purchaseDate: e.target.value })} aria-label={`Tanggal item ${idx + 1}`} />
                <Input value={item.description} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder="Deskripsi" aria-label={`Deskripsi item ${idx + 1}`} />
                <Select value={item.category} onValueChange={(v) => setItem(idx, { category: v })}>
                  <SelectTrigger size="sm" aria-label={`Kategori item ${idx + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number" min="0" step="any" inputMode="decimal"
                  value={item.amount} onChange={(e) => setItem(idx, { amount: e.target.value })}
                  placeholder="Jumlah" aria-label={`Jumlah item ${idx + 1}`}
                />
                <Input value={item.receiptRef} onChange={(e) => setItem(idx, { receiptRef: e.target.value })} placeholder="No. nota" aria-label={`Referensi nota item ${idx + 1}`} />
                <Button
                  variant="ghost" size="icon" aria-label={`Hapus item ${idx + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="h-4 w-4 text-rose-600" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, { purchaseDate: todayIso(), description: "", category: "other", amount: "", receiptRef: "" }])}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah Item
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 text-sm">
          <span className="text-zinc-500">Total klaim</span>
          <strong className="font-mono text-base text-zinc-900">{formatCurrencyFull(total)}</strong>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving !== null}>Batal</Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={saving !== null}>
            {saving === "draft" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ClipboardList className="h-4 w-4" aria-hidden="true" />}
            Simpan Draft
          </Button>
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => submit(true)} disabled={saving !== null}>
            {saving === "submit" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Ajukan Langsung
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClaimCard({
  claim, me, canApprove, canPay, postedSourceIds, onAction,
}: {
  claim: ExpenseClaimDTO;
  me: ExpenseMeDTO;
  canApprove: boolean;
  canPay: boolean;
  postedSourceIds: Set<string>;
  onAction: (claim: ExpenseClaimDTO, action: "submit" | "approve" | "reject" | "pay") => void;
}) {
  const isOwner = !!me && me.id === claim.employeeId;
  const canSubmitNow = claim.status === "draft" && isOwner;
  const canDecide = claim.status === "submitted" && canApprove && !isOwner;
  const canPayNow = claim.status === "approved" && canPay;
  const hasJournal = postedSourceIds.has(claim.id);

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900">{claim.title}</span>
            <ClaimStatusBadge status={claim.status} />
            {hasJournal ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700">
                <BookOpen className="mr-1 h-3 w-3" aria-hidden="true" /> Jurnal terposting
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {claim.employee.preferredName} · {claim.employee.employeeNumber} · diajukan {claim.submittedAt ? formatDateTime(claim.submittedAt) : "—"}
          </p>
        </div>
        <span className="font-mono text-sm font-bold text-zinc-900">{formatCurrencyFull(claim.totalAmount)}</span>
      </div>

      <div className="mt-2 max-h-24 overflow-y-auto crm-scroll space-y-1">
        {claim.items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2 py-1 text-xs">
            <span className="truncate text-zinc-600">
              {formatDate(it.purchaseDate)} · {it.description}
              {it.receiptRef ? <span className="text-zinc-400"> · nota {it.receiptRef}</span> : null}
            </span>
            <span className="whitespace-nowrap">
              <Badge variant="outline" className="mr-1 border-zinc-200 bg-white text-[10px] text-zinc-500">{CATEGORY_LABEL[it.category] ?? it.category}</Badge>
              <span className="font-mono">{formatCurrency(it.amount)}</span>
            </span>
          </div>
        ))}
      </div>

      {claim.decisionNote ? (
        <p className="mt-2 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-500">
          Catatan keputusan ({claim.approvedBy ?? "keuangan"}): {claim.decisionNote}
        </p>
      ) : null}

      {(canSubmitNow || canDecide || canPayNow) ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t pt-3">
          {canSubmitNow ? (
            <Button size="sm" variant="outline" className="border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white" onClick={() => onAction(claim, "submit")} aria-label={`Ajukan klaim ${claim.title}`}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" /> Ajukan
            </Button>
          ) : null}
          {canDecide ? (
            <>
              <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => onAction(claim, "reject")} aria-label={`Tolak klaim ${claim.title}`}>
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Tolak
              </Button>
              <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => onAction(claim, "approve")} aria-label={`Setujui klaim ${claim.title}`}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Setujui
              </Button>
            </>
          ) : null}
          {canPayNow ? (
            <Button size="sm" className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => onAction(claim, "pay")} aria-label={`Tandai dibayar klaim ${claim.title}`}>
              <Banknote className="h-3.5 w-3.5" aria-hidden="true" /> Tandai Dibayar
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ExpensesTab({
  claims, myClaims, me, canApprove, canPay, journals, onChanged,
}: {
  claims: ExpenseClaimDTO[] | null;
  myClaims: ExpenseClaimDTO[] | null;
  me: ExpenseMeDTO;
  canApprove: boolean;
  canPay: boolean;
  journals: JournalEntryDTO[] | null;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decideTarget, setDecideTarget] = useState<{ claim: ExpenseClaimDTO; action: "approve" | "reject" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [payTarget, setPayTarget] = useState<ExpenseClaimDTO | null>(null);
  const [payMethod, setPayMethod] = useState("transfer");
  const [payRef, setPayRef] = useState("");
  const [paying, setPaying] = useState(false);

  const postedSourceIds = useMemo(() => {
    const s = new Set<string>();
    (journals ?? []).forEach((j) => {
      if (j.sourceType === "expense" && j.status === "posted" && j.sourceId) s.add(j.sourceId);
    });
    return s;
  }, [journals]);

  const source = mineOnly ? myClaims : claims;
  const filtered = useMemo(() => {
    if (!source) return null;
    return status === "all" ? source : source.filter((c) => c.status === status);
  }, [source, status]);

  const doAction = async (claim: ExpenseClaimDTO, action: "submit" | "approve" | "reject" | "pay") => {
    if (action === "approve" || action === "reject") {
      setDecisionNote("");
      setDecideTarget({ claim, action });
      return;
    }
    if (action === "pay") {
      setPayMethod("transfer");
      setPayRef("");
      setPayTarget(claim);
      return;
    }
    // submit
    setBusyId(claim.id);
    try {
      await accountingApi.expenseAction(claim.id, { action: "submit" });
      toast.success("Klaim diajukan — menunggu persetujuan keuangan");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengajukan klaim");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDecide = async () => {
    if (!decideTarget) return;
    setDeciding(true);
    try {
      await accountingApi.expenseAction(decideTarget.claim.id, {
        action: decideTarget.action,
        ...(decisionNote.trim() ? { decisionNote: decisionNote.trim() } : {}),
      });
      toast.success(decideTarget.action === "approve" ? "Klaim disetujui" : "Klaim ditolak");
      setDecideTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memutuskan klaim");
    } finally {
      setDeciding(false);
    }
  };

  const confirmPay = async () => {
    if (!payTarget) return;
    setPaying(true);
    try {
      await accountingApi.expenseAction(payTarget.id, {
        action: "pay",
        method: payMethod,
        ...(payRef.trim() ? { bankRef: payRef.trim() } : {}),
      });
      toast.success("Klaim dibayar — kewajiban, pencairan & jurnal otomatis tercatat");
      setPayTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membayar klaim");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]" size="sm" aria-label="Filter status klaim">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Diajukan</SelectItem>
              <SelectItem value="approved">Disetujui</SelectItem>
              <SelectItem value="rejected">Ditolak</SelectItem>
              <SelectItem value="paid">Dibayar</SelectItem>
            </SelectContent>
          </Select>
          {me ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm shadow-sm">
              <input
                type="checkbox" className="accent-zinc-900" checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)} aria-label="Tampilkan hanya klaim saya"
              />
              Hanya klaim saya
            </label>
          ) : null}
        </div>
        {me ? (
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Klaim Baru
          </Button>
        ) : (
          <span className="text-xs text-zinc-400">Akun belum terhubung karyawan — klaim tidak tersedia</span>
        )}
      </div>

      {filtered === null ? (
        <ListSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Belum ada klaim" subtitle="Klaim reimbursement karyawan akan tampil di sini." />
      ) : (
        <div className="max-h-96 space-y-3 overflow-y-auto crm-scroll pr-1">
          {filtered.map((c) => (
            <ClaimCard
              key={c.id} claim={c} me={me} canApprove={canApprove} canPay={canPay}
              postedSourceIds={postedSourceIds} onAction={doAction}
            />
          ))}
        </div>
      )}

      <ExpenseFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={onChanged} />

      {/* Dialog setujui / tolak */}
      <Dialog open={decideTarget !== null} onOpenChange={(v) => !v && setDecideTarget(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{decideTarget?.action === "approve" ? "Setujui Klaim" : "Tolak Klaim"}</DialogTitle>
            <DialogDescription>
              {decideTarget?.claim.title} — {formatCurrencyFull(decideTarget?.claim.totalAmount ?? 0)} a.n. {decideTarget?.claim.employee.preferredName}.
              {decideTarget?.action === "approve" ? " Klaim disetujui dan siap dibayar oleh keuangan." : " Klaim ditolak dan kembali ke pemilik dengan status ditolak."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decision-note">Catatan keputusan (opsional)</Label>
            <Textarea id="decision-note" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Contoh: Nota lengkap, sesuai kebijakan perjalanan dinas." rows={3} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecideTarget(null)} disabled={deciding}>Batal</Button>
            {decideTarget?.action === "approve" ? (
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={confirmDecide} disabled={deciding}>
                <Check className="h-4 w-4" aria-hidden="true" /> Setujui
              </Button>
            ) : (
              <Button className="bg-rose-600 text-white hover:bg-rose-700" onClick={confirmDecide} disabled={deciding}>
                <X className="h-4 w-4" aria-hidden="true" /> Tolak
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog tandai dibayar */}
      <Dialog open={payTarget !== null} onOpenChange={(v) => !v && setPayTarget(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Tandai Dibayar</DialogTitle>
            <DialogDescription>
              {payTarget?.title} — {formatCurrencyFull(payTarget?.totalAmount ?? 0)} a.n. {payTarget?.employee.preferredName}.
              Sistem otomatis mencatat kewajiban, pencairan kas, dan memposting jurnal reimbursement.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Metode</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger aria-label="Metode pembayaran"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">Transfer Bank</SelectItem>
                  <SelectItem value="cash">Kas (Tunai)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Referensi bank (opsional)</Label>
              <Input id="pay-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="No. transaksi / bukti transfer" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayTarget(null)} disabled={paying}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={confirmPay} disabled={paying}>
              {paying ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Banknote className="h-4 w-4" aria-hidden="true" />}
              Konfirmasi Pembayaran
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Tab: Bagan Akun =====

function AccountsTab({
  accounts, canWrite, onChanged,
}: {
  accounts: AccountDTO[] | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!accounts) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((a) => a.code.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle));
  }, [accounts, q]);

  const create = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error("Kode dan nama akun wajib diisi");
      return;
    }
    setSaving(true);
    try {
      await accountingApi.createAccount({ code: code.trim(), name: name.trim(), type });
      toast.success("Akun ditambahkan");
      setCode(""); setName(""); setType("expense");
      setCreateOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menambah akun");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (acc: AccountDTO) => {
    setTogglingId(acc.id);
    try {
      await accountingApi.updateAccount(acc.id, { active: !acc.active });
      toast.success(acc.active ? `Akun ${acc.code} dinonaktifkan` : `Akun ${acc.code} diaktifkan`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah akun");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode / nama akun…" className="w-full sm:w-64" aria-label="Cari akun" />
        {canWrite ? (
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Tambah Akun
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-white shadow-sm">
        {filtered === null ? (
          <ListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <div className="p-4"><EmptyState icon={Landmark} title="Akun tidak ditemukan" /></div>
        ) : (
          <div className="max-h-96 overflow-y-auto crm-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Kode</TableHead>
                  <TableHead>Nama Akun</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead className="text-right">Aktif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs font-semibold">{a.code}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell><TypeBadge type={a.type} /></TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={a.active} disabled={!canWrite || togglingId === a.id}
                        onCheckedChange={() => toggleActive(a)}
                        aria-label={a.active ? `Nonaktifkan akun ${a.code}` : `Aktifkan akun ${a.code}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Tambah Akun</DialogTitle>
            <DialogDescription>Kode akun harus unik. Akun nonaktif tidak bisa dipakai jurnal baru tetapi riwayatnya tetap ada.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="acc-code">Kode</Label>
              <Input id="acc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="5-2200" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipe</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Tipe akun"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="acc-name">Nama Akun</Label>
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Beban Langganan Software" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={create} disabled={saving}>
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Tab: Periode =====

function PeriodsTab({
  periods, currentPeriodName, canCreate, canClose, onChanged,
}: {
  periods: AccountingPeriodDTO[] | null;
  currentPeriodName: string;
  canCreate: boolean;
  canClose: boolean;
  onChanged: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState(currentPeriodName);
  const [saving, setSaving] = useState(false);
  const [closeTarget, setCloseTarget] = useState<AccountingPeriodDTO | null>(null);
  const [closing, setClosing] = useState(false);

  const create = async () => {
    if (!/^\d{4}-\d{2}$/.test(name.trim())) {
      toast.error("Format periode harus YYYY-MM (contoh: 2026-10)");
      return;
    }
    setSaving(true);
    try {
      await accountingApi.createPeriod({ name: name.trim() });
      toast.success(`Periode ${name.trim()} dibuat (open)`);
      setCreateOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat periode");
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (!closeTarget) return;
    setClosing(true);
    try {
      await accountingApi.closePeriod(closeTarget.id);
      toast.success(`Periode ${closeTarget.name} ditutup — posting baru ditolak`);
      setCloseTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menutup periode");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">Periode berjalan: <strong className="font-mono text-zinc-900">{currentPeriodName}</strong></p>
        {canCreate ? (
          <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => { setName(currentPeriodName); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Buat Periode
          </Button>
        ) : null}
      </div>

      {periods === null ? (
        <ListSkeleton rows={3} />
      ) : periods.length === 0 ? (
        <EmptyState icon={CalendarRange} title="Belum ada periode pembukuan" subtitle="Posting jurnal butuh periode open yang mencakup tanggal entry." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {periods.map((p) => {
            const open = p.status === "open";
            return (
              <div key={p.id} className={`rounded-xl border bg-white p-4 shadow-sm ${p.name === currentPeriodName ? "ring-1 ring-zinc-900/20" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-lg font-bold text-zinc-900">{p.name}</span>
                  <Badge variant="outline" className={open ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-100 text-zinc-500"}>
                    {open ? "Open" : "Closed"}
                  </Badge>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-zinc-500">
                  <p>{p.entryCount ?? 0} jurnal{p.draftCount ? <span className="text-amber-600"> · {p.draftCount} draft tersisa</span> : null}</p>
                  {p.closedAt ? <p>Ditutup {formatDate(p.closedAt)} oleh {p.closedBy ?? "—"}</p> : <p>Belum ditutup</p>}
                </div>
                {open && canClose ? (
                  <Button
                    size="sm" variant="outline"
                    className="mt-3 w-full border-amber-200 text-amber-700 hover:bg-amber-50"
                    disabled={(p.draftCount ?? 0) > 0}
                    title={(p.draftCount ?? 0) > 0 ? `Masih ada ${p.draftCount} jurnal draft dalam periode ini` : "Tutup buku periode ini"}
                    onClick={() => setCloseTarget(p)}
                    aria-label={`Tutup periode ${p.name}`}
                  >
                    Tutup Buku
                  </Button>
                ) : null}
                {open && canClose && (p.draftCount ?? 0) > 0 ? (
                  <p className="mt-1 text-center text-[11px] text-amber-600">Selesaikan {p.draftCount} draft dulu</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Buat Periode Pembukuan</DialogTitle>
            <DialogDescription>Format YYYY-MM. Periode baru langsung berstatus open dan siap menerima posting.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="period-name">Nama Periode</Label>
            <Input id="period-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="2026-10" className="font-mono" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={create} disabled={saving}>
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Buat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={closeTarget !== null} onOpenChange={(v) => !v && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tutup buku periode {closeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Setelah ditutup, TIDAK ada jurnal baru yang bisa diposting dengan tanggal dalam periode ini.
              Sisa draft dalam periode: <strong>{closeTarget?.draftCount ?? 0}</strong>.
              {closeTarget?.draftCount ? " Tutup ditolak selama draft masih ada." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-zinc-900 text-white hover:bg-zinc-800"
              disabled={closing || (closeTarget?.draftCount ?? 0) > 0}
              onClick={(e) => { e.preventDefault(); close(); }}
            >
              {closing ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarRange className="h-4 w-4" aria-hidden="true" />}
              Ya, Tutup Buku
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===== Tab: Kewajiban & Pencairan =====

function ObligationsTab({
  obligations, canWrite, onChanged,
}: {
  obligations: FinancialObligationDTO[] | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [disbTarget, setDisbTarget] = useState<FinancialObligationDTO | null>(null);
  const [method, setMethod] = useState("transfer");
  const [bankRef, setBankRef] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const openList = useMemo(() => (obligations ?? []).filter((o) => o.status === "open"), [obligations]);
  const history = useMemo(() => {
    const rows = (obligations ?? []).flatMap((o) => o.disbursements.map((d) => ({ ...d, sourceType: o.sourceType })));
    return rows.sort((a, b) => (a.disbursedAt < b.disbursedAt ? 1 : -1));
  }, [obligations]);

  const submit = async () => {
    if (!disbTarget) return;
    setSaving(true);
    try {
      await accountingApi.createDisbursement({
        obligationId: disbTarget.id,
        method,
        ...(bankRef.trim() ? { bankRef: bankRef.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(`Pencairan ${formatCurrency(disbTarget.amount)} ke ${disbTarget.payeeName} tercatat`);
      setDisbTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pencairan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Kewajiban Open</h3>
        <div className="rounded-xl border bg-white shadow-sm">
          {obligations === null ? (
            <ListSkeleton rows={3} />
          ) : openList.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Wallet} title="Tidak ada kewajiban open" subtitle="Semua kewajiban pembayaran sudah dicairkan." />
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto crm-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Penerima</TableHead>
                    <TableHead>Jumlah</TableHead>
                    <TableHead>Sumber</TableHead>
                    <TableHead>Umur</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openList.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.payeeName}</TableCell>
                      <TableCell className="font-mono text-xs">{formatCurrencyFull(o.amount)}</TableCell>
                      <TableCell><ObligationSourceBadge source={o.sourceType} /></TableCell>
                      <TableCell className="text-xs text-zinc-500">{timeAgo(o.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {canWrite ? (
                          <Button
                            size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-800"
                            onClick={() => { setMethod("transfer"); setBankRef(""); setNote(""); setDisbTarget(o); }}
                            aria-label={`Catat pencairan untuk ${o.payeeName}`}
                          >
                            <Banknote className="h-3.5 w-3.5" aria-hidden="true" /> Catat Pencairan
                          </Button>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Riwayat Pencairan</h3>
        <div className="rounded-xl border bg-white shadow-sm">
          {obligations === null ? (
            <ListSkeleton rows={3} />
          ) : history.length === 0 ? (
            <div className="p-4"><EmptyState icon={Coins} title="Belum ada pencairan" /></div>
          ) : (
            <div className="max-h-96 overflow-y-auto crm-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Penerima</TableHead>
                    <TableHead>Jumlah</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead>Referensi</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Oleh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.payeeName}</TableCell>
                      <TableCell className="font-mono text-xs">{formatCurrencyFull(d.amount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[11px] text-zinc-600">
                          {d.method === "transfer" ? "Transfer" : "Kas"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">{d.bankRef ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(d.disbursedAt)}</TableCell>
                      <TableCell className="text-xs text-zinc-500">{d.createdBy}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      <Dialog open={disbTarget !== null} onOpenChange={(v) => !v && setDisbTarget(null)}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Catat Pencairan</DialogTitle>
            <DialogDescription>
              {disbTarget ? `${disbTarget.payeeName} — ${formatCurrencyFull(disbTarget.amount)} (${OBLIGATION_SOURCE_LABEL[disbTarget.sourceType] ?? disbTarget.sourceType})` : ""}
              . Jumlah mengikuti kewajiban; kewajiban langsung berstatus paid setelah disimpan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Metode</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger aria-label="Metode pencairan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">Transfer Bank</SelectItem>
                  <SelectItem value="cash">Kas (Tunai)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disb-ref">Referensi bank (opsional)</Label>
              <Input id="disb-ref" value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="No. transaksi / bukti transfer" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="disb-note">Catatan (opsional)</Label>
              <Input id="disb-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: payroll minggu ke-4" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDisbTarget(null)} disabled={saving}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={submit} disabled={saving}>
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Banknote className="h-4 w-4" aria-hidden="true" />}
              Simpan Pencairan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Modul utama =====

export default function AccountingModule() {
  const user = useCrmStore((s) => s.user);
  const role = user?.role ?? null;
  const isFinanceTeam = !!role && FINANCE_TEAM.includes(role);
  const canWrite = !!role && WRITE_ROLES.includes(role);
  const canApprove = isFinanceTeam;
  const canPay = canWrite;
  const canCreatePeriod = isFinanceTeam;
  const canClosePeriod = !!role && CLOSE_ROLES.includes(role);

  const [tab, setTab] = useState("summary");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<FinanceSummaryDTO | null>(null);
  const [accounts, setAccounts] = useState<AccountDTO[] | null>(null);
  const [journals, setJournals] = useState<JournalEntryDTO[] | null>(null);
  const [periods, setPeriods] = useState<AccountingPeriodDTO[] | null>(null);
  const [currentPeriodName, setCurrentPeriodName] = useState("");
  const [claims, setClaims] = useState<ExpenseClaimDTO[] | null>(null);
  const [myClaims, setMyClaims] = useState<ExpenseClaimDTO[] | null>(null);
  const [me, setMe] = useState<ExpenseMeDTO>(null);
  const [obligations, setObligations] = useState<FinancialObligationDTO[] | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [sum, acc, jrn, per, allClaims, ownClaims, obl] = await Promise.all([
        accountingApi.summary(),
        accountingApi.accounts(),
        accountingApi.journals(),
        accountingApi.periods(),
        accountingApi.expenses(),
        accountingApi.expenses({ mine: true }),
        accountingApi.obligations(),
      ]);
      setSummary(sum);
      setAccounts(acc.accounts);
      setJournals(jrn.journals);
      setPeriods(per.periods);
      setCurrentPeriodName(per.currentPeriodName);
      setClaims(allClaims.claims);
      setMyClaims(ownClaims.claims);
      setMe(ownClaims.me ?? null);
      setObligations(obl.obligations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data pembukuan");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  const maxMutation = useMemo(() => {
    if (!summary || summary.byAccount.length === 0) return 0;
    return Math.max(...summary.byAccount.map((a) => a.debit + a.credit), 1);
  }, [summary]);

  const balanced = !!summary && Math.abs(summary.totalDebit - summary.totalCredit) <= 0.01;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <Landmark className="h-5 w-5 text-zinc-700" aria-hidden="true" /> Pembukuan &amp; Keuangan
          </h1>
          <p className="text-sm text-zinc-500">Buku besar, jurnal umum, reimbursement, kewajiban &amp; penutupan buku.</p>
        </div>
        <div className="flex items-center gap-2">
          {summary?.currentPeriod ? (
            <Badge variant="outline" className={summary.currentPeriod.status === "open" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-100 text-zinc-500"}>
              Periode {summary.currentPeriod.name} · {summary.currentPeriod.status === "open" ? "Open" : "Closed"}
            </Badge>
          ) : null}
          <Button variant="outline" size="icon" onClick={refresh} disabled={refreshing} aria-label="Muat ulang data pembukuan">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="text-sm font-medium text-rose-700">{error}</p>
          <Button variant="outline" size="sm" onClick={() => load()} aria-label="Coba muat ulang">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Coba Lagi
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="summary">Ringkasan</TabsTrigger>
          <TabsTrigger value="journals">Jurnal Umum</TabsTrigger>
          <TabsTrigger value="expenses">Pengeluaran (Reimbursement)</TabsTrigger>
          <TabsTrigger value="accounts">Bagan Akun</TabsTrigger>
          <TabsTrigger value="periods">Periode</TabsTrigger>
          <TabsTrigger value="obligations">Kewajiban &amp; Pencairan</TabsTrigger>
        </TabsList>

        {/* ===== Ringkasan ===== */}
        <TabsContent value="summary" className="space-y-4">
          {loading || !summary ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <KpiCard
                  icon={BookOpen} label="Total Debit" value={formatCurrency(summary.totalDebit)}
                  badge={
                    balanced ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Balanced</Badge>
                    ) : (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">SELISIH!</Badge>
                    )
                  }
                />
                <KpiCard
                  icon={Coins} label="Total Kredit" value={formatCurrency(summary.totalCredit)}
                  badge={
                    balanced ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Balanced</Badge>
                    ) : (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">SELISIH!</Badge>
                    )
                  }
                />
                <KpiCard icon={ClipboardList} label="Jurnal Bulan Ini" value={String(summary.journalsThisMonth)} onClick={() => setTab("journals")} />
                <KpiCard icon={ReceiptText} label="Klaim Pending" value={String(summary.pendingClaims)} onClick={() => setTab("expenses")} />
                <KpiCard icon={Wallet} label="Kewajiban Open" value={String(summary.openObligations)} onClick={() => setTab("obligations")} />
              </div>

              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700">
                  <Scale className="h-4 w-4" aria-hidden="true" /> Mutasi per Akun (top 8, semua jurnal posted)
                </h3>
                {summary.byAccount.length === 0 ? (
                  <EmptyState icon={Landmark} title="Belum ada mutasi" subtitle="Posting jurnal pertama untuk melihat buku besar." />
                ) : (
                  <div className="max-h-96 space-y-3 overflow-y-auto crm-scroll pr-1">
                    {summary.byAccount.slice(0, 8).map((a) => (
                      <div key={a.code}>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-xs">
                          <span className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-zinc-700">{a.code}</span>
                            <span className="font-medium text-zinc-900">{a.name}</span>
                            <TypeBadge type={a.type} />
                          </span>
                          <span className="font-mono text-zinc-500">
                            D {formatCurrency(a.debit)} · K {formatCurrency(a.credit)}
                          </span>
                        </div>
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full bg-zinc-900" style={{ width: `${(a.debit / maxMutation) * 100}%` }} title={`Debit ${formatCurrencyFull(a.debit)}`} />
                          <div className="h-full bg-emerald-500" style={{ width: `${(a.credit / maxMutation) * 100}%` }} title={`Kredit ${formatCurrencyFull(a.credit)}`} />
                        </div>
                      </div>
                    ))}
                    <p className="pt-1 text-[11px] text-zinc-400">Bar gelap = debit · bar hijau = kredit. Skala relatif terhadap mutasi terbesar.</p>
                  </div>
                )}
              </div>

              {!summary.periodOpen && summary.currentPeriod === null ? (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                  <CalendarRange className="h-4 w-4" aria-hidden="true" />
                  Periode pembukuan untuk bulan berjalan belum dibuat — posting jurnal akan ditolak. Buat dulu di tab Periode.
                </div>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="journals">
          <JournalsTab journals={journals} accounts={accounts ?? []} canWrite={canWrite} onChanged={() => load(true)} />
        </TabsContent>

        <TabsContent value="expenses">
          <ExpensesTab
            claims={claims} myClaims={myClaims} me={me}
            canApprove={canApprove} canPay={canPay} journals={journals}
            onChanged={() => load(true)}
          />
        </TabsContent>

        <TabsContent value="accounts">
          <AccountsTab accounts={accounts} canWrite={canWrite} onChanged={() => load(true)} />
        </TabsContent>

        <TabsContent value="periods">
          <PeriodsTab periods={periods} currentPeriodName={currentPeriodName} canCreate={canCreatePeriod} canClose={canClosePeriod} onChanged={() => load(true)} />
        </TabsContent>

        <TabsContent value="obligations">
          <ObligationsTab obligations={obligations} canWrite={canPay} onChanged={() => load(true)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
