"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Download, FileX2, Receipt, RefreshCw, Target, Timer, TrendingUp, Users2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getReports } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type { ReportsData } from "@/lib/crm/types";
import { formatCurrency } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";

// ============ Konstanta tampilan ============

const WON_GREEN = "#059669"; // Segia Tech emerald — dipakai untuk bar won/win-rate
const ZINC_BAR = "#27272a"; // zinc-800
const ROSE_BAR = "#e11d48"; // Erfo rose — bucket 90+ hari

const PERIODS = [
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
  { days: 365, label: "365 hari" },
] as const;

type ReportDays = (typeof PERIODS)[number]["days"];

const CATEGORY_LABELS: Record<string, string> = {
  animation: "Animasi",
  website: "Website",
  video: "Video",
  immersive: "Immersive",
  digital_marketing: "Digital Marketing",
  tanpa_kategori: "Tanpa Kategori",
};

function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// ============ Ekspor CSV (pola buildOpportunityCsv ronde 13: BOM + CRLF + separator ";") ============

function escapeCsvField(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.join(";")];
  for (const row of rows) {
    lines.push(row.map((c) => escapeCsvField(String(c))).join(";"));
  }
  return "\uFEFF" + lines.join("\r\n");
}

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function downloadCsv(jenis: string, headers: string[], rows: (string | number)[][]) {
  const filename = `laporan-${jenis}-${todayYmd()}.csv`;
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success(`CSV ${filename} diunduh`);
}

// ============ Sub-komponen ============

function ReportBar({ pct, color }: { pct: number; color: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full min-w-[72px] overflow-hidden rounded-full bg-zinc-100" aria-hidden>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${w}%`, backgroundColor: color }}
      />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100" aria-hidden>
          <Icon className="h-4 w-4 text-zinc-600" />
        </span>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      </div>
      <p className="mt-3 text-xl font-bold tracking-tight text-zinc-900">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>
    </div>
  );
}

function ReportCard({
  icon: Icon, kicker, title, description, onExport, exportLabel, children,
}: {
  icon: LucideIcon;
  kicker: string;
  title: string;
  description: string;
  onExport: () => void;
  exportLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white shadow-sm" aria-label={title}>
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6 sm:py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100" aria-hidden>
            <Icon className="h-4 w-4 text-zinc-600" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{kicker}</p>
            <h2 className="text-sm font-bold text-zinc-900">{title}</h2>
            <p className="text-xs text-zinc-500">{description}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExport} aria-label={exportLabel} className="shrink-0">
          <Download className="h-3.5 w-3.5" aria-hidden /> Ekspor CSV
        </Button>
      </div>
      <div className="p-4 sm:p-6 sm:pt-4">
        {children}
      </div>
    </section>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan}>
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <FileX2 className="h-8 w-8 text-zinc-300" aria-hidden />
          <p className="text-sm text-zinc-400">Tidak ada data pada periode ini</p>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-60 rounded-xl" />
      ))}
    </div>
  );
}

// ============ Module utama ============

