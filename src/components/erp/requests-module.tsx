"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, BadgeCheck, Banknote, Briefcase, CalendarDays, Check, Timer,
  Plus, RefreshCw, Wallet, X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
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
import { formatCurrency, formatDate } from "@/lib/crm/utils";
import {
  hrisApi,
  type EmployeeRow, type HrisOverview, type LeaveRow, type OvertimeRow, type TravelRow,
} from "@/lib/erp/hris-client";

// ===== Konstanta & util =====

const HR_ROLES = ["hr", "director", "super_admin"];
const MANAGER_PLUS = ["hr", "manager", "director", "super_admin"];
const DIRECTOR_ROLES = ["director", "super_admin"];
const CLOSE_ROLES = ["finance", "director", "super_admin"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function minuteLabel(m: number): string {
  const day = Math.floor(m / 1440);
  const rem = m % 1440;
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return day > 0 ? `${hh}:${mm} +${day} hari` : `${hh}:${mm}`;
}
function timeToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// ===== Badge helpers =====

const badgeCls = (cls: string) => `border ${cls}`;

function LeaveStatusBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}>Menunggu</Badge>;
  if (status === "approved") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Disetujui</Badge>;
  if (status === "rejected") return <Badge className={badgeCls("bg-rose-50 text-rose-700 border-rose-200")}>Ditolak</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Dibatalkan</Badge>;
}

function OvertimeStatusBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}>Menunggu</Badge>;
  if (status === "approved") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Disetujui</Badge>;
  if (status === "rejected") return <Badge className={badgeCls("bg-rose-50 text-rose-700 border-rose-200")}>Ditolak</Badge>;
  return <Badge className={badgeCls("bg-cyan-50 text-cyan-700 border-cyan-200")}>Terverifikasi</Badge>;
}

function TravelStatusBadge({ status }: { status: string }) {
  if (status === "draft") return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Draft</Badge>;
  if (status === "approved") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Disetujui</Badge>;
  if (status === "ongoing") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}>Berjalan</Badge>;
  if (status === "settlement_pending") return <Badge className={badgeCls("bg-violet-50 text-violet-700 border-violet-200")}>Settlement</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Selesai</Badge>;
}

function SettlementBadge({ s }: { s: string }) {
  if (s === "return_due") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}><Wallet className="mr-1 h-3 w-3" />Kembalikan ke kas</Badge>;
  if (s === "additional_payable") return <Badge className={badgeCls("bg-rose-50 text-rose-700 border-rose-200")}><Banknote className="mr-1 h-3 w-3" />Kurang bayar</Badge>;
  if (s === "balanced") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}><Check className="mr-1 h-3 w-3" />Seimbang</Badge>;
  return null;
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ===== Komponen utama =====

