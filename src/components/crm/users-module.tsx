"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, RefreshCw, ShieldCheck, Users as UsersIcon, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/crm/api-client";
import { ROLES } from "@/lib/crm/constants";
import { MODULE_META, type ModuleKey } from "@/lib/crm/store";
import { initials } from "@/lib/crm/utils";

// ============ Meta ============

/** Warna badge per role (mengikuti konvensi warna proyek). */
const ROLE_BADGE: Record<string, string> = {
  super_admin: "bg-zinc-900 text-zinc-50",
  director: "bg-amber-100 text-amber-700",
  marketing: "bg-rose-100 text-rose-600",
  finance: "bg-cyan-100 text-cyan-700",
  production: "bg-lime-100 text-lime-700",
  client: "bg-zinc-100 text-zinc-400",
};

const MODULE_ORDER: ModuleKey[] = [
  "dashboard", "inbox", "contacts", "pipeline", "followups",
  "finance", "projects", "portal", "brands", "users", "audit",
];

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarColor: string;
  active: boolean;
}

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

// ============ Module utama ============

export default function UsersModule() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("all");

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

  if (loading && users === null) return <UsersSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">User &amp; Access</h1>
          <p className="text-sm text-zinc-500">Role dan hak akses per modul</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang daftar user">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
        </Button>
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
                <TableHead>Status</TableHead>
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
                      <span className="text-sm font-semibold text-zinc-900">{u.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600">{u.email}</TableCell>
                  <TableCell><RoleBadge role={u.role} /></TableCell>
                  <TableCell>
                    {u.active ? (
                      <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-700">Aktif</Badge>
                    ) : (
                      <Badge variant="outline" className="border-transparent bg-zinc-100 text-zinc-400">Nonaktif</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-zinc-400">
                    Tidak ada user untuk role ini.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>

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
