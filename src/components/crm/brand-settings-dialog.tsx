"use client";

/**
 * Ronde 29-b — Dialog Pengaturan Brand (Kelola per brand).
 *
 * 4 tab:
 *  1. Identitas     — logo asli (preview/upload) + tagline + alamat + kontak resmi
 *  2. Layanan       — kategori & layanan khas brand + workflow produksi custom
 *                     (fase → langkah) + RINCIAN BIAYA per layanan (template harga
 *                     marketing: butir biaya → total, margin target, saran harga)
 *  3. Surat         — kop/kaki surat (upload gambar) + gaya template surat
 *  4. Integrasi     — SEMUA tipe kanal (WhatsApp/IG/Threads/Email) + status koneksi
 *                     per kanal (Terhubung/Error/Terputus/Belum terhubung),
 *                     hubungkan demo 1-klik atau buka modul Kanal untuk setup nyata
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign, BadgeCheck, Building2, Check, ChevronDown, ChevronUp, FileText, Globe, Image as ImageIcon, Instagram,
  Layers, Link2, Loader2, Mail, MessageCircle, Pencil, Plus, RefreshCw, Save, Trash2, TriangleAlert, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, channelsApi } from "@/lib/crm/api-client";
import { CHANNEL_TYPES, CHANNEL_TYPE_KEYS } from "@/lib/crm/channels";
import type {
  Brand, BrandServiceCatalog, ChannelConfigDTO, ServiceCategoryDTO, ServiceCostItem, ServiceDTO,
} from "@/lib/crm/types";

// ============ Util ============

/** Baca file gambar kecil → data URL (dipakai logo & kop surat). */
function readImageFile(file: File, maxChars = 1_500_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("File harus berupa gambar (PNG/JPG/SVG/WebP)"));
      return;
    }
    if (file.size > 1_100_000) {
      reject(new Error("Ukuran gambar terlalu besar (maksimal ±1MB)"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      if (result.length > maxChars) {
        reject(new Error("Gambar terlalu besar setelah dibaca — pakai file lebih kecil"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

// ============ Util format ============

const IDR_FMT = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

/** Format uang rupiah tanpa desimal (mis. Rp28.000.000). */
function fmtIDR(value: number): string {
  return IDR_FMT.format(value);
}

/** Tanggal-waktu ringkas id-ID (mis. 02 Sep, 13.01) — "" bila tidak valid. */
function fmtWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export const CHANNEL_ICON: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  threads: AtSign,
  email: Mail,
};

/** Label kanal dari katalog tipe kanal (fallback: key). */
function channelLabel(key: string): string {
  return CHANNEL_TYPES[key]?.label ?? key;
}

const CHANNEL_COLOR: Record<string, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  threads: "#0a0a0a",
  email: "#6366f1",
};

interface IdentityDraft {
  tagline: string;
  address: string;
  city: string;
  phone: string;
  whatsappNumber: string;
  instagramHandle: string;
  threadsHandle: string;
  email: string;
  website: string;
  /** Ronde 40-C — mata uang bawaan brand utk peluang/quotation/brief baru. */
  primaryCurrency: string;
}

/** Ronde 40-C — opsi mata uang (sama dgn form brand di brands-module). */
const CURRENCIES = ["IDR", "USD", "SGD", "EUR", "AUD"] as const;

interface LetterTemplateDraft {
  fontFamily: string;
  accentColor: string;
  headerStyle: string;
  showLogo: boolean;
  footerNote: string;
}

const DEFAULT_LETTER: LetterTemplateDraft = {
  fontFamily: "Helvetica",
  accentColor: "#0f172a",
  headerStyle: "logo-left",
  showLogo: true,
  footerNote: "",
};

const LETTER_FONTS = [
  { key: "Helvetica", label: "Helvetica / Arial" },
  { key: "Times", label: "Times New Roman" },
  { key: "Georgia", label: "Georgia" },
  { key: "Calibri", label: "Calibri" },
];

const LETTER_HEADER_STYLES = [
  { key: "logo-left", label: "Logo kiri + alamat kanan" },
  { key: "logo-center", label: "Logo tengah" },
  { key: "letterhead-image", label: "Gambar kop surat penuh" },
];

// ============ Komponen utama ============

export default function BrandSettingsDialog({
  brand,
  open,
  onOpenChange,
  onSaved,
}: {
  brand: Brand | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (brand: Brand) => void;
}) {
  const [tab, setTab] = useState("identity");
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [savingLetter, setSavingLetter] = useState(false);

  // Identitas
  const [identity, setIdentity] = useState<IdentityDraft | null>(null);
  const [logoData, setLogoData] = useState<string | null>(null); // data URL baru / "" hapus
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  // Layanan & workflow
  const [catalog, setCatalog] = useState<BrandServiceCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Surat
  const [letter, setLetter] = useState<LetterTemplateDraft | null>(null);
  const [headerImg, setHeaderImg] = useState<string | null>(null);
  const [footerImg, setFooterImg] = useState<string | null>(null);
  const headerInputRef = useRef<HTMLInputElement | null>(null);
  const footerInputRef = useRef<HTMLInputElement | null>(null);

  // Integrasi
  const [channels, setChannels] = useState<ChannelConfigDTO[] | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);

  // Reset state saat brand berganti / dialog dibuka
  useEffect(() => {
    if (open && brand) {
      setTab("identity");
      setIdentity({
        tagline: brand.tagline ?? "",
        address: brand.address ?? "",
        city: brand.city ?? "",
        phone: brand.phone ?? "",
        whatsappNumber: brand.whatsappNumber ?? "",
        instagramHandle: brand.instagramHandle ?? "",
        threadsHandle: brand.threadsHandle ?? "",
        email: brand.email ?? "",
        website: brand.website ?? "",
        primaryCurrency: brand.primaryCurrency ?? "IDR",
      });
      setLogoData(null);
      let parsedLetter: LetterTemplateDraft = { ...DEFAULT_LETTER };
      if (brand.letterTemplate) {
        try {
          parsedLetter = { ...DEFAULT_LETTER, ...(JSON.parse(brand.letterTemplate) as Partial<LetterTemplateDraft>) };
        } catch { /* pakai default */ }
      }
      setLetter(parsedLetter);
      setHeaderImg(brand.letterheadHeader ?? "");
      setFooterImg(brand.letterheadFooter ?? "");
    }
  }, [open, brand]);

  // Muat katalog layanan saat tab layanan dibuka
  const loadCatalog = useCallback(async () => {
    if (!brand) return;
    setCatalogLoading(true);
    try {
      const res = await api.brandServices(brand.id);
      setCatalog(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat katalog layanan");
    } finally {
      setCatalogLoading(false);
    }
  }, [brand]);

  // Muat daftar kanal saat tab integrasi dibuka
  const loadChannels = useCallback(async () => {
    setChannels(null);
    try {
      const res = await channelsApi.list();
      setChannels(res.configs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat kanal");
    }
  }, []);

  useEffect(() => {
    if (open && brand) {
      if (tab === "services" && !catalog && !catalogLoading) void loadCatalog();
      if (tab === "letter" && !catalog && !catalogLoading) void loadCatalog();
      if (tab === "integrasi" && !channels) void loadChannels();
    }
  }, [open, brand, tab, catalog, catalogLoading, channels, loadCatalog, loadChannels]);

  if (!brand) return null;
  const activeBrand = brand; // snapshot utk closure (TS narrowing tidak menembus fungsi)

  const effectiveLogo = logoData !== null ? logoData : (brand.logoUrl ?? "");

  // ---------- Aksi: identitas ----------
  async function saveIdentity() {
    if (!identity) return;
    setSavingIdentity(true);
    try {
      const payload: Record<string, unknown> = { ...identity };
      if (logoData !== null) payload.logoUrl = logoData === "" ? null : logoData;
      const res = await api.updateBrand(activeBrand.id, payload);
      onSaved(res.brand);
      setLogoData(null);
      toast.success(`Identitas ${activeBrand.name} tersimpan`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan identitas");
    } finally {
      setSavingIdentity(false);
    }
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await readImageFile(file);
      setLogoData(dataUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat gambar");
    }
  }

  // ---------- Aksi: surat ----------
  async function pickLetterImage(side: "header" | "footer", file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await readImageFile(file);
      if (side === "header") setHeaderImg(dataUrl);
      else setFooterImg(dataUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat gambar");
    }
  }

  async function saveLetter() {
    if (!letter) return;
    setSavingLetter(true);
    try {
      const res = await api.updateBrand(activeBrand.id, {
        letterheadHeader: headerImg === "" ? null : headerImg || null,
        letterheadFooter: footerImg === "" ? null : footerImg || null,
        letterTemplate: letter,
      });
      onSaved(res.brand);
      toast.success(`Template surat ${activeBrand.name} tersimpan`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan template surat");
    } finally {
      setSavingLetter(false);
    }
  }

  // ---------- Aksi: katalog layanan ----------
  async function mutateCatalog(payload: Record<string, unknown>, method: "POST" | "PATCH" | "DELETE") {
    try {
      await api.brandServiceMutate(activeBrand.id, payload, method);
      await loadCatalog();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
      return false;
    }
  }

  async function addCategory(name: string): Promise<boolean> {
    if (!name.trim()) return false;
    setBusyKey("cat:new");
    const okDone = await mutateCatalog({ kind: "category", name: name.trim() }, "POST");
    setBusyKey(null);
    if (okDone) toast.success(`Kategori "${name.trim()}" ditambahkan`);
    return okDone;
  }

  async function addService(categoryId: string, name: string, unit: string, basePrice: string): Promise<boolean> {
    if (!name.trim()) return false;
    setBusyKey(`svc:${categoryId}`);
    const okDone = await mutateCatalog({
      kind: "service", categoryId, name: name.trim(),
      unit: unit.trim() || null,
      basePrice: basePrice.trim() === "" ? null : Number(basePrice.replace(/[^\d]/g, "")),
    }, "POST");
    setBusyKey(null);
    if (okDone) toast.success(`Layanan "${name.trim()}" ditambahkan`);
    return okDone;
  }

  async function addStage(serviceId: string, phase: string, name: string, isMilestone: boolean): Promise<boolean> {
    if (!name.trim()) return false;
    setBusyKey(`stg:${serviceId}`);
    const okDone = await mutateCatalog({
      kind: "stage", serviceId, phase: phase.trim() || "Production",
      name: name.trim(), isMilestone,
    }, "POST");
    setBusyKey(null);
    if (okDone) toast.success(`Langkah workflow ditambahkan`);
    return okDone;
  }

  // Ronde 39 — EDIT layanan (nama/unit/harga dasar) — API PATCH sudah mendukung sejak r29-b.
  async function editService(serviceId: string, name: string, unit: string, basePrice: string): Promise<boolean> {
    if (!name.trim()) return false;
    setBusyKey(`svc-edit:${serviceId}`);
    const okDone = await mutateCatalog({
      kind: "service", id: serviceId, name: name.trim(),
      unit: unit.trim() || null,
      basePrice: basePrice.trim() === "" ? null : Number(basePrice.replace(/[^\d]/g, "")),
    }, "PATCH");
    setBusyKey(null);
    if (okDone) toast.success("Layanan diperbarui");
    return okDone;
  }

  // Ronde 39 — EDIT langkah workflow (fase/nama).
  async function editStage(stageId: string, serviceId: string, phase: string, name: string): Promise<boolean> {
    if (!name.trim()) return false;
    setBusyKey(`stg:${serviceId}`);
    const okDone = await mutateCatalog({
      kind: "stage", id: stageId, phase: phase.trim() || "Production", name: name.trim(),
    }, "PATCH");
    setBusyKey(null);
    if (okDone) toast.success("Langkah workflow diperbarui");
    return okDone;
  }

  async function toggleMilestone(stage: { id: string; isMilestone: boolean; name: string }, serviceId: string): Promise<boolean> {
    setBusyKey(`stg:${serviceId}`);
    const okDone = await mutateCatalog({ kind: "stage", id: stage.id, isMilestone: !stage.isMilestone }, "PATCH");
    setBusyKey(null);
    return okDone;
  }

  async function removeCatalog(kind: "category" | "service" | "stage", id: string, label: string): Promise<boolean> {
    if (!window.confirm(`Hapus "${label}"? ${kind === "service" ? "Workflow di dalamnya ikut terhapus." : ""}`)) return false;
    setBusyKey(`del:${id}`);
    const okDone = await mutateCatalog({ kind, id }, "DELETE");
    setBusyKey(null);
    if (okDone) toast.success(`"${label}" dihapus`);
    return okDone;
  }

  // Ronde 29-b — simpan rincian biaya (template harga) satu layanan
  async function saveServiceCost(serviceId: string, items: ServiceCostItem[], marginPct: number | null): Promise<boolean> {
    try {
      await api.brandServiceMutate(
        activeBrand.id,
        { kind: "service", id: serviceId, costItems: items, targetMarginPct: marginPct },
        "PATCH"
      );
      await loadCatalog();
      toast.success("Rincian biaya layanan tersimpan");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan rincian biaya");
      return false;
    }
  }

  // ---------- Aksi: integrasi ----------
  /** Koneksi milik brand ini per tipe kanal (config pertama per channel). */
  const cfgByChannel = new Map<string, ChannelConfigDTO>();
  if (channels) {
    for (const c of channels) {
      if (c.brandId === activeBrand.id && !cfgByChannel.has(c.channel)) cfgByChannel.set(c.channel, c);
    }
  }

  const connectedCount = CHANNEL_TYPE_KEYS.filter((key) => cfgByChannel.get(key)?.status === "connected").length;
  const connectedPct = CHANNEL_TYPE_KEYS.length > 0 ? Math.round((connectedCount / CHANNEL_TYPE_KEYS.length) * 100) : 0;

  async function connectDemo(channel: string) {
    setConnectingKey(channel);
    try {
      await channelsApi.demoConnect({ channel, brandId: activeBrand.id });
      toast.success(`Kanal ${channelLabel(channel)} terhubung (demo) untuk ${activeBrand.name}`);
      await loadChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghubungkan kanal demo");
    } finally {
      setConnectingKey(null);
    }
  }

  async function reconnectChannel(id: string, label: string) {
    setReconnectingId(id);
    try {
      await channelsApi.update(id, { action: "reconnect" });
      toast.success(`Kanal ${label} disambungkan ulang`);
      await loadChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyambungkan ulang kanal");
    } finally {
      setReconnectingId(null);
    }
  }

  async function disconnectChannel(id: string, label: string) {
    if (!brand) return;
    if (!window.confirm(`Putuskan kanal "${label}" untuk ${brand.name}?`)) return;
    try {
      await channelsApi.remove(id);
      toast.success(`Kanal ${label} diputuskan`);
      await loadChannels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memutus kanal");
    }
  }

  // ============ Render ============

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col overflow-hidden gap-0 p-0 sm:w-[94%] sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b bg-zinc-50/80 px-5 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo brand={brand} size="sm" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">Pengaturan Brand — {brand.name}</DialogTitle>
              <DialogDescription className="truncate text-xs">
                Identitas asli, katalog layanan + workflow produksi, surat, dan integrasi kanal milik brand ini.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b px-3 pt-2.5">
            <TabsList className="h-9 w-full justify-start gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1">
              <TabsTrigger value="identity" className="gap-1.5 px-2.5 text-xs"><Building2 className="h-3.5 w-3.5" aria-hidden /> Identitas</TabsTrigger>
              <TabsTrigger value="services" className="gap-1.5 px-2.5 text-xs"><Layers className="h-3.5 w-3.5" aria-hidden /> Layanan & Workflow</TabsTrigger>
              <TabsTrigger value="letter" className="gap-1.5 px-2.5 text-xs"><FileText className="h-3.5 w-3.5" aria-hidden /> Surat</TabsTrigger>
              <TabsTrigger value="integrasi" className="gap-1.5 px-2.5 text-xs"><Link2 className="h-3.5 w-3.5" aria-hidden /> Integrasi</TabsTrigger>
            </TabsList>
          </div>

          {/* ===== TAB 1: IDENTITAS ===== */}
          <TabsContent value="identity" className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
            {/* Logo */}
            <div className="mb-5 flex items-center gap-4 rounded-xl border bg-zinc-50/60 p-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white">
                {effectiveLogo ? (
                  <img src={effectiveLogo} alt={`Logo ${brand.name}`} className="max-h-full max-w-full object-contain p-1.5" />
                ) : (
                  <span className="text-3xl font-bold" style={{ color: brand.color }} aria-hidden>{brand.name.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-semibold text-zinc-900">Logo brand</p>
                <p className="text-xs leading-relaxed text-zinc-500">
                  Logo asli dari situs resmi sudah terpasang. Unggah ulang bila ada pembaruan (PNG/SVG/WebP ≤1MB).
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden" onChange={(e) => { void pickLogo(e.target.files?.[0]); e.currentTarget.value = ""; }}
                  />
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => logoInputRef.current?.click()}>
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Unggah logo
                  </Button>
                  {logoData && logoData !== "" ? (
                    <Button type="button" size="sm" variant="ghost" className="h-8 text-rose-600 hover:text-rose-700" onClick={() => setLogoData("")}>
                      <X className="h-3.5 w-3.5" aria-hidden /> Batalkan unggahan
                    </Button>
                  ) : null}
                  {logoData === "" ? (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Logo akan dihapus saat disimpan</Badge>
                  ) : null}
                </div>
              </div>
            </div>

            {identity ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bs-tagline" className="text-xs">Tagline</Label>
                    <Input id="bs-tagline" className="h-9" value={identity.tagline}
                      onChange={(e) => setIdentity({ ...identity, tagline: e.target.value })}
                      placeholder="mis. Jagonya Buat Animasi" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bs-address" className="text-xs">Alamat lengkap</Label>
                    <Textarea id="bs-address" className="min-h-[64px] text-sm" value={identity.address}
                      onChange={(e) => setIdentity({ ...identity, address: e.target.value })}
                      placeholder="Jalan, nomor, kecamatan, kota, kode pos" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-city" className="text-xs">Kota operasional</Label>
                    <Input id="bs-city" className="h-9" value={identity.city}
                      onChange={(e) => setIdentity({ ...identity, city: e.target.value })}
                      placeholder="mis. Yogyakarta" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-phone" className="text-xs">Telepon utama</Label>
                    <Input id="bs-phone" className="h-9" value={identity.phone}
                      onChange={(e) => setIdentity({ ...identity, phone: e.target.value })}
                      placeholder="+628…" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-wa" className="text-xs flex items-center gap-1"><MessageCircle className="h-3 w-3 text-emerald-600" aria-hidden /> WhatsApp bisnis</Label>
                    <Input id="bs-wa" className="h-9" value={identity.whatsappNumber}
                      onChange={(e) => setIdentity({ ...identity, whatsappNumber: e.target.value })}
                      placeholder="+628…" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-ig" className="text-xs flex items-center gap-1"><Instagram className="h-3 w-3 text-pink-600" aria-hidden /> Instagram</Label>
                    <Input id="bs-ig" className="h-9" value={identity.instagramHandle}
                      onChange={(e) => setIdentity({ ...identity, instagramHandle: e.target.value })}
                      placeholder="@brand" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-threads" className="text-xs flex items-center gap-1"><AtSign className="h-3 w-3 text-zinc-700" aria-hidden /> Threads</Label>
                    <Input id="bs-threads" className="h-9" value={identity.threadsHandle}
                      onChange={(e) => setIdentity({ ...identity, threadsHandle: e.target.value })}
                      placeholder="@brand" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-email" className="text-xs flex items-center gap-1"><Mail className="h-3 w-3 text-zinc-500" aria-hidden /> Email bisnis</Label>
                    <Input id="bs-email" type="email" className="h-9" value={identity.email}
                      onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
                      placeholder="info@brand.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-web" className="text-xs flex items-center gap-1"><Globe className="h-3 w-3 text-zinc-400" aria-hidden /> Website</Label>
                    <Input id="bs-web" className="h-9" value={identity.website}
                      onChange={(e) => setIdentity({ ...identity, website: e.target.value })}
                      placeholder="https://…" />
                  </div>
                  {/* Ronde 40-C — mata uang bawaan brand */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bs-currency" className="text-xs">Mata Uang</Label>
                    <Select value={identity.primaryCurrency} onValueChange={(v) => setIdentity({ ...identity, primaryCurrency: v })}>
                      <SelectTrigger id="bs-currency" className="h-9 w-full sm:w-48" aria-label="Mata uang brand">
                        <SelectValue placeholder="Pilih mata uang" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      Dipakai sebagai mata uang bawaan untuk peluang, quotation, dan brief baru di brand ini.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end border-t pt-4">
                  <Button type="button" className="h-9" onClick={() => void saveIdentity()} disabled={savingIdentity}>
                    {savingIdentity ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                    Simpan identitas
                  </Button>
                </div>
              </div>
            ) : null}
          </TabsContent>

          {/* ===== TAB 2: LAYANAN & WORKFLOW ===== */}
          <TabsContent value="services" className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
            {catalogLoading && !catalog ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Memuat katalog…
              </div>
            ) : catalog ? (
              <CatalogEditor
                catalog={catalog}
                busyKey={busyKey}
                onAddCategory={addCategory}
                onAddService={addService}
                onAddStage={addStage}
                onToggleMilestone={toggleMilestone}
                onRemove={removeCatalog}
                onSaveCost={saveServiceCost}
                onEditService={editService}
                onEditStage={editStage}
              />
            ) : (
              <p className="text-sm text-zinc-500">Katalog belum termuat.</p>
            )}
          </TabsContent>

          {/* ===== TAB 3: SURAT ===== */}
          <TabsContent value="letter" className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
            {letter ? (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Kop surat */}
                  <div className="space-y-2 rounded-xl border p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
                      <ImageIcon className="h-4 w-4 text-zinc-400" aria-hidden /> Kop surat (header)
                    </p>
                    <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border bg-zinc-50">
                      {headerImg ? (
                        <img src={headerImg} alt={`Kop surat ${brand.name}`} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <p className="px-3 text-center text-xs text-zinc-400">Belum ada gambar kop — dipakai logo + alamat brand</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={headerInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                        className="hidden" onChange={(e) => { void pickLetterImage("header", e.target.files?.[0]); e.currentTarget.value = ""; }}
                      />
                      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => headerInputRef.current?.click()}>
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Unggah
                      </Button>
                      {headerImg ? (
                        <Button type="button" size="sm" variant="ghost" className="h-8 text-rose-600 hover:text-rose-700" onClick={() => setHeaderImg("")}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Hapus
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {/* Kaki surat */}
                  <div className="space-y-2 rounded-xl border p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
                      <ImageIcon className="h-4 w-4 text-zinc-400" aria-hidden /> Kaki surat (footer)
                    </p>
                    <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border bg-zinc-50">
                      {footerImg ? (
                        <img src={footerImg} alt={`Kaki surat ${brand.name}`} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <p className="px-3 text-center text-xs text-zinc-400">Belum ada gambar footer</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={footerInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                        className="hidden" onChange={(e) => { void pickLetterImage("footer", e.target.files?.[0]); e.currentTarget.value = ""; }}
                      />
                      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => footerInputRef.current?.click()}>
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Unggah
                      </Button>
                      {footerImg ? (
                        <Button type="button" size="sm" variant="ghost" className="h-8 text-rose-600 hover:text-rose-700" onClick={() => setFooterImg("")}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Hapus
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Gaya template */}
                <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                  <p className="text-sm font-semibold text-zinc-900 sm:col-span-2">Gaya template surat</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Font surat</Label>
                    <Select value={letter.fontFamily} onValueChange={(v) => setLetter({ ...letter, fontFamily: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LETTER_FONTS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tata letak kop</Label>
                    <Select value={letter.headerStyle} onValueChange={(v) => setLetter({ ...letter, headerStyle: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LETTER_HEADER_STYLES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bs-accent" className="text-xs">Warna aksen surat</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="bs-accent" type="color" value={letter.accentColor}
                        onChange={(e) => setLetter({ ...letter, accentColor: e.target.value })}
                        className="h-9 w-12 cursor-pointer rounded-md border border-zinc-200 bg-white p-1"
                      />
                      <span className="font-mono text-xs text-zinc-500">{letter.accentColor}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-zinc-50/60 px-3 py-2">
                    <Label htmlFor="bs-showlogo" className="text-xs">Tampilkan logo di surat</Label>
                    <Switch id="bs-showlogo" checked={letter.showLogo} onCheckedChange={(v) => setLetter({ ...letter, showLogo: v })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bs-footnote" className="text-xs">Catatan footer surat</Label>
                    <Input id="bs-footnote" className="h-9" value={letter.footerNote}
                      onChange={(e) => setLetter({ ...letter, footerNote: e.target.value })}
                      placeholder="mis. Alamat kantor · Telp · Email · Website" />
                  </div>
                </div>

                {/* Pratinjau mini */}
                <div className="overflow-hidden rounded-xl border">
                  <div className="border-b-2 px-4 py-3" style={{ borderColor: letter.accentColor }}>
                    {headerImg && letter.headerStyle === "letterhead-image" ? (
                      <img src={headerImg} alt="" className="h-10 object-contain" />
                    ) : (
                      <div className={`flex items-center gap-3 ${letter.headerStyle === "logo-center" ? "justify-center text-center" : ""}`}>
                        {letter.showLogo && effectiveLogo ? (
                           
                          <img src={effectiveLogo} alt="" className="h-8 object-contain" />
                        ) : null}
                        <div>
                          <p className="text-sm font-bold" style={{ color: letter.accentColor }}>{brand.name}</p>
                          <p className="text-[10px] text-zinc-500">{identity?.address || brand.address || brand.city || ""}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5 px-4 py-3" style={{ fontFamily: letter.fontFamily }}>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-400">Pratinjau</p>
                    <div className="h-2 w-3/4 rounded bg-zinc-100" />
                    <div className="h-2 w-full rounded bg-zinc-100" />
                    <div className="h-2 w-5/6 rounded bg-zinc-100" />
                  </div>
                  <div className="border-t px-4 py-2.5 text-center text-[10px] text-zinc-500" style={{ backgroundColor: `${letter.accentColor}0d` }}>
                    {letter.footerNote || `${brand.name} · ${brand.email || ""} · ${brand.phone || ""}`}
                  </div>
                </div>

                <div className="flex justify-end border-t pt-4">
                  <Button type="button" className="h-9" onClick={() => void saveLetter()} disabled={savingLetter}>
                    {savingLetter ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                    Simpan template surat
                  </Button>
                </div>
              </div>
            ) : null}
          </TabsContent>

          {/* ===== TAB 4: INTEGRASI ===== */}
          <TabsContent value="integrasi" className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs leading-relaxed text-emerald-900">
              <p className="font-semibold">Integrasi milik {brand.name} sendiri</p>
              <p className="mt-0.5 text-emerald-800">
                Pesan yang masuk lewat kanal brand ini otomatis menjadi lead di Inbox dan dapat dibalas atas nama {brand.name}.
                Akun resmi brand: {brand.whatsappNumber ?? "-"} · {brand.instagramHandle ?? "-"} · {brand.email ?? "-"}.
              </p>
            </div>

            {!channels ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Memuat kanal…
              </div>
            ) : (
              <div className="space-y-3">
                {/* Ringkasan koneksi */}
                <div className="rounded-xl border bg-white p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-semibold text-zinc-900">
                      {connectedCount} dari {CHANNEL_TYPE_KEYS.length} kanal terhubung
                    </p>
                    {connectedCount === CHANNEL_TYPE_KEYS.length ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        <BadgeCheck className="h-3 w-3" aria-hidden /> Semua kanal utama terhubung
                      </Badge>
                    ) : null}
                  </div>
                  <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
                    role="progressbar"
                    aria-label="Kanal terhubung"
                    aria-valuemin={0}
                    aria-valuemax={CHANNEL_TYPE_KEYS.length}
                    aria-valuenow={connectedCount}
                  >
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${connectedPct}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Mode demo memakai akun asli brand dgn kredensial buatan — untuk produksi, gunakan Setup berpandu di modul Kanal.
                  </p>
                </div>

                {/* Semua tipe kanal + status koneksi */}
                {CHANNEL_TYPE_KEYS.map((key) => {
                  const meta = CHANNEL_TYPES[key];
                  const Icon = CHANNEL_ICON[key] ?? Link2;
                  const color = CHANNEL_COLOR[key] ?? "#52525b";
                  const label = channelLabel(key);
                  const cfg = cfgByChannel.get(key);
                  return (
                    <div key={key} className="rounded-xl border bg-white p-3.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}1a` }} aria-hidden>
                          <Icon className="h-4.5 w-4.5" style={{ color }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-900">
                            <span className="truncate">{label}</span>
                            {cfg?.isDemo ? <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-700">Demo</Badge> : null}
                          </p>
                          <p className="truncate font-mono text-xs text-zinc-500">
                            {cfg?.accountRef ?? (meta?.accountRefPlaceholder ? `mis. ${meta.accountRefPlaceholder}` : "—")}
                          </p>
                          {cfg?.status === "error" && cfg.statusNote ? (
                            <p className="truncate text-[11px] text-amber-700">{cfg.statusNote}</p>
                          ) : null}
                          {cfg ? (
                            <p className="truncate text-[11px] text-zinc-400">
                              {cfg.lastTestedAt ? `Diuji ${fmtWhen(cfg.lastTestedAt)}` : cfg.connectedAt ? `Terhubung sejak ${fmtWhen(cfg.connectedAt)}` : "—"}
                            </p>
                          ) : null}
                        </div>
                        {cfg ? (
                          cfg.status === "connected" ? (
                            <Badge variant="outline" className="shrink-0 border-transparent bg-emerald-50 text-emerald-700">
                              <BadgeCheck className="h-3 w-3" aria-hidden /> Terhubung
                            </Badge>
                          ) : cfg.status === "error" ? (
                            <Badge variant="outline" className="shrink-0 border-transparent bg-amber-50 text-amber-700">
                              <TriangleAlert className="h-3 w-3" aria-hidden /> Error
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 border-transparent bg-zinc-100 text-zinc-600">Terputus</Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="shrink-0 border-zinc-200 bg-zinc-50 text-zinc-500">Belum terhubung</Badge>
                        )}
                        <div className="flex shrink-0 items-center gap-2">
                          {cfg ? (
                            <>
                              {cfg.status !== "connected" ? (
                                <Button
                                  type="button" size="sm" variant="outline" className="h-9 gap-1.5"
                                  disabled={reconnectingId !== null || connectingKey !== null}
                                  onClick={() => void reconnectChannel(cfg.id, label)}
                                >
                                  {reconnectingId === cfg.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                                  Sambungkan ulang
                                </Button>
                              ) : null}
                              <Button
                                type="button" size="sm" variant="ghost" className="h-9 text-zinc-500 hover:text-rose-600"
                                onClick={() => void disconnectChannel(cfg.id, cfg.displayName)}
                              >
                                Putuskan
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button" size="sm" variant="outline" className="h-9 gap-1.5"
                              disabled={connectingKey !== null || reconnectingId !== null}
                              onClick={() => void connectDemo(key)}
                            >
                              {connectingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden />}
                              Hubungkan (Demo)
                            </Button>
                          )}
                        </div>
                      </div>
                      {!cfg ? (
                        <p className="mt-2 border-t pt-2 text-[11px] text-zinc-400">Setup kredensial nyata via modul Kanal.</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ============ BrandLogo (dipakai lintas modul) ============
export function BrandLogo({ brand, size = "md" }: { brand: Pick<Brand, "name" | "logoUrl" | "color">; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-8 w-8 text-sm" : size === "lg" ? "h-14 w-14 text-2xl" : "h-10 w-10 text-lg";
  return (
    <span className={`flex ${dim} shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white`} aria-hidden>
      {brand.logoUrl ? (
         
        <img src={brand.logoUrl} alt="" className="max-h-full max-w-full object-contain p-1" />
      ) : (
        <span className="font-bold" style={{ color: brand.color }}>{brand.name.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

// ============ Editor katalog layanan & workflow ============

function CatalogEditor({
  catalog, busyKey, onAddCategory, onAddService, onAddStage, onToggleMilestone, onRemove, onSaveCost,
  onEditService, onEditStage,
}: {
  catalog: BrandServiceCatalog;
  busyKey: string | null;
  onAddCategory: (name: string) => Promise<boolean>;
  onAddService: (categoryId: string, name: string, unit: string, basePrice: string) => Promise<boolean>;
  onAddStage: (serviceId: string, phase: string, name: string, isMilestone: boolean) => Promise<boolean>;
  onToggleMilestone: (stage: { id: string; isMilestone: boolean; name: string }, serviceId: string) => Promise<boolean>;
  onRemove: (kind: "category" | "service" | "stage", id: string, label: string) => Promise<boolean>;
  onSaveCost: (serviceId: string, items: ServiceCostItem[], marginPct: number | null) => Promise<boolean>;
  onEditService: (serviceId: string, name: string, unit: string, basePrice: string) => Promise<boolean>;
  onEditStage: (stageId: string, serviceId: string, phase: string, name: string) => Promise<boolean>;
}) {
  const [openCat, setOpenCat] = useState<Record<string, boolean>>({});
  // Ronde 42 — workflow langkah kini SELALU tampil (keluhan: sebelumnya hanya rincian biaya
  // yang terlihat untuk template quotation) — state collapse per layanan dihapus.
  const [newCatName, setNewCatName] = useState("");
  const [catForms, setCatForms] = useState<Record<string, { name: string; unit: string; price: string }>>({});
  const [stageForms, setStageForms] = useState<Record<string, { phase: string; name: string; milestone: boolean }>>({});
  // Ronde 39 — state edit inline layanan & langkah workflow
  const [svcEdit, setSvcEdit] = useState<Record<string, { name: string; unit: string; price: string }>>({});
  const [stgEdit, setStgEdit] = useState<Record<string, { phase: string; name: string }>>({});

  const servicesByCat = useMemo(() => {
    const map = new Map<string | null, ServiceDTO[]>();
    for (const s of catalog.services) {
      const key = s.categoryId ?? null;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [catalog.services]);

  const uncategorized = servicesByCat.get(null) ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-zinc-500">
        Kategori & layanan khas brand ini. Tiap layanan punya <span className="font-medium text-zinc-700">workflow produksi</span> sendiri
        (fase → langkah, sebagian ditandai <span className="font-medium text-zinc-700">milestone</span> yang menjadi tahapan project).
      </p>

      {catalog.categories.map((cat: ServiceCategoryDTO) => {
        const svcs = servicesByCat.get(cat.id) ?? [];
        const open = openCat[cat.id] ?? true;
        return (
          <div key={cat.id} className="overflow-hidden rounded-xl border">
            <div className="flex items-center gap-2 bg-zinc-50/80 px-4 py-3">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpenCat((m) => ({ ...m, [cat.id]: !open }))}>
                <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
                <span className="truncate text-sm font-bold text-zinc-900">{cat.name}</span>
                <Badge variant="outline" className="border-transparent bg-zinc-200/70 px-1.5 text-[10px] text-zinc-600">{svcs.length} layanan</Badge>
                {cat.description ? <span className="hidden truncate text-xs text-zinc-500 sm:inline">— {cat.description}</span> : null}
              </button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-rose-600"
                aria-label={`Hapus kategori ${cat.name}`} onClick={() => void onRemove("category", cat.id, cat.name)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            {open ? (
              <div className="divide-y">
                {svcs.map((svc) => {
                  const form = stageForms[svc.id] ?? { phase: "", name: "", milestone: false };
                  return (
                    <div key={svc.id} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {svcEdit[svc.id] ? (
                          /* Ronde 39 — mode edit layanan: nama/unit/harga dasar inline */
                          <div className="min-w-0 flex-1 space-y-2 rounded-lg border border-zinc-300 bg-white p-2.5">
                            <div className="grid gap-2 sm:grid-cols-[1fr_120px_150px]">
                              <div className="space-y-1">
                                <Label className="text-[11px]">Nama layanan</Label>
                                <Input className="h-8 text-xs" value={svcEdit[svc.id].name}
                                  onChange={(e) => setSvcEdit((m) => ({ ...m, [svc.id]: { ...svcEdit[svc.id], name: e.target.value } }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px]">Satuan</Label>
                                <Input className="h-8 text-xs" value={svcEdit[svc.id].unit} placeholder="mis. video"
                                  onChange={(e) => setSvcEdit((m) => ({ ...m, [svc.id]: { ...svcEdit[svc.id], unit: e.target.value } }))} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px]">Harga dasar (Rp)</Label>
                                <Input className="h-8 text-xs" inputMode="numeric" value={svcEdit[svc.id].price} placeholder="mis. 25000000"
                                  onChange={(e) => setSvcEdit((m) => ({ ...m, [svc.id]: { ...svcEdit[svc.id], price: e.target.value } }))} />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                                onClick={() => setSvcEdit((m) => { const { [svc.id]: _drop, ...rest } = m; return rest; })}>
                                Batal
                              </Button>
                              <Button type="button" size="sm" className="h-7 text-xs"
                                disabled={busyKey === `svc-edit:${svc.id}` || !svcEdit[svc.id].name.trim()}
                                onClick={() => void onEditService(svc.id, svcEdit[svc.id].name, svcEdit[svc.id].unit, svcEdit[svc.id].price)
                                  .then((res) => { if (res) setSvcEdit((m) => { const { [svc.id]: _drop, ...rest } = m; return rest; }); return res; })}>
                                {busyKey === `svc-edit:${svc.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                                Simpan
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-zinc-900">{svc.name}</p>
                              <p className="text-xs text-zinc-500">
                                {[svc.unit, svc.basePrice != null ? fmtIDR(svc.basePrice) : null, `${svc.workflow.length} langkah workflow`].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                          </div>
                        )}
                        {svcEdit[svc.id] ? null : (
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-zinc-400 hover:text-zinc-900"
                            aria-label={`Edit layanan ${svc.name}`}
                            onClick={() => setSvcEdit((m) => ({ ...m, [svc.id]: {
                              name: svc.name, unit: svc.unit ?? "", price: svc.basePrice != null ? String(svc.basePrice) : "",
                            } }))}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-zinc-400 hover:text-rose-600"
                          aria-label={`Hapus layanan ${svc.name}`} onClick={() => void onRemove("service", svc.id, svc.name)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>

                      {/* Rincian biaya (template harga) — Ronde 29-b */}
                      <ServiceCostEditor service={svc} onSave={onSaveCost} />

                      {/* Workflow produksi — Ronde 42: selalu tampil (sebelumnya tersembunyi
                          di balik collapse, sehingga yang tampak hanya rincian biaya) */}
                      <div className="mt-3 space-y-2.5 pl-6">
                          {svc.workflow.length > 0 ? (
                            <ol className="space-y-1.5">
                              {svc.workflow.map((w, idx) => (
                                <li key={w.id} className="rounded-lg border bg-zinc-50/60 px-3 py-2">
                                  {stgEdit[w.id] ? (
                                    /* Ronde 39 — mode edit langkah: fase + nama inline */
                                    <div className="space-y-2">
                                      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                                        <div className="space-y-1">
                                          <Label className="text-[11px]">Fase</Label>
                                          <Input className="h-8 text-xs" value={stgEdit[w.id].phase} placeholder="mis. Production"
                                            onChange={(e) => setStgEdit((m) => ({ ...m, [w.id]: { ...stgEdit[w.id], phase: e.target.value } }))} />
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-[11px]">Nama langkah</Label>
                                          <Input className="h-8 text-xs" value={stgEdit[w.id].name}
                                            onChange={(e) => setStgEdit((m) => ({ ...m, [w.id]: { ...stgEdit[w.id], name: e.target.value } }))} />
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2">
                                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                                          onClick={() => setStgEdit((m) => { const { [w.id]: _drop, ...rest } = m; return rest; })}>
                                          Batal
                                        </Button>
                                        <Button type="button" size="sm" className="h-7 text-xs"
                                          disabled={busyKey === `stg:${svc.id}` || !stgEdit[w.id].name.trim()}
                                          onClick={() => void onEditStage(w.id, svc.id, stgEdit[w.id].phase, stgEdit[w.id].name)
                                            .then((res) => { if (res) setStgEdit((m) => { const { [w.id]: _drop, ...rest } = m; return rest; }); return res; })}>
                                          {busyKey === `stg:${svc.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                                          Simpan
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white" aria-hidden>{idx + 1}</span>
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium text-zinc-800">
                                          {w.name}
                                          {w.isMilestone ? (
                                            <Badge variant="outline" className="ml-1.5 border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-700">Milestone</Badge>
                                          ) : null}
                                        </p>
                                        <p className="truncate text-[11px] text-zinc-500">{w.phase}</p>
                                      </div>
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-zinc-400 hover:text-zinc-900"
                                        aria-label={`Edit langkah ${w.name}`}
                                        onClick={() => setStgEdit((m) => ({ ...m, [w.id]: { phase: w.phase, name: w.name } }))}>
                                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                                      </Button>
                                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]"
                                        disabled={busyKey === `stg:${svc.id}`}
                                        onClick={() => void onToggleMilestone(w, svc.id)}>
                                        {w.isMilestone ? "Lepas" : "Jadikan milestone"}
                                      </Button>
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-rose-600"
                                        aria-label={`Hapus langkah ${w.name}`} onClick={() => void onRemove("stage", w.id, `${w.phase} · ${w.name}`)}>
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                      </Button>
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="text-xs italic text-zinc-400">Belum ada workflow — tambahkan fase produksi di bawah.</p>
                          )}

                          {/* Form tambah langkah */}
                          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2.5">
                            <div className="w-32 space-y-1">
                              <Label className="text-[11px]">Fase</Label>
                              <Input className="h-8 text-xs" value={form.phase} placeholder="mis. Production"
                                onChange={(e) => setStageForms((m) => ({ ...m, [svc.id]: { ...form, phase: e.target.value } }))} />
                            </div>
                            <div className="min-w-[160px] flex-1 space-y-1">
                              <Label className="text-[11px]">Langkah</Label>
                              <Input className="h-8 text-xs" value={form.name} placeholder="mis. Creative Concept & Story Board"
                                onChange={(e) => setStageForms((m) => ({ ...m, [svc.id]: { ...form, name: e.target.value } }))} />
                            </div>
                            <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-600">
                              <input type="checkbox" className="accent-zinc-900" checked={form.milestone}
                                onChange={(e) => setStageForms((m) => ({ ...m, [svc.id]: { ...form, milestone: e.target.checked } }))} />
                              Milestone
                            </label>
                            <Button type="button" size="sm" variant="outline" className="h-8"
                              disabled={busyKey === `stg:${svc.id}` || !form.name.trim()}
                              onClick={() => void onAddStage(svc.id, form.phase, form.name, form.milestone)
                                .then(() => setStageForms((m) => ({ ...m, [svc.id]: { phase: "", name: "", milestone: false } })))}>
                              <Plus className="h-3.5 w-3.5" aria-hidden /> Langkah
                            </Button>
                          </div>
                      </div>
                    </div>
                  );
                })}

                {/* Form tambah layanan */}
                <ServiceAddForm
                  busy={busyKey === `svc:${cat.id}`}
                  form={catForms[cat.id] ?? { name: "", unit: "", price: "" }}
                  onChange={(form) => setCatForms((m) => ({ ...m, [cat.id]: form }))}
                  onSubmit={(f) =>
                    onAddService(cat.id, f.name, f.unit, f.price)
                      .then((res) => {
                        if (res) setCatForms((m) => ({ ...m, [cat.id]: { name: "", unit: "", price: "" } }));
                        return res;
                      })
                  }
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Tanpa kategori */}
      {uncategorized.length > 0 ? (
        <div className="rounded-xl border border-dashed p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Tanpa kategori</p>
          <div className="flex flex-wrap gap-1.5">
            {uncategorized.map((s) => (
              <span key={s.id} className="group inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
                {s.name}
                <button type="button" className="text-zinc-300 hover:text-rose-600" aria-label={`Hapus ${s.name}`} onClick={() => void onRemove("service", s.id, s.name)}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Form kategori baru */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3.5">
        <div className="min-w-[180px] flex-1 space-y-1">
          <Label className="text-xs">Kategori layanan baru</Label>
          <Input className="h-9" value={newCatName} placeholder="mis. Animasi 3D"
            onChange={(e) => setNewCatName(e.target.value)} />
        </div>
        <Button type="button" size="sm" className="h-9" disabled={busyKey === "cat:new" || !newCatName.trim()}
          onClick={() => void onAddCategory(newCatName).then((res) => { if (res) setNewCatName(""); return res; })}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah kategori
        </Button>
      </div>
    </div>
  );
}

function ServiceAddForm({
  busy, form, onChange, onSubmit,
}: {
  busy: boolean;
  form: { name: string; unit: string; price: string };
  onChange: (form: { name: string; unit: string; price: string }) => void;
  onSubmit: (form: { name: string; unit: string; price: string }) => Promise<boolean>;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 bg-zinc-50/60 px-4 py-3">
      <div className="min-w-[160px] flex-1 space-y-1">
        <Label className="text-[11px]">Layanan baru</Label>
        <Input className="h-8 text-xs" value={form.name} placeholder="mis. Pembuatan Video Pembelajaran 3D"
          onChange={(e) => onChange({ ...form, name: e.target.value })} />
      </div>
      <div className="w-24 space-y-1">
        <Label className="text-[11px]">Satuan</Label>
        <Input className="h-8 text-xs" value={form.unit} placeholder="video"
          onChange={(e) => onChange({ ...form, unit: e.target.value })} />
      </div>
      <div className="w-32 space-y-1">
        <Label className="text-[11px]">Harga acuan</Label>
        <Input className="h-8 text-xs" value={form.price} placeholder="35000000" inputMode="numeric"
          onChange={(e) => onChange({ ...form, price: e.target.value })} />
      </div>
      <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy || !form.name.trim()} onClick={() => void onSubmit(form)}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah
      </Button>
    </div>
  );
}

// ============ Rincian biaya per layanan (template harga marketing) — Ronde 29-b ============

interface CostDraftItem {
  name: string;
  /** String agar input bebas mengetik angka (separator diabaikan saat parse). */
  amount: string;
  note?: string | null;
}

function costDraftFromService(svc: ServiceDTO): CostDraftItem[] {
  return (svc.costItems ?? []).map((it) => ({ name: it.name, amount: String(it.amount ?? 0), note: it.note ?? null }));
}

/** Parse nominal "28.000.000" / "28000000" → number (≥0); kosong/non-angka → 0. */
function parseAmount(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  return digits === "" ? 0 : Number(digits);
}

/** Saran harga = total biaya × (1 + margin%) dibulatkan ke 100 ribu terdekat. */
function suggestedPriceOf(total: number, marginPct: number): number {
  return Math.round((total * (1 + marginPct / 100)) / 100_000) * 100_000;
}

/**
 * Blok "Rincian Biaya" per layanan — expand/collapse dgn state LOKAL
 * (mengetik di sini tidak me-render ulang seluruh dialog).
 */
function ServiceCostEditor({
  service,
  onSave,
}: {
  service: ServiceDTO;
  onSave: (serviceId: string, items: ServiceCostItem[], marginPct: number | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CostDraftItem[]>(() => costDraftFromService(service));
  const [margin, setMargin] = useState<string>(() => (service.targetMarginPct != null ? String(service.targetMarginPct) : "30"));
  const [saving, setSaving] = useState(false);

  // Sinkronkan draf saat data server berubah (setelah simpan / katalog dimuat ulang)
  useEffect(() => {
    setItems(costDraftFromService(service));
    setMargin(service.targetMarginPct != null ? String(service.targetMarginPct) : "30");
  }, [service]);

  const hasItems = (service.costItems ?? []).length > 0;
  const serverTotal = service.costTotal ?? (service.costItems ?? []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  const serverSaran = service.suggestedPrice ?? suggestedPriceOf(serverTotal, service.targetMarginPct ?? 30);

  const parsed = useMemo(
    () => items.map((it) => ({ name: it.name.trim(), amount: parseAmount(it.amount), note: it.note ?? null })),
    [items]
  );
  const invalid = parsed.some((it) => it.name === "" || !Number.isFinite(it.amount) || it.amount < 0);
  const total = parsed.reduce((sum, it) => sum + it.amount, 0);
  const marginNum = margin.trim() === "" ? 30 : Number(margin.replace(",", "."));
  const marginPct = Number.isFinite(marginNum) ? Math.min(95, Math.max(0, marginNum)) : 30;
  const saran = suggestedPriceOf(total, marginPct);
  const basePrice = service.basePrice ?? null;

  function addItem() {
    setItems((m) => [...m, { name: "", amount: "", note: null }]);
  }

  function resetDraft() {
    setItems(costDraftFromService(service));
    setMargin(service.targetMarginPct != null ? String(service.targetMarginPct) : "30");
  }

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const payload: ServiceCostItem[] = parsed.map((it) => ({ name: it.name, amount: it.amount, note: it.note }));
      await onSave(service.id, payload, margin.trim() === "" ? null : marginPct);
      // Sukses → katalog dimuat ulang, draf direset otomatis via useEffect [service]
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50/60">
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-label={`Rincian biaya ${service.name}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
          )}
          <span className="shrink-0 text-xs font-semibold text-zinc-700">Rincian Biaya</span>
          {!open ? (
            hasItems ? (
              <span className="min-w-0 truncate text-[11px] text-zinc-500">
                {service.costItems?.length} butir · Total biaya {fmtIDR(serverTotal)} · Saran harga {fmtIDR(serverSaran)}
              </span>
            ) : (
              <span className="text-[11px] italic text-zinc-400">Belum ada rincian biaya</span>
            )
          ) : null}
        </button>
        {!open && !hasItems ? (
          <Button
            type="button" variant="outline" className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => { setOpen(true); if (items.length === 0) addItem(); }}
          >
            <Plus className="h-3 w-3" aria-hidden /> Mulai isi
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-2.5 border-t px-3 py-3">
          {items.length > 0 ? (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {items.map((it, idx) => (
                <div key={idx}>
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label={`Nama butir biaya ${idx + 1}`}
                      className="h-8 min-w-0 flex-1 text-xs"
                      placeholder="mis. Talenta / Sewa alat"
                      value={it.name}
                      onChange={(e) => setItems((m) => m.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row)))}
                    />
                    <Input
                      aria-label={`Nominal butir biaya ${idx + 1} (rupiah)`}
                      className="h-8 w-32 shrink-0 text-right font-mono text-xs"
                      inputMode="numeric"
                      placeholder="0"
                      value={it.amount}
                      onChange={(e) => setItems((m) => m.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)))}
                    />
                    <Button
                      type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-zinc-400 hover:text-rose-600"
                      aria-label={`Hapus butir ${it.name.trim() || idx + 1}`}
                      onClick={() => setItems((m) => m.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                  {it.note ? <p className="pl-1 text-[11px] italic text-zinc-400">{it.note}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-zinc-400">Belum ada rincian biaya — tambahkan butir komponen biaya (talenta, sewa alat, transport, dsb.).</p>
          )}

          <Button type="button" variant="outline" className="h-8" onClick={addItem}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah butir
          </Button>

          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 rounded-lg border border-dashed bg-white px-3 py-2.5">
            <div>
              <p className="text-[11px] text-zinc-500">Total biaya</p>
              <p className="text-sm font-bold text-zinc-900">{fmtIDR(total)}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`cost-margin-${service.id}`} className="text-[11px]">Margin target %</Label>
              <Input
                id={`cost-margin-${service.id}`}
                className="h-8 w-20 text-xs"
                inputMode="decimal"
                placeholder="30"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
              />
            </div>
            <div className="text-right">
              <p className="text-[11px] text-zinc-500">Saran harga</p>
              <p className="text-sm font-bold text-orange-600">{fmtIDR(saran)}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {basePrice != null ? (
              basePrice < saran ? (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Harga acuan di bawah saran</Badge>
              ) : (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Sesuai saran</Badge>
              )
            ) : null}
            {basePrice != null ? <span className="text-[11px] text-zinc-500">Harga acuan: {fmtIDR(basePrice)}</span> : null}
            <div className="flex-1" />
            {invalid ? <p className="text-[11px] text-rose-600">Nama butir wajib diisi &amp; nominal ≥ 0.</p> : null}
            <Button type="button" variant="ghost" className="h-8" disabled={saving} onClick={resetDraft}>
              Batal
            </Button>
            <Button type="button" className="h-8" disabled={saving || invalid} onClick={() => void save()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
              Simpan rincian
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
