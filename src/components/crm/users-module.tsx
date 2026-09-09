"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Pencil, RefreshCw, ShieldCheck, UserPlus, Users as UsersIcon, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type UserAdminRow } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import { ROLES } from "@/lib/crm/constants";
import { MODULE_META, type ModuleKey } from "@/lib/crm/store";
import { initials } from "@/lib/crm/utils";

// ============ Meta ============

/** Warna badge per role (mengikuti konvensi warna proyek). */
const ROLE_BADGE: Record<string, string> = {
  super_admin: "bg-zinc-900 text-zinc-50",
  director: "bg-amber-100 text-amber-700",
  manager: "bg-teal-100 text-teal-700",
  hr: "bg-purple-100 text-purple-700",
  marketing: "bg-rose-100 text-rose-600",
  finance: "bg-cyan-100 text-cyan-700",
  production: "bg-lime-100 text-lime-700",
  client: "bg-zinc-100 text-zinc-400",
};

const MODULE_ORDER: ModuleKey[] = [
  "dashboard", "inbox", "contacts", "pipeline", "followups",
  "finance", "projects", "portal", "brands", "users", "audit",
];

const AVATAR_COLORS = ["#0f766e", "#b45309", "#be123c", "#7c3aed", "#0369a1", "#4d7c0f", "#525252", "#c2410c", "#0e7490", "#a21caf"];

function roleLabel(role: string): string {
  return ROLES.find((r) => r.key === role)?.label ?? role;
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className={`border-transparent px-1.5 ${ROLE_BADGE[role] ?? "bg-zinc-100 text-zinc-600"}`}>
      {roleLabel(role)}
    </Badge>
  );
}

// ============ Sub-komponen kecil ============

function UsersSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-64 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
      </div>
    </div>
  );
}

// ============ Dialog: buat / edit pengguna ============

interface UserFormState {
  name: string; email: string; role: string; avatarColor: string;
  phone: string; password: string; pin: string; active: boolean;
}

const EMPTY_FORM: UserFormState = {
  name: "", email: "", role: "marketing", avatarColor: AVATAR_COLORS[3],
  phone: "", password: "", pin: "1234", active: true,
};

