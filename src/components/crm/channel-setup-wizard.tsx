"use client";

/**
 * Ronde 20 — Wizard setup kanal berpandu (Fase 3).
 * Mengubah setup manual menjadi alasan langkah-demi-langkah sesuai dokumentasi
 * resmi penyedia (Meta WhatsApp Cloud API / Instagram Messaging / SMTP):
 *  - intro (ringkasan + estimasi + Mode Demo 1-klik)
 *  - langkah panduan (checklist interaktif, nilai copyable, preset, form kredensial)
 *  - verifikasi (data koneksi + hubungkan & uji otomatis)
 *  - sukses (ringkasan + lanjutan: buka inbox)
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Instagram,
  Inbox,
  Loader2,
  Mail,
  Plug,
  PlugZap,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { channelsApi } from "@/lib/crm/api-client";
import { CHANNEL_TYPES, SETUP_GUIDES, type SetupCheckItem } from "@/lib/crm/channels";
import { cn } from "@/lib/utils";

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  whatsapp: Plug,
  instagram: Instagram,
  email: Mail,
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Disalin ke clipboard");
  } catch {
    toast.error("Gagal menyalin — salin manual dari teks");
  }
}

// ---------- Sub-komponen ----------

/** Item checklist interaktif (bisa dicentang saat mengikuti panduan). */
function GuideCheckItem({
  index,
  checked,
  onToggle,
  item,
}: {
  index: number;
  checked: boolean;
  onToggle: () => void;
  item: SetupCheckItem;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
        checked ? "bg-emerald-50/70" : "hover:bg-zinc-100/80"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 bg-white text-transparent"
        )}
        aria-hidden="true"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-600">
        <span className={cn(checked && "text-zinc-400 line-through")}>
          <span className="mr-1 font-mono text-[10px] font-semibold text-zinc-400">{index + 1}.</span>
          {item.text}
        </span>
        {item.link ? (
          <a
            href={item.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500"
            onClick={(e) => e.stopPropagation()}
          >
            {item.link.label}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </span>
    </button>
  );
}

/** Kotak nilai yang bisa disalin (callback URL / verify token). */
function CopyBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="truncate font-mono text-xs text-zinc-700" title={value}>
          {value}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-zinc-400 hover:text-zinc-700"
        aria-label={`Salin ${label}`}
        onClick={() => void copyText(value)}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------- Komponen utama ----------

export interface ChannelSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelKey: string | null;
  /** Nilai webhook live dari GET /api/channels (callback path + verify token efektif). */
  callbackPath: string;
  verifyToken: string;
  brands: Array<{ id: string; name: string }>;
  /** Koneksi yang sudah ada — dipakai utk mendeteksi konflik 409 & menawarkan jalur edit. */
  configs?: Array<import("@/lib/crm/types").ChannelConfigDTO>;
  /** Buka dialog edit utk koneksi yang sudah ada (dipanggil dari peringatan 409). */
  onEditExisting?: (config: import("@/lib/crm/types").ChannelConfigDTO) => void;
  actorName?: string;
  actorRole?: string;
  /** Dipanggil setelah koneksi berhasil (refresh daftar). */
  onConnected: () => Promise<void> | void;
  /** Dipanggil saat tombol "Buka Inbox" pada layar sukses. */
  onGoInbox: () => void;
}

