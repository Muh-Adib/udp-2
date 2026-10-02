"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, CalendarDays, Pencil, Plus, RefreshCw, Search, Users,
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
import { formatDate } from "@/lib/crm/utils";
import {
  hrisApi,
  type EmployeeRow, type LeaveBalanceRow,
} from "@/lib/erp/hris-client";

// ===== Konstanta & util =====

const HR_ROLES = ["hr", "director", "super_admin"];
const MANAGER_PLUS = ["hr", "manager", "director", "super_admin"];
const DEPARTMENTS = ["marketing", "production", "finance", "hr", "management"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ===== Badge helpers =====

const badgeCls = (cls: string) => `border ${cls}`;

function EmploymentStatusBadge({ status }: { status: string }) {
  if (status === "permanent") return <Badge className={badgeCls("bg-emerald-50 text-emerald-700 border-emerald-200")}>Permanent</Badge>;
  if (status === "intern") return <Badge className={badgeCls("bg-amber-50 text-amber-700 border-amber-200")}>Intern</Badge>;
  return <Badge className={badgeCls("bg-zinc-100 text-zinc-600 border-zinc-200")}>Freelance</Badge>;
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

/** Bar sisa cuti: emerald bila sisa ≥ 30% kuota total, amber ≥ 0, rose negatif. */
function LeaveBalanceBar({ remaining, total }: { remaining: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((remaining / total) * 100))) : 100;
  const tone = total > 0 && remaining >= total * 0.3 ? "bg-emerald-500" : remaining >= 0 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div
      className="h-2 w-full rounded-full bg-zinc-100"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Proporsi sisa kuota cuti"
    >
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ===== Komponen utama =====

export default function EmployeesModule() {
  const user = useCrmStore((s) => s.user);
  const role = user?.role ?? null;

  const isHrTeam = role ? HR_ROLES.includes(role) : false;
  const isManagerPlus = role ? MANAGER_PLUS.includes(role) : false;

  // ===== Data state =====
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [canSeeBank, setCanSeeBank] = useState(false);
  const [balances, setBalances] = useState<LeaveBalanceRow[]>([]);
  const [balanceYear, setBalanceYear] = useState<string>(String(new Date().getUTCFullYear()));
  const [balLoading, setBalLoading] = useState(false);
  const [balError, setBalError] = useState<string | null>(null);

  // ===== Dialog state =====
  const [employeeDialog, setEmployeeDialog] = useState(false);
  const [employeeEditing, setEmployeeEditing] = useState<EmployeeRow | null>(null);
  const [balEditing, setBalEditing] = useState<LeaveBalanceRow | null>(null);

  const loadEmployees = useCallback(async () => {
    const res = await hrisApi.employees();
    setEmployees(res.employees);
    setCanSeeBank(res.canSeeBank);
  }, []);

  // ===== Kuota cuti tahunan =====
  const loadBalances = useCallback(async () => {
    setBalLoading(true);
    try {
      const res = await hrisApi.leaveBalances({ year: Number(balanceYear) });
      setBalances(res.balances);
      setBalError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal memuat kuota cuti";
      setBalError(msg);
      throw new Error(msg);
    } finally {
      setBalLoading(false);
    }
  }, [balanceYear]);

  // Pilihan tahun kuota: 3 tahun mulai 2025 — min digeser ke tahun join paling
  // awal bila lebih besar dari 2025.
  const balanceYearOptions = useMemo(() => {
    const joinYears = employees
      .map((e) => (e.joinedOn ? Number(e.joinedOn.slice(0, 4)) : 0))
      .filter((y) => Number.isInteger(y) && y > 1900);
    const minYear = Math.max(2025, joinYears.length ? Math.min(...joinYears) : 2025);
    return [minYear, minYear + 1, minYear + 2];
  }, [employees]);

  const balanceYearTouched = useRef(false);
  useEffect(() => {
    // Muat awal sudah di-cover loadAll — refetch hanya saat tahun diganti.
    if (!balanceYearTouched.current) {
      balanceYearTouched.current = true;
      return;
    }
    void loadBalances().catch(() => {
      // sudah ditandai di balError + global banner via loadAll pattern
    });
  }, [balanceYear, loadBalances]);

  const [balForm, setBalForm] = useState({ quotaDays: "", carriedDays: "", note: "" });
  const openBalEdit = (row: LeaveBalanceRow) => {
    setBalEditing(row);
    setBalForm({ quotaDays: String(row.quotaDays), carriedDays: String(row.carriedDays), note: "" });
  };
  const submitBalEdit = async () => {
    if (!balEditing) return;
    try {
      const quotaDays = Number(balForm.quotaDays);
      const carriedDays = Number(balForm.carriedDays);
      if (!Number.isFinite(quotaDays) || quotaDays < 0 || quotaDays > 365) {
        toast.error("Kuota cuti harus angka 0–365");
        return;
      }
      if (!Number.isFinite(carriedDays) || carriedDays < 0 || carriedDays > 365) {
        toast.error("Bawaan tahun lalu harus angka 0–365");
        return;
      }
      await hrisApi.upsertLeaveBalance({
        employeeId: balEditing.employeeId,
        year: Number(balanceYear),
        quotaDays,
        carriedDays,
        ...(balForm.note.trim() ? { note: balForm.note.trim() } : {}),
      });
      toast.success(`Kuota cuti ${balEditing.preferredName} tersimpan`);
      setBalEditing(null);
      await loadBalances();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan kuota cuti");
    }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setGlobalError(null);
    const tasks: Array<[string, () => Promise<void>]> = [
      ["Karyawan", loadEmployees],
      ["Kuota Cuti", loadBalances],
    ];
    const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
    const firstFail = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstFail) {
      const msg = firstFail.reason instanceof Error ? firstFail.reason.message : "Gagal memuat data";
      setGlobalError(msg);
      toast.error(msg);
    }
    setLoading(false);
  }, [loadEmployees, loadBalances]);

  useEffect(() => {
    // Ditunda 1 tick agar setState awal tidak berjalan sinkron di dalam effect.
    // Deps sengaja kosong: muat awal sekali — ganti tahun kuota ditangani effect terpisah.
    const id = setTimeout(() => { void loadAll(); }, 0);
    return () => clearTimeout(id);
  }, []);

  // ===== Kuota cuti saya (self-scope → 1 baris dari GET leave-balances) =====
  const myBalance: LeaveBalanceRow | null = balances.length > 0 ? balances[0] : null;

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

  // ===== Render =====
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">Kepegawaian — Karyawan &amp; Kuota Cuti</h1>
          <p className="text-sm text-zinc-500">Master data karyawan, status kepegawaian &amp; kuota cuti tahunan</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading} aria-label="Muat ulang data kepegawaian">
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

      <Tabs defaultValue="karyawan">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="karyawan" className="gap-1.5"><Users className="h-4 w-4" />Karyawan</TabsTrigger>
          <TabsTrigger value="kuota" className="gap-1.5"><CalendarDays className="h-4 w-4" />Kuota Cuti</TabsTrigger>
        </TabsList>

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

        {/* ===== TAB: KUOTA CUTI ===== */}
        <TabsContent value="kuota" className="mt-4 space-y-4">
          {isManagerPlus && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-500">Kuota tahunan + bawaan tahun lalu — cuti disetujui terhitung otomatis dari hari kerja.</p>
              <Select value={balanceYear} onValueChange={(v) => setBalanceYear(v)}>
                <SelectTrigger className="w-full sm:w-36" aria-label="Pilih tahun kuota cuti">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {balanceYearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {balError && (
            <Card className="border-rose-200 bg-rose-50">
              <CardContent className="flex items-center justify-between gap-3 py-3">
                <p className="flex items-center gap-2 text-sm text-rose-700"><AlertTriangle className="h-4 w-4" /> {balError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadBalances().catch(() => {})}>Coba Lagi</Button>
              </CardContent>
            </Card>
          )}

          {isManagerPlus ? (
            <Card className="rounded-xl border bg-white shadow-sm">
              <CardContent className="pt-4">
                {loading || balLoading ? <ListSkeleton rows={5} /> : balances.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-500">Tidak ada data kuota cuti</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto crm-scroll">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nama</TableHead>
                          <TableHead>Departemen</TableHead>
                          <TableHead className="text-right">Kuota</TableHead>
                          <TableHead className="text-right">Bawaan</TableHead>
                          <TableHead className="text-right">Terpakai</TableHead>
                          <TableHead className="w-44">Sisa</TableHead>
                          {isHrTeam && <TableHead className="text-right">Aksi</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {balances.map((b) => (
                          <TableRow key={b.employeeId}>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-zinc-900">{b.preferredName}</p>
                                <EmploymentStatusBadge status={b.employmentStatus} />
                              </div>
                              <p className="text-xs text-zinc-500">{b.employeeNumber}</p>
                            </TableCell>
                            <TableCell className="text-sm capitalize">{b.department ?? "—"}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{b.quotaDays}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{b.carriedDays}</TableCell>
                            <TableCell className="text-right text-sm">{b.usedDays}</TableCell>
                            <TableCell>
                              <p className={`text-sm font-semibold ${b.remaining < 0 ? "text-rose-600" : "text-zinc-900"}`}>{b.remaining} hari</p>
                              <LeaveBalanceBar remaining={b.remaining} total={b.quotaDays + b.carriedDays} />
                            </TableCell>
                            {isHrTeam && (
                              <TableCell className="text-right">
                                <Button size="sm" variant="ghost" className="h-8" aria-label={`Edit kuota cuti ${b.preferredName}`} onClick={() => openBalEdit(b)}>
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
          ) : (
            <Card className="rounded-xl border bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-zinc-500" /> Kuota Cuti Saya {balanceYear}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading || balLoading ? <Skeleton className="h-28 w-full rounded-lg" /> : !myBalance ? (
                  <p className="py-6 text-center text-sm text-zinc-500">Data kuota tidak tersedia — hubungi HR bila Anda karyawan aktif</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Sisa cuti</p>
                        <p className={`text-4xl font-bold ${myBalance.remaining < 0 ? "text-rose-600" : "text-zinc-900"}`}>
                          {myBalance.remaining}<span className="ml-1 text-base font-medium text-zinc-400">hari</span>
                        </p>
                      </div>
                      <div className="flex-1">
                        <LeaveBalanceBar remaining={myBalance.remaining} total={myBalance.quotaDays + myBalance.carriedDays} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 rounded-lg border bg-zinc-50 p-3 text-sm">
                      <div><p className="text-xs text-zinc-500">Kuota</p><p className="font-semibold text-zinc-900">{myBalance.quotaDays} hari</p></div>
                      <div><p className="text-xs text-zinc-500">Bawaan tahun lalu</p><p className="font-semibold text-zinc-900">{myBalance.carriedDays} hari</p></div>
                      <div><p className="text-xs text-zinc-500">Terpakai</p><p className="font-semibold text-zinc-900">{myBalance.usedDays} hari</p></div>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Cuti yang sudah disetujui otomatis terhitung — Sabtu, Minggu, dan hari libur nasional tidak dipotong dari kuota.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ===== Dialog: Edit kuota cuti ===== */}
      <Dialog open={!!balEditing} onOpenChange={(o) => !o && setBalEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit Kuota Cuti{balEditing ? ` — ${balEditing.preferredName} (${balanceYear})` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="bal-quota">Kuota tahunan (hari) *</Label>
                <Input id="bal-quota" type="number" min="0" max="365" value={balForm.quotaDays} onChange={(e) => setBalForm((f) => ({ ...f, quotaDays: e.target.value }))} aria-label="Kuota cuti tahunan (hari)" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bal-carried">Bawaan tahun lalu (hari)</Label>
                <Input id="bal-carried" type="number" min="0" max="365" value={balForm.carriedDays} onChange={(e) => setBalForm((f) => ({ ...f, carriedDays: e.target.value }))} aria-label="Sisa cuti dibawa dari tahun lalu (hari)" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bal-note">Catatan</Label>
              <Textarea id="bal-note" placeholder="mis. sisa 2 hari dibawa dari 2025" value={balForm.note} onChange={(e) => setBalForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            {balEditing && (
              <p className="text-xs text-zinc-500">
                Terpakai {balEditing.usedDays} hari (cuti disetujui) — sisa dihitung ulang otomatis: kuota + bawaan − terpakai.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBalEditing(null)}>Batal</Button>
            <Button className="bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => void submitBalEdit()}>
              Simpan
            </Button>
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
    </div>
  );
}
