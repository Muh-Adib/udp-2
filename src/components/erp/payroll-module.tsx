"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeCheck, Banknote, CalendarClock,
  CalendarRange, CheckCircle2, ChevronDown, ChevronRight, Coins, GraduationCap, HandCoins,
  Hourglass, Loader2, Lock, PlayCircle, Plus, RefreshCw, Search,
  Send, Stamp, Trophy, Wallet, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCrmStore } from "@/lib/crm/store";
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";
import {
  CONVERSION_VALUE, payrollApi,
  type EmployeeLiteDTO, type IncentiveProposalDTO, type InternAccrualDTO,
  type InternSettlementDTO, type PayrollPeriodDTO, type PayrollRunDTO, type PayrollMeDTO,
  type PointReservationDTO, type PointsDetailDTO, type UmkRefDTO,
} from "@/lib/erp/payroll-client";

/**
 * Fase 6 — Modul Payroll & Poin (ERP slice vertikal kompensasi).
 * Tab: Periode & Run · Slip Saya · Poin · Insentif · Uang Saku Magang · UMK.
 * Palet zinc + emerald/amber/rose; Bahasa Indonesia; sonner utk semua aksi.
 */

const ADMIN_ROLES = ["hr", "finance", "director", "super_admin"];
const HR_GANG = ["hr", "director", "super_admin"]; // buat periode / kunci / hitung / adjust
const FIN_REVIEW = ["finance", "director", "super_admin"]; // approve run
const DIR_ONLY = ["director", "super_admin"]; // finalize run / approve settlement
const FIN_PAY = ["finance", "director", "super_admin"]; // pay

const SOURCE_LABEL: Record<string, string> = {
  task: "Tugas", overtime: "Lembur", travel: "Dinas", project: "Proyek", manual: "Manual",
};
const COMPONENT_ORDER: Record<string, number> = {
  base_salary: 0, allowance: 1, overtime: 2, incentive: 3, stipend: 4, point_redemption: 5, deduction: 9,
};

type TabKey = "period" | "me" | "points" | "incentives" | "intern" | "umk";

function statusPeriodBadge(status: string) {
  if (status === "open") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Open</Badge>;
  if (status === "locked") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Terkunci</Badge>;
  return <Badge className="bg-zinc-200 text-zinc-700 hover:bg-zinc-200">Finalized</Badge>;
}
function statusRunBadge(status: string) {
  if (status === "draft") return <Badge className="bg-zinc-100 text-zinc-600 hover:bg-zinc-100">Draft</Badge>;
  if (status === "calculated") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Dihitung</Badge>;
  if (status === "approved") return <Badge className="border border-emerald-300 text-emerald-700" variant="outline">Disetujui</Badge>;
  return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Finalized</Badge>;
}
function statusSlipBadge(status: string) {
  if (status === "finalized") return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Final</Badge>;
  return <Badge className="bg-zinc-100 text-zinc-600 hover:bg-zinc-100">Draft</Badge>;
}
function kindPointBadge(kind: string) {
  if (kind === "earn") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Earn</Badge>;
  if (kind === "redeem") return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">Redeem</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Adjust</Badge>;
}
function statusReservationBadge(status: string) {
  if (status === "reserved") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Ditahan</Badge>;
  if (status === "settled") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Dibayar</Badge>;
  return <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100">Dilepas</Badge>;
}
function statusIncentiveBadge(status: string) {
  if (status === "pending") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Menunggu</Badge>;
  if (status === "approved") return <Badge className="border border-emerald-300 text-emerald-700" variant="outline">Disetujui</Badge>;
  if (status === "rejected") return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">Ditolak</Badge>;
  return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Dibayar</Badge>;
}
function statusSettlementBadge(status: string) {
  if (status === "open") return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Open</Badge>;
  if (status === "submitted") return <Badge className="bg-zinc-200 text-zinc-700 hover:bg-zinc-200">Diajukan</Badge>;
  if (status === "approved") return <Badge className="border border-emerald-300 text-emerald-700" variant="outline">Disetujui</Badge>;
  return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Dibayar</Badge>;
}
function itemAmountCls(classification: string) {
  if (classification === "deduction") return "text-rose-600";
  if (classification === "reimbursement") return "text-amber-600";
  return "text-emerald-700";
}

function StatChip({ label, value, icon, cls }: { label: string; value: string; icon: React.ReactNode; cls: string }) {
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm" aria-label={label}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
        {icon}{label}
      </div>
      <p className={`mt-1 text-lg font-bold ${cls}`}>{value}</p>
    </div>
  );
}

