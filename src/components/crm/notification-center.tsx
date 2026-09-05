"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrmStore, type ModuleKey } from "@/lib/crm/store";
import { api } from "@/lib/crm/api-client";
import {
  applyNotifPrefs, NOTIF_TYPES, useNotifPrefs,
} from "@/lib/crm/notif-prefs";
import { timeAgo } from "@/lib/crm/utils";
import { useNotifSocket } from "@/lib/crm/notif-socket";
import type { NotificationDTO, NotificationSeverity, NotificationType } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { io } from "socket.io-client";
import {
  Bell, BellOff, CheckCheck, X, Timer, FileCheck2, GitPullRequestArrow,
  ListChecks, CalendarClock, ReceiptText, SlidersHorizontal, MessageSquare,
} from "lucide-react";

/** Event global untuk membuka pusat notifikasi dari widget dashboard. */
export const OPEN_NOTIF_EVENT = "crm:open-notifications";

/** Event global: notifikasi berubah (realtime) — widget dashboard ikut refresh.
 * Konstanta didefinisikan di notif-prefs (dipakai juga utk sync prefs antar perangkat). */
export { NOTIF_CHANGED_EVENT } from "@/lib/crm/notif-prefs";
import { NOTIF_CHANGED_EVENT } from "@/lib/crm/notif-prefs";

const TYPE_ICON: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  sla: Timer,
  message: MessageSquare, // Ronde 32 — pesan baru dari lead
  approval: FileCheck2,
  cr: GitPullRequestArrow,
  task: ListChecks,
  deadline: CalendarClock,
  invoice: ReceiptText,
};

const SEVERITY_STYLE: Record<NotificationSeverity, string> = {
  danger: "bg-rose-100 text-rose-600",
  warning: "bg-amber-100 text-amber-600",
  info: "bg-zinc-100 text-zinc-500",
};

/** Module tujuan navigasi yang valid untuk notifikasi (Fase 3). */
const NAV_MODULES = new Set<string>(["dashboard", "inbox", "pipeline", "followups", "finance", "projects"]);

type FilterKey = "all" | "unread";

/** Statistik mini service via event socket "stats" (ronde 17-d — monitoring kesehatan). */
interface ServiceStats {
  startedAt: string;
  uptimeMs: number;
  activeRooms: number;
  totalEmits: number;
  pollCount: number;
  pollErrorCount: number;
  lastPollAt: string | null;
}

/** Hasil GET /api/health (ronde 17-d) — struktur sama dgn api.getSystemHealth. */
interface SystemHealth {
  status: "ok" | "degraded";
  db: { status: "up" | "down"; ms: number | null };
  notifService: { status: "up" | "down"; detail: string };
  uptimeSec: number;
  rssMb: number;
}

