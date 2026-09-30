"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, BadgeCheck, Banknote, Briefcase, CalendarDays, Check, Clock,
  LogIn, LogOut, MapPin, NotebookPen, Pencil, Plus, RefreshCw, Search, Timer,
  Users, Wallet, X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  type AttendanceRow, type DailyLogRow, type EmployeeRow, type HrisOverview,
  type LeaveRow, type OvertimeRow, type TodayAttendanceRow, type TravelRow,
} from "@/lib/erp/hris-client";

// ===== Konstanta & util =====

const HR_ROLES = ["hr", "director", "super_admin"];
const MANAGER_PLUS = ["hr", "manager", "director", "super_admin"];
const DIRECTOR_ROLES = ["director", "super_admin"];
const CLOSE_ROLES = ["finance", "director", "super_admin"];
const DEPARTMENTS = ["marketing", "production", "finance", "hr", "management"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
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
function genClientEventId(): string {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== Badge helpers =====

const badgeCls = (cls: string) => `border ${cls}`;

function EmploymentStatusBadge({ status }: { status: string }) {
  if (status === "permanent") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Permanent</Badge>;
  if (status === "intern") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}>Intern</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Freelance</Badge>;
}

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

function VerdictBadge({ v }: { v: string }) {
  if (v === "matched") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}><MapPin className="mr-1 h-3 w-3" />GPS cocok</Badge>;
  if (v === "unmatched") return <Badge className={badgeCls("bg-rose-50 text-rose-700 border-rose-200")}><MapPin className="mr-1 h-3 w-3" />GPS tak cocok</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Tanpa GPS</Badge>;
}

function ValidationBadge({ v }: { v: string }) {
  if (v === "valid") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Valid</Badge>;
  if (v === "exception") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}><AlertTriangle className="mr-1 h-3 w-3" />Exception</Badge>;
  if (v === "rejected") return <Badge className={badgeCls("bg-rose-50 text-rose-700 border-rose-200")}>Ditolak</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Pending</Badge>;
}

function PresenceBadge({ s }: { s: string }) {
  if (s === "hadir") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Hadir</Badge>;
  if (s === "izin") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}>Izin</Badge>;
  if (s === "exception") return <Badge className={badgeCls("bg-rose-50 text-rose-700 border-rose-200")}><AlertTriangle className="mr-1 h-3 w-3" />Exception</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Belum check-in</Badge>;
}

