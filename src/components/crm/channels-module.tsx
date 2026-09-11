"use client";

/**
 * Ronde 19 — Saluran & Integrasi (Fase 3): koneksi WhatsApp Business, Instagram,
 * dan Email per brand / global. Kredensial selalu ditampilkan TERSENSA oleh API
 * ("••••1234"); edit hanya mengirim field yang diisi ulang (kosong = tetap).
 * Termasuk panduan webhook WhatsApp (URL + verify token aktif + salin).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  AtSign,
  BookOpen,
  Building2,
  Check,
  CircleAlert,
  Copy,
  Instagram,
  Loader2,
  Mail,
  Pencil,
  Plug,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WhatsAppIcon } from "@/components/crm/whatsapp-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { channelsApi } from "@/lib/crm/api-client";
import { CHANNEL_TYPES, SETUP_GUIDES } from "@/lib/crm/channels";
import { useCrmStore } from "@/lib/crm/store";
import type { ChannelActivityStats, ChannelConfigDTO } from "@/lib/crm/types";
import { formatDate } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";
import ChannelSetupWizard from "./channel-setup-wizard";

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  whatsapp: WhatsAppIcon,
  instagram: Instagram,
  threads: AtSign,
  email: Mail,
};

const STATUS_META: Record<string, { label: string; badgeCls: string; dotCls: string }> = {
  connected: { label: "Terhubung", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200", dotCls: "bg-emerald-500" },
  disconnected: { label: "Terputus", badgeCls: "bg-zinc-100 text-zinc-600 border-zinc-200", dotCls: "bg-zinc-400" },
  error: { label: "Error", badgeCls: "bg-red-50 text-red-700 border-red-200", dotCls: "bg-red-500" },
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Disalin ke clipboard");
  } catch {
    toast.error("Gagal menyalin — salin manual dari teks");
  }
}

// ---------- Kartu koneksi terpasang ----------

function ConfigCard({
  config,
  stats,
  busy,
  onTest,
  onEdit,
  onToggle,
  onDelete,
}: {
  config: ChannelConfigDTO;
  stats?: ChannelActivityStats;
  busy: string | null;
  onTest: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const Icon = CHANNEL_ICONS[config.channel] ?? Plug;
  const color = CHANNEL_TYPES[config.channel]?.color ?? "#f97316";
  const status = STATUS_META[config.status] ?? STATUS_META.disconnected;

  return (
    <div className="flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-zinc-900">{config.displayName}</p>
            <Badge variant="outline" className={cn("gap-1 px-1.5 py-0 text-[10px]", status.badgeCls)}>
              <span className={cn("size-1.5 rounded-full", status.dotCls)} aria-hidden="true" />
              {status.label}
            </Badge>
            {config.isDemo ? (
              <Badge variant="outline" className="gap-0.5 border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700">
                <Sparkles className="size-2.5" aria-hidden="true" />
                Demo
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-zinc-500">{config.accountRef}</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {config.brand ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3" aria-hidden="true" />
                {config.brand.name}
              </span>
            ) : (
              "Global (semua brand)"
            )}
            {config.connectedAt ? ` · terhubung ${formatDate(config.connectedAt)}` : ""}
          </p>
        </div>
      </div>

      {config.statusNote ? (
        <p
          className={cn(
            "mt-2.5 truncate rounded-lg px-2 py-1 text-[11px]",
            config.status === "error" ? "bg-red-50 text-red-600" : "bg-zinc-50 text-zinc-500"
          )}
          title={config.statusNote}
        >
          {config.status === "error" ? <CircleAlert className="mr-1 inline size-3" aria-hidden="true" /> : <ShieldCheck className="mr-1 inline size-3 text-emerald-500" aria-hidden="true" />}
          {config.statusNote}
          {config.lastTestedAt ? ` · ${formatDate(config.lastTestedAt)}` : ""}
        </p>
      ) : null}

      {Object.keys(config.credentials).length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {Object.entries(config.credentials)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k} className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                {k}: {v}
              </span>
            ))}
        </div>
      ) : null}

      {/* Statistik aktivitas kanal (7 hari) */}
      {stats && (stats.inbound7d > 0 || stats.outbound7d > 0 || stats.inboundTotal > 0) ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500" title="Lead masuk 7 hari terakhir">
            <ArrowDownLeft className="size-3 text-emerald-500" aria-hidden="true" />
            {stats.inbound7d} masuk/7h
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500" title="Balasan terkirim 7 hari terakhir">
            <ArrowUpRight className="size-3 text-orange-500" aria-hidden="true" />
            {stats.outbound7d} balasan/7h
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-400" title="Total lead masuk sepanjang waktu">
            {stats.inboundTotal} total
          </span>
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onTest} disabled={busy === `test-${config.id}`}>
          {busy === `test-${config.id}` ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-3" aria-hidden="true" />}
          Uji
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onEdit} disabled={busy !== null}>
          <Pencil className="size-3" aria-hidden="true" />
          Edit
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onToggle} disabled={busy !== null}>
          {busy === `toggle-${config.id}` ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : config.status === "disconnected" ? (
            <PlugZap className="size-3" aria-hidden="true" />
          ) : (
            <Unplug className="size-3" aria-hidden="true" />
          )}
          {config.status === "disconnected" ? "Sambungkan" : "Putuskan"}
        </Button>
        {/* Tautan dokumentasi resmi kanal */}
        {SETUP_GUIDES[config.channel] ? (
          <a
            href={SETUP_GUIDES[config.channel].steps.find((s) => s.docLink)?.docLink?.href ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Buka dokumentasi resmi ${config.displayName}`}
            title="Dokumentasi resmi"
            className="inline-flex h-7 items-center rounded-md px-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={onDelete}
          disabled={busy !== null}
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ---------- Kartu tipe kanal (belum ada koneksi) ----------

function TypeCard({
  channelKey,
  onConnect,
  onDemo,
  demoBusy,
}: {
  channelKey: string;
  onConnect: () => void;
  onDemo: () => void;
  demoBusy: boolean;
}) {
  const meta = CHANNEL_TYPES[channelKey];
  if (!meta) return null;
  const Icon = CHANNEL_ICONS[channelKey] ?? Plug;
  return (
    <div className="flex flex-col rounded-2xl border border-dashed bg-zinc-50/60 p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm"
          style={{ color: meta.color }}
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-700">{meta.label}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">{meta.description}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        <Button
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-white hover:opacity-90"
          style={{ backgroundColor: meta.color }}
          onClick={onConnect}
        >
          <PlugZap className="size-3.5" aria-hidden="true" />
          Setup berpandu
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"
          onClick={onDemo}
          disabled={demoBusy}
          title="Hubungkan instan dengan kredensial demo (tanpa akun asli)"
        >
          {demoBusy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3" aria-hidden="true" />}
          Demo cepat
        </Button>
      </div>
    </div>
  );
}

// ---------- Komponen utama ----------

export default function ChannelsModule() {
  const { user, brands, setActiveModule } = useCrmStore();

  const [data, setData] = useState<{ configs: ChannelConfigDTO[]; webhook: { whatsapp: { path: string; envVerifyToken: boolean; envAppSecret: boolean; effectiveVerifyToken: string; dbTokenCount: number; dbSecretCount: number } }; stats: Record<string, ChannelActivityStats> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Wizard setup berpandu (ronde 20)
  const [wizardChannel, setWizardChannel] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  // Form connect/edit
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelConfigDTO | null>(null);
  const [formChannel, setFormChannel] = useState("whatsapp");
  const [formBrand, setFormBrand] = useState<string>("all");
  const [formName, setFormName] = useState("");
  const [formAccount, setFormAccount] = useState("");
  const [formCreds, setFormCreds] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Hapus
  const [deleteTarget, setDeleteTarget] = useState<ChannelConfigDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await channelsApi.list();
      setData(res);
    } catch (e) {
      console.error(e);
      // Ronde 36 (audit FIX): kegagalan muat kini terlihat — dulu diam-diam
      // menampilkan empty state "Belum ada kanal" yang menyesatkan.
      toast.error(e instanceof Error ? e.message : "Gagal memuat daftar kanal");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configs = data?.configs ?? [];
  const connectedChannels = useMemo(() => new Set(configs.map((c) => c.channel)), [configs]);
  const waInfo = data?.webhook?.whatsapp;

  function openConnect(channelKey: string) {
    // Ronde 20: connect selalu via wizard berpandu (dialog manual hanya utk edit).
    setWizardChannel(channelKey);
    setWizardOpen(true);
  }

  async function handleDemoQuick(channelKey: string) {
    setDemoBusy(channelKey);
    try {
      await channelsApi.demoConnect({ channel: channelKey, actorName: user?.name, actorRole: user?.role });
      toast.success(`${CHANNEL_TYPES[channelKey]?.label ?? channelKey} terhubung (mode demo)`, {
        description: "Kredensial demo aktif — ganti kredensial asli kapan pun lewat Edit.",
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat koneksi demo");
    } finally {
      setDemoBusy(null);
    }
  }

  function openEdit(config: ChannelConfigDTO) {
    setEditing(config);
    setFormChannel(config.channel);
    setFormBrand(config.brandId ?? "all");
    setFormName(config.displayName);
    setFormAccount(config.accountRef ?? "");
    setFormCreds({});
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    const meta = CHANNEL_TYPES[formChannel];
    if (!meta) return;
    if (!formName.trim()) {
      setFormError("Nama koneksi wajib diisi");
      return;
    }
    if (!formAccount.trim()) {
      setFormError(`${meta.accountRefLabel} wajib diisi`);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await channelsApi.update(editing.id, {
          action: "update",
          displayName: formName.trim(),
          accountRef: formAccount.trim(),
          credentials: formCreds,
          actorName: user?.name,
          actorRole: user?.role,
        });
      } else {
        await channelsApi.connect({
          channel: formChannel,
          brandId: formBrand === "all" ? null : formBrand,
          displayName: formName.trim(),
          accountRef: formAccount.trim(),
          credentials: formCreds,
          actorName: user?.name,
          actorRole: user?.role,
        });
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Gagal menyimpan koneksi");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(config: ChannelConfigDTO) {
    setBusy(`test-${config.id}`);
    try {
      const res = await channelsApi.update(config.id, { action: "test", actorName: user?.name, actorRole: user?.role });
      // Ronde 36 (audit FIX): hasil tes kini DITAMPILKAN — dulu di-void (user tak tahu
      // apakah kanal benar-benar berfungsi).
      const st = res.config?.status;
      const note = res.config?.statusNote;
      if (st === "connected") toast.success(note || `Koneksi ${config.displayName} OK`);
      else if (st === "error" || st === "disconnected") toast.error(note || `Tes ${config.displayName} gagal`);
      else if (note) toast.info(note);
      await load();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Gagal mengetes kanal");
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle(config: ChannelConfigDTO) {
    setBusy(`toggle-${config.id}`);
    try {
      await channelsApi.update(config.id, {
        action: config.status === "disconnected" ? "reconnect" : "disconnect",
        actorName: user?.name,
        actorRole: user?.role,
      });
      await load();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Gagal mengubah status kanal");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(`delete-${deleteTarget.id}`);
    try {
      await channelsApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Gagal menghapus kanal");
    } finally {
      setBusy(null);
    }
  }

  const meta = CHANNEL_TYPES[formChannel];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Saluran &amp; Integrasi</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Hubungkan WhatsApp Business, Instagram, dan Email agar lead masuk &amp; balasan terkirim lewat kanal yang
            sama.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
          Muat ulang
        </Button>
      </div>

      {/* Panduan webhook WhatsApp */}
      {waInfo ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Webhook className="size-4 text-emerald-600" aria-hidden="true" />
            <p className="text-sm font-semibold text-emerald-800">Setup webhook WhatsApp (Meta App)</p>
            <Badge variant="outline" className="border-emerald-300 bg-white text-[10px] text-emerald-700">
              {waInfo.envVerifyToken ? "verify token dari ENV" : waInfo.dbTokenCount > 0 ? `verify token dari ${waInfo.dbTokenCount} koneksi tersimpan` : "fallback token demo"}
            </Badge>
            <Badge variant="outline" className="border-emerald-300 bg-white text-[10px] text-emerald-700">
              {waInfo.envAppSecret ? "app secret dari ENV" : waInfo.dbSecretCount > 0 ? `signature: ${waInfo.dbSecretCount} app secret tersimpan` : "signature validation nonaktif"}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Callback URL</p>
                <p className="truncate font-mono text-xs text-zinc-700">{waInfo.path}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-zinc-400 hover:text-emerald-700"
                aria-label="Salin callback URL"
                onClick={() => void copyText(waInfo.path)}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Verify Token aktif</p>
                <p className="truncate font-mono text-xs text-zinc-700">{waInfo.effectiveVerifyToken}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-zinc-400 hover:text-emerald-700"
                aria-label="Salin verify token"
                onClick={() => void copyText(waInfo.effectiveVerifyToken)}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-emerald-700/80">
            Isi kedua nilai di Meta App → WhatsApp → Configuration. Saat koneksi WhatsApp disimpan di sini, handshake
            webhook menerima verify token dari koneksi (tanpa perlu ubah env) dan signature divalidasi bila app secret
            diisi.
          </p>
        </div>
      ) : null}

      {/* Daftar koneksi */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-4">
          {configs.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Terpasang ({configs.length})
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {configs.map((c) => (
                  <ConfigCard
                    key={c.id}
                    config={c}
                    stats={data?.stats?.[c.channel]}
                    busy={busy}
                    onTest={() => void handleTest(c)}
                    onEdit={() => openEdit(c)}
                    onToggle={() => void handleToggle(c)}
                    onDelete={() => setDeleteTarget(c)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-8 text-center">
              <Plug className="mx-auto size-8 text-zinc-300" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-zinc-700">Belum ada kanal terhubung</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
                Klik <span className="font-medium text-zinc-700">Setup berpandu</span> di bawah — wizard akan menuntun Anda
                langkah demi langkah sesuai dokumentasi resmi (Meta/SMTP), lengkap dgn callback URL siap salin.
              </p>
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Kanal tersedia</p>
              <p className="text-[10px] text-zinc-400">Tanpa waktu untuk setup? Coba “Demo cepat” dulu.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Object.keys(CHANNEL_TYPES).map((k) => (
                <TypeCard
                  key={k}
                  channelKey={k}
                  onConnect={() => openConnect(k)}
                  onDemo={() => void handleDemoQuick(k)}
                  demoBusy={demoBusy === k}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Dialog connect/edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {(() => {
                const Icon = CHANNEL_ICONS[formChannel] ?? Plug;
                return <Icon className="size-4" style={{ color: meta?.color }} aria-hidden="true" />;
              })()}
              {editing ? `Edit ${meta?.label}` : `Hubungkan ${meta?.label}`}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Kredensial tersimpan ditampilkan termask — isi ulang hanya field yang ingin diganti."
                : meta?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="crm-scroll -mx-1 flex-1 space-y-3.5 overflow-y-auto px-1 py-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="ch-name" className="text-xs font-medium text-zinc-600">Nama koneksi</label>
                <Input id="ch-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={`mis. ${meta?.label} Unimasi`} />
              </div>
              <div className="space-y-1">
                <label htmlFor="ch-brand" className="text-xs font-medium text-zinc-600">Cakupan brand</label>
                <Select value={formBrand} onValueChange={setFormBrand}>
                  <SelectTrigger id="ch-brand" aria-label="Cakupan brand">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Global (semua brand)</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="ch-account" className="text-xs font-medium text-zinc-600">{meta?.accountRefLabel}</label>
              <Input
                id="ch-account"
                value={formAccount}
                onChange={(e) => setFormAccount(e.target.value)}
                placeholder={meta?.accountRefPlaceholder}
              />
            </div>

            <div className="space-y-2.5 rounded-xl border bg-zinc-50/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Kredensial</p>
              {(meta?.fields ?? []).map((f) => {
                const saved = editing?.credentials?.[f.key];
                return (
                  <div key={f.key} className="space-y-0.5">
                    <label htmlFor={`ch-${f.key}`} className="text-xs font-medium text-zinc-600">
                      {f.label}
                      {f.required ? <span className="text-red-500"> *</span> : null}
                    </label>
                    <Input
                      id={`ch-${f.key}`}
                      type={f.secret ? "password" : "text"}
                      value={formCreds[f.key] ?? ""}
                      onChange={(e) => setFormCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      autoComplete="off"
                    />
                    {saved && editing ? (
                      <p className="text-[10px] text-zinc-400">Tersimpan: <span className="font-mono">{saved}</span> — kosongkan agar tidak berubah</p>
                    ) : f.hint ? (
                      <p className="text-[10px] text-zinc-400">{f.hint}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {formError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">{formError}</p>
            ) : null}
          </div>

          <DialogFooter className="border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Batal</Button>
            <Button
              size="sm"
              className="text-white hover:opacity-90"
              style={{ backgroundColor: meta?.color ?? "#f97316" }}
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              {editing ? "Simpan" : "Hubungkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi hapus */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Putuskan &amp; hapus {deleteTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Kredensial akan dihapus dari sistem. Lead yang sudah masuk tetap tersimpan. Tindakan tercatat pada audit
              log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {busy?.startsWith("delete") ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Wizard setup berpandu (ronde 20) — connect selalu lewat sini */}
      <ChannelSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        channelKey={wizardChannel}
        callbackPath={waInfo?.path ?? "/api/webhooks/whatsapp"}
        verifyToken={waInfo?.effectiveVerifyToken ?? "grupcrm-demo-token"}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        actorName={user?.name}
        actorRole={user?.role}
        onConnected={load}
        onGoInbox={() => {
          setWizardOpen(false);
          setActiveModule("inbox");
        }}
      />
    </div>
  );
}