export default function RequestsModule() {
  const user = useCrmStore((s) => s.user);
  const role = user?.role ?? null;

  const isHrTeam = role ? HR_ROLES.includes(role) : false;
  const isManagerPlus = role ? MANAGER_PLUS.includes(role) : false;
  const isDirector = role ? DIRECTOR_ROLES.includes(role) : false;
  const canCloseTravel = role ? CLOSE_ROLES.includes(role) : false;
  const myId = user?.id ?? null;

  // ===== Data state =====
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [overview, setOverview] = useState<HrisOverview | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [overtimes, setOvertimes] = useState<OvertimeRow[]>([]);
  const [travels, setTravels] = useState<TravelRow[]>([]);
  const [myPending, setMyPending] = useState({ leaves: 0, overtimes: 0 });

  // ===== Dialog state =====
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [overtimeDialog, setOvertimeDialog] = useState(false);
  const [verifyOtId, setVerifyOtId] = useState<string | null>(null);
  const [verifyMinutes, setVerifyMinutes] = useState<string>("");
  const [settleTravel, setSettleTravel] = useState<TravelRow | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>("");
  const [travelDialog, setTravelDialog] = useState(false);

  const loadOverview = useCallback(async () => {
    const res = await hrisApi.overview();
    setOverview(res);
  }, []);

  const loadEmployees = useCallback(async () => {
    // Daftar karyawan dipakai dialog lembur (pilih bawahan utk manager+)
    const res = await hrisApi.employees();
    setEmployees(res.employees);
  }, []);

  const loadLeaves = useCallback(async () => {
    const res = await hrisApi.leaves(isManagerPlus ? { status: "all" } : { mine: true });
    setLeaves(res.requests);
  }, [isManagerPlus]);

  const loadOvertimes = useCallback(async () => {
    const res = await hrisApi.overtimes(isManagerPlus ? { status: "all" } : { mine: true });
    setOvertimes(res.requests);
  }, [isManagerPlus]);

  const loadTravels = useCallback(async () => {
    const res = await hrisApi.travels(isManagerPlus ? { status: "all" } : { mine: true });
    setTravels(res.orders);
  }, [isManagerPlus]);

  const loadMyPending = useCallback(async () => {
    try {
      const [l, o] = await Promise.all([
        hrisApi.leaves({ mine: true, status: "pending" }),
        hrisApi.overtimes({ mine: true, status: "pending" }),
      ]);
      setMyPending({ leaves: l.requests.length, overtimes: o.requests.length });
    } catch {
      // badge pribadi — gagal diamkan
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setGlobalError(null);
    const tasks: Array<[string, () => Promise<void>]> = [
      ["Ringkasan", loadOverview],
      ["Karyawan", loadEmployees],
      ["Pengajuan", loadLeaves],
      ["Lembur", loadOvertimes],
      ["Dinas", loadTravels],
      ["Pengajuan saya", loadMyPending],
    ];
    const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
    const firstFail = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstFail) {
      const msg = firstFail.reason instanceof Error ? firstFail.reason.message : "Gagal memuat data";
      setGlobalError(msg);
      toast.error(msg);
    }
    setLoading(false);
  }, [loadOverview, loadEmployees, loadLeaves, loadOvertimes, loadTravels, loadMyPending]);

  useEffect(() => {
    // Ditunda 1 tick agar setState awal tidak berjalan sinkron di dalam effect.
    const id = setTimeout(() => { void loadAll(); }, 0);
    return () => clearTimeout(id);
  }, [loadAll]);

  // ===== Aksi: leave =====
  const [leaveForm, setLeaveForm] = useState({ type: "izin", startDate: todayIso(), endDate: todayIso(), reason: "", evidenceUrl: "" });
  const submitLeave = async () => {
    try {
      if (!leaveForm.reason.trim()) { toast.error("Alasan wajib diisi"); return; }
      if (leaveForm.startDate > leaveForm.endDate) { toast.error("Tanggal mulai harus <= tanggal selesai"); return; }
      await hrisApi.createLeave({
        type: leaveForm.type,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason.trim(),
        ...(leaveForm.evidenceUrl.trim() ? { evidenceUrl: leaveForm.evidenceUrl.trim() } : {}),
      });
      toast.success("Pengajuan terkirim — menunggu persetujuan");
      setLeaveDialog(false);
      setLeaveForm({ type: "izin", startDate: todayIso(), endDate: todayIso(), reason: "", evidenceUrl: "" });
      await Promise.all([loadLeaves(), loadMyPending(), loadOverview()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat pengajuan");
    }
  };
  const decideLeave = async (id: string, action: "approve" | "reject" | "cancel") => {
    try {
      await hrisApi.decideLeave(id, { action });
      toast.success(action === "approve" ? "Pengajuan disetujui" : action === "reject" ? "Pengajuan ditolak" : "Pengajuan dibatalkan");
      await Promise.all([loadLeaves(), loadMyPending(), loadOverview()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses pengajuan");
    }
  };

  // ===== Aksi: overtime =====
  const [otForm, setOtForm] = useState({ employeeId: "self", date: todayIso(), start: "17:00", end: "20:00", crossMidnight: false, reason: "", taskRef: "", consent: true });
  const otPlanned = useMemo(() => {
    const s = timeToMinutes(otForm.start);
    const e = timeToMinutes(otForm.end);
    if (s === null || e === null) return null;
    const end = otForm.crossMidnight ? e + 1440 : e;
    if (end <= s) return null;
    return { start: s, end };
  }, [otForm.start, otForm.end, otForm.crossMidnight]);
  const otNeedsReview = otPlanned ? otPlanned.end > 1440 || otPlanned.end - otPlanned.start > 240 : false;

  const submitOvertime = async () => {
    try {
      if (!otForm.reason.trim()) { toast.error("Alasan lembur wajib diisi"); return; }
      if (!otPlanned) { toast.error("Jam selesai harus lebih besar dari jam mulai"); return; }
      const isForOther = otForm.employeeId !== "self";
      if (isForOther && otForm.consent) { toast.error("Consent hanya boleh diberikan staf yang bersangkutan"); return; }
      await hrisApi.createOvertime({
        ...(isForOther ? { employeeId: otForm.employeeId } : {}),
        date: otForm.date,
        startMinute: otPlanned.start,
        endMinute: otPlanned.end,
        reason: otForm.reason.trim(),
        ...(otForm.taskRef.trim() ? { taskRef: otForm.taskRef.trim() } : {}),
        consent: !isForOther && otForm.consent,
      });
      toast.success(otNeedsReview ? "Order lembur dibuat — melewati batas harian, perlu review HR" : "Order lembur terkirim");
      setOvertimeDialog(false);
      setOtForm({ employeeId: "self", date: todayIso(), start: "17:00", end: "20:00", crossMidnight: false, reason: "", taskRef: "", consent: true });
      await Promise.all([loadOvertimes(), loadMyPending(), loadOverview()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat order lembur");
    }
  };
  const decideOvertime = async (id: string, action: "approve" | "reject") => {
    try {
      await hrisApi.decideOvertime(id, { action });
      toast.success(action === "approve" ? "Lembur disetujui" : "Lembur ditolak");
      await Promise.all([loadOvertimes(), loadMyPending()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses lembur");
    }
  };
  const submitVerify = async () => {
    if (!verifyOtId) return;
    const minutes = Number(verifyMinutes);
    if (!Number.isInteger(minutes) || minutes < 0) { toast.error("Realisasi menit tidak valid"); return; }
    try {
      await hrisApi.decideOvertime(verifyOtId, { action: "verify", realizedMinutes: minutes });
      toast.success("Realisasi lembur terverifikasi");
      setVerifyOtId(null);
      await loadOvertimes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal verifikasi lembur");
    }
  };

  // ===== Aksi: travel =====
  const [travelForm, setTravelForm] = useState({ purpose: "", destination: "", projectRef: "", departDate: todayIso(), returnDate: todayIso(), advanceAmount: "", allowanceDaily: "" });
  const submitTravel = async () => {
    try {
      if (!travelForm.purpose.trim()) { toast.error("Keperluan dinas wajib diisi"); return; }
      if (!travelForm.destination.trim()) { toast.error("Kota/tujuan wajib diisi"); return; }
      if (travelForm.returnDate < travelForm.departDate) { toast.error("Tanggal kembali harus >= tanggal berangkat"); return; }
      await hrisApi.createTravel({
        purpose: travelForm.purpose.trim(),
        destination: travelForm.destination.trim(),
        ...(travelForm.projectRef.trim() ? { projectRef: travelForm.projectRef.trim() } : {}),
        departDate: travelForm.departDate,
        returnDate: travelForm.returnDate,
        ...(travelForm.advanceAmount ? { advanceAmount: Number(travelForm.advanceAmount) } : {}),
        ...(travelForm.allowanceDaily ? { allowanceDaily: Number(travelForm.allowanceDaily) } : {}),
      });
      toast.success("Travel order dibuat (draft)");
      setTravelDialog(false);
      setTravelForm({ purpose: "", destination: "", projectRef: "", departDate: todayIso(), returnDate: todayIso(), advanceAmount: "", allowanceDaily: "" });
      await Promise.all([loadTravels(), loadMyPending(), loadOverview()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat travel order");
    }
  };
  const travelAct = async (id: string, action: "submit" | "approve" | "start" | "close" | "settle", actualAmount?: number) => {
    try {
      if (action === "settle") {
        await hrisApi.travelAction(id, { action: "settle", actualAmount: actualAmount ?? 0 });
      } else {
        await hrisApi.travelAction(id, { action });
      }
      const label: Record<string, string> = { submit: "Order diajukan utk persetujuan", approve: "Order disetujui", start: "Dinas dimulai", close: "Settlement ditutup", settle: "Settlement diajukan" };
      toast.success(label[action] ?? "Berhasil");
      await Promise.all([loadTravels(), loadMyPending(), loadOverview()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses travel order");
    }
  };
  const submitSettle = async () => {
    if (!settleTravel) return;
    const amount = Number(settleAmount);
    if (!Number.isFinite(amount) || amount < 0) { toast.error("Nominal realisasi tidak valid"); return; }
    await travelAct(settleTravel.id, "settle", amount);
    setSettleTravel(null);
  };

  const stats = overview?.stats;
  const myPendingCount = myPending.leaves + myPending.overtimes;
  // Badge header: manager+ melihat total pengajuan yang menunggu persetujuan,
  // staf melihat jumlah pengajuan miliknya yang masih pending.
  const headerPending = isManagerPlus && stats ? stats.pendingLeaves + stats.pendingOvertimes : myPendingCount;
  const headerPendingLabel = isManagerPlus ? "menunggu persetujuan" : "pending";

  // ===== Render =====
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">Pengajuan — Izin, Lembur, &amp; Dinas</h1>
            {headerPending > 0 && (
              <Badge className="bg-amber-50 text-amber-700 border border-amber-200" aria-label={`${headerPending} pengajuan ${headerPendingLabel}`}>
                {headerPending} {headerPendingLabel}
              </Badge>
            )}
          </div>
          <p className="text-sm text-zinc-500">Izin/sakit/cuti, lembur berkonsen &amp; perjalanan dinas beserta persetujuannya</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading} aria-label="Muat ulang data pengajuan">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Muat ulang
        </Button>
      </div>

      {globalError && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="flex items-center gap-2 text-sm text-rose-700"><AlertTriangle className="h-4 w-4" /> {globalError}</p>
            <Button size="sm" variant="outline" onClick={() => void loadAll()}>Coba Lagi</Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="izin">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="izin" className="gap-1.5"><CalendarDays className="h-4 w-4" />Izin / Sakit / Cuti</TabsTrigger>
          <TabsTrigger value="lembur" className="gap-1.5"><Timer className="h-4 w-4" />Lembur</TabsTrigger>
          <TabsTrigger value="dinas" className="gap-1.5"><Briefcase className="h-4 w-4" />Dinas</TabsTrigger>
        </TabsList>

        {/* ===== TAB: IZIN / SAKIT / CUTI ===== */}
        <TabsContent value="izin" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setLeaveDialog(true)} aria-label="Buat pengajuan izin/sakit/cuti">
              <Plus className="mr-2 h-4 w-4" /> Ajukan Izin/Sakit/Cuti
            </Button>
          </div>
          <Card className="rounded-xl border bg-white shadow-sm">
            <CardContent className="pt-4">
              {loading ? <ListSkeleton /> : leaves.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">Belum ada pengajuan</p>
              ) : (
                <div className="max-h-96 overflow-y-auto crm-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Karyawan</TableHead>
                        <TableHead>Jenis</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead className="hidden md:table-cell">Alasan</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaves.map((r) => {
                        const isMine = r.employee.userId === myId;
                        const canDecide = isManagerPlus && !isMine && r.status === "pending";
                        const canCancel = isMine && r.status === "pending";
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <p className="font-medium text-zinc-900">{r.employee.preferredName}</p>
                              <p className="text-xs text-zinc-500">{r.employee.employeeNumber}</p>
                            </TableCell>
                            <TableCell><Badge variant="outline" className="capitalize">{r.type}</Badge></TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDate(r.startDate)} — {formatDate(r.endDate)}
                            </TableCell>
                            <TableCell className="hidden max-w-48 truncate text-sm text-zinc-600 md:table-cell" title={r.reason}>
                              {r.reason}
                              {r.evidenceUrl && (
                                <a href={r.evidenceUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-emerald-700 underline">Bukti</a>
                              )}
                            </TableCell>
                            <TableCell>
                              <LeaveStatusBadge status={r.status} />
                              {r.decidedAt && r.approvedBy && (
                                <p className="mt-1 text-xs text-zinc-400">{r.approvedBy}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1.5">
                                {canDecide && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50" aria-label={`Setujui pengajuan ${r.employee.preferredName}`} onClick={() => void decideLeave(r.id, "approve")}>
                                      <Check className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50" aria-label={`Tolak pengajuan ${r.employee.preferredName}`} onClick={() => void decideLeave(r.id, "reject")}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                                {canCancel && (
                                  <Button size="sm" variant="outline" className="h-8 text-zinc-500" onClick={() => void decideLeave(r.id, "cancel")}>
                                    Batalkan
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: LEMBUR ===== */}
        <TabsContent value="lembur" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setOvertimeDialog(true)} aria-label="Buat order lembur">
              <Plus className="mr-2 h-4 w-4" /> Ajukan Lembur
            </Button>
          </div>
          <Card className="rounded-xl border bg-white shadow-sm">
            <CardContent className="pt-4">
              {loading ? <ListSkeleton /> : overtimes.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">Belum ada order lembur</p>
              ) : (
                <div className="max-h-96 overflow-y-auto crm-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Karyawan</TableHead>
                        <TableHead>Jadwal</TableHead>
                        <TableHead className="hidden md:table-cell">Alasan</TableHead>
                        <TableHead>Consent</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overtimes.map((r) => {
                        const isMine = r.employee.userId === myId;
                        const canDecide = isManagerPlus && !isMine && r.status === "pending";
                        const canVerify = isHrTeam && r.status === "approved";
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <p className="font-medium text-zinc-900">{r.employee.preferredName}</p>
                              <p className="text-xs text-zinc-500">{formatDate(r.date)}</p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm">
                              {minuteLabel(r.startMinute)} — {minuteLabel(r.endMinute)}
                              <span className="ml-1 text-zinc-400">({Math.floor((r.endMinute - r.startMinute) / 60)}j {(r.endMinute - r.startMinute) % 60}m)</span>
                              {r.realizedMinutes !== null && (
                                <p className="font-sans text-xs text-cyan-700">Realisasi: {Math.floor(r.realizedMinutes / 60)}j {r.realizedMinutes % 60}m</p>
                              )}
                            </TableCell>
                            <TableCell className="hidden max-w-48 text-sm text-zinc-600 md:table-cell">
                              <span className="line-clamp-2" title={r.reason}>{r.reason}</span>
                              {r.complianceFlag && (
                                <Badge className="mt-1 bg-amber-50 text-amber-700 border border-amber-200"><AlertTriangle className="mr-1 h-3 w-3" />Perlu review HR</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {r.consent
                                ? <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200"><BadgeCheck className="mr-1 h-3 w-3" />Ya</Badge>
                                : <Badge variant="outline" className="text-zinc-500">Tidak</Badge>}
                              <p className="text-xs text-zinc-400">oleh {r.requestedBy}</p>
                            </TableCell>
                            <TableCell><OvertimeStatusBadge status={r.status} /></TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1.5">
                                {canDecide && (
                                  <>
                                    <Button size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50" aria-label={`Setujui lembur ${r.employee.preferredName}`} onClick={() => void decideOvertime(r.id, "approve")}>
                                      <Check className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50" aria-label={`Tolak lembur ${r.employee.preferredName}`} onClick={() => void decideOvertime(r.id, "reject")}>
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                                {canVerify && (
                                  <Button size="sm" variant="outline" className="h-8 border-cyan-200 text-cyan-700 hover:bg-cyan-50" onClick={() => { setVerifyOtId(r.id); setVerifyMinutes(String(r.endMinute - r.startMinute)); }}>
                                    Verifikasi
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: DINAS ===== */}
        <TabsContent value="dinas" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setTravelDialog(true)} aria-label="Buat travel order">
              <Plus className="mr-2 h-4 w-4" /> Buat Travel Order
            </Button>
          </div>
          <Card className="rounded-xl border bg-white shadow-sm">
            <CardContent className="pt-4">
              {loading ? <ListSkeleton /> : travels.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">Belum ada perjalanan dinas</p>
              ) : (
                <div className="max-h-96 overflow-y-auto crm-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Karyawan</TableHead>
                        <TableHead>Tujuan</TableHead>
                        <TableHead className="hidden md:table-cell">Tanggal</TableHead>
                        <TableHead>Biaya</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {travels.map((r) => {
                        const isSelf = r.employee.userId === myId;
                        const allowedActor = isSelf || isManagerPlus;
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <p className="font-medium text-zinc-900">{r.employee.preferredName}</p>
                              <p className="line-clamp-1 text-xs text-zinc-500" title={r.purpose}>{r.purpose}</p>
                            </TableCell>
                            <TableCell className="text-sm">
                              <span className="font-medium">{r.destination}</span>
                              {r.projectRef && <p className="text-xs text-zinc-400">Ref: {r.projectRef}</p>}
                            </TableCell>
                            <TableCell className="hidden whitespace-nowrap text-sm md:table-cell">
                              {formatDate(r.departDate)} — {formatDate(r.returnDate)}
                            </TableCell>
                            <TableCell className="text-sm">
                              <p>Advance: <span className="font-medium">{formatCurrency(r.advanceAmount)}</span></p>
                              {r.actualAmount !== null && (
                                <p>Realisasi: <span className="font-medium">{formatCurrency(r.actualAmount)}</span></p>
                              )}
                            </TableCell>
                            <TableCell>
                              <TravelStatusBadge status={r.status} />
                              <div className="mt-1"><SettlementBadge s={r.settlementStatus} /></div>
                              {r.settlementDueAt && r.status === "settlement_pending" && (
                                <p className="mt-1 text-xs text-zinc-400">Batas: {formatDate(r.settlementDueAt)}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {r.status === "draft" && allowedActor && (
                                  <Button size="sm" variant="outline" className="h-8" onClick={() => void travelAct(r.id, "submit")}>Ajukan</Button>
                                )}
                                {r.status === "draft" && isDirector && (
                                  <Button size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void travelAct(r.id, "approve")}>Setujui</Button>
                                )}
                                {r.status === "approved" && allowedActor && (
                                  <Button size="sm" variant="outline" className="h-8 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => void travelAct(r.id, "start")}>Mulai</Button>
                                )}
                                {r.status === "ongoing" && allowedActor && (
                                  <Button size="sm" variant="outline" className="h-8 border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => { setSettleTravel(r); setSettleAmount(r.advanceAmount > 0 ? String(r.advanceAmount) : ""); }}>
                                    Settlement
                                  </Button>
                                )}
                                {r.status === "settlement_pending" && canCloseTravel && (
                                  <Button size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void travelAct(r.id, "close")}>Tutup</Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== Dialog: Ajukan izin/sakit/cuti ===== */}
      <Dialog open={leaveDialog} onOpenChange={setLeaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajukan Izin / Sakit / Cuti</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Jenis pengajuan</Label>
              <Select value={leaveForm.type} onValueChange={(v) => setLeaveForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger aria-label="Jenis pengajuan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="izin">Izin</SelectItem>
                  <SelectItem value="sakit">Sakit</SelectItem>
                  <SelectItem value="cuti">Cuti</SelectItem>
                  <SelectItem value="koreksi">Koreksi Absensi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="leave-start">Mulai</Label>
                <Input id="leave-start" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="leave-end">Selesai</Label>
                <Input id="leave-end" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-reason">Alasan</Label>
              <Textarea id="leave-reason" rows={3} placeholder="Jelaskan alasan pengajuan…" value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-evidence">URL bukti (opsional)</Label>
              <Input id="leave-evidence" placeholder="https://…" value={leaveForm.evidenceUrl} onChange={(e) => setLeaveForm((f) => ({ ...f, evidenceUrl: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitLeave()}>Kirim Pengajuan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: Ajukan lembur ===== */}
      <Dialog open={overtimeDialog} onOpenChange={setOvertimeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajukan Lembur</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {isManagerPlus && (
              <div className="space-y-1">
                <Label>Untuk karyawan</Label>
                <Select value={otForm.employeeId} onValueChange={(v) => setOtForm((f) => ({ ...f, employeeId: v }))}>
                  <SelectTrigger aria-label="Karyawan yang dilemburkan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Saya sendiri</SelectItem>
                    {employees.filter((e) => e.active).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employeeNumber} — {e.preferredName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ot-date">Tanggal</Label>
              <Input id="ot-date" type="date" value={otForm.date} onChange={(e) => setOtForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ot-start">Jam mulai</Label>
                <Input id="ot-start" type="time" value={otForm.start} onChange={(e) => setOtForm((f) => ({ ...f, start: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ot-end">Jam selesai</Label>
                <Input id="ot-end" type="time" value={otForm.end} onChange={(e) => setOtForm((f) => ({ ...f, end: e.target.value }))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <Checkbox
                checked={otForm.crossMidnight}
                onCheckedChange={(v) => setOtForm((f) => ({ ...f, crossMidnight: v === true }))}
                aria-label="Selesai setelah tengah malam"
              />
              Selesai setelah tengah malam (+1 hari)
            </label>
            {otNeedsReview && (
              <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Melewati batas harian — akan ditandai perlu review HR.
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="ot-reason">Alasan lembur</Label>
              <Textarea id="ot-reason" rows={2} placeholder="Pekerjaan apa yang dikerjakan…" value={otForm.reason} onChange={(e) => setOtForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ot-taskref">Referensi tugas (opsional)</Label>
              <Input id="ot-taskref" placeholder="mis. kode task / project" value={otForm.taskRef} onChange={(e) => setOtForm((f) => ({ ...f, taskRef: e.target.value }))} />
            </div>
            <label className={`flex items-start gap-2 text-sm ${otForm.employeeId !== "self" ? "opacity-50" : ""}`}>
              <Checkbox
                checked={otForm.employeeId === "self" && otForm.consent}
                disabled={otForm.employeeId !== "self"}
                onCheckedChange={(v) => setOtForm((f) => ({ ...f, consent: v === true }))}
                aria-label="Persetujuan kerja lembur"
              />
              <span>Saya bersedia bekerja lembur{otForm.employeeId !== "self" ? " — consent hanya boleh diberikan staf yang bersangkutan" : ""}</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOvertimeDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitOvertime()}>Kirim Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: Verifikasi realisasi lembur ===== */}
      <Dialog open={!!verifyOtId} onOpenChange={(o) => !o && setVerifyOtId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Verifikasi Realisasi Lembur</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ot-realized">Realisasi (menit)</Label>
              <Input id="ot-realized" type="number" min="0" max="2880" value={verifyMinutes} onChange={(e) => setVerifyMinutes(e.target.value)} />
              <p className="text-xs text-zinc-500">Total menit faktual yang dikerjakan (0–2880).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyOtId(null)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitVerify()}>Verifikasi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: Buat travel order ===== */}
      <Dialog open={travelDialog} onOpenChange={setTravelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Travel Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tv-purpose">Keperluan dinas</Label>
              <Input id="tv-purpose" placeholder="mis. Survey lokasi klien" value={travelForm.purpose} onChange={(e) => setTravelForm((f) => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tv-dest">Kota / tujuan</Label>
                <Input id="tv-dest" placeholder="mis. Bandung" value={travelForm.destination} onChange={(e) => setTravelForm((f) => ({ ...f, destination: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tv-ref">Referensi project (opsional)</Label>
                <Input id="tv-ref" placeholder="kode project" value={travelForm.projectRef} onChange={(e) => setTravelForm((f) => ({ ...f, projectRef: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tv-depart">Berangkat</Label>
                <Input id="tv-depart" type="date" value={travelForm.departDate} onChange={(e) => setTravelForm((f) => ({ ...f, departDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tv-return">Kembali</Label>
                <Input id="tv-return" type="date" value={travelForm.returnDate} onChange={(e) => setTravelForm((f) => ({ ...f, returnDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tv-advance">Uang muka (Rp)</Label>
                <Input id="tv-advance" type="number" min="0" placeholder="0" value={travelForm.advanceAmount} onChange={(e) => setTravelForm((f) => ({ ...f, advanceAmount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tv-allow">Uang harian (Rp/hari)</Label>
                <Input id="tv-allow" type="number" min="0" placeholder="0" value={travelForm.allowanceDaily} onChange={(e) => setTravelForm((f) => ({ ...f, allowanceDaily: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTravelDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitTravel()}>Buat Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: Settlement dinas ===== */}
      <Dialog open={!!settleTravel} onOpenChange={(o) => !o && setSettleTravel(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Settlement Perjalanan Dinas</DialogTitle>
          </DialogHeader>
          {settleTravel && (
            <div className="space-y-3">
              <div className="rounded-md border bg-zinc-50 p-3 text-sm">
                <p className="font-medium">{settleTravel.destination} — {settleTravel.employee.preferredName}</p>
                <p className="text-zinc-500">Uang muka: {formatCurrency(settleTravel.advanceAmount)}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="settle-amount">Realisasi total biaya (Rp)</Label>
                <Input id="settle-amount" type="number" min="0" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} />
                <p className="text-xs text-zinc-500">
                  Kurang dari advance → kembalikan ke kas; lebih → kurang bayar; sama → seimbang.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleTravel(null)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitSettle()}>Ajukan Settlement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