export default function ChannelSetupWizard({
  open,
  onOpenChange,
  channelKey,
  callbackPath,
  verifyToken,
  brands,
  configs,
  onEditExisting,
  actorName,
  actorRole,
  onConnected,
  onGoInbox,
}: ChannelSetupWizardProps) {
  const [phase, setPhase] = useState<"intro" | number | "success">("intro");
  const [checks, setChecks] = useState<Record<string, boolean[]>>({});
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [brandId, setBrandId] = useState<string>("all");
  const [displayName, setDisplayName] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [skipVerify, setSkipVerify] = useState(false);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  // Konflik 409 — koneksi utk kanal+brand ini sudah ada; tawarkan jalur edit.
  const [conflictConfig, setConflictConfig] = useState<import("@/lib/crm/types").ChannelConfigDTO | null>(null);
  const [origin, setOrigin] = useState("");

  const meta = channelKey ? CHANNEL_TYPES[channelKey] : null;
  const guide = channelKey ? SETUP_GUIDES[channelKey] : null;

  // Reset seluruh state wizard setiap kali dibuka / ganti kanal.
  useEffect(() => {
    if (open && channelKey) {
      setPhase("intro");
      setChecks({});
      setCreds({});
      setBrandId("all");
      setDisplayName(CHANNEL_TYPES[channelKey]?.label ?? "");
      setAccountRef("");
      setError(null);
      setConnecting(false);
      setIsDemo(false);
      setSkipVerify(false);
      setVerifyNote(null);
      setConflictConfig(null);
      setOrigin(window.location.origin);
    }
  }, [open, channelKey]);

  const stepIndex = typeof phase === "number" ? phase : -1;
  const step = guide && stepIndex >= 0 ? guide.steps[stepIndex] : null;
  const totalSteps = guide?.steps.length ?? 0;
  const progress = phase === "success" ? 100 : phase === "intro" || stepIndex < 0 ? 0 : ((stepIndex + 1) / totalSteps) * 100;
  const channelColor = meta?.color ?? "#f97316";

  const callbackUrl = `${origin}${callbackPath}`;

  /** Kredensial yang diumpulkan lintas langkah (digabung untuk validasi akhir). */
  const collectedCreds = useMemo(() => creds, [creds]);

  function toggleCheck(stepId: string, idx: number) {
    setChecks((prev) => {
      const arr = [...(prev[stepId] ?? [])];
      arr[idx] = !arr[idx];
      return { ...prev, [stepId]: arr };
    });
  }

  function applyPreset(values: Record<string, string>) {
    setCreds((c) => ({ ...c, ...values }));
    toast.success("Preset diterapkan — lengkapi username & App Password");
  }

  /** Validasi field required milik langkah sebelum lanjut. */
  function validateStepFields(): string | null {
    if (!step?.fields || !meta) return null;
    const missing = step.fields
      .map((k) => meta.fields.find((f) => f.key === k))
      .filter((f) => f && f.required && !(collectedCreds[f.key] ?? "").trim())
      .map((f) => f!.label);
    return missing.length > 0 ? `Lengkapi dulu: ${missing.join(", ")}` : null;
  }

  function handleNext() {
    if (!guide) return;
    const err = validateStepFields();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setPhase(stepIndex < guide.steps.length - 1 ? stepIndex + 1 : guide.steps.length - 1);
  }

  async function handleConnect() {
    if (!channelKey || !meta) return;
    const missing = meta.fields
      .filter((f) => f.required && !(collectedCreds[f.key] ?? "").trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      setError(`Kredensial wajib belum lengkap: ${missing.join(", ")}`);
      return;
    }
    if (!displayName.trim()) {
      setError("Nama koneksi wajib diisi");
      return;
    }
    if (!accountRef.trim()) {
      setError(`${meta.accountRefLabel} wajib diisi`);
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const res = await channelsApi.connect({
        channel: channelKey,
        brandId: brandId === "all" ? null : brandId,
        displayName: displayName.trim(),
        accountRef: accountRef.trim(),
        credentials: collectedCreds,
        skipVerification: skipVerify,
        actorName,
        actorRole,
      });
      setIsDemo(skipVerify);
      setVerifyNote(res.config?.statusNote ?? null);
      setPhase("success");
      await onConnected();
      toast.success(`${meta.label} berhasil terhubung 🎉`);
    } catch (e) {
      // Verifikasi nyata gagal → pesan error asli ditampilkan inline agar bisa diperbaiki.
      const msg = e instanceof Error ? e.message : "Gagal menghubungkan kanal";
      // 409 — koneksi utk kanal+brand ini sudah ada (seed/demo atau sebelumnya):
      // jangan biarkan user buntu — tunjukkan koneksi yang dimaksud & tawarkan Edit.
      if (/sudah terhubung/i.test(msg)) {
        const match =
          configs?.find(
            (c) =>
              c.channel === channelKey &&
              (brandId === "all" ? c.brandId == null : c.brandId === brandId)
          ) ?? null;
        setConflictConfig(match);
        setError(
          match
            ? `${msg}. Koneksi yang ada: “${match.displayName}”${match.accountRef ? ` (${match.accountRef})` : ""} — gunakan tombol di bawah untuk mengedit kredensialnya.`
            : `${msg} — tutup wizard lalu gunakan tombol Edit pada koneksi yang ada.`
        );
      } else {
        setConflictConfig(null);
        setError(msg);
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleDemo() {
    if (!channelKey || !meta) return;
    setConnecting(true);
    setError(null);
    try {
      await channelsApi.demoConnect({ channel: channelKey, brandId: null, actorName, actorRole });
      setIsDemo(true);
      setPhase("success");
      await onConnected();
      toast.success(`${meta.label} terhubung (mode demo)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat koneksi demo");
    } finally {
      setConnecting(false);
    }
  }

  function handleClose(next: boolean) {
    if (!next) onOpenChange(false);
  }

  if (!channelKey || !meta || !guide) {
    return null;
  }

  const Icon = CHANNEL_ICONS[channelKey] ?? Plug;
  const brandName = brandId === "all" ? null : brands.find((b) => b.id === brandId)?.name ?? null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* Header: judul + stepper + progress */}
        <div className="shrink-0 border-b bg-zinc-50/80 px-5 pb-3 pt-4">
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span
                className="flex size-7 items-center justify-center rounded-lg text-white shadow-sm"
                style={{ backgroundColor: channelColor }}
                aria-hidden="true"
              >
                <Icon className="size-4" />
              </span>
              {meta.label}
            </DialogTitle>
            <DialogDescription className="sr-only">Wizard setup koneksi {meta.label}</DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          {phase !== "success" ? (
            <div className="mt-3">
              <div className="flex items-center gap-1.5">
                {guide.steps.map((s, i) => {
                  const done = stepIndex > i;
                  const active = stepIndex === i;
                  return (
                    <div key={s.id} className="flex min-w-0 items-center gap-1.5">
                      <div
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                          done
                            ? "bg-emerald-500 text-white"
                            : active
                              ? "text-white"
                              : "bg-zinc-200 text-zinc-500"
                        )}
                        style={active ? { backgroundColor: channelColor } : undefined}
                        aria-current={active ? "step" : undefined}
                        aria-label={`Langkah ${i + 1}: ${s.title}${done ? " (selesai)" : ""}`}
                      >
                        {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                      </div>
                      {i < guide.steps.length - 1 ? (
                        <div className={cn("h-0.5 w-4 shrink-0 rounded-full", done ? "bg-emerald-400" : "bg-zinc-200")} />
                      ) : null}
                    </div>
                  );
                })}
                {stepIndex >= 0 ? (
                  <span className="ml-1.5 truncate text-xs font-medium text-zinc-500" title={guide.steps[stepIndex]?.title}>
                    Langkah {stepIndex + 1}/{totalSteps} · {guide.steps[stepIndex]?.title}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progress}%`, backgroundColor: channelColor }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Body */}
        <div className="crm-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ---------- INTRO ---------- */}
          {phase === "intro" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
                  style={{ backgroundColor: channelColor }}
                  aria-hidden="true"
                >
                  <Icon className="size-5.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">Hubungkan {meta.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="gap-1 border-zinc-200 bg-white text-[10px] text-zinc-500">
                      <Clock className="size-3" aria-hidden="true" />±{guide.minutes} menit
                    </Badge>
                    <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] text-zinc-500">
                      {guide.steps.length} langkah
                    </Badge>
                    <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] text-zinc-500">
                      <BookOpen className="size-3" aria-hidden="true" />sesuai dokumentasi resmi
                    </Badge>
                  </div>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-zinc-600">{guide.intro}</p>

              {/* Pratinjau langkah */}
              <ol className="space-y-1.5">
                {guide.steps.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: channelColor }}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700">{s.title}</span>
                    {s.fields && s.fields.length > 0 ? (
                      <Badge variant="outline" className="shrink-0 border-zinc-200 bg-zinc-50 text-[10px] text-zinc-500">
                        {s.fields.length} isian
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ol>

              {/* Hint demo */}
              <div className="flex items-start gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3 py-2.5">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                <p className="text-[11px] leading-relaxed text-amber-800">{guide.demoHint}</p>
              </div>
            </div>
          ) : null}

          {/* ---------- STEP CONTENT ---------- */}
          {step ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-zinc-900">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{step.description}</p>
              </div>

              {/* Checklist interaktif */}
              {step.checklist && step.checklist.length > 0 ? (
                <div className="rounded-2xl border bg-white p-1.5 shadow-sm">
                  {step.checklist.map((item, i) => (
                    <GuideCheckItem
                      key={i}
                      index={i}
                      item={item}
                      checked={checks[step.id]?.[i] ?? false}
                      onToggle={() => toggleCheck(step.id, i)}
                    />
                  ))}
                  <p className="px-3 pb-1.5 pt-0.5 text-[10px] text-zinc-400">
                    {checks[step.id]?.filter(Boolean).length ?? 0}/{step.checklist.length} selesai — centang sambil mengikuti panduan
                  </p>
                </div>
              ) : null}

              {/* Nilai copyable */}
              {step.copyables && step.copyables.length > 0 ? (
                <div className="space-y-1.5">
                  {step.copyables.map((c) => (
                    <CopyBox key={c.kind} label={c.label} value={c.kind === "callbackUrl" ? callbackUrl : verifyToken} />
                  ))}
                </div>
              ) : null}

              {/* Preset cepat (email) */}
              {step.presets && step.presets.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {step.presets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyPreset(p.values)}
                      className="rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <p className="text-xs font-semibold text-zinc-800">{p.label}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-500">{p.description}</p>
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: channelColor }}>
                        <PlugZap className="size-3" aria-hidden="true" />Isi otomatis
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Form kredensial langkah ini */}
              {step.fields && step.fields.length > 0 ? (
                <div className="space-y-2.5 rounded-2xl border bg-zinc-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Isian langkah ini</p>
                  {step.fields.map((k) => {
                    const f = meta.fields.find((x) => x.key === k);
                    if (!f) return null;
                    const savedHint = f.hint;
                    return (
                      <div key={f.key} className="space-y-0.5">
                        <label htmlFor={`wiz-${f.key}`} className="text-xs font-medium text-zinc-600">
                          {f.label}
                          {f.required ? <span className="text-red-500"> *</span> : null}
                        </label>
                        <Input
                          id={`wiz-${f.key}`}
                          type={f.secret ? "password" : "text"}
                          value={creds[f.key] ?? ""}
                          onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          autoComplete="off"
                        />
                        {savedHint ? <p className="text-[10px] text-zinc-400">{savedHint}</p> : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Catatan */}
              {step.note ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                  <p className="text-[11px] leading-relaxed text-amber-800">{step.note}</p>
                </div>
              ) : null}

              {/* Tautan dokumentasi */}
              {step.docLink ? (
                <a
                  href={step.docLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50"
                >
                  <BookOpen className="size-3.5 shrink-0" style={{ color: channelColor }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{step.docLink.label}</span>
                  <ExternalLink className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : null}

          {/* ---------- VERIFIKASI (langkah terakhir selalu berisi data koneksi) ---------- */}
          {step && stepIndex === totalSteps - 1 ? (
            <div className="mt-4 space-y-2.5 rounded-2xl border-2 border-dashed p-3.5" style={{ borderColor: `${channelColor}55`, backgroundColor: `${channelColor}0a` }}>
              <p className="text-xs font-semibold" style={{ color: channelColor }}>
                Data koneksi — langkah terakhir
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="space-y-0.5">
                  <label htmlFor="wiz-name" className="text-xs font-medium text-zinc-600">Nama koneksi</label>
                  <Input id="wiz-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={`mis. ${meta.label} Unimasi`} />
                </div>
                <div className="space-y-0.5">
                  <label htmlFor="wiz-brand" className="text-xs font-medium text-zinc-600">Cakupan brand</label>
                  <Select value={brandId} onValueChange={setBrandId}>
                    <SelectTrigger id="wiz-brand" aria-label="Cakupan brand">
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
              <div className="space-y-0.5">
                <label htmlFor="wiz-account" className="text-xs font-medium text-zinc-600">{meta.accountRefLabel}</label>
                <Input
                  id="wiz-account"
                  value={accountRef}
                  onChange={(e) => setAccountRef(e.target.value)}
                  placeholder={meta.accountRefPlaceholder}
                />
              </div>
              {brandName ? (
                <p className="text-[10px] text-zinc-400">
                  Koneksi ini hanya aktif untuk lead brand <span className="font-medium text-zinc-600">{brandName}</span>.
                </p>
              ) : null}
              {/* Ronde 21: opsi sadar-demo — default TIDAK dicentang, verifikasi nyata diutamakan */}
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2" htmlFor="wiz-skip-verify">
                <input
                  id="wiz-skip-verify"
                  type="checkbox"
                  checked={skipVerify}
                  onChange={(e) => setSkipVerify(e.target.checked)}
                  className="mt-0.5 size-3.5 accent-amber-600"
                />
                <span className="text-[11px] leading-relaxed text-amber-800">
                  Sambungkan <span className="font-semibold">tanpa verifikasi nyata (mode demo)</span> — kredensial tidak diuji ke server.
                  Kanal akan bertanda Demo dan email tidak benar-benar terkirim.
                </span>
              </label>
              <p className="text-[10px] text-zinc-400">
                Default: sistem melakukan verifikasi NYATA ({channelKey === "email" ? "handshake + login SMTP/IMAP" : "cek ID & token ke API penyedia"}) — gagal berarti koneksi tidak dibuat.
              </p>
            </div>
          ) : null}

          {/* ---------- SUKSES ---------- */}
          {phase === "success" ? (
            <div className="flex flex-col items-center py-4 text-center">
              <span className="flex size-16 animate-in zoom-in-50 items-center justify-center rounded-full bg-emerald-100 duration-300">
                <CheckCircle2 className="size-9 text-emerald-600" aria-hidden="true" />
              </span>
              <p className="mt-3 text-base font-bold text-zinc-900">
                {meta.label} terhubung{isDemo ? " (demo)" : ""}!
              </p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
                {isDemo
                  ? "Koneksi aktif TANPA verifikasi nyata — kredensial belum diuji. Ganti kredensial asli kapan pun lewat Edit atau tekan “Uji”."
                  : `Kredensial diverifikasi langsung ke server. ${channelKey === "email" ? "Balasan dari Inbox akan terkirim nyata via SMTP, dan tombol “Tarik Email” menarik email masuk via IMAP." : "Pesan masuk akan diterima lewat webhook yang terdaftar."}`}
              </p>
              {verifyNote ? (
                <p className="mt-2 max-w-sm rounded-lg bg-zinc-100 px-3 py-1.5 text-[10px] leading-relaxed text-zinc-500" title={verifyNote}>
                  <span className="font-semibold">Hasil verifikasi:</span> {verifyNote}
                </p>
              ) : null}
              <div className="mt-4 w-full max-w-sm space-y-1.5 rounded-2xl border bg-white p-3 text-left shadow-sm">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-400">Koneksi</span>
                  <span className="truncate font-medium text-zinc-700">{meta.label}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-400">Cakupan</span>
                  <span className="truncate font-medium text-zinc-700">{isDemo ? "Global (demo)" : brandName ?? "Global (semua brand)"}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-400">Status</span>
                  <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-700">
                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    Terhubung
                  </Badge>
                </div>
              </div>
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="mt-3 space-y-2" role="alert">
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
              {conflictConfig && onEditExisting ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 w-full gap-1.5 border-zinc-300 text-xs text-zinc-700 hover:bg-zinc-50"
                  onClick={() => onEditExisting(conflictConfig)}
                >
                  <Settings2 className="size-3.5" aria-hidden="true" />
                  Edit koneksi yang ada: {conflictConfig.displayName}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-zinc-50/80 px-5 py-3">
          <div className="min-w-0">
            {phase !== "success" ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                onClick={() => void handleDemo()}
                disabled={connecting}
              >
                {connecting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
                Demo 1-klik
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onGoInbox}>
                <Inbox className="size-3.5" aria-hidden="true" />
                Buka Inbox
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {typeof phase === "number" ? (
              <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => (phase === 0 ? setPhase("intro") : setPhase(phase - 1))} disabled={connecting}>
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                Kembali
              </Button>
            ) : null}

            {phase === "intro" ? (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-white hover:opacity-90"
                style={{ backgroundColor: channelColor }}
                onClick={() => setPhase(0)}
              >
                Mulai setup
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}

            {typeof phase === "number" && stepIndex < totalSteps - 1 ? (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-white hover:opacity-90"
                style={{ backgroundColor: channelColor }}
                onClick={handleNext}
                disabled={connecting}
              >
                Lanjut
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}

            {typeof phase === "number" && stepIndex === totalSteps - 1 ? (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-white hover:opacity-90"
                style={{ backgroundColor: channelColor }}
                onClick={() => void handleConnect()}
                disabled={connecting}
              >
                {connecting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <PlugZap className="size-3.5" aria-hidden="true" />}
                Hubungkan &amp; Uji
              </Button>
            ) : null}

            {phase === "success" ? (
              <Button size="sm" className="h-8 bg-zinc-900 text-white hover:bg-zinc-800" onClick={() => onOpenChange(false)}>
                Selesai
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
