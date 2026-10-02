"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarDays, Check, Clock, LogIn, LogOut, MapPin,
  NotebookPen, Pencil, Plus, RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { useCrmStore } from "@/lib/crm/store";
import { formatDate } from "@/lib/crm/utils";
import {
  hrisApi,
  type AttendanceRow, type DailyLogRow, type HrisOverview, type TodayAttendanceRow,
} from "@/lib/erp/hris-client";

// ===== Konstanta & util =====

const MANAGER_PLUS = ["hr", "manager", "director", "super_admin"];

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
function genClientEventId(): string {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== Badge helpers =====

const badgeCls = (cls: string) => `border ${cls}`;

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

export default function AttendanceModule() {
  const user = useCrmStore((s) => s.user);
  const role = user?.role ?? null;

  const isManagerPlus = role ? MANAGER_PLUS.includes(role) : false;
  const myId = user?.id ?? null;

  // ===== Data state =====
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [overview, setOverview] = useState<HrisOverview | null>(null);
  const [eventsToday, setEventsToday] = useState<AttendanceRow[]>([]);
  const [myHistory, setMyHistory] = useState<AttendanceRow[]>([]);
  const [logs, setLogs] = useState<DailyLogRow[]>([]);

  // ===== Dialog state =====
  const [logEditing, setLogEditing] = useState<DailyLogRow | null>(null);

  const loadOverview = useCallback(async () => {
    const res = await hrisApi.overview();
    setOverview(res);
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

  const loadLogs = useCallback(async () => {
    const res = await hrisApi.dailyLogs(isManagerPlus ? {} : { mine: true });
    setLogs(res.logs);
  }, [isManagerPlus]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setGlobalError(null);
    const tasks: Array<[string, () => Promise<void>]> = [
      ["Ringkasan", loadOverview],
      ["Kehadiran", loadAttendanceToday],
      ["Riwayat", loadMyHistory],
      ["Log Harian", loadLogs],
    ];
    const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
    const firstFail = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstFail) {
      const msg = firstFail.reason instanceof Error ? firstFail.reason.message : "Gagal memuat data";
      setGlobalError(msg);
      toast.error(msg);
    }
    setLoading(false);
  }, [loadOverview, loadAttendanceToday, loadMyHistory, loadLogs]);

  useEffect(() => {
    // Ditunda 1 tick agar setState awal tidak berjalan sinkron di dalam effect.
    const id = setTimeout(() => { void loadAll(); }, 0);
    return () => clearTimeout(id);
  }, [loadAll]);

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

  const stats = overview?.stats;

  // ===== Render =====
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">Kehadiran — Check-in &amp; Absensi</h1>
          <p className="text-sm text-zinc-500">Check-in/out GPS, statistik harian, riwayat absensi &amp; log pekerjaan</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading} aria-label="Muat ulang data kehadiran">
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

      {/* Kartu aksi cepat pribadi */}
      <Card className="rounded-xl border bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Absensi Saya</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-3">
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
          </div>
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
        </CardContent>
      </Card>

      {/* Statistik hari ini */}
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

      {/* Event kehadiran hari ini */}
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

      {/* Riwayat 7 hari (staf non-manager) */}
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

      {/* Log harian — form cepat */}
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

      {/* Log harian — daftar */}
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