/** Durasi pendek utk uptime layanan: "45 dtk", "12 mnt", "2 j 13 mnt", "3 hr 2 j". */
function formatUptimeShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} j ${m % 60} mnt`;
  const d = Math.floor(h / 24);
  return `${d} hr ${h % 24} j`;
}

function normalizeStats(v: unknown): ServiceStats | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<ServiceStats>;
  if (typeof s.uptimeMs !== "number" || typeof s.activeRooms !== "number") return null;
  return {
    startedAt: typeof s.startedAt === "string" ? s.startedAt : "",
    uptimeMs: s.uptimeMs,
    activeRooms: s.activeRooms,
    totalEmits: typeof s.totalEmits === "number" ? s.totalEmits : 0,
    pollCount: typeof s.pollCount === "number" ? s.pollCount : 0,
    pollErrorCount: typeof s.pollErrorCount === "number" ? s.pollErrorCount : 0,
    lastPollAt: typeof s.lastPollAt === "string" ? s.lastPollAt : null,
  };
}

/** Minta statistik layanan via socket "stats" (ack + fallback event "service:stats").
 * Koneksi sekali pakai (forceNew, tanpa reconnect) agar TIDAK mengganggu socket
 * notifikasi milik useNotifSocket — hanya dipanggil saat panel preferensi dibuka. */
function fetchServiceStats(): Promise<ServiceStats | null> {
  return new Promise((resolve) => {
    let done = false;
    let socket: ReturnType<typeof io> | null = null;
    const finish = (v: ServiceStats | null) => {
      if (done) return;
      done = true;
      try {
        socket?.close();
      } catch {
        /* abaikan */
      }
      resolve(v);
    };
    try {
      socket = io("/?XTransformPort=3005", {
        path: "/",
        transports: ["polling", "websocket"],
        forceNew: true,
        reconnection: false,
        timeout: 4000,
      });
      socket.on("connect", () => {
        socket?.once("service:stats", (s: unknown) => finish(normalizeStats(s)));
        socket?.emit("stats", (s: unknown) => finish(normalizeStats(s)));
      });
      socket.on("connect_error", () => finish(null));
      window.setTimeout(() => finish(null), 4500);
    } catch {
      finish(null);
    }
  });
}

export default function NotificationCenter() {
  const user = useCrmStore((s) => s.user);
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);

  const [open, setOpen] = useState(false);
  // items = data mentah dari server; tampilan & unread diturunkan via useMemo (prefs + filter)
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [acting, setActing] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const { prefs, update, toggleMuted } = useNotifPrefs(user?.email);

  // Status sistem (ronde 17-d) — diisi saat panel preferensi dibuka
  const [serviceStats, setServiceStats] = useState<ServiceStats | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);

  // Ref terbaru agar polling tidak dobel & closure selalu segar
  const brandRef = useRef(activeBrandFilter);
  const openRef = useRef(open);
  const inFlightRef = useRef(false);
  const firstLoadDoneRef = useRef(false);
  const realtimeRef = useRef(false);

  useEffect(() => {
    brandRef.current = activeBrandFilter;
    openRef.current = open;
  });

  const load = useCallback(async (silent = false) => {
    const u = user;
    if (!u || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      if (!silent) setLoading(true);
      const res = await api.notifications(u.email, brandRef.current);
      setItems(res.items);
      // Reset filter saat re-fetch — hanya saat popover tertutup agar tidak mengganggu yang sedang membaca
      if (!openRef.current) setFilter("all");
      firstLoadDoneRef.current = true;
    } catch {
      if (!silent) toast.error("Gagal memuat notifikasi");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [user]);

  // Turunan tampilan: preferensi mute/hideRead + filter segmented + hitung unread
  const { visible, unread, hasDangerUnread } = useMemo(() => {
    const applied = applyNotifPrefs(items, prefs);
    const shown = filter === "unread" ? applied.items.filter((i) => !i.read) : applied.items;
    const danger = applied.unread > 0 && applied.items.some((i) => !i.read && i.severity === "danger");
    return { visible: shown, unread: applied.unread, hasDangerUnread: danger };
  }, [items, prefs, filter]);

  // Event global: buka popover dari luar (widget dashboard)
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setFilter("all");
      setShowPrefs(false);
      void load();
    };
    window.addEventListener(OPEN_NOTIF_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIF_EVENT, onOpen);
  }, [load]);

  // Fetch awal saat user login + refetch saat filter brand global berubah
  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, activeBrandFilter, load]);

  // Polling 60 detik untuk refresh unread — skip saat tab tidak terlihat atau realtime aktif.
  // Ronde 16-c: polling fallback JUGA men-dispatch crm:notif-changed agar preferensi notifikasi
  // (UserPreference) & widget dashboard tetap tersinkron antar perangkat walau socket tidak aktif.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (realtimeRef.current) return; // push realtime menang — hindari fetch dobel
      void load(true);
      window.dispatchEvent(new CustomEvent(NOTIF_CHANGED_EVENT));
    }, 60_000);
    return () => clearInterval(id);
  }, [user, load]);

  // Push realtime via mini service socket.io (port 3005) — onChanged memakai refetch yang sama.
  const { connected: realtimeConnected } = useNotifSocket({
    email: user?.email ?? null,
    brandId: activeBrandFilter,
    enabled: !!user,
    onChanged: () => {
      void load(true);
      window.dispatchEvent(new CustomEvent(NOTIF_CHANGED_EVENT));
    },
  });

  useEffect(() => {
    realtimeRef.current = realtimeConnected;
  }, [realtimeConnected]);

  // "Status sistem" (ronde 17-d): refresh SETIAP panel preferensi dibuka — tanpa interval.
  // Kesehatan server via GET /api/health; statistik realtime service via socket "stats"
  // (hanya saat socket browser konek — saat fallback, status layanan dicek dari server).
  useEffect(() => {
    if (!open || !showPrefs) return;
    let cancelled = false;
    setServiceStats(null);
    setSystemHealth(null);
    setHealthFailed(false);
    api
      .getSystemHealth()
      .then((h) => {
        if (!cancelled) setSystemHealth(h);
      })
      .catch(() => {
        if (!cancelled) setHealthFailed(true);
      });
    if (realtimeConnected) {
      void fetchServiceStats().then((s) => {
        if (!cancelled && s) setServiceStats(s);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, showPrefs, realtimeConnected]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setFilter("all");
      void load();
    }
  }

  function handleItemClick(n: NotificationDTO) {
    const u = user;
    if (!u) return;
    if (!n.read) {
      setItems((prev) => prev.map((i) => (i.key === n.key ? { ...i, read: true } : i)));
      // Ronde 36 (audit FIX): optimistic read kini di-revert bila request gagal
      // (dulu tetap "terbaca" di UI sampai poll berikutnya).
      api.markNotifications({ user: u.email, action: "read", keys: [n.key] }).catch(() => {
        setItems((prev) => prev.map((i) => (i.key === n.key ? { ...i, read: false } : i)));
      });
    }
    if (NAV_MODULES.has(n.module)) setActiveModule(n.module as ModuleKey);
    setOpen(false);
  }

  function handleDismiss(e: React.MouseEvent, n: NotificationDTO) {
    e.stopPropagation();
    const u = user;
    if (!u) return;
    setItems((prev) => prev.filter((i) => i.key !== n.key));
    api.markNotifications({ user: u.email, action: "dismiss", keys: [n.key] }).catch(() => {
      toast.error("Gagal menghapus notifikasi");
      void load(true);
    });
  }

  async function handleMarkAll() {
    const u = user;
    if (!u) return;
    const keys = items.filter((i) => !i.read).map((i) => i.key);
    if (keys.length === 0) return;
    setActing(true);
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    try {
      await api.markNotifications({ user: u.email, action: "read", keys });
      void load(true);
    } catch {
      toast.error("Gagal menandai semua notifikasi");
      void load(true);
    } finally {
      setActing(false);
    }
  }

  if (!user) return null;

  const showSkeleton = loading && items.length === 0;

  // Baris "Status sistem": kesehatan database dari GET /api/health (ronde 17-d)
  const dbLine = (() => {
    if (healthFailed) return { dot: "bg-red-600", text: "Server tidak terjangkau" };
    if (!systemHealth) return { dot: "bg-zinc-400", text: "Memeriksa server…" };
    if (systemHealth.db.status !== "up" || systemHealth.db.ms === null) {
      return { dot: "bg-red-600", text: "Database tidak responsif" };
    }
    if (systemHealth.db.ms > 500) {
      return { dot: "bg-amber-500", text: `Database lambat · ${systemHealth.db.ms} ms` };
    }
    return { dot: "bg-emerald-500", text: `Database responsif · ${systemHealth.db.ms} ms` };
  })();
  // Probe layanan dari server — hanya tampil saat socket browser tidak konek (fallback)
  const serviceLine = (() => {
    if (healthFailed) return { dot: "bg-zinc-400", text: "Kesehatan layanan tidak diketahui" };
    if (!systemHealth) return { dot: "bg-zinc-400", text: "Memeriksa layanan dari server…" };
    return systemHealth.notifService.status === "up"
      ? { dot: "bg-emerald-500", text: "Layanan notifikasi terjangkau dari server" }
      : { dot: "bg-red-600", text: "Layanan notifikasi mati (dari server)" };
  })();

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Buka pusat notifikasi"
          title={unread > 0 ? `${unread} notifikasi belum dibaca` : "Notifikasi"}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {hasDangerUnread && (
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-600" />
            </span>
          )}
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-0" aria-label="Pusat notifikasi">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">Notifikasi</h2>
            {unread > 0 && (
              <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                {unread} belum dibaca
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-zinc-500 hover:text-zinc-900"
            onClick={() => setShowPrefs((v) => !v)}
            aria-expanded={showPrefs}
            aria-label="Preferensi notifikasi"
            title="Preferensi notifikasi"
          >
            <SlidersHorizontal className={cn("h-4 w-4", showPrefs && "text-zinc-900")} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-zinc-500 hover:text-zinc-900"
            disabled={unread === 0 || acting}
            onClick={handleMarkAll}
            aria-label="Tandai semua dibaca"
            title="Tandai semua dibaca"
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {/* Panel preferensi (mute per tipe) */}
        {showPrefs ? (
          <div className="border-b border-zinc-200 bg-zinc-50/60 px-4 py-3" role="region" aria-label="Preferensi notifikasi">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Tipe notifikasi</p>
            <p className="mt-0.5 text-[10px] text-zinc-400">Tipe yang dimatikan tidak tampil & tidak dihitung sebagai belum dibaca. Tersimpan per pengguna & tersinkron antar perangkat.</p>
            <ul className="mt-2 space-y-1">
              {NOTIF_TYPES.map((t) => {
                const muted = prefs.muted.includes(t.key);
                return (
                  <li key={t.key} className="flex items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-1.5">
                    <span className="min-w-0">
                      <span className={cn("block text-xs font-medium", muted ? "text-zinc-400" : "text-zinc-900")}>{t.label}</span>
                      <span className="block truncate text-[10px] text-zinc-400">{t.hint}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className={cn("text-[10px] font-medium", muted ? "text-rose-500" : "text-emerald-600")}>
                        {muted ? "Mute" : "Aktif"}
                      </span>
                      <Switch
                        checked={!muted}
                        onCheckedChange={() => toggleMuted(t.key)}
                        aria-label={`${muted ? "Aktifkan" : "Matikan"} notifikasi ${t.label}`}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
            <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-white px-2.5 py-1.5">
              <span className="text-xs font-medium text-zinc-900">Sembunyikan yang sudah dibaca</span>
              <Switch
                checked={prefs.hideRead}
                onCheckedChange={(v) => update({ hideRead: v })}
                aria-label="Sembunyikan notifikasi yang sudah dibaca"
              />
            </label>
            {/* Status sinkronisasi antar perangkat (ronde 16-c) */}
            <p
              className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500"
              aria-live="polite"
              data-testid="prefs-sync-status"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  realtimeConnected ? "animate-pulse bg-emerald-500" : "bg-amber-500"
                )}
                aria-hidden
              />
              {realtimeConnected ? "Tersinkron antar perangkat" : "Sinkron antar perangkat menunggu koneksi realtime"}
            </p>
            {/* Status sistem (ronde 17-d) — realtime service + kesehatan server; dimuat tiap panel dibuka */}
            <div
              className="mt-3 border-t border-zinc-200 pt-2"
              role="region"
              aria-label="Status sistem"
              data-testid="status-sistem"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Status sistem</p>
              <ul className="mt-1 space-y-1">
                <li className="flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite" data-testid="health-realtime">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      realtimeConnected ? "animate-pulse bg-emerald-500" : "bg-amber-500"
                    )}
                    aria-hidden
                  />
                  {realtimeConnected
                    ? serviceStats
                      ? `Layanan realtime aktif · ${formatUptimeShort(serviceStats.uptimeMs)} · ${serviceStats.activeRooms} ruangan`
                      : "Layanan realtime aktif"
                    : "Layanan realtime tidak terjangkau dari browser — dicek dari server"}
                </li>
                {!realtimeConnected && (
                  <li className="flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite" data-testid="health-service-server">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", serviceLine.dot)} aria-hidden />
                    {serviceLine.text}
                  </li>
                )}
                <li className="flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite" data-testid="health-server">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dbLine.dot)} aria-hidden />
                  {dbLine.text}
                </li>
              </ul>
            </div>
          </div>
        ) : null}

        {/* Filter segmented */}
        <div className="border-b border-zinc-200 px-4 py-2">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5" aria-label="Filter notifikasi">
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === "all" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              Semua
            </button>
            <button
              type="button"
              aria-pressed={filter === "unread"}
              onClick={() => setFilter("unread")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === "unread" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              Belum dibaca
            </button>
          </div>
        </div>

        {/* List / skeleton / empty */}
        {showSkeleton ? (
          <div className="space-y-4 px-4 py-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-zinc-200" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-200" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
            <BellOff className="h-10 w-10 text-zinc-300" aria-hidden />
            <p className="text-sm font-medium text-zinc-600">Tidak ada notifikasi</p>
            <p className="text-xs text-zinc-400">
              {filter === "all" ? "Semua tugas & lead dalam kendali" : "Semua notifikasi sudah dibaca"}
            </p>
          </div>
        ) : (
          <div className="max-h-[380px] divide-y divide-zinc-100 overflow-y-auto crm-scroll">
            {visible.map((n) => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              return (
                <div
                  key={n.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleItemClick(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleItemClick(n);
                    }
                  }}
                  aria-label={n.title}
                  className={cn(
                    "group relative flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-100/60 focus-visible:bg-zinc-100/60 focus-visible:outline-none",
                    !n.read && "bg-zinc-50/80"
                  )}
                >
                  {!n.read && (
                    <span className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-rose-600" aria-hidden />
                  )}
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", SEVERITY_STYLE[n.severity])}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("line-clamp-2 text-[13px] font-medium text-zinc-900", n.read && "font-normal text-zinc-500")}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{n.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-zinc-400">
                      {n.brandColor && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: n.brandColor }} aria-hidden />
                      )}
                      {n.brandName && <span className="font-medium text-zinc-500">{n.brandName}</span>}
                      {n.entityLabel && <span className="font-mono">{n.entityLabel}</span>}
                      <span>{timeAgo(n.at)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDismiss(e, n)}
                    aria-label="Hapus notifikasi"
                    title="Hapus notifikasi"
                    className="rounded-md p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-zinc-200 px-4 py-2">
          <p className="flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                realtimeConnected ? "animate-pulse bg-emerald-500" : "bg-zinc-400"
              )}
              aria-hidden
            />
            {realtimeConnected ? "Realtime aktif" : "Mode fallback · polling 60 dtk"}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