function UserDialog({
  open, onOpenChange, target, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: UserAdminRow | null; // null = buat baru
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const isEdit = !!target;

  useEffect(() => {
    if (open) {
      setForm(target
        ? { name: target.name, email: target.email, role: target.role, avatarColor: target.avatarColor, phone: target.phone ?? "", password: "", pin: "", active: target.active }
        : { ...EMPTY_FORM, avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] });
    }
  }, [open, target]);

  async function submit() {
    setBusy(true);
    try {
      if (isEdit && target) {
        const payload: Record<string, unknown> = {
          name: form.name.trim(), role: form.role, avatarColor: form.avatarColor,
          phone: form.phone.trim() || null, active: form.active,
        };
        if (form.password.trim()) payload.password = form.password.trim();
        if (form.pin.trim()) payload.pin = form.pin.trim();
        await api.updateUser(target.id, payload);
        toast.success(`Perubahan ${target.name} tersimpan`);
      } else {
        await api.createUser({
          name: form.name.trim(), email: form.email.trim(), role: form.role,
          password: form.password.trim(), pin: form.pin.trim() || "1234",
          avatarColor: form.avatarColor, phone: form.phone.trim() || undefined,
        });
        toast.success(`Pengguna ${form.name} dibuat — sudah bisa login dengan password`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan pengguna");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = form.name.trim().length >= 2
    && (isEdit || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    && (isEdit || form.password.trim().length >= 8)
    && (!form.pin.trim() || /^\d{4,8}$/.test(form.pin.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Pengguna — ${target?.name}` : "Tambah Pengguna"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Perubahan role/status langsung berlaku. Biarkan kolom rahasia kosong bila tidak diubah."
              : "Buat akun nyata: login dengan email + password (min. 8 karakter); PIN dipakai untuk membuka layar terkunci."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5 py-1">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Nama lengkap</Label>
              <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Rina Kartika" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-role">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger id="u-role" aria-label="Role pengguna"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-email">Email {isEdit && <span className="text-xs text-zinc-400">(tetap)</span>}</Label>
              <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nama@udp.co.id" disabled={isEdit} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-phone">Telepon (opsional)</Label>
              <Input id="u-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+6281…" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-password">{isEdit ? "Reset password (opsional)" : "Password"}</Label>
              <Input id="u-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={isEdit ? "biarkan kosong = tidak diubah" : "min. 8 karakter"} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pin">{isEdit ? "Reset PIN layar (opsional)" : "PIN kunci layar"}</Label>
              <Input id="u-pin" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="4–8 digit" autoComplete="off" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-zinc-50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Warna avatar</p>
              <div className="mt-1.5 flex gap-1.5">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c} type="button" aria-label={`Pilih warna ${c}`}
                    onClick={() => setForm({ ...form, avatarColor: c })}
                    className={`h-6 w-6 rounded-full ring-offset-2 transition-transform hover:scale-110 ${form.avatarColor === c ? "ring-2 ring-zinc-900" : ""}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            {isEdit && (
              <div className="flex items-center gap-2">
                <Label htmlFor="u-active" className="text-sm">Aktif</Label>
                <Switch id="u-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || busy}>
            {isEdit ? "Simpan Perubahan" : "Buat Pengguna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Module utama ============

export default function UsersModule() {
  const me = useCrmStore((s) => s.user);
  // Ronde 46-b — manajemen user: super_admin ATAU direktur (tim UDP tanpa super_admin khusus).
  const isSuperAdmin = me?.role === "super_admin" || me?.role === "director";
  const [users, setUsers] = useState<UserAdminRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserAdminRow | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.users();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat users");
      if (!silent) toast.error("Gagal memuat data user");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredUsers = useMemo(() => {
    const list = users ?? [];
    if (roleFilter === "all") return list;
    return list.filter((u) => u.role === roleFilter);
  }, [users, roleFilter]);

  const roleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    (users ?? []).forEach((u) => { map[u.role] = (map[u.role] ?? 0) + 1; });
    return map;
  }, [users]);

  async function toggleActive(u: UserAdminRow) {
    try {
      await api.updateUser(u.id, { active: !u.active });
      toast.success(`${u.name} ${u.active ? "dinonaktifkan" : "diaktifkan"}`);
      void load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah status");
    }
  }

  if (loading && users === null) return <UsersSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">User &amp; Access</h1>
          <p className="text-sm text-zinc-500">Akun nyata dari database — login password, PIN kunci layar, role RBAC</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button size="sm" onClick={() => { setEditTarget(null); setDialogOpen(true); }} aria-label="Tambah pengguna baru">
              <UserPlus className="h-4 w-4" aria-hidden /> Tambah Pengguna
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang daftar user">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Filter role */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-[220px]" aria-label="Filter role user">
              <SelectValue placeholder="Semua Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Role</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label} ({roleCounts[r.key] ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-zinc-500 sm:ml-auto">{filteredUsers.length} dari {users?.length ?? 0} user</span>
      </div>

      {/* A. Tabel users */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Kredensial</TableHead>
                <TableHead>Status</TableHead>
                {isSuperAdmin && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: u.avatarColor }}
                        aria-hidden
                      >
                        {initials(u.name)}
                      </span>
                      <span className="text-sm font-semibold text-zinc-900">
                        {u.name}
                        {me?.id === u.id && <span className="ml-1.5 text-[10px] font-normal text-zinc-400">(Anda)</span>}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600">{u.email}</TableCell>
                  <TableCell><RoleBadge role={u.role} /></TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      {u.hasPassword ? (
                        <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-700">password ✓</Badge>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-700">tanpa password</Badge>
                          </TooltipTrigger>
                          <TooltipContent>Akun legacy — masih login via PIN. Reset password lewat Edit.</TooltipContent>
                        </Tooltip>
                      )}
                      {u.legacyPin && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="border-transparent bg-zinc-100 text-zinc-500">PIN plaintext</Badge>
                          </TooltipTrigger>
                          <TooltipContent>PIN belum ter-hash — otomatis dimigrasi saat login berikutnya.</TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {isSuperAdmin && me?.id !== u.id ? (
                      <label className="flex items-center gap-2 text-xs text-zinc-600">
                        <Switch checked={u.active} onCheckedChange={() => void toggleActive(u)} aria-label={`Aktifkan/nonaktifkan ${u.name}`} />
                        {u.active ? "Aktif" : "Nonaktif"}
                      </label>
                    ) : u.active ? (
                      <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-700">Aktif</Badge>
                    ) : (
                      <Badge variant="outline" className="border-transparent bg-zinc-100 text-zinc-400">Nonaktif</Badge>
                    )}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        aria-label={`Edit pengguna ${u.name}`}
                        onClick={() => { setEditTarget(u); setDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 6 : 5} className="py-10 text-center text-sm text-zinc-400">
                    Tidak ada user untuk role ini.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Dialog buat/edit — satu instance */}
      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        target={editTarget}
        onSaved={() => void load(true)}
      />

      {/* B. Matriks permission */}
      <section aria-label="Matriks hak akses" className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <ShieldCheck className="h-4 w-4 text-zinc-400" aria-hidden /> Matriks Hak Akses per Modul
          </h2>
          <p className="text-xs text-zinc-500">Ringkasan modul yang dapat dibuka tiap role (sumber: konfigurasi MODULE_META).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Modul
                </th>
                {ROLES.map((r) => (
                  <th key={r.key} className="border-b px-2 py-2 text-center text-xs font-semibold text-zinc-600">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULE_ORDER.map((m) => {
                const meta = MODULE_META[m];
                return (
                  <tr key={m} className="hover:bg-zinc-50">
                    <td className="sticky left-0 z-10 border-b bg-white px-3 py-2">
                      <p className="text-sm font-medium text-zinc-900">{meta.label}</p>
                      <p className="text-[11px] text-zinc-400">{meta.description}</p>
                    </td>
                    {ROLES.map((r) => {
                      const allowed = meta.roles.includes(r.key);
                      return (
                        <td key={r.key} className="border-b px-2 py-2 text-center">
                          <span
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${allowed ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-400"}`}
                            aria-label={`${allowed ? "Boleh" : "Tidak boleh"} — ${meta.label} untuk ${r.label}`}
                          >
                            {allowed ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* C. Kartu penjelasan per role */}
      <section aria-label="Penjelasan role" className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <UsersIcon className="h-4 w-4 text-zinc-400" aria-hidden /> Penjelasan Role
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.key} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <RoleBadge role={r.key} />
                <span className="text-[11px] text-zinc-400">{roleCounts[r.key] ?? 0} user</span>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-zinc-600">{r.description}</p>
              <p className="mt-2 text-[11px] text-zinc-400">
                {MODULE_ORDER.filter((m) => MODULE_META[m].roles.includes(r.key)).length} modul dapat diakses
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