export default function ReportsModule() {
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);
  const brands = useCrmStore((s) => s.brands);

  const [days, setDays] = useState<ReportDays>(90);
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await getReports({ brandId: activeBrandFilter, days });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat laporan");
      if (!silent) toast.error("Gagal memuat laporan");
    } finally {
      setLoading(false);
    }
  }, [activeBrandFilter, days]);

  useEffect(() => { void load(); }, [load]);

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeBrandFilter) ?? null,
    [brands, activeBrandFilter]
  );

  const totals = data?.totals;
  const maxRevenue = Math.max(...(data?.revenuePerBrand ?? []).map((r) => r.value), 0);
  const maxAging = Math.max(...(data?.invoiceAging ?? []).map((r) => r.amount), 0);
  const maxPipeline = Math.max(...(data?.pipelinePerOwner ?? []).map((r) => r.value), 0);
  const agingColors = [ZINC_BAR, ZINC_BAR, ZINC_BAR, ROSE_BAR];

  if (loading && !data && !error) return <ReportsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header + periode chips */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Laporan Kinerja</h1>
          <p className="text-sm text-zinc-500">
            {days} hari terakhir ·{" "}
            {activeBrand ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeBrand.color }} aria-hidden />
                {activeBrand.name}
              </span>
            ) : (
              "Semua Brand"
            )}{" "}
            · data period-bounded, siap ekspor
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && data ? (
            <span className="flex items-center gap-1.5 text-xs text-zinc-400" role="status">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> Memperbarui…
            </span>
          ) : null}
          <div
            role="group"
            aria-label="Pilih periode laporan"
            className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm"
          >
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
                aria-pressed={days === p.days}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400",
                  days === p.days ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center">
          <p className="text-sm text-rose-700">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Coba muat ulang laporan">
            <RefreshCw className="h-4 w-4" aria-hidden /> Coba lagi
          </Button>
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="Total Won Value"
          value={formatCurrency(totals?.wonValue ?? 0)}
          sub={`${totals?.wonCount ?? 0} deal won pada periode`}
        />
        <KpiCard
          icon={Target}
          label="Win Rate"
          value={`${totals?.winRatePct ?? 0}%`}
          sub={`${totals?.wonCount ?? 0} won vs ${totals?.lostCount ?? 0} lost`}
        />
        <KpiCard
          icon={Receipt}
          label="Outstanding Invoice"
          value={formatCurrency(totals?.outstanding ?? 0)}
          sub="Sent · partial · overdue"
        />
        <KpiCard
          icon={Timer}
          label="SLA Respons"
          value={`${totals?.avgResponseHours ?? 0} jam`}
          sub="Rata-rata respons lead inbound"
        />
      </div>

      {data ? (
        <>
          {/* 1. Revenue per brand */}
          <ReportCard
            icon={BarChart3}
            kicker="Penjualan"
            title="Revenue per Brand"
            description="Opportunity won dalam periode (won-date = terakhir diperbarui), dikelompokkan per brand"
            onExport={() =>
              downloadCsv(
                "revenue-brand",
                ["brand", "deal_won", "nilai_won"],
                data.revenuePerBrand.map((r) => [r.name, r.count, r.value])
              )
            }
            exportLabel="Ekspor CSV revenue per brand"
          >
            <div className="max-h-96 overflow-auto crm-scroll">
              <div className="min-w-[560px]">
                <Table aria-label="Tabel revenue per brand">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Brand</TableHead>
                      <TableHead className="text-right">Won</TableHead>
                      <TableHead className="text-right">Nilai Won</TableHead>
                      <TableHead className="w-[30%]">Kontribusi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.revenuePerBrand.length === 0 ? (
                      <EmptyRow colSpan={4} />
                    ) : (
                      data.revenuePerBrand.map((r) => (
                        <TableRow key={r.brandId} className="hover:bg-zinc-50">
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                              <span className="text-sm font-medium text-zinc-800">{r.name}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-zinc-600">{r.count}</TableCell>
                          <TableCell className="text-right text-sm font-semibold text-zinc-900">{formatCurrency(r.value)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ReportBar pct={maxRevenue > 0 ? (r.value / maxRevenue) * 100 : 0} color={r.color} />
                              <span className="w-10 shrink-0 text-right text-xs text-zinc-400">
                                {maxRevenue > 0 ? Math.round((r.value / maxRevenue) * 100) : 0}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ReportCard>

          {/* 2. Win rate per layanan */}
          <ReportCard
            icon={Target}
            kicker="Sales"
            title="Win Rate per Layanan"
            description="Kohort opportunity dibuat dalam periode: created vs won/lost per kategori layanan"
            onExport={() =>
              downloadCsv(
                "winrate-layanan",
                ["kategori_layanan", "dibuat", "won", "lost", "win_rate_pct", "nilai_won"],
                data.winRatePerService.map((r) => [categoryLabel(r.category), r.created, r.won, r.lost, r.winRatePct, r.valueWon])
              )
            }
            exportLabel="Ekspor CSV win rate per layanan"
          >
            <div className="max-h-96 overflow-auto crm-scroll">
              <div className="min-w-[720px]">
                <Table aria-label="Tabel win rate per layanan">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Kategori Layanan</TableHead>
                      <TableHead className="text-right">Dibuat</TableHead>
                      <TableHead className="text-right">Won</TableHead>
                      <TableHead className="text-right">Lost</TableHead>
                      <TableHead className="text-right">Win Rate</TableHead>
                      <TableHead className="text-right">Nilai Won</TableHead>
                      <TableHead className="w-[22%]">Win Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.winRatePerService.length === 0 ? (
                      <EmptyRow colSpan={7} />
                    ) : (
                      data.winRatePerService.map((r) => (
                        <TableRow key={r.category} className="hover:bg-zinc-50">
                          <TableCell>
                            <span className="text-sm font-medium text-zinc-800">{categoryLabel(r.category)}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-zinc-600">{r.created}</TableCell>
                          <TableCell className="text-right text-sm font-medium text-emerald-700">{r.won}</TableCell>
                          <TableCell className="text-right text-sm font-medium text-rose-600">{r.lost}</TableCell>
                          <TableCell className="text-right text-sm font-semibold text-zinc-900">{r.winRatePct}%</TableCell>
                          <TableCell className="text-right text-sm text-zinc-700">{formatCurrency(r.valueWon)}</TableCell>
                          <TableCell><ReportBar pct={r.winRatePct} color={WON_GREEN} /></TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ReportCard>

          {/* 3. SLA compliance per brand */}
          <ReportCard
            icon={Timer}
            kicker="Layanan Pelanggan"
            title="SLA Compliance per Brand"
            description={`Lead inbound dalam periode vs target SLA brand · breach = respons telat atau belum direspons melewati SLA`}
            onExport={() =>
              downloadCsv(
                "sla-brand",
                ["brand", "sla_target_jam", "total_lead", "responded", "responded_pct", "avg_respons_jam", "breach_pct"],
                data.slaCompliance.map((r) => [r.name, r.slaHours, r.total, r.responded, r.respondedPct, r.avgResponseHours, r.breachPct])
              )
            }
            exportLabel="Ekspor CSV SLA compliance per brand"
          >
            <div className="max-h-96 overflow-auto crm-scroll">
              <div className="min-w-[720px]">
                <Table aria-label="Tabel SLA compliance per brand">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Brand</TableHead>
                      <TableHead className="text-right">Target SLA</TableHead>
                      <TableHead className="text-right">Lead</TableHead>
                      <TableHead className="text-right">Direspons</TableHead>
                      <TableHead className="text-right">Rata-rata Respons</TableHead>
                      <TableHead className="text-right">Breach</TableHead>
                      <TableHead className="w-[22%]">% Direspons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.slaCompliance.length === 0 ? (
                      <EmptyRow colSpan={7} />
                    ) : (
                      data.slaCompliance.map((r) => (
                        <TableRow key={r.brandId} className="hover:bg-zinc-50">
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />
                              <span className="text-sm font-medium text-zinc-800">{r.name}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-zinc-500">{r.slaHours} jam</TableCell>
                          <TableCell className="text-right text-sm text-zinc-600">{r.total}</TableCell>
                          <TableCell className="text-right text-sm text-zinc-700">
                            {r.responded} <span className="text-zinc-400">({r.respondedPct}%)</span>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold text-zinc-900">{r.avgResponseHours} jam</TableCell>
                          <TableCell className="text-right">
                            <span className={cn("text-sm font-semibold", r.breachPct > 0 ? "text-rose-600" : "text-zinc-400")}>
                              {r.breachPct}%
                            </span>
                          </TableCell>
                          <TableCell><ReportBar pct={r.respondedPct} color={WON_GREEN} /></TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ReportCard>

          {/* 4. Invoice aging */}
          <ReportCard
            icon={Receipt}
            kicker="Finansial"
            title="Invoice Aging"
            description="Outstanding invoice (sent/partial/overdue) yang sudah melewati jatuh tempo, per bucket hari"
            onExport={() =>
              downloadCsv(
                "invoice-aging",
                ["bucket", "jumlah_invoice", "total_tunggakan"],
                data.invoiceAging.map((r) => [r.bucket, r.count, r.amount])
              )
            }
            exportLabel="Ekspor CSV invoice aging"
          >
            <div className="max-h-96 overflow-auto crm-scroll">
              <div className="min-w-[560px]">
                <Table aria-label="Tabel invoice aging">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Bucket</TableHead>
                      <TableHead className="text-right">Invoice</TableHead>
                      <TableHead className="text-right">Total Tunggakan</TableHead>
                      <TableHead className="w-[32%]">Porsi Tunggakan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoiceAging.every((r) => r.count === 0) ? (
                      <EmptyRow colSpan={4} />
                    ) : (
                      data.invoiceAging.map((r, i) => (
                        <TableRow key={r.bucket} className="hover:bg-zinc-50">
                          <TableCell>
                            <span className="text-sm font-medium text-zinc-800">{r.bucket}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-zinc-600">{r.count}</TableCell>
                          <TableCell className="text-right text-sm font-semibold text-zinc-900">{formatCurrency(r.amount)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ReportBar pct={maxAging > 0 ? (r.amount / maxAging) * 100 : 0} color={agingColors[i] ?? ZINC_BAR} />
                              <span className="w-10 shrink-0 text-right text-xs text-zinc-400">
                                {maxAging > 0 ? Math.round((r.amount / maxAging) * 100) : 0}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ReportCard>

          {/* 5. Pipeline per owner */}
          <ReportCard
            icon={Users2}
            kicker="Pipeline"
            title="Pipeline per Owner"
            description="Opportunity open (belum won/lost) per owner · weighted = nilai × probabilitas"
            onExport={() =>
              downloadCsv(
                "pipeline-owner",
                ["owner", "open_deals", "nilai_pipeline", "nilai_weighted"],
                data.pipelinePerOwner.map((r) => [r.owner, r.count, r.value, r.weighted])
              )
            }
            exportLabel="Ekspor CSV pipeline per owner"
          >
            <div className="max-h-96 overflow-auto crm-scroll">
              <div className="min-w-[640px]">
                <Table aria-label="Tabel pipeline per owner">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Owner</TableHead>
                      <TableHead className="text-right">Open Deals</TableHead>
                      <TableHead className="text-right">Nilai Pipeline</TableHead>
                      <TableHead className="text-right">Weighted</TableHead>
                      <TableHead className="w-[26%]">Porsi Nilai</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pipelinePerOwner.length === 0 ? (
                      <EmptyRow colSpan={5} />
                    ) : (
                      data.pipelinePerOwner.map((r) => (
                        <TableRow key={r.owner} className="hover:bg-zinc-50">
                          <TableCell>
                            <span className="text-sm font-medium text-zinc-800">{r.owner}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm text-zinc-600">{r.count}</TableCell>
                          <TableCell className="text-right text-sm font-semibold text-zinc-900">{formatCurrency(r.value)}</TableCell>
                          <TableCell className="text-right text-sm text-zinc-600">{formatCurrency(r.weighted)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ReportBar pct={maxPipeline > 0 ? (r.value / maxPipeline) * 100 : 0} color={ZINC_BAR} />
                              <span className="w-10 shrink-0 text-right text-xs text-zinc-400">
                                {maxPipeline > 0 ? Math.round((r.value / maxPipeline) * 100) : 0}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ReportCard>
        </>
      ) : null}
    </div>
  );
}