function MiniStat({ label, value, tone, icon }: {
  label: string; value: number; tone: string; icon: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl border bg-white shadow-sm py-3">
      <CardContent className="flex items-center gap-3 px-4">
        <div className={`rounded-lg p-2 ${tone}`}>{icon}</div>
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
          <p className="text-2xl font-bold text-zinc-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
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

export default function HrisModule() {
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
  const [canSeeBank, setCanSeeBank] = useState(false);
  const [eventsToday, setEventsToday] = useState<AttendanceRow[]>([]);
  const [myHistory, setMyHistory] = useState<AttendanceRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [overtimes, setOvertimes] = useState<OvertimeRow[]>([]);
  const [travels, setTravels] = useState<TravelRow[]>([]);
  const [logs, setLogs] = useState<DailyLogRow[]>([]);
  const [myPending, setMyPending] = useState({ leaves: 0, overtimes: 0 });

  // ===== Dialog state =====
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [overtimeDialog, setOvertimeDialog] = useState(false);
  const [travelDialog, setTravelDialog] = useState(false);
  const [verifyOtId, setVerifyOtId] = useState<string | null>(null);
  const [verifyMinutes, setVerifyMinutes] = useState<string>("");
  const [settleTravel, setSettleTravel] = useState<TravelRow | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>("");
  const [employeeDialog, setEmployeeDialog] = useState(false);
  const [employeeEditing, setEmployeeEditing] = useState<EmployeeRow | null>(null);
  const [logEditing, setLogEditing] = useState<DailyLogRow | null>(null);

  const loadOverview = useCallback(async () => {
    const res = await hrisApi.overview();
    setOverview(res);
  }, []);

  const loadEmployees = useCallback(async () => {
    const res = await hrisApi.employees();
    setEmployees(res.employees);
    setCanSeeBank(res.canSeeBank);
  }, []);

  const loadAttendanceToday = useCallback(async () => {
    const res = await hrisApi.attendance(isManagerPlus ? { date: todayIso() } : { date: todayIso(), mine: true });
    setEventsToday(res.events);
  }, [isManagerPlus]);

  const loadMyHistory = useCallback(async () => {
    // Riwayat 7 hari milik sendiri (utk staf non-manager)
    if (isManagerPlus) return;
    const res = await hrisApi.attendance({ mine: true, from: daysAgoIso(6), to: todayIso() });
    setMyHistory(res.events);
  }, [isManagerPlus]);

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

  const loadLogs = useCallback(async () => {
    const res = await hrisApi.dailyLogs(isManagerPlus ? {} : { mine: true });
    setLogs(res.logs);
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
      ["Kehadiran", loadAttendanceToday],
      ["Riwayat", loadMyHistory],
      ["Pengajuan", loadLeaves],
      ["Lembur", loadOvertimes],
      ["Dinas", loadTravels],
      ["Log Harian", loadLogs],
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
  }, [loadOverview, loadEmployees, loadAttendanceToday, loadMyHistory, loadLeaves, loadOvertimes, loadTravels, loadLogs, loadMyPending]);

  useEffect(() => {
    void loadAll();
  }, []);

  // ===== Status saya hari ini =====
  const myRow: TodayAttendanceRow | undefined = useMemo(
    () => overview?.todayAttendance.find((r) => r.userId && r.userId === myId),
    [overview, myId],
  );
  const hasCheckIn = !!myRow?.checkInAt;
  const hasCheckOut = !!myRow?.checkOutAt;

  // ===== Tabel event hari ini dikelompokkan per karyawan =====
  const todayRows = useMemo(() => {
    type Row = { employeeId: string; name: string; number: string; dept: string | null; pos: string | null; in: string | null; out: string | null; verdict: string; status: string };
    const map = new Map<string, Row>();
    const sorted = [...eventsToday].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    for (const ev of sorted) {
      const cur = map.get(ev.employeeId) ?? {
        employeeId: ev.employeeId,
        name: ev.employee.preferredName,
        number: ev.employee.employeeNumber,
        dept: ev.employee.department,
        pos: ev.employee.position,
        in: null, out: null, verdict: ev.locationVerdict, status: ev.validationStatus,
      };
      if (ev.kind === "check_in") {
        cur.in = ev.receivedAt;
        cur.verdict = ev.locationVerdict;
        cur.status = ev.validationStatus;
      } else {
        cur.out = ev.receivedAt;
      }
      map.set(ev.employeeId, cur);
    }
    return [...map.values()];
  }, [eventsToday]);

  // Riwayat 7 hari dikelompokkan per tanggal
  const historyRows = useMemo(() => {
    const map = new Map<string, { date: string; in: string | null; out: string | null; verdict: string; status: string }>();
    const sorted = [...myHistory].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    for (const ev of sorted) {
      const d = ev.businessDate.slice(0, 10);
      const cur = map.get(d) ?? { date: d, in: null, out: null, verdict: ev.locationVerdict, status: ev.validationStatus };
      if (ev.kind === "check_in") { cur.in = ev.receivedAt; cur.verdict = ev.locationVerdict; cur.status = ev.validationStatus; }
      else cur.out = ev.receivedAt;
      map.set(d, cur);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [myHistory]);

  // ===== Aksi: check-in / check-out =====
  const [checking, setChecking] = useState(false);
  const doAttendance = useCallback(async (kind: "check_in" | "check_out") => {
    setChecking(true);
    const finish = async (lat?: number, lng?: number, accuracyM?: number) => {
      try {
        const res = await hrisApi.createAttendance({
          kind,
          clientEventId: genClientEventId(),
          ...(lat !== undefined ? { lat, lng, accuracyM } : {}),
        });
        if (res.idempotent) toast.info("Event absensi sudah tercatat sebelumnya");
        else toast.success(kind === "check_in" ? "Check-in tercatat" : "Check-out tercatat");
        await Promise.all([loadOverview(), loadAttendanceToday(), loadMyHistory()]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal mencatat absensi");
      } finally {
        setChecking(false);
      }
    };
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void finish(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => void finish(), // tanpa GPS → verdict unknown + exception
        { timeout: 5000, maximumAge: 30000 },
      );
    } else {
      await finish();
    }
  }, [loadOverview, loadAttendanceToday, loadMyHistory]);

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

  // ===== Aksi: daily log =====
  const [logForm, setLogForm] = useState({ date: todayIso(), content: "", hours: "8", projectId: "" });
  const submitLog = async () => {
    try {
      if (!logForm.content.trim()) { toast.error("Isi pekerjaan wajib diisi"); return; }
      const hours = Number(logForm.hours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) { toast.error("Jam kerja harus 0–24"); return; }
      await hrisApi.createDailyLog({
        date: logForm.date,
        content: logForm.content.trim(),
        hours,
        ...(logForm.projectId.trim() ? { projectId: logForm.projectId.trim() } : {}),
      });
      toast.success("Log harian tersimpan");
      setLogForm({ date: todayIso(), content: "", hours: "8", projectId: "" });
      await loadLogs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan log");
    }
  };
  const submitLogEdit = async () => {
    if (!logEditing) return;
    try {
      const hours = Number(logForm.hours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) { toast.error("Jam kerja harus 0–24"); return; }
      await hrisApi.updateDailyLog(logEditing.id, {
        date: logForm.date,
        content: logForm.content.trim(),
        hours,
        ...(logForm.projectId.trim() ? { projectId: logForm.projectId.trim() } : { projectId: null }),
      });
      toast.success("Log diperbarui");
      setLogEditing(null);
      await loadLogs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memperbarui log");
    }
  };

  // ===== Aksi: employee =====
  const emptyEmp = { employeeNumber: "", preferredName: "", employmentStatus: "permanent", department: "production", position: "", supervisorId: "none", joinedOn: todayIso(), bankName: "", bankAccount: "", umkRegion: "", internProgram: "", internStart: "", internEnd: "", stipendDaily: "", active: true };
  const [empForm, setEmpForm] = useState(emptyEmp);
  const openEmployeeDialog = (row: EmployeeRow | null) => {
    setEmployeeEditing(row);
    if (row) {
      setEmpForm({
        employeeNumber: row.employeeNumber,
        preferredName: row.preferredName,
        employmentStatus: row.employmentStatus,
        department: row.department ?? "production",
        position: row.position ?? "",
        supervisorId: row.supervisorId ?? "none",
        joinedOn: row.joinedOn ? row.joinedOn.slice(0, 10) : todayIso(),
        bankName: row.bankName ?? "",
        bankAccount: row.bankAccount ?? "",
        umkRegion: row.umkRegion ?? "",
        internProgram: row.internProgram ?? "",
        internStart: row.internStart ? row.internStart.slice(0, 10) : "",
        internEnd: row.internEnd ? row.internEnd.slice(0, 10) : "",
        stipendDaily: row.stipendDaily !== null ? String(row.stipendDaily) : "",
        active: row.active,
      });
    } else {
      setEmpForm(emptyEmp);
    }
    setEmployeeDialog(true);
  };
  const submitEmployee = async () => {
    try {
      if (!empForm.employeeNumber.trim()) { toast.error("Nomor karyawan wajib diisi"); return; }
      if (!empForm.preferredName.trim()) { toast.error("Nama karyawan wajib diisi"); return; }
      const payload = {
        employeeNumber: empForm.employeeNumber.trim(),
        preferredName: empForm.preferredName.trim(),
        employmentStatus: empForm.employmentStatus,
        department: empForm.department,
        position: empForm.position.trim() || null,
        supervisorId: empForm.supervisorId === "none" ? null : empForm.supervisorId,
        joinedOn: empForm.joinedOn || null,
        bankName: empForm.bankName.trim() || null,
        bankAccount: empForm.bankAccount.trim() || null,
        umkRegion: empForm.umkRegion.trim() || null,
        internProgram: empForm.employmentStatus === "intern" ? empForm.internProgram.trim() || null : null,
        internStart: empForm.employmentStatus === "intern" && empForm.internStart ? empForm.internStart : null,
        internEnd: empForm.employmentStatus === "intern" && empForm.internEnd ? empForm.internEnd : null,
        stipendDaily: empForm.employmentStatus === "intern" && empForm.stipendDaily ? Number(empForm.stipendDaily) : null,
        active: empForm.active,
      };
      if (employeeEditing) {
        await hrisApi.updateEmployee(employeeEditing.id, payload);
        toast.success("Data karyawan diperbarui");
      } else {
        await hrisApi.createEmployee(payload);
        toast.success("Karyawan ditambahkan");
      }
      setEmployeeDialog(false);
      await loadEmployees();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan karyawan");
    }
  };

  // ===== Filter karyawan =====
  const [empQuery, setEmpQuery] = useState("");
  const [empStatus, setEmpStatus] = useState("all");
  const filteredEmployees = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (empStatus !== "all" && e.employmentStatus !== empStatus) return false;
      if (!q) return true;
      return (
        e.preferredName.toLowerCase().includes(q) ||
        e.employeeNumber.toLowerCase().includes(q) ||
        (e.position ?? "").toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, empQuery, empStatus]);

  const stats = overview?.stats;
  const myPendingCount = myPending.leaves + myPending.overtimes;

  // ===== Render =====
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">HRIS — Kehadiran &amp; Kepegawaian</h1>
          <p className="text-sm text-zinc-500">Absensi GPS, izin/sakit/cuti, lembur, dinas, log harian &amp; master karyawan</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading} aria-label="Muat ulang data HRIS">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ===== Tabs (kiri, span 2) ===== */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="kehadiran">
            <TabsList className="flex w-full flex-wrap justify-start gap-1 overflow-x-auto">
              <TabsTrigger value="kehadiran" className="gap-1.5"><Clock className="h-4 w-4" />Kehadiran</TabsTrigger>
              <TabsTrigger value="pengajuan" className="gap-1.5"><CalendarDays className="h-4 w-4" />Pengajuan</TabsTrigger>
              <TabsTrigger value="lembur" className="gap-1.5"><Timer className="h-4 w-4" />Lembur</TabsTrigger>
              <TabsTrigger value="dinas" className="gap-1.5"><Briefcase className="h-4 w-4" />Dinas</TabsTrigger>
              <TabsTrigger value="log" className="gap-1.5"><NotebookPen className="h-4 w-4" />Log Harian</TabsTrigger>
              <TabsTrigger value="karyawan" className="gap-1.5"><Users className="h-4 w-4" />Karyawan</TabsTrigger>
            </TabsList>

            {/* ===== TAB: KEHADIRAN ===== */}
            <TabsContent value="kehadiran" className="mt-4 space-y-4">
              {loading || !stats ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniStat label="Hadir" value={stats.presentToday} tone="bg-emerald-50 text-emerald-600" icon={<Check className="h-4 w-4" />} />
                  <MiniStat label="Izin" value={stats.onLeaveToday} tone="bg-amber-50 text-amber-600" icon={<CalendarDays className="h-4 w-4" />} />
                  <MiniStat label="Belum check-in" value={stats.belumCheckIn} tone="bg-zinc-100 text-zinc-500" icon={<Clock className="h-4 w-4" />} />
                  <MiniStat label="Exception" value={stats.exceptionsToday} tone="bg-rose-50 text-rose-600" icon={<AlertTriangle className="h-4 w-4" />} />
                </div>
              )}

              <Card className="rounded-xl border bg-white shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-zinc-500" /> Event Kehadiran Hari Ini</CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? <ListSkeleton /> : todayRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">Belum ada event kehadiran hari ini</p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto crm-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nama</TableHead>
                            <TableHead>Check-in</TableHead>
                            <TableHead>Check-out</TableHead>
                            <TableHead>Verdict</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {todayRows.map((r) => (
                            <TableRow key={r.employeeId}>
                              <TableCell>
                                <p className="font-medium text-zinc-900">{r.name}</p>
                                <p className="text-xs text-zinc-500">{r.number}{r.pos ? ` · ${r.pos}` : ""}</p>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{fmtTime(r.in)}</TableCell>
                              <TableCell className="font-mono text-sm">{fmtTime(r.out)}</TableCell>
                              <TableCell><VerdictBadge v={r.verdict} /></TableCell>
                              <TableCell><ValidationBadge v={r.status} /></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {!isManagerPlus && (
                <Card className="rounded-xl border bg-white shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-zinc-500" /> Riwayat 7 Hari Saya</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loading ? <ListSkeleton rows={3} /> : historyRows.length === 0 ? (
                      <p className="py-6 text-center text-sm text-zinc-500">Belum ada riwayat absensi</p>
                    ) : (
                      <div className="max-h-96 overflow-y-auto crm-scroll">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Tanggal</TableHead>
                              <TableHead>Check-in</TableHead>
                              <TableHead>Check-out</TableHead>
                              <TableHead>Verdict</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {historyRows.map((r) => (
                              <TableRow key={r.date}>
                                <TableCell className="text-sm">{formatDate(`${r.date}T00:00:00.000Z`)}</TableCell>
                                <TableCell className="font-mono text-sm">{fmtTime(r.in)}</TableCell>
                                <TableCell className="font-mono text-sm">{fmtTime(r.out)}</TableCell>
                                <TableCell><VerdictBadge v={r.verdict} /></TableCell>
                                <TableCell><ValidationBadge v={r.status} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ===== TAB: PENGAJUAN ===== */}
            <TabsContent value="pengajuan" className="mt-4 space-y-4">
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

            {/* ===== TAB: LOG HARIAN ===== */}
            <TabsContent value="log" className="mt-4 space-y-4">
              <Card className="rounded-xl border bg-white shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base"><NotebookPen className="h-4 w-4 text-zinc-500" /> Tambah Log Pekerjaan</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="log-date">Tanggal</Label>
                      <Input id="log-date" type="date" value={logForm.date} onChange={(e) => setLogForm((f) => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="log-hours">Jam kerja (0–24)</Label>
                      <Input id="log-hours" type="number" min="0" max="24" step="0.5" value={logForm.hours} onChange={(e) => setLogForm((f) => ({ ...f, hours: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="log-project">Project ID (opsional)</Label>
                      <Input id="log-project" placeholder="mis. project id / kode" value={logForm.projectId} onChange={(e) => setLogForm((f) => ({ ...f, projectId: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="log-content">Pekerjaan hari ini</Label>
                    <Textarea id="log-content" rows={2} placeholder="Apa yang dikerjakan hari ini…" value={logForm.content} onChange={(e) => setLogForm((f) => ({ ...f, content: e.target.value }))} />
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => void submitLog()}><Plus className="mr-2 h-4 w-4" /> Simpan Log</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border bg-white shadow-sm">
                <CardContent className="pt-4">
                  {loading ? <ListSkeleton /> : logs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">Belum ada log harian</p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto crm-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Tanggal</TableHead>
                            {isManagerPlus && <TableHead>Karyawan</TableHead>}
                            <TableHead>Pekerjaan</TableHead>
                            <TableHead>Jam</TableHead>
                            <TableHead className="text-right">Aksi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {logs.map((l) => {
                            const isOwner = l.employee.userId === myId;
                            return (
                              <TableRow key={l.id}>
                                <TableCell className="whitespace-nowrap text-sm">{formatDate(l.date)}</TableCell>
                                {isManagerPlus && (
                                  <TableCell>
                                    <p className="font-medium text-zinc-900">{l.employee.preferredName}</p>
                                    <p className="text-xs text-zinc-500">{l.employee.employeeNumber}</p>
                                  </TableCell>
                                )}
                                <TableCell className="max-w-72 text-sm text-zinc-600"><span className="line-clamp-2">{l.content}</span>{l.projectId && <span className="text-xs text-zinc-400"> · {l.projectId}</span>}</TableCell>
                                <TableCell className="text-sm font-medium">{l.hours}j</TableCell>
                                <TableCell className="text-right">
                                  {(isOwner || isManagerPlus) && (
                                    <Button size="sm" variant="ghost" className="h-8" aria-label={`Edit log ${l.employee.preferredName}`} onClick={() => { setLogEditing(l); setLogForm({ date: l.date.slice(0, 10), content: l.content, hours: String(l.hours), projectId: l.projectId ?? "" }); }}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
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

            {/* ===== TAB: KARYAWAN ===== */}
            <TabsContent value="karyawan" className="mt-4 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                  <Input placeholder="Cari nama / nomor / posisi…" className="pl-8" value={empQuery} onChange={(e) => setEmpQuery(e.target.value)} aria-label="Cari karyawan" />
                </div>
                <Select value={empStatus} onValueChange={setEmpStatus}>
                  <SelectTrigger className="w-full sm:w-40" aria-label="Filter status kepegawaian">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua status</SelectItem>
                    <SelectItem value="permanent">Permanent</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                    <SelectItem value="freelance">Freelance</SelectItem>
                  </SelectContent>
                </Select>
                {isHrTeam && (
                  <Button size="sm" onClick={() => openEmployeeDialog(null)} aria-label="Tambah karyawan">
                    <Plus className="mr-2 h-4 w-4" /> Tambah Karyawan
                  </Button>
                )}
              </div>

              <Card className="rounded-xl border bg-white shadow-sm">
                <CardContent className="pt-4">
                  {loading ? <ListSkeleton /> : filteredEmployees.length === 0 ? (
                    <p className="py-6 text-center text-sm text-zinc-500">Tidak ada karyawan yang cocok</p>
                  ) : (
                    <div className="max-h-96 overflow-y-auto crm-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nomor</TableHead>
                            <TableHead>Nama</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Departemen</TableHead>
                            <TableHead className="hidden md:table-cell">Posisi</TableHead>
                            <TableHead className="hidden lg:table-cell">Supervisor</TableHead>
                            <TableHead className="hidden lg:table-cell">Bergabung</TableHead>
                            {canSeeBank && <TableHead>Bank</TableHead>}
                            {isHrTeam && <TableHead className="text-right">Aksi</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredEmployees.map((e) => (
                            <TableRow key={e.id} className={e.active ? "" : "opacity-50"}>
                              <TableCell className="font-mono text-sm">{e.employeeNumber}</TableCell>
                              <TableCell>
                                <p className="font-medium text-zinc-900">{e.preferredName}</p>
                                {e.user?.email && <p className="text-xs text-zinc-400">{e.user.email}</p>}
                              </TableCell>
                              <TableCell><EmploymentStatusBadge status={e.employmentStatus} /></TableCell>
                              <TableCell className="text-sm capitalize">{e.department ?? "—"}</TableCell>
                              <TableCell className="hidden text-sm md:table-cell">{e.position ?? "—"}</TableCell>
                              <TableCell className="hidden text-sm lg:table-cell">{e.supervisor?.preferredName ?? "—"}</TableCell>
                              <TableCell className="hidden text-sm lg:table-cell">{e.joinedOn ? formatDate(e.joinedOn) : "—"}</TableCell>
                              {canSeeBank && (
                                <TableCell className="text-sm">
                                  {e.bankName ? (
                                    <>
                                      <p className="font-medium">{e.bankName}</p>
                                      <p className="font-mono text-xs text-zinc-500">{e.bankAccount}</p>
                                    </>
                                  ) : "—"}
                                </TableCell>
                              )}
                              {isHrTeam && (
                                <TableCell className="text-right">
                                  <Button size="sm" variant="ghost" className="h-8" aria-label={`Edit karyawan ${e.preferredName}`} onClick={() => openEmployeeDialog(e)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* ===== Kartu aksi cepat (kanan) ===== */}
        <div className="space-y-4">
          <Card className="rounded-xl border bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Absensi Saya</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasCheckIn && hasCheckOut ? (
                <Button className="h-12 w-full" disabled variant="outline">
                  <Check className="mr-2 h-5 w-5 text-emerald-600" /> Absensi hari ini lengkap
                </Button>
              ) : (
                <Button
                  className="h-12 w-full bg-zinc-900 text-white hover:bg-zinc-800"
                  onClick={() => void doAttendance(hasCheckIn ? "check_out" : "check_in")}
                  disabled={checking}
                  aria-label={hasCheckIn ? "Check-out dari kerja" : "Check-in mulai kerja"}
                >
                  {checking ? (
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                  ) : hasCheckIn ? (
                    <LogOut className="mr-2 h-5 w-5" />
                  ) : (
                    <LogIn className="mr-2 h-5 w-5" />
                  )}
                  {hasCheckIn ? "Check-out" : "Check-in"}
                </Button>
              )}
              <p className="text-xs text-zinc-500">
                Lokasi GPS dicoba otomatis — tanpa GPS tercatat <span className="font-medium text-amber-700">exception</span>.
              </p>

              <div className="rounded-lg border bg-zinc-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Status hari ini</span>
                  {myRow ? <PresenceBadge s={myRow.status} /> : <Badge variant="outline" className="text-zinc-500">Bukan karyawan</Badge>}
                </div>
                {myRow && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-zinc-400">Check-in:</span> <span className="font-mono font-medium">{fmtTime(myRow.checkInAt)}</span></div>
                    <div><span className="text-zinc-400">Check-out:</span> <span className="font-mono font-medium">{fmtTime(myRow.checkOutAt)}</span></div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border bg-zinc-50 p-3 text-sm">
                <span className="text-zinc-500">Pengajuan saya</span>
                {myPendingCount > 0 ? (
                  <Badge className="bg-amber-50 text-amber-700 border border-amber-200">{myPendingCount} pending</Badge>
                ) : (
                  <Badge variant="outline" className="text-zinc-500">Tidak ada</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {stats && (
            <Card className="rounded-xl border bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ringkasan Modul</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-zinc-500">Total karyawan aktif</span><span className="font-semibold">{stats.totalEmployees}</span></div>
                <div className="flex items-center justify-between"><span className="text-zinc-500">Pengajuan izin pending</span><Badge className="bg-amber-50 text-amber-700 border border-amber-200">{stats.pendingLeaves}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-zinc-500">Order lembur pending</span><Badge className="bg-amber-50 text-amber-700 border border-amber-200">{stats.pendingOvertimes}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-zinc-500">Dinas aktif</span><Badge variant="outline">{stats.activeTravels}</Badge></div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

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

      {/* ===== Dialog: Tambah/Edit karyawan ===== */}
      <Dialog open={employeeDialog} onOpenChange={setEmployeeDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{employeeEditing ? "Edit Karyawan" : "Tambah Karyawan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="emp-no">Nomor karyawan *</Label>
                <Input id="emp-no" placeholder="EMP-011" value={empForm.employeeNumber} onChange={(e) => setEmpForm((f) => ({ ...f, employeeNumber: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emp-name">Nama *</Label>
                <Input id="emp-name" placeholder="Nama panggilan" value={empForm.preferredName} onChange={(e) => setEmpForm((f) => ({ ...f, preferredName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Status kepegawaian</Label>
                <Select value={empForm.employmentStatus} onValueChange={(v) => setEmpForm((f) => ({ ...f, employmentStatus: v }))}>
                  <SelectTrigger aria-label="Status kepegawaian"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">Permanent</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                    <SelectItem value="freelance">Freelance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Departemen</Label>
                <Select value={empForm.department} onValueChange={(v) => setEmpForm((f) => ({ ...f, department: v }))}>
                  <SelectTrigger aria-label="Departemen"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="emp-pos">Posisi</Label>
                <Input id="emp-pos" placeholder="mis. Motion Designer" value={empForm.position} onChange={(e) => setEmpForm((f) => ({ ...f, position: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Supervisor</Label>
                <Select value={empForm.supervisorId} onValueChange={(v) => setEmpForm((f) => ({ ...f, supervisorId: v }))}>
                  <SelectTrigger aria-label="Supervisor"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanpa supervisor —</SelectItem>
                    {employees.filter((e) => e.id !== employeeEditing?.id).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employeeNumber} — {e.preferredName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="emp-joined">Bergabung</Label>
                <Input id="emp-joined" type="date" value={empForm.joinedOn} onChange={(e) => setEmpForm((f) => ({ ...f, joinedOn: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emp-umk">Wilayah UMK</Label>
                <Input id="emp-umk" placeholder="mis. JABODETABEK" value={empForm.umkRegion} onChange={(e) => setEmpForm((f) => ({ ...f, umkRegion: e.target.value }))} />
              </div>
            </div>
            {empForm.employmentStatus === "intern" && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Data Magang</p>
                <div className="space-y-1">
                  <Label htmlFor="emp-internprog">Program magang</Label>
                  <Input id="emp-internprog" placeholder="mis. Batch 2026 — Editor" value={empForm.internProgram} onChange={(e) => setEmpForm((f) => ({ ...f, internProgram: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="emp-internstart">Mulai</Label>
                    <Input id="emp-internstart" type="date" value={empForm.internStart} onChange={(e) => setEmpForm((f) => ({ ...f, internStart: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="emp-internend">Selesai</Label>
                    <Input id="emp-internend" type="date" value={empForm.internEnd} onChange={(e) => setEmpForm((f) => ({ ...f, internEnd: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="emp-stipend">Saku/hari</Label>
                    <Input id="emp-stipend" type="number" min="0" placeholder="0" value={empForm.stipendDaily} onChange={(e) => setEmpForm((f) => ({ ...f, stipendDaily: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="emp-bank">Bank</Label>
                <Input id="emp-bank" placeholder="mis. BCA" value={empForm.bankName} onChange={(e) => setEmpForm((f) => ({ ...f, bankName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emp-bankacc">No. rekening</Label>
                <Input id="emp-bankacc" placeholder="1234567890" value={empForm.bankAccount} onChange={(e) => setEmpForm((f) => ({ ...f, bankAccount: e.target.value }))} />
              </div>
            </div>
            {employeeEditing && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={empForm.active} onCheckedChange={(v) => setEmpForm((f) => ({ ...f, active: v === true }))} aria-label="Karyawan aktif" />
                <span>Karyawan aktif {empForm.active ? "" : "— nonaktif = offboarding (tanggal keluar diisi otomatis)"}</span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmployeeDialog(false)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitEmployee()}>
              {employeeEditing ? "Simpan Perubahan" : "Tambah Karyawan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog: Edit log harian ===== */}
      <Dialog open={!!logEditing} onOpenChange={(o) => !o && setLogEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Log Harian</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="logedit-date">Tanggal</Label>
                <Input id="logedit-date" type="date" value={logForm.date} onChange={(e) => setLogForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="logedit-hours">Jam kerja (0–24)</Label>
                <Input id="logedit-hours" type="number" min="0" max="24" step="0.5" value={logForm.hours} onChange={(e) => setLogForm((f) => ({ ...f, hours: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="logedit-project">Project ID (opsional)</Label>
              <Input id="logedit-project" value={logForm.projectId} onChange={(e) => setLogForm((f) => ({ ...f, projectId: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="logedit-content">Pekerjaan</Label>
              <Textarea id="logedit-content" rows={3} value={logForm.content} onChange={(e) => setLogForm((f) => ({ ...f, content: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogEditing(null)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitLogEdit()}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