export default function PayrollModule() {
  const user = useCrmStore((s) => s.user);
  const role = user?.role ?? null;
  const isAdmin = !!role && ADMIN_ROLES.includes(role);
  const has = (roles: string[]) => !!role && roles.includes(role);

  const [tab, setTab] = useState<TabKey>("me");
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ===== Data =====
  const [me, setMe] = useState<PayrollMeDTO | null>(null);
  const [periods, setPeriods] = useState<PayrollPeriodDTO[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [runs, setRuns] = useState<PayrollRunDTO[]>([]);
  const [employees, setEmployees] = useState<EmployeeLiteDTO[]>([]);
  const [points, setPoints] = useState<PointsDetailDTO | null>(null);
  const [selectedPointEmp, setSelectedPointEmp] = useState<string>("");
  const [reservations, setReservations] = useState<PointReservationDTO[]>([]);
  const [incentives, setIncentives] = useState<IncentiveProposalDTO[]>([]);
  const [incentiveFilter, setIncentiveFilter] = useState<string>("all");
  const [interns, setInterns] = useState<EmployeeLiteDTO[]>([]);
  const [selectedIntern, setSelectedIntern] = useState<string>("");
  const [internMonth, setInternMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [accruals, setAccruals] = useState<InternAccrualDTO[]>([]);
  const [accrualTotals, setAccrualTotals] = useState<{ employeeId: string; name: string; days: number; total: number }[]>([]);
  const [settlements, setSettlements] = useState<InternSettlementDTO[]>([]);
  const [umk, setUmk] = useState<UmkRefDTO[]>([]);
  const [umkQuery, setUmkQuery] = useState("");

  // ===== Loading flags =====
  const [loadingMe, setLoadingMe] = useState(true);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [loadingIncentives, setLoadingIncentives] = useState(false);
  const [loadingIntern, setLoadingIntern] = useState(false);
  const [loadingUmk, setLoadingUmk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // ===== Dialog states =====
  const [periodDialog, setPeriodDialog] = useState(false);
  const [pName, setPName] = useState("");
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [lockTarget, setLockTarget] = useState<PayrollPeriodDTO | null>(null);
  const [finalizeTarget, setFinalizeTarget] = useState<PayrollRunDTO | null>(null);
  const [redeemDialog, setRedeemDialog] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [adjustDialog, setAdjustDialog] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [settleTarget, setSettleTarget] = useState<PointReservationDTO | null>(null);
  const [incentiveDialog, setIncentiveDialog] = useState(false);
  const [incEmployee, setIncEmployee] = useState("");
  const [incSource, setIncSource] = useState("task");
  const [incPoints, setIncPoints] = useState("");
  const [incAmount, setIncAmount] = useState("");
  const [incReason, setIncReason] = useState("");

  const visibleTabs: { key: TabKey; label: string }[] = useMemo(() => {
    const all: { key: TabKey; label: string }[] = [
      { key: "period", label: "Periode & Run" },
      { key: "me", label: "Slip Saya" },
      { key: "points", label: "Poin" },
      { key: "incentives", label: "Insentif" },
      { key: "intern", label: "Uang Saku Magang" },
      { key: "umk", label: "UMK" },
    ];
    return isAdmin ? all : all.filter((t) => t.key === "me");
  }, [isAdmin]);

  // ===== Loaders =====
  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const data = await payrollApi.me();
      setMe(data);
      setMyEmployeeId(data.employee.id);
      setGlobalError(null);
    } catch (e) {
      setMe(null);
      setGlobalError(e instanceof Error ? e.message : "Gagal memuat data slip saya");
    } finally {
      setLoadingMe(false);
    }
  }, []);

  const loadPeriods = useCallback(async () => {
    setLoadingPeriods(true);
    try {
      const data = await payrollApi.periods();
      setPeriods(data.periods);
      setGlobalError(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat periode");
    } finally {
      setLoadingPeriods(false);
    }
  }, []);

  const loadRuns = useCallback(async (periodId: string) => {
    setLoadingRuns(true);
    try {
      const data = await payrollApi.runs(periodId);
      setRuns(data.runs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat run");
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const data = await payrollApi.employees();
      setEmployees(data.employees);
      setInterns(data.employees.filter((e) => e.employmentStatus === "intern" && e.active !== false));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat daftar karyawan");
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  const loadPoints = useCallback(async (employeeId: string) => {
    if (!employeeId) return;
    setLoadingPoints(true);
    try {
      const [detail, resv] = await Promise.all([
        payrollApi.points(employeeId),
        payrollApi.reservations(),
      ]);
      setPoints(detail);
      setReservations(resv.reservations);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat ledger poin");
    } finally {
      setLoadingPoints(false);
    }
  }, []);

  const loadIncentives = useCallback(async (status: string) => {
    setLoadingIncentives(true);
    try {
      const data = await payrollApi.incentives(status === "all" ? undefined : status);
      setIncentives(data.proposals);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat proposal insentif");
    } finally {
      setLoadingIncentives(false);
    }
  }, []);

  const loadIntern = useCallback(async (month: string) => {
    setLoadingIntern(true);
    try {
      const [acc, setl] = await Promise.all([
        payrollApi.internAccruals({ month }),
        payrollApi.internSettlements(),
      ]);
      setAccruals(acc.accruals);
      setAccrualTotals(acc.totals);
      setSettlements(setl.settlements);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat data magang");
    } finally {
      setLoadingIntern(false);
    }
  }, []);

  const loadUmk = useCallback(async () => {
    setLoadingUmk(true);
    try {
      const data = await payrollApi.umk();
      setUmk(data.refs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat referensi UMK");
    } finally {
      setLoadingUmk(false);
    }
  }, []);

  // Muat data awal sesuai role + tab pertama.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadMe();
      if (cancelled) return;
      if (isAdmin) {
        setTab("period");
        await Promise.all([loadPeriods(), loadEmployees()]);
      }
      if (!cancelled) setFirstLoadDone(true);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, loadMe, loadPeriods, loadEmployees]);

  // Pilih periode terbaru (open dulu) setelah daftar periode termuat.
  useEffect(() => {
    if (periods.length > 0 && !selectedPeriodId) {
      const open = periods.find((p) => p.status === "open") ?? periods[0];
      setSelectedPeriodId(open.id);
    }
  }, [periods, selectedPeriodId]);

  // Muat run saat periode terpilih berubah (tab periode aktif).
  useEffect(() => {
    if (tab === "period" && selectedPeriodId) loadRuns(selectedPeriodId);
  }, [tab, selectedPeriodId, loadRuns]);

  // Muat data saat tab admin dibuka.
  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "points" && employees.length > 0 && !selectedPointEmp) {
      setSelectedPointEmp(employees[0].id);
    }
    if (tab === "incentives") loadIncentives(incentiveFilter);
    if (tab === "intern") loadIntern(internMonth);
    if (tab === "umk") loadUmk();
  }, [tab, isAdmin]);

  // Muat ledger poin saat karyawan terpilih berubah.
  useEffect(() => {
    if (tab === "points" && selectedPointEmp) loadPoints(selectedPointEmp);
  }, [tab, selectedPointEmp, loadPoints]);

  const refreshCurrentTab = useCallback(async () => {
    if (tab === "period" && selectedPeriodId) await Promise.all([loadPeriods(), loadRuns(selectedPeriodId)]);
    else if (tab === "me") await loadMe();
    else if (tab === "points" && selectedPointEmp) await loadPoints(selectedPointEmp);
    else if (tab === "incentives") await loadIncentives(incentiveFilter);
    else if (tab === "intern") await loadIntern(internMonth);
    else if (tab === "umk") await loadUmk();
  }, [tab, selectedPeriodId, selectedPointEmp, incentiveFilter, internMonth, loadPeriods, loadRuns, loadMe, loadPoints, loadIncentives, loadIntern, loadUmk]);

  // ===== Aksi =====
  async function handleCreatePeriod() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pName.trim())) {
      toast.error("Nama periode harus berformat YYYY-MM (contoh: 2026-11)");
      return;
    }
    if (!pStart || !pEnd) { toast.error("Tanggal mulai & akhir wajib diisi"); return; }
    setBusy("createPeriod");
    try {
      await payrollApi.createPeriod({ name: pName.trim(), startDate: pStart, endDate: pEnd });
      toast.success(`Periode ${pName} dibuat — payDate otomatis dimajukan ke hari kerja`);
      setPeriodDialog(false); setPName(""); setPStart(""); setPEnd("");
      await loadPeriods();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat periode");
    } finally { setBusy(null); }
  }

  async function handleLockPeriod() {
    if (!lockTarget) return;
    setBusy("lock");
    try {
      await payrollApi.lockPeriod(lockTarget.id);
      toast.success(`Periode ${lockTarget.name} dikunci`);
      setLockTarget(null);
      await loadPeriods();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengunci periode");
    } finally { setBusy(null); }
  }

  async function handleCalculateRun(period: PayrollPeriodDTO) {
    setBusy("calc");
    try {
      const res = await payrollApi.calculateRun(period.id);
      toast.success(`Run revisi ${res.run.revision} dihitung — ${res.run.slips.length} slip (insentif: ${res.incentiveCount})`);
      setSelectedPeriodId(period.id);
      await Promise.all([loadPeriods(), loadRuns(period.id)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghitung run");
    } finally { setBusy(null); }
  }

  async function handleRunAction(run: PayrollRunDTO, action: "approve" | "reject" | "finalize") {
    setBusy(`run-${run.id}-${action}`);
    try {
      const res = await payrollApi.runAction(run.id, action);
      if (action === "approve") toast.success("Run disetujui — siap difinalisasi Direktur");
      if (action === "reject") toast.info("Run dikembalikan ke draft — hitung ulang untuk revisi berikutnya");
      if (action === "finalize") toast.success(`Run difinalisasi — ${res.slipCount ?? 0} slip immutable + kewajiban ${formatCurrency(res.totalNet ?? 0)}`);
      setFinalizeTarget(null);
      if (selectedPeriodId) await Promise.all([loadPeriods(), loadRuns(selectedPeriodId)]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses run");
    } finally { setBusy(null); }
  }

  async function handleRedeem() {
    const pts = Number(redeemPoints);
    if (!Number.isFinite(pts) || pts <= 0 || pts % 10 !== 0) {
      toast.error("Poin harus kelipatan 10 dan lebih dari 0");
      return;
    }
    if (me && pts > me.points.available) {
      toast.error(`Saldo tidak cukup — tersedia ${me.points.available} poin`);
      return;
    }
    setBusy("redeem");
    try {
      await payrollApi.redeemPoints({ points: pts });
      toast.success(`${pts} poin ditahan untuk pencairan — menunggu settle oleh HR/Finance`);
      setRedeemDialog(false); setRedeemPoints("");
      await loadMe();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencairkan poin");
    } finally { setBusy(null); }
  }

  async function handleAdjust() {
    const pts = Number(adjustPoints);
    if (!Number.isFinite(pts) || pts === 0) { toast.error("Poin penyesuaian wajib angka tidak nol"); return; }
    if (!adjustNote.trim()) { toast.error("Catatan wajib diisi (jejak audit)"); return; }
    setBusy("adjust");
    try {
      await payrollApi.adjustPoints({ employeeId: selectedPointEmp, points: pts, note: adjustNote.trim() });
      toast.success("Penyesuaian poin dicatat (append-only)");
      setAdjustDialog(false); setAdjustPoints(""); setAdjustNote("");
      await loadPoints(selectedPointEmp);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat penyesuaian");
    } finally { setBusy(null); }
  }

  async function handleReservation(reservation: PointReservationDTO, action: "release" | "settle") {
    setBusy(`resv-${reservation.id}-${action}`);
    try {
      await payrollApi.reservationAction(reservation.id, action);
      if (action === "release") toast.success(`${reservation.points} poin kembali ke saldo`);
      else toast.success(`${reservation.points} poin dibayar — kewajiban Rp ${((reservation.points / 10) * CONVERSION_VALUE).toLocaleString("id-ID")} tercatat`);
      setSettleTarget(null);
      await loadPoints(selectedPointEmp);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses reservasi");
    } finally { setBusy(null); }
  }

  async function handleCreateIncentive() {
    if (!incEmployee) { toast.error("Pilih karyawan penerima"); return; }
    const pts = Number(incPoints || 0);
    const amt = Number(incAmount || 0);
    if ((!Number.isFinite(pts) || pts < 0) || (!Number.isFinite(amt) || amt < 0)) {
      toast.error("Poin/uang insentif harus angka yang valid");
      return;
    }
    if (pts === 0 && amt === 0) { toast.error("Isi minimal satu: poin atau uang insentif"); return; }
    if (!incReason.trim()) { toast.error("Alasan/justifikasi wajib diisi"); return; }
    setBusy("createInc");
    try {
      await payrollApi.createIncentive({
        employeeId: incEmployee, sourceType: incSource,
        proposedPoints: pts, proposedAmount: amt, reason: incReason.trim(),
      });
      toast.success("Proposal insentif dibuat — menunggu keputusan");
      setIncentiveDialog(false); setIncEmployee(""); setIncPoints(""); setIncAmount(""); setIncReason("");
      await loadIncentives(incentiveFilter);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat proposal");
    } finally { setBusy(null); }
  }

  async function handleIncentiveAction(p: IncentiveProposalDTO, action: "approve" | "reject" | "pay") {
    if (action !== "pay" && myEmployeeId && p.employeeId === myEmployeeId) {
      toast.error("Dilarang memutuskan insentif untuk diri sendiri");
      return;
    }
    setBusy(`inc-${p.id}-${action}`);
    try {
      await payrollApi.incentiveAction(p.id, action);
      if (action === "approve") toast.success(p.proposedPoints > 0 ? `Disetujui — ${p.proposedPoints} poin masuk ledger` : "Disetujui — uang insentif akan dibayar via payroll");
      if (action === "reject") toast.info("Proposal ditolak");
      if (action === "pay") toast.success("Ditandai dibayar (pembayaran langsung di luar payroll)");
      await loadIncentives(incentiveFilter);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses proposal");
    } finally { setBusy(null); }
  }

  async function handleGenerateAccrual() {
    if (!selectedIntern) { toast.error("Pilih karyawan magang dulu"); return; }
    setBusy("genAccrual");
    try {
      const res = await payrollApi.generateInternAccruals({ employeeId: selectedIntern, month: internMonth });
      toast.success(`${res.createdCount} hari accrual dibuat (${res.skipped} sudah ada) @ Rp ${res.rate.toLocaleString("id-ID")}/hari`);
      await loadIntern(internMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal generate accrual");
    } finally { setBusy(null); }
  }

  async function handleCreateSettlement(internId: string) {
    setBusy(`setl-${internId}`);
    try {
      await payrollApi.createInternSettlement(internId);
      toast.success("Settlement dibuat (status open) — ajukan setelah diperiksa");
      await loadIntern(internMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat settlement");
    } finally { setBusy(null); }
  }

  async function handleSettlementAction(s: InternSettlementDTO, action: "submit" | "approve" | "pay") {
    setBusy(`setlAct-${s.id}-${action}`);
    try {
      await payrollApi.internSettlementAction(s.id, action);
      if (action === "submit") toast.success("Settlement diajukan ke Direktur");
      if (action === "approve") toast.success("Settlement disetujui — siap dibayar Finance");
      if (action === "pay") toast.success(`Dibayar ${formatCurrency(s.totalAccrued)} — kewajiban tercatat`);
      await loadIntern(internMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses settlement");
    } finally { setBusy(null); }
  }

  // ===== Render helpers =====
  const umkFiltered = umk.filter((r) =>
    !umkQuery.trim() ||
    r.regionName.toLowerCase().includes(umkQuery.toLowerCase()) ||
    r.regionCode.toLowerCase().includes(umkQuery.toLowerCase()),
  );

  function renderSkeletonGrid(n: number) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: n }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  // ================= TAB 1 — PERIODE & RUN =================
  function renderPeriodTab() {
    const selected = periods.find((p) => p.id === selectedPeriodId) ?? null;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-500">Cutoff tanggal 21 · pembayaran 25 (dimajukan ke Jumat bila weekend)</p>
          {has(HR_GANG) && (
            <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={() => setPeriodDialog(true)} aria-label="Buat periode payroll baru">
              <Plus className="mr-1 h-4 w-4" />Buat Periode
            </Button>
          )}
        </div>

        {loadingPeriods ? renderSkeletonGrid(3) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {periods.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedPeriodId(p.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedPeriodId(p.id); }}
                aria-label={`Pilih periode ${p.name}`}
                className={`cursor-pointer rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:shadow-md ${selectedPeriodId === p.id ? "ring-2 ring-zinc-900/70" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-mono text-base font-bold text-zinc-900">{p.name}</p>
                  {statusPeriodBadge(p.status)}
                </div>
                <p className="mt-1 text-xs text-zinc-500">{formatDate(p.startDate)} — {formatDate(p.endDate)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-zinc-600"><CalendarClock className="mr-1 h-3 w-3" />Cutoff 21</Badge>
                  <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Bayar {formatDate(p.payDate)}</Badge>
                  <Badge variant="outline" className="text-zinc-500">{p.runCount ?? 0} run</Badge>
                </div>
                {p.status === "open" && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {has(HR_GANG) && !p.hasActiveRun && (
                      <Button size="sm" variant="outline" className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        disabled={busy === "calc"}
                        onClick={(e) => { e.stopPropagation(); void handleCalculateRun(p); }}
                        aria-label={`Hitung run periode ${p.name}`}>
                        {busy === "calc" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PlayCircle className="mr-1 h-3 w-3" />}Hitung Run
                      </Button>
                    )}
                    {has(["hr", "director"]) && (
                      <Button size="sm" variant="outline" className="h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={(e) => { e.stopPropagation(); setLockTarget(p); }}
                        aria-label={`Kunci periode ${p.name}`}>
                        <Lock className="mr-1 h-3 w-3" />Kunci
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {periods.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">
                Belum ada periode payroll — buat periode pertama.
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <div>
                <p className="font-semibold text-zinc-900">Run payroll — {selected.name}</p>
                <p className="text-xs text-zinc-500">HR menghitung → Finance menyetujui → Direktur memfinalisasi (immutable + kewajiban)</p>
              </div>
              {loadingRuns && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
            </div>
            <div className="space-y-6 p-4">
              {runs.length === 0 && !loadingRuns && (
                <p className="text-sm text-zinc-500">Belum ada run di periode ini.</p>
              )}
              {runs.map((run) => (
                <div key={run.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-900">Revisi {run.revision}</span>
                      {statusRunBadge(run.status)}
                      <Badge variant="outline" className="text-zinc-500">oleh {run.createdBy}</Badge>
                      {run.inputHash && (
                        <Badge variant="outline" className="font-mono text-[10px] text-zinc-400" aria-label="Hash snapshot">#{run.inputHash.slice(0, 10)}…</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {run.status === "calculated" && has(FIN_REVIEW) && (
                        <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" disabled={busy === `run-${run.id}-approve`}
                          onClick={() => void handleRunAction(run, "approve")} aria-label="Setujui run">
                          {busy === `run-${run.id}-approve` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}Setujui
                        </Button>
                      )}
                      {run.status === "calculated" && has(FIN_REVIEW) && (
                        <Button size="sm" variant="outline" className="h-7 border-rose-300 text-rose-600 hover:bg-rose-50" disabled={busy === `run-${run.id}-reject`}
                          onClick={() => void handleRunAction(run, "reject")} aria-label="Tolak run">
                          <XCircle className="mr-1 h-3 w-3" />Tolak
                        </Button>
                      )}
                      {run.status === "approved" && has(DIR_ONLY) && (
                        <Button size="sm" className="h-7 bg-zinc-900 hover:bg-zinc-800" disabled={busy === `run-${run.id}-finalize`}
                          onClick={() => setFinalizeTarget(run)} aria-label="Finalisasi run">
                          <Stamp className="mr-1 h-3 w-3" />Finalisasi
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Dibuat {formatDateTime(run.createdAt)}{run.finalizedAt ? ` · difinalisasi ${formatDateTime(run.finalizedAt)}` : ""}{run.note ? ` — ${run.note}` : ""}
                  </p>

                  <div className="mt-3 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Karyawan</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Potongan</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {run.slips.map((slip) => (
                          <SlipRow key={slip.id} slip={slip} />
                        ))}
                        {run.slips.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-sm text-zinc-400">Tidak ada slip</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function SlipRow({ slip }: { slip: PayrollRunDTO["slips"][number] }) {
    const [open, setOpen] = useState(false);
    const items = [...slip.items].sort((a, b) =>
      (COMPONENT_ORDER[a.componentCode] ?? 6) - (COMPONENT_ORDER[b.componentCode] ?? 6),
    );
    return (
      <>
        <TableRow className="hover:bg-zinc-50">
          <TableCell>
            <button type="button" onClick={() => setOpen(!open)} aria-label={open ? "Tutup rincian komponen" : "Buka rincian komponen"}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </TableCell>
          <TableCell>
            <span className="font-medium text-zinc-900">{slip.employee?.preferredName ?? slip.employeeId}</span>
            <span className="ml-2 font-mono text-xs text-zinc-400">{slip.employee?.employeeNumber}</span>
          </TableCell>
          <TableCell className="text-right font-medium">{formatCurrency(slip.gross)}</TableCell>
          <TableCell className="text-right text-rose-600">{slip.deduction > 0 ? `-${formatCurrency(slip.deduction)}` : "-"}</TableCell>
          <TableCell className="text-right font-bold text-zinc-900">{formatCurrencyFull(slip.net)}</TableCell>
          <TableCell>{statusSlipBadge(slip.status)}</TableCell>
        </TableRow>
        {open && (
          <TableRow className="bg-zinc-50/60">
            <TableCell colSpan={6}>
              <div className="max-h-96 space-y-1 overflow-y-auto crm-scroll py-1">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-white">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px] text-zinc-500">{it.componentCode}</Badge>
                      <span className="truncate text-zinc-700">{it.label}</span>
                      {it.quantity !== 1 && <span className="shrink-0 text-xs text-zinc-400">×{it.quantity}{it.rate > 0 ? ` @${formatCurrency(it.rate)}` : ""}</span>}
                    </span>
                    <span className={`shrink-0 font-medium ${itemAmountCls(it.classification)}`}>{formatCurrencyFull(it.amount)}</span>
                  </div>
                ))}
                {items.length === 0 && <p className="px-2 py-1 text-sm text-zinc-400">Tidak ada komponen</p>}
              </div>
            </TableCell>
          </TableRow>
        )}
      </>
    );
  }

  // ================= TAB 2 — SLIP SAYA =================
  function renderMeTab() {
    if (loadingMe) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      );
    }
    if (!me) {
      return (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center">
          <Wallet className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-2 text-sm font-medium text-zinc-700">Akun belum terhubung ke data karyawan</p>
          <p className="text-xs text-zinc-500">{globalError ?? "Hubungi HR untuk mengaitkan akun Anda dengan Employee."}</p>
        </div>
      );
    }
    const lastSlip = me.mySlips[0] ?? null;
    const history = me.mySlips.slice(1);
    const lastEarnings = lastSlip ? lastSlip.items.filter((i) => i.classification === "earning") : [];
    const lastDeductions = lastSlip ? lastSlip.items.filter((i) => i.classification === "deduction") : [];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatChip label="Poin didapat" value={`${me.points.earned}`} icon={<ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />} cls="text-emerald-700" />
          <StatChip label="Poin dicairkan" value={`${me.points.redeemed}`} icon={<ArrowDownRight className="h-3.5 w-3.5 text-rose-600" />} cls="text-rose-600" />
          <StatChip label="Poin tersedia" value={`${me.points.available}${me.points.reserved > 0 ? ` (${me.points.reserved} ditahan)` : ""}`} icon={<Coins className="h-3.5 w-3.5 text-zinc-900" />} cls="text-zinc-900" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">Halo, <span className="font-semibold text-zinc-800">{me.employee.preferredName}</span> · {me.employee.employeeNumber} · {me.employee.employmentStatus === "intern" ? "Magang" : "Karyawan"}</p>
          <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={() => setRedeemDialog(true)} aria-label="Cairkan poin">
            <HandCoins className="mr-1 h-4 w-4" />Cairkan Poin
          </Button>
        </div>

        {lastSlip ? (
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Slip gaji terakhir — periode</p>
                <p className="font-mono text-lg font-bold text-zinc-900">{lastSlip.run?.period?.name ?? "-"}</p>
                {lastSlip.run?.period?.payDate && (
                  <Badge className="mt-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Bayar {formatDate(lastSlip.run.period.payDate)}</Badge>
                )}
              </div>
              {statusSlipBadge(lastSlip.status)}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-400">Pendapatan</p>
                <div className="mt-2 max-h-96 space-y-1 overflow-y-auto crm-scroll">
                  {lastEarnings.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-zinc-50">
                      <span className="truncate text-zinc-700">{i.label}</span>
                      <span className="shrink-0 font-medium text-emerald-700">{formatCurrencyFull(i.amount)}</span>
                    </div>
                  ))}
                  {lastDeductions.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-zinc-50">
                      <span className="truncate text-zinc-700">{i.label}</span>
                      <span className="shrink-0 font-medium text-rose-600">{formatCurrencyFull(i.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1 border-t pt-2 text-sm">
                  <div className="flex justify-between"><span className="text-zinc-500">Gross</span><span className="font-medium">{formatCurrencyFull(lastSlip.gross)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Potongan</span><span className="font-medium text-rose-600">-{formatCurrencyFull(lastSlip.deduction)}</span></div>
                  <div className="flex justify-between text-base"><span className="font-semibold text-zinc-900">Net dibayar</span><span className="font-bold text-zinc-900">{formatCurrencyFull(lastSlip.net)}</span></div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-400">Riwayat slip (12 terakhir)</p>
                  <div className="mt-2 max-h-96 space-y-1 overflow-y-auto crm-scroll">
                    {history.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50">
                        <span className="font-mono text-zinc-700">{s.run?.period?.name ?? "-"}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-zinc-900">{formatCurrencyFull(s.net)}</span>
                          {statusSlipBadge(s.status)}
                        </span>
                      </div>
                    ))}
                    {history.length === 0 && <p className="text-sm text-zinc-400">Belum ada slip sebelumnya</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-400">Reservasi pencairan saya</p>
                  <div className="mt-2 max-h-96 space-y-1 overflow-y-auto crm-scroll">
                    {me.myReservations.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50">
                        <span className="text-zinc-700">{r.points} poin · {formatDateTime(r.createdAt)}</span>
                        {statusReservationBadge(r.status)}
                      </div>
                    ))}
                    {me.myReservations.length === 0 && <p className="text-sm text-zinc-400">Belum ada pencairan</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">
            Belum ada slip gaji — slip muncul setelah run payroll difinalisasi.
          </div>
        )}

        {me.myIncentives.length > 0 && (
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase text-zinc-400">Proposal insentif saya</p>
            <div className="mt-2 max-h-96 space-y-1 overflow-y-auto crm-scroll">
              {me.myIncentives.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-zinc-500">{SOURCE_LABEL[p.sourceType] ?? p.sourceType}</Badge>
                    <span className="truncate text-zinc-700">{p.reason}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                    {p.proposedPoints > 0 && <span className="font-medium text-emerald-700">+{p.proposedPoints} poin</span>}
                    {p.proposedAmount > 0 && <span className="font-medium text-zinc-900">{formatCurrency(p.proposedAmount)}</span>}
                    {statusIncentiveBadge(p.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================= TAB 3 — POIN (ADMIN) =================
  function renderPointsTab() {
    const canAdjust = has(["hr", "director", "super_admin"]);
    const canResv = has(ADMIN_ROLES);
    const employeeName = (id: string) => employees.find((e) => e.id === id)?.preferredName ?? id;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Label className="text-xs text-zinc-500">Karyawan</Label>
            <Select value={selectedPointEmp} onValueChange={setSelectedPointEmp} disabled={loadingEmployees}>
              <SelectTrigger aria-label="Pilih karyawan untuk ledger poin"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.preferredName} · {e.employeeNumber}{e.employmentStatus === "intern" ? " (magang)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canAdjust && (
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" disabled={!selectedPointEmp}
              onClick={() => setAdjustDialog(true)} aria-label="Buat jurnal penyesuaian poin">
              <Plus className="mr-1 h-4 w-4" />Jurnal Adjust
            </Button>
          )}
        </div>

        {loadingPoints ? <Skeleton className="h-64 rounded-xl" /> : points ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatChip label="Didapat" value={`${points.summary.earned}`} icon={<ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />} cls="text-emerald-700" />
              <StatChip label="Dicairkan" value={`${points.summary.redeemed}`} icon={<ArrowDownRight className="h-3.5 w-3.5 text-rose-600" />} cls="text-rose-600" />
              <StatChip label="Ditahan" value={`${points.summary.reserved}`} icon={<Hourglass className="h-3.5 w-3.5 text-amber-600" />} cls="text-amber-600" />
              <StatChip label="Tersedia" value={`${points.summary.available}`} icon={<Coins className="h-3.5 w-3.5 text-zinc-900" />} cls="text-zinc-900" />
            </div>

            <div className="rounded-xl border bg-white shadow-sm">
              <div className="border-b p-4">
                <p className="font-semibold text-zinc-900">Ledger poin — {points.employee.preferredName} <span className="font-mono text-xs text-zinc-400">{points.employee.employeeNumber}</span></p>
                <p className="text-xs text-zinc-500">Append-only: earn (+) · redeem (−) · adjust (±). Sumber kebenaran saldo.</p>
              </div>
              <div className="max-h-96 overflow-y-auto crm-scroll">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead className="text-right">Poin</TableHead>
                      <TableHead>Sumber</TableHead>
                      <TableHead>Catatan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {points.entries.map((en) => (
                      <TableRow key={en.id} className="hover:bg-zinc-50">
                        <TableCell className="whitespace-nowrap text-xs text-zinc-500">{formatDateTime(en.createdAt)}</TableCell>
                        <TableCell>{kindPointBadge(en.kind)}</TableCell>
                        <TableCell className={`text-right font-semibold ${en.points >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                          {en.points > 0 ? `+${en.points}` : en.points}
                        </TableCell>
                        <TableCell className="text-xs text-zinc-500">{en.sourceType ?? "—"}{en.sourceRef ? <span className="ml-1 font-mono text-[10px] text-zinc-400">{en.sourceRef.slice(0, 14)}…</span> : null}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs text-zinc-600">{en.note ?? "—"} <span className="text-zinc-400">· {en.createdBy}</span></TableCell>
                      </TableRow>
                    ))}
                    {points.entries.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-zinc-400">Ledger kosong</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">Pilih karyawan untuk melihat ledger poin.</div>
        )}

        <div className="rounded-xl border bg-white shadow-sm">
          <div className="border-b p-4">
            <p className="font-semibold text-zinc-900">Antrian pencairan poin (semua karyawan)</p>
            <p className="text-xs text-zinc-500">Settle → kewajiban pembayaran Rp {CONVERSION_VALUE.toLocaleString("id-ID")}/10 poin (nilai konversi sementara) · Release → saldo kembali</p>
          </div>
          <div className="max-h-96 overflow-y-auto crm-scroll">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead className="text-right">Poin</TableHead>
                  <TableHead>Nilai (settle)</TableHead>
                  <TableHead>Diajukan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservations.map((r) => (
                  <TableRow key={r.id} className="hover:bg-zinc-50">
                    <TableCell className="font-medium text-zinc-800">{employeeName(r.employeeId)}</TableCell>
                    <TableCell className="text-right font-semibold">{r.points}</TableCell>
                    <TableCell className="text-zinc-600">{formatCurrency((r.points / 10) * CONVERSION_VALUE)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>{statusReservationBadge(r.status)}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "reserved" && canResv && (
                        <span className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                            disabled={busy === `resv-${r.id}-release`}
                            onClick={() => void handleReservation(r, "release")} aria-label={`Lepas reservasi ${r.points} poin`}>
                            <XCircle className="mr-1 h-3 w-3" />Release
                          </Button>
                          <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700"
                            disabled={busy === `resv-${r.id}-settle`}
                            onClick={() => setSettleTarget(r)} aria-label={`Settle pembayaran ${r.points} poin`}>
                            <BadgeCheck className="mr-1 h-3 w-3" />Settle
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {reservations.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-zinc-400">Belum ada reservasi pencairan</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    );
  }

  // ================= TAB 4 — INSENTIF =================
  function renderIncentivesTab() {
    const canCreate = has(["manager", "director", "super_admin"]);
    const canDecide = has(["director", "super_admin", "hr"]);
    const canPay = has(FIN_PAY);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-500">Usulan poin/uang atas tugas, lembur, dinas, atau proyek — keputusan tidak boleh oleh diri sendiri</p>
          <div className="flex items-center gap-2">
            <Select value={incentiveFilter} onValueChange={(v) => { setIncentiveFilter(v); void loadIncentives(v); }}>
              <SelectTrigger className="w-40" aria-label="Filter status insentif"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="pending">Menunggu</SelectItem>
                <SelectItem value="approved">Disetujui</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
                <SelectItem value="paid">Dibayar</SelectItem>
              </SelectContent>
            </Select>
            {canCreate && (
              <Button size="sm" className="bg-zinc-900 hover:bg-zinc-800" onClick={() => setIncentiveDialog(true)} aria-label="Buat proposal insentif">
                <Plus className="mr-1 h-4 w-4" />Usulkan
              </Button>
            )}
          </div>
        </div>

        {loadingIncentives ? renderSkeletonGrid(3) : (
          <div className="max-h-96 space-y-2 overflow-y-auto crm-scroll">
            {incentives.map((p) => {
              const isSelf = !!myEmployeeId && p.employeeId === myEmployeeId;
              return (
                <div key={p.id} className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-zinc-900">{p.employee?.preferredName ?? p.employeeId}</span>
                        <span className="font-mono text-xs text-zinc-400">{p.employee?.employeeNumber}</span>
                        <Badge variant="outline" className="text-zinc-600">{SOURCE_LABEL[p.sourceType] ?? p.sourceType}</Badge>
                        {statusIncentiveBadge(p.status)}
                        {isSelf && <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">Untuk diri sendiri — tak boleh memutuskan</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">{p.reason}</p>
                      <p className="mt-1 text-xs text-zinc-400">Diusulkan {p.proposedBy} · {formatDateTime(p.createdAt)}{p.decidedBy ? ` · diputuskan ${p.decidedBy}` : ""}{p.paidAt ? ` · dibayar ${formatDate(p.paidAt)}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {p.proposedPoints > 0 && <span className="font-semibold text-emerald-700">+{p.proposedPoints} poin</span>}
                      {p.proposedAmount > 0 && <span className="font-semibold text-zinc-900">{formatCurrencyFull(p.proposedAmount)}</span>}
                      {p.proposedPoints === 0 && p.proposedAmount === 0 && <span className="text-xs text-zinc-400">—</span>}
                    </div>
                  </div>
                  {p.status === "pending" && canDecide && (
                    <div className="mt-3 flex gap-1.5">
                      <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" disabled={busy === `inc-${p.id}-approve` || isSelf}
                        onClick={() => void handleIncentiveAction(p, "approve")} aria-label="Setujui proposal insentif">
                        {busy === `inc-${p.id}-approve` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}Setujui
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 border-rose-300 text-rose-600 hover:bg-rose-50" disabled={busy === `inc-${p.id}-reject` || isSelf}
                        onClick={() => void handleIncentiveAction(p, "reject")} aria-label="Tolak proposal insentif">
                        <XCircle className="mr-1 h-3 w-3" />Tolak
                      </Button>
                    </div>
                  )}
                  {p.status === "approved" && p.proposedAmount > 0 && canPay && (
                    <div className="mt-3">
                      <Button size="sm" variant="outline" className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50" disabled={busy === `inc-${p.id}-pay`}
                        onClick={() => void handleIncentiveAction(p, "pay")} aria-label="Tandai insentif dibayar">
                        <Banknote className="mr-1 h-3 w-3" />Tandai Dibayar (langsung)
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {incentives.length === 0 && (
              <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-zinc-500">Tidak ada proposal pada filter ini.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ================= TAB 5 — UANG SAKU MAGANG =================
  function renderInternTab() {
    const canGenerate = has(["hr", "finance", "director", "super_admin"]);
    const canSubmit = has(["hr", "super_admin"]);
    const canApprove = has(DIR_ONLY);
    const canPay = has(FIN_PAY);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-48">
            <Label className="text-xs text-zinc-500">Bulan</Label>
            <Input type="month" value={internMonth} onChange={(e) => setInternMonth(e.target.value)} aria-label="Pilih bulan accrual" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              disabled={!selectedIntern || busy === "genAccrual" || !canGenerate}
              onClick={() => void handleGenerateAccrual()} aria-label="Generate accrual dari absensi">
              {busy === "genAccrual" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CalendarRange className="mr-1 h-4 w-4" />}
              Generate Accrual dari Absensi
            </Button>
          </div>
        </div>

        {loadingIntern ? renderSkeletonGrid(2) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              {interns.map((it) => {
                const total = accrualTotals.find((t) => t.employeeId === it.id);
                return (
                  <div key={it.id} role="button" tabIndex={0}
                    onClick={() => setSelectedIntern(it.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedIntern(it.id); }}
                    aria-label={`Pilih magang ${it.preferredName}`}
                    className={`w-full cursor-pointer rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:shadow-md ${selectedIntern === it.id ? "ring-2 ring-emerald-500/60" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-semibold text-zinc-900">
                        <GraduationCap className="h-4 w-4 text-emerald-600" />{it.preferredName}
                      </span>
                      <span className="font-mono text-xs text-zinc-400">{it.employeeNumber}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{it.internProgram ?? "Program magang"} · saku {formatCurrency(it.stipendDaily ?? 0)}/hari</p>
                    <p className="mt-2 text-sm">
                      <span className="text-zinc-500">Accrual {internMonth}: </span>
                      <span className="font-bold text-emerald-700">{total ? `${total.days} hari · ${formatCurrency(total.total)}` : "0 hari"}</span>
                    </p>
                    {canSubmit && (
                      <Button size="sm" variant="link" className="mt-1 h-6 px-0 text-xs text-zinc-500 hover:text-zinc-800"
                        onClick={(e) => { e.stopPropagation(); void handleCreateSettlement(it.id); }}
                        aria-label={`Ajukan settlement untuk ${it.preferredName}`}>
                        Ajukan settlement sisa
                      </Button>
                    )}
                  </div>
                );
              })}
              {interns.length === 0 && (
                <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-zinc-500">Tidak ada karyawan magang aktif.</div>
              )}
            </div>

            <div className="rounded-xl border bg-white shadow-sm lg:col-span-2">
              <div className="border-b p-4">
                <p className="font-semibold text-zinc-900">
                  Accrual harian — {interns.find((i) => i.id === selectedIntern)?.preferredName ?? "pilih magang"}
                </p>
                <p className="text-xs text-zinc-500">Dibuat dari absensi check-in terverifikasi (1 baris per tanggal · idempoten)</p>
              </div>
              <div className="max-h-96 overflow-y-auto crm-scroll">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Fraction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accruals.filter((a) => !selectedIntern || a.employeeId === selectedIntern).map((a) => (
                      <TableRow key={a.id} className="hover:bg-zinc-50">
                        <TableCell className="whitespace-nowrap">{formatDate(a.businessDate)}</TableCell>
                        <TableCell className="text-right text-zinc-600">{formatCurrency(a.rate)}</TableCell>
                        <TableCell className="text-right text-zinc-600">{a.fraction}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-700">{formatCurrency(a.amount)}</TableCell>
                        <TableCell>
                          <Badge className={a.status === "verified" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-100"}>
                            {a.status === "verified" ? "Terverifikasi" : a.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {accruals.filter((a) => !selectedIntern || a.employeeId === selectedIntern).length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-zinc-400">Belum ada accrual pada bulan ini</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border bg-white shadow-sm">
          <div className="border-b p-4">
            <p className="font-semibold text-zinc-900">Settlement uang saku</p>
            <p className="text-xs text-zinc-500">Alur: HR mengajukan → Direktur menyetujui → Finance menandai dibayar (kewajiban otomatis tercatat)</p>
          </div>
          <div className="max-h-96 overflow-y-auto crm-scroll">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  <TableHead>Magang</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Dibayar</TableHead>
                  <TableHead>Jatuh tempo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => {
                  const overdue = s.dueDate && s.status !== "paid" && new Date(s.dueDate).getTime() < Date.now();
                  return (
                    <TableRow key={s.id} className="hover:bg-zinc-50">
                      <TableCell>
                        <span className="font-medium text-zinc-900">{s.employee?.preferredName ?? s.employeeId}</span>
                        <span className="ml-2 font-mono text-xs text-zinc-400">{s.employee?.employeeNumber}</span>
                        {s.employee?.active === false && <Badge className="ml-2 bg-zinc-100 text-zinc-500 hover:bg-zinc-100">keluar</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrencyFull(s.totalAccrued)}</TableCell>
                      <TableCell className="text-right text-zinc-600">{s.paidTotal > 0 ? formatCurrencyFull(s.paidTotal) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {s.dueDate ? (
                          <span className={overdue ? "font-semibold text-rose-600" : "text-zinc-500"}>
                            {formatDate(s.dueDate)}{overdue ? " · lewat tempo" : ""}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>{statusSettlementBadge(s.status)}</TableCell>
                      <TableCell className="text-right">
                        <span className="flex justify-end gap-1.5">
                          {s.status === "open" && canSubmit && (
                            <Button size="sm" variant="outline" className="h-7 border-zinc-300 text-zinc-700 hover:bg-zinc-50" disabled={busy === `setlAct-${s.id}-submit`}
                              onClick={() => void handleSettlementAction(s, "submit")} aria-label="Ajukan settlement">
                              <Send className="mr-1 h-3 w-3" />Ajukan
                            </Button>
                          )}
                          {s.status === "submitted" && canApprove && (
                            <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" disabled={busy === `setlAct-${s.id}-approve`}
                              onClick={() => void handleSettlementAction(s, "approve")} aria-label="Setujui settlement">
                              <CheckCircle2 className="mr-1 h-3 w-3" />Setujui
                            </Button>
                          )}
                          {s.status === "approved" && canPay && (
                            <Button size="sm" className="h-7 bg-zinc-900 hover:bg-zinc-800" disabled={busy === `setlAct-${s.id}-pay`}
                              onClick={() => void handleSettlementAction(s, "pay")} aria-label="Tandai settlement dibayar">
                              <Banknote className="mr-1 h-3 w-3" />Tandai Dibayar
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {settlements.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-zinc-400">Belum ada settlement</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    );
  }

  // ================= TAB 6 — UMK =================
  function renderUmkTab() {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-500">Upah minimum kota per wilayah — basis formula insentif dinas</p>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <Input className="pl-8" placeholder="Cari wilayah / kode…" value={umkQuery} onChange={(e) => setUmkQuery(e.target.value)} aria-label="Cari referensi UMK" />
          </div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm">
          {loadingUmk ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead>Wilayah</TableHead>
                  <TableHead className="w-20">Tahun</TableHead>
                  <TableHead className="text-right">UMK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {umkFiltered.map((r) => (
                  <TableRow key={r.id} className="hover:bg-zinc-50">
                    <TableCell><Badge variant="outline" className="font-mono text-zinc-600">{r.regionCode}</Badge></TableCell>
                    <TableCell className="font-medium text-zinc-800">{r.regionName}</TableCell>
                    <TableCell className="text-zinc-500">{r.year}</TableCell>
                    <TableCell className="text-right font-semibold text-zinc-900">{formatCurrencyFull(r.amount)}</TableCell>
                  </TableRow>
                ))}
                {umkFiltered.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-zinc-400">Tidak ada wilayah cocok</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    );
  }

  // ===== Render utama =====
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <Wallet className="h-5 w-5 text-emerald-600" />Payroll &amp; Poin
          </h2>
          <p className="text-sm text-zinc-500">Kompensasi terpadu: periode gaji, poin karyawan, insentif, uang saku magang &amp; referensi UMK</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refreshCurrentTab()} aria-label="Muat ulang data payroll">
          <RefreshCw className={`mr-1 h-4 w-4 ${loadingPeriods || loadingRuns || loadingMe || loadingPoints || loadingIncentives || loadingIntern || loadingUmk ? "animate-spin" : ""}`} />Muat Ulang
        </Button>
      </div>

      {globalError && !isAdmin && !loadingMe ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
          <p className="mt-2 text-sm font-medium text-rose-700">{globalError}</p>
          <Button size="sm" variant="outline" className="mt-3 border-rose-300 text-rose-700 hover:bg-rose-100" onClick={() => void loadMe()}>Coba Lagi</Button>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className={`flex flex-wrap gap-1 ${isAdmin ? "" : "hidden"}`} aria-label="Tab modul payroll">
            {visibleTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} aria-label={`Tab ${t.label}`}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
          {!firstLoadDone && <Skeleton className="h-48 rounded-xl" />}
          {firstLoadDone && (
            <>
              <TabsContent value="period" className="mt-4">{renderPeriodTab()}</TabsContent>
              <TabsContent value="me" className="mt-4">{renderMeTab()}</TabsContent>
              <TabsContent value="points" className="mt-4">{renderPointsTab()}</TabsContent>
              <TabsContent value="incentives" className="mt-4">{renderIncentivesTab()}</TabsContent>
              <TabsContent value="intern" className="mt-4">{renderInternTab()}</TabsContent>
              <TabsContent value="umk" className="mt-4">{renderUmkTab()}</TabsContent>
            </>
          )}
        </Tabs>
      )}

      {/* ===== Dialog buat periode ===== */}
      <Dialog open={periodDialog} onOpenChange={setPeriodDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Periode Payroll</DialogTitle>
            <DialogDescription>
              Cutoff tanggal 21. PayDate otomatis = tanggal akhir + 4 hari, dimajukan ke Jumat bila jatuh weekend.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nama periode (YYYY-MM)</Label>
              <Input placeholder="2026-11" value={pName} onChange={(e) => setPName(e.target.value)} aria-label="Nama periode" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Mulai</Label>
                <Input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} aria-label="Tanggal mulai periode" />
              </div>
              <div>
                <Label className="text-xs">Akhir (cutoff 21)</Label>
                <Input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} aria-label="Tanggal akhir periode" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeriodDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 hover:bg-zinc-800" disabled={busy === "createPeriod"} onClick={() => void handleCreatePeriod()}>
              {busy === "createPeriod" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Buat Periode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Konfirmasi kunci periode ===== */}
      <AlertDialog open={!!lockTarget} onOpenChange={(o) => !o && setLockTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kunci periode {lockTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Periode terkunci tidak bisa menerima run baru. Run yang sudah ada tetap bisa diproses sampai final.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-amber-600 hover:bg-amber-700" onClick={() => void handleLockPeriod()}>Ya, Kunci</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Konfirmasi finalisasi run ===== */}
      <AlertDialog open={!!finalizeTarget} onOpenChange={(o) => !o && setFinalizeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalisasi run {finalizeTarget ? `revisi ${finalizeTarget.revision}` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini IMMUTABLE: semua slip dikunci menjadi finalized, kewajiban pembayaran per karyawan
              otomatis tercatat di Finance, dan snapshot di-hash. Koreksi hanya lewat run revisi baru.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-zinc-900 hover:bg-zinc-800" onClick={() => finalizeTarget && void handleRunAction(finalizeTarget, "finalize")}>
              {busy === `run-${finalizeTarget?.id}-finalize` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Stamp className="mr-1 h-4 w-4" />}
              Ya, Finalisasi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Dialog cairkan poin ===== */}
      <Dialog open={redeemDialog} onOpenChange={setRedeemDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cairkan Poin</DialogTitle>
            <DialogDescription>
              Kelipatan 10 · nilai konversi sementara Rp {CONVERSION_VALUE.toLocaleString("id-ID")}/10 poin.
              Tersedia: <span className="font-bold text-zinc-900">{me?.points.available ?? 0} poin</span>
              {me && me.points.reserved > 0 ? ` (${me.points.reserved} sedang ditahan)` : ""}.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Jumlah poin</Label>
            <Input type="number" min={10} step={10} placeholder="contoh: 20" value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)} aria-label="Jumlah poin yang dicairkan" />
            <p className="mt-2 text-xs text-zinc-500">
              ≈ {formatCurrency((Math.floor(Number(redeemPoints || 0) / 10)) * CONVERSION_VALUE)} — diajukan sebagai reservasi, dibayar setelah HR/Finance men-settle.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeemDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 hover:bg-zinc-800" disabled={busy === "redeem"} onClick={() => void handleRedeem()}>
              {busy === "redeem" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <HandCoins className="mr-1 h-4 w-4" />}Ajukan Pencairan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog jurnal adjust ===== */}
      <Dialog open={adjustDialog} onOpenChange={setAdjustDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Jurnal Penyesuaian Poin</DialogTitle>
            <DialogDescription>
              Append-only. Gunakan tanda: positif menambah, negatif mengurangi. Catatan wajib sebagai jejak audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Karyawan</Label>
              <Input disabled value={employees.find((e) => e.id === selectedPointEmp)?.preferredName ?? "-"} aria-label="Karyawan yang disesuaikan" />
            </div>
            <div>
              <Label className="text-xs">Poin (bernilai tanda)</Label>
              <Input type="number" placeholder="contoh: 5 atau -10" value={adjustPoints} onChange={(e) => setAdjustPoints(e.target.value)} aria-label="Poin penyesuaian" />
            </div>
            <div>
              <Label className="text-xs">Catatan (wajib)</Label>
              <Textarea rows={2} placeholder="Alasan penyesuaian…" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} aria-label="Catatan penyesuaian" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialog(false)}>Batal</Button>
            <Button className="bg-amber-600 hover:bg-amber-700" disabled={busy === "adjust"} onClick={() => void handleAdjust()}>
              {busy === "adjust" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Stamp className="mr-1 h-4 w-4" />}Catat Adjust
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Konfirmasi settle reservasi ===== */}
      <AlertDialog open={!!settleTarget} onOpenChange={(o) => !o && setSettleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Settle pencairan {settleTarget?.points} poin?</AlertDialogTitle>
            <AlertDialogDescription>
              Poin dibukukan sebagai redeem permanen dan kewajiban pembayaran{" "}
              <span className="font-semibold">{formatCurrencyFull(((settleTarget?.points ?? 0) / 10) * CONVERSION_VALUE)}</span>{" "}
              tercipta di Finance (nilai konversi sementara Rp {CONVERSION_VALUE.toLocaleString("id-ID")}/10 poin). Tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700" onClick={() => settleTarget && void handleReservation(settleTarget, "settle")}>
              Ya, Settle &amp; Catat Kewajiban
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== Dialog usulkan insentif ===== */}
      <Dialog open={incentiveDialog} onOpenChange={setIncentiveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Usulkan Insentif</DialogTitle>
            <DialogDescription>
              Isi poin dan/atau uang. Poin masuk ledger saat disetujui; uang insentif dibayar lewat run payroll.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Karyawan penerima</Label>
              <Select value={incEmployee} onValueChange={setIncEmployee}>
                <SelectTrigger aria-label="Pilih karyawan penerima insentif"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {employees.filter((e) => e.active !== false).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.preferredName} · {e.employeeNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sumber</Label>
              <Select value={incSource} onValueChange={setIncSource}>
                <SelectTrigger aria-label="Sumber insentif"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Tugas</SelectItem>
                  <SelectItem value="overtime">Lembur</SelectItem>
                  <SelectItem value="travel">Dinas</SelectItem>
                  <SelectItem value="project">Proyek</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Poin insentif</Label>
                <Input type="number" min={0} placeholder="0" value={incPoints} onChange={(e) => setIncPoints(e.target.value)} aria-label="Poin insentif" />
              </div>
              <div>
                <Label className="text-xs">Uang insentif (Rp)</Label>
                <Input type="number" min={0} placeholder="0" value={incAmount} onChange={(e) => setIncAmount(e.target.value)} aria-label="Uang insentif" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Alasan / justifikasi (wajib)</Label>
              <Textarea rows={2} placeholder="Contoh: menyelesaikan render episode 5-8 di luar jam kerja…" value={incReason} onChange={(e) => setIncReason(e.target.value)} aria-label="Alasan insentif" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncentiveDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 hover:bg-zinc-800" disabled={busy === "createInc"} onClick={() => void handleCreateIncentive()}>
              {busy === "createInc" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trophy className="mr-1 h-4 w-4" />}Kirim Usulan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
