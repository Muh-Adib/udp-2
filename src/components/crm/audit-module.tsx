"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RefreshCw } from "lucide-react";
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
import type { AuditLogDTO } from "@/lib/crm/types";
import { formatDateTime, initials, timeAgo } from "@/lib/crm/utils";

// ============ Meta ============

const ENTITY_OPTIONS = [
  { key: "all", label: "Semua Entity" },
  { key: "opportunity", label: "Opportunity" },
  { key: "contact", label: "Contact" },
  { key: "company", label: "Company" },
  { key: "task", label: "Task" },
  { key: "invoice", label: "Invoice" },
  { key: "project", label: "Project" },
  { key: "interaction", label: "Interaction" },
  { key: "user", label: "User" },
] as const;

const ACTION_OPTIONS = [
  { key: "all", label: "Semua Aksi" },
  { key: "create", label: "Create" },
  { key: "update", label: "Update" },
  { key: "delete", label: "Delete" },
  { key: "stage_change", label: "Stage Change" },
  { key: "merge", label: "Merge" },
  { key: "login", label: "Login" },
  { key: "convert", label: "Convert" },
] as const;

const LIMIT_OPTIONS = [50, 100, 200] as const;

const ACTION_BADGE: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-amber-100 text-amber-700",
  delete: "bg-rose-100 text-rose-700",
  stage_change: "bg-violet-100 text-violet-700",
  merge: "bg-cyan-100 text-cyan-700",
  login: "bg-zinc-100 text-zinc-600",
  convert: "bg-orange-100 text-orange-700",
};

const ROLE_BADGE: Record<string, string> = {
  super_admin: "bg-zinc-900 text-zinc-50",
  director: "bg-amber-100 text-amber-700",
  marketing: "bg-rose-100 text-rose-600",
  finance: "bg-cyan-100 text-cyan-700",
  production: "bg-lime-100 text-lime-700",
  client: "bg-zinc-100 text-zinc-400",
};

function actionBadge(action: string): { label: string; cls: string } {
  return {
    label: ACTION_OPTIONS.find((a) => a.key === action)?.label ?? action,
    cls: ACTION_BADGE[action] ?? "bg-zinc-100 text-zinc-600",
  };
}

function roleLabel(role?: string | null): string {
  if (!role) return "-";
  return ROLES.find((r) => r.key === role)?.label ?? role;
}

// ============ Sub-komponen kecil ============

function ChangeCell({ log }: { log: AuditLogDTO }) {
  if (log.field) {
    return (
      <span className="block max-w-[280px] truncate font-mono text-xs" title={`${log.field}: ${log.oldValue ?? "-"} → ${log.newValue ?? "-"}`}>
        {log.field}:{" "}
        <span className="text-rose-600 line-through">{log.oldValue ?? "-"}</span>
        {" → "}
        <span className="font-semibold text-emerald-700">{log.newValue ?? "-"}</span>
      </span>
    );
  }
  if (log.metadata) {
    return <span className="block max-w-[280px] truncate text-xs text-zinc-600" title={log.metadata}>{log.metadata}</span>;
  }
  return <span className="text-xs text-zinc-300">—</span>;
}

function AuditSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="ml-auto h-10 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-[60vh] rounded-xl" />
    </div>
  );
}

// ============ Module utama ============

export default function AuditModule() {
  const [logs, setLogs] = useState<AuditLogDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [limit, setLimit] = useState<string>("100");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.auditLogs({
        limit: Number(limit),
        entity,
        action,
      });
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat audit log");
      if (!silent) toast.error("Gagal memuat audit log");
    } finally {
      setLoading(false);
    }
  }, [entity, action, limit]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => {
    const list = logs ?? [];
    const actors = new Set(list.map((l) => l.actorName));
    return { total: list.length, actors: actors.size };
  }, [logs]);

  if (loading && logs === null) return <AuditSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Audit Logs</h1>
          <p className="text-sm text-zinc-500">Siapa mengubah apa, kapan, dari nilai apa menjadi apa</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang audit log">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
        </Button>
      </div>

      {/* Filter */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter entity">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter aksi">
            <SelectValue placeholder="Aksi" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={limit} onValueChange={setLimit}>
          <SelectTrigger className="w-full sm:w-[110px]" aria-label="Jumlah baris">
            <SelectValue placeholder="Limit" />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((l) => <SelectItem key={l} value={String(l)}>{l} baris</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-zinc-500 lg:ml-auto">
          {summary.total} log · {summary.actors} aktor unik
        </span>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Tabel log */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="max-h-[70vh] overflow-y-auto crm-scroll">
          <div className="min-w-[900px]">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky top-0 z-10 bg-white">Waktu</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-white">Aktor</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-white">Aksi</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-white">Entity</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-white">Perubahan</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-white">Koneksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs ?? []).map((log) => {
                  const ab = actionBadge(log.action);
                  return (
                    <TableRow key={log.id} className="hover:bg-zinc-50">
                      <TableCell className="whitespace-nowrap align-top">
                        <p className="text-xs font-medium text-zinc-800">{formatDateTime(log.createdAt)}</p>
                        <p className="text-[11px] text-zinc-400">{timeAgo(log.createdAt)}</p>
                      </TableCell>
                      <TableCell className="align-top">
                        <span className="flex items-center gap-2">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-white"
                            aria-hidden
                          >
                            {initials(log.actorName)}
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-[140px] truncate text-xs font-semibold text-zinc-800" title={log.actorName}>
                              {log.actorName}
                            </span>
                            {log.actorRole ? (
                              <Badge
                                variant="outline"
                                className={`mt-0.5 border-transparent px-1 py-0 text-[10px] ${ROLE_BADGE[log.actorRole] ?? "bg-zinc-100 text-zinc-500"}`}
                              >
                                {roleLabel(log.actorRole)}
                              </Badge>
                            ) : null}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={`border-transparent px-1.5 ${ab.cls}`}>{ab.label}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[180px] align-top">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="border-zinc-200 px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                            {log.entity}
                          </Badge>
                          <span className="truncate text-xs text-zinc-700" title={log.entityLabel ?? undefined}>
                            {log.entityLabel ?? log.entityId}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="align-top"><ChangeCell log={log} /></TableCell>
                      <TableCell className="max-w-[160px] align-top">
                        <p className="truncate text-xs text-zinc-400" title={log.ip ?? undefined}>{log.ip ?? "-"}</p>
                        <p className="truncate text-xs text-zinc-400" title={log.userAgent ?? undefined}>{log.userAgent ?? "-"}</p>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {logs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-400">
                      Tidak ada audit log untuk filter ini.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
