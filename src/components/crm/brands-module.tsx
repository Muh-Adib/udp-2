"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign, BellRing, Building2, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileText, Globe, Instagram, Layers, LayoutDashboard,
  Link2, Loader2, Mail, Map as MapIcon, MapPin, MessageCircle, Palette, Pencil, Phone, Plus, RefreshCw, Settings2, Tag, Trash2, Video, Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import BrandSettingsDialog, { BrandLogo } from "@/components/crm/brand-settings-dialog";
import { BRAND_SERVICES, PIPELINE_STAGES, stageLabel } from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type { Brand, CrossSellCompany, FollowUpTemplateDTO, ServiceMapData, ServiceMapRow } from "@/lib/crm/types";

// ============ Meta ============

const CURRENCIES = ["IDR", "USD", "SGD", "EUR", "AUD"] as const;

const CHANNEL_META: Record<string, { label: string; icon: LucideIcon }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  email: { label: "Email", icon: Mail },
  instagram: { label: "Instagram", icon: Instagram },
  website: { label: "Website", icon: Globe },
  phone: { label: "Telepon", icon: Phone },
  meeting: { label: "Meeting", icon: Video },
  portal: { label: "Client Portal", icon: LayoutDashboard },
};

function channelMeta(channel: string): { label: string; icon: LucideIcon } {
  if (CHANNEL_META[channel]) return CHANNEL_META[channel];
  return {
    label: channel ? channel.charAt(0).toUpperCase() + channel.slice(1) : "Lainnya",
    icon: BellRing,
  };
}

interface BrandDraft {
  name: string;
  slug: string;
  color: string;
  description: string;
  website: string;
  primaryCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  slaHours: string;
  portalDomain: string;
  active: boolean;
}

interface TemplateDraft {
  name: string;
  channel: string;
  brandId: string; // "all" = berlaku untuk semua brand
  stage: string;
  delayDays: string;
  body: string;
  approved: boolean;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function quotePrefixFrom(prefix: string): string {
  const clean = prefix.trim().replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  return clean ? `Q${clean}` : "";
}

function fmtIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

const SERVICE_MAP_VISIBLE_COMPANIES = 8;

const EMPTY_DRAFT: BrandDraft = {
  name: "", slug: "", color: "#ea580c",
  description: "", website: "", primaryCurrency: "IDR",
  invoicePrefix: "", quotePrefix: "", slaHours: "24", portalDomain: "", active: true,
};

const EMPTY_TEMPLATE_DRAFT: TemplateDraft = {
  name: "", channel: "whatsapp", brandId: "all", stage: "", delayDays: "1", body: "", approved: false,
};

const TEMPLATE_CHANNELS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "email", label: "Email" },
] as const;

const TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  namaKontak: "Dian",
  brand: "Unimasi",
  layanan: "Website Profil",
};

function previewTemplateBody(body: string): string {
  return body.replace(/\{(namaKontak|brand|layanan)\}/g, (_, key: string) => TEMPLATE_SAMPLE_VALUES[key] ?? _);
}

// ============ Sub-komponen kecil ============

function BrandCard({ brand, onSettings }: { brand: Brand; onSettings: (brand: Brand) => void }) {
  const services = BRAND_SERVICES[brand.slug] ?? [];
  const contactChips: Array<{ key: string; value: string | null | undefined; label: string }> = [
    { key: "wa", value: brand.whatsappNumber, label: "WhatsApp" },
    { key: "ig", value: brand.instagramHandle, label: "Instagram" },
    { key: "threads", value: brand.threadsHandle, label: "Threads" },
    { key: "email", value: brand.email, label: "Email" },
  ];
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border bg-white p-5 pl-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: brand.color }} aria-hidden />
      <div className="flex items-start gap-3">
        <BrandLogo brand={brand} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold text-zinc-900">{brand.name}</p>
            {!brand.active ? <Badge variant="outline" className="border-transparent bg-zinc-100 px-1.5 text-zinc-500">Nonaktif</Badge> : null}
          </div>
          {brand.tagline ? (
            <p className="truncate text-xs font-medium italic" style={{ color: brand.color }}>&ldquo;{brand.tagline}&rdquo;</p>
          ) : (
            <p className="truncate font-mono text-xs text-zinc-500">{brand.slug}</p>
          )}
          {brand.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{brand.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-zinc-800"
            onClick={() => onSettings(brand)}
            aria-label={`Pengaturan ${brand.name}`}
            title="Kelola: identitas, layanan & workflow, surat, integrasi"
          >
            <Settings2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Kontak resmi brand (data asli situs) */}
      {contactChips.some((c) => c.value) ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {contactChips.filter((c) => c.value).map((c) => (
            <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600" title={c.label}>
              {c.key === "wa" ? <MessageCircle className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                : c.key === "ig" ? <Instagram className="h-3 w-3 shrink-0 text-pink-600" aria-hidden />
                : c.key === "threads" ? <AtSign className="h-3 w-3 shrink-0 text-zinc-700" aria-hidden />
                : <Mail className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />}
              <span className="truncate font-mono">{c.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {brand.city || brand.address ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
          <span className="line-clamp-1" title={brand.address ?? brand.city ?? ""}>{brand.city ?? brand.address}</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-zinc-600" title="Warna brand">
          <span className="h-3 w-3 rounded-full border border-zinc-200" style={{ backgroundColor: brand.color }} aria-hidden />
          <span className="font-mono">{brand.color}</span>
        </span>
        <Badge variant="outline" className="border-transparent bg-zinc-100 text-zinc-600">{brand.primaryCurrency}</Badge>
        <Badge variant="outline" className="border-transparent bg-zinc-100 font-mono text-zinc-600">{brand.invoicePrefix}</Badge>
        <Badge variant="outline" className="border-transparent bg-amber-50 text-amber-700">
          <Clock3 className="h-3 w-3" aria-hidden /> SLA {brand.slaHours} jam
        </Badge>
      </div>

      {(brand.portalDomain || brand.website) ? (
        <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 text-xs">
          {brand.portalDomain ? (
            <p className="flex items-center gap-1.5 text-zinc-600">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden /> Portal: {brand.portalDomain}
            </p>
          ) : null}
          {brand.website ? (
            <a
              href={brand.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-zinc-700 underline-offset-2 hover:underline"
              aria-label={`Buka website ${brand.name}`}
            >
              <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden /> {brand.website.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Layanan brand */}
      <div className="mt-3 border-t border-zinc-100 pt-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Layanan {brand.name}</p>
        {services.length === 0 ? (
          <p className="text-xs text-zinc-400">Belum ada katalog layanan untuk brand ini.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <span key={s} className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineStageCard({ stage, index }: { stage: (typeof PIPELINE_STAGES)[number]; index: number }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-sm">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
        style={{ backgroundColor: stage.color }}
        aria-hidden
      >
        {index + 1}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-900">{stage.label}</p>
        <p className="text-xs text-zinc-500">{stage.meaning}</p>
        <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-zinc-400">
          <Tag className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>Aktivitas wajib: {stage.required}</span>
        </p>
      </div>
    </div>
  );
}

function TemplateCard({
  template, brandName, onEdit, onDelete,
}: {
  template: FollowUpTemplateDTO;
  brandName?: string;
  onEdit: (template: FollowUpTemplateDTO) => void;
  onDelete: (template: FollowUpTemplateDTO) => void;
}) {
  const meta = channelMeta(template.channel);
  const ChannelIcon = meta.icon;
  return (
    <div className="flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600" aria-hidden>
          <ChannelIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">{template.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">
            {brandName ?? "Semua brand"}
            {template.stage ? ` · Stage ${stageLabel(template.stage)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-400 hover:text-zinc-800"
            onClick={() => onEdit(template)}
            aria-label={`Edit template ${template.name}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-400 hover:text-rose-600"
            onClick={() => onDelete(template)}
            aria-label={`Hapus template ${template.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-transparent bg-zinc-100 text-zinc-600">
          <ChannelIcon className="h-3 w-3" aria-hidden /> {meta.label}
        </Badge>
        <Badge variant="outline" className="border-transparent bg-zinc-100 font-medium text-zinc-700">H+{template.delayDays}</Badge>
        <Badge variant="outline" className="border-transparent bg-zinc-100 font-mono uppercase text-zinc-600">{template.language}</Badge>
        <Badge variant="outline" className="border-transparent bg-zinc-100 font-mono text-zinc-500">v{template.version}</Badge>
        {template.approved ? (
          <Badge variant="outline" className="border-transparent bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Disetujui
          </Badge>
        ) : (
          <Badge variant="outline" className="border-transparent bg-amber-50 text-amber-700">Review</Badge>
        )}
      </div>

      <blockquote className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-600">
        <span className="line-clamp-2 whitespace-pre-line">{template.body}</span>
      </blockquote>
    </div>
  );
}

function BrandsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-72 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

function TemplatesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ============ Ronde 29-b — Peta Layanan & Cross-Selling (super_admin + director) ============

function ServiceMapSection() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ServiceMapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"matrix" | "crosssell">("matrix");
  const [showAll, setShowAll] = useState(false);

  const loadMap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.serviceMap();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat peta layanan");
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy: fetch pertama kali hanya saat section dibuka.
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && data === null && !loading) void loadMap();
  }

  const rowsByBrand = useMemo(() => {
    const map = new Map<string, ServiceMapRow[]>();
    (data?.rows ?? []).forEach((row) => {
      const list = map.get(row.brandId);
      if (list) list.push(row);
      else map.set(row.brandId, [row]);
    });
    return map;
  }, [data]);

  const companies: CrossSellCompany[] = data?.crossSell ?? [];
  const visibleCompanies = showAll ? companies : companies.slice(0, SERVICE_MAP_VISIBLE_COMPANIES);
  const avgBrands = data
    ? Number.isInteger(data.stats.avgBrandsPerCompany)
      ? String(data.stats.avgBrandsPerCompany)
      : data.stats.avgBrandsPerCompany.toFixed(1)
    : "0";

  return (
    <section aria-label="Peta Layanan & Cross-Selling" className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" onClick={toggleOpen} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600" aria-hidden>
            <MapIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-zinc-900">Peta Layanan &amp; Cross-Selling</span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              Panduan strategi cross-selling antar brand &amp; acuan harga layanan (template rincian biaya)
            </span>
          </span>
          <ChevronDown className={`mt-1.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {open ? (
          <Button variant="outline" size="sm" onClick={() => void loadMap()} disabled={loading} aria-label="Muat ulang peta layanan">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4">
          {loading && data === null ? (
            <div className="space-y-4" aria-hidden>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-44 rounded-full" />)}
              </div>
              <Skeleton className="h-8 w-72 rounded-lg" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void loadMap()} aria-label="Coba lagi memuat peta layanan">
                <RefreshCw className="h-4 w-4" aria-hidden /> Coba lagi
              </Button>
            </div>
          ) : data ? (
            <>
              {/* Stat chips */}
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
                  <span className="font-bold text-zinc-900">{data.stats.companies}</span> perusahaan aktif
                </span>
                <span className="rounded-full border bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
                  rata-rata <span className="font-bold text-zinc-900">{avgBrands}</span> brand per perusahaan
                </span>
                <span className="rounded-full border bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
                  <span className="font-bold text-emerald-700">{data.stats.coveredAll}</span> pakai semua brand
                </span>
                <span className="rounded-full border bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
                  <span className="font-bold text-zinc-900">{data.stats.activeServices}</span> layanan aktif
                </span>
              </div>

              {/* Sub-tab internal */}
              <div className="mt-4 inline-flex rounded-lg border bg-zinc-50 p-0.5" role="tablist" aria-label="Mode tampilan peta layanan">
                <button
                  type="button" role="tab" aria-selected={tab === "matrix"}
                  onClick={() => setTab("matrix")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === "matrix" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
                >
                  Matriks Layanan
                </button>
                <button
                  type="button" role="tab" aria-selected={tab === "crosssell"}
                  onClick={() => setTab("crosssell")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === "crosssell" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
                >
                  Peluang Cross-Selling
                </button>
              </div>

              {tab === "matrix" ? (
                /* ===== MATRIKS LAYANAN — kartu per brand, digroup per kategori ===== */
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {data.brands.map((b) => {
                    const rows = rowsByBrand.get(b.id) ?? [];
                    const categories = new Map<string, ServiceMapRow[]>();
                    rows.forEach((row) => {
                      const key = row.categoryName ?? "Lainnya";
                      const list = categories.get(key);
                      if (list) list.push(row);
                      else categories.set(key, [row]);
                    });
                    return (
                      <div key={b.id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                        <div className="flex items-center gap-2.5 border-b border-zinc-100 bg-zinc-50/60 px-4 py-3">
                          <BrandLogo brand={b} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-zinc-900">{b.name}</p>
                            {b.tagline ? <p className="truncate text-[11px] italic text-zinc-500">{b.tagline}</p> : null}
                          </div>
                          <span className="shrink-0 rounded-full border bg-white px-2 py-0.5 text-[11px] text-zinc-500">{rows.length} layanan</span>
                        </div>
                        <div className="space-y-3 p-4">
                          {rows.length === 0 ? (
                            <p className="text-xs text-zinc-400">Belum ada layanan terdaftar untuk brand ini.</p>
                          ) : (
                            Array.from(categories.entries()).map(([catName, list]) => (
                              <div key={catName}>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{catName}</p>
                                <ul className="mt-1.5 space-y-1.5">
                                  {list.map((row) => {
                                    const badge =
                                      row.costTotal == null || row.suggestedPrice == null || row.basePrice == null || row.suggestedPrice <= 0
                                        ? null
                                        : row.basePrice < row.suggestedPrice
                                          ? (
                                            <Badge variant="outline" className="border-transparent bg-amber-50 px-1.5 text-[10px] text-amber-700">
                                              Di bawah saran
                                            </Badge>
                                          )
                                          : (
                                            <Badge variant="outline" className="border-transparent bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                                              OK
                                            </Badge>
                                          );
                                    return (
                                      <li key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-2">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-medium text-zinc-800">{row.name}</p>
                                          <p className="text-xs text-zinc-500">{row.unit ?? "paket"}</p>
                                          {row.costTotal != null ? (
                                            <p className="mt-0.5 text-xs text-zinc-500">
                                              Biaya: <span className="font-medium">{fmtIDR(row.costTotal)}</span>
                                              {" · Saran: "}
                                              <span className="font-medium">{fmtIDR(row.suggestedPrice ?? 0)}</span>
                                            </p>
                                          ) : null}
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                          <span className="text-sm font-semibold text-zinc-900">{fmtIDR(row.basePrice ?? 0)}</span>
                                          <div className="flex gap-1">
                                            {!row.active ? (
                                              <Badge variant="outline" className="border-transparent bg-zinc-100 px-1.5 text-[10px] text-zinc-500">Nonaktif</Badge>
                                            ) : null}
                                            {badge}
                                          </div>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ===== PELUANG CROSS-SELLING — kartu per perusahaan ===== */
                <div className="mt-4">
                  {companies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-200 p-8 text-center">
                      <Building2 className="h-8 w-8 text-zinc-300" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-700">Belum ada data perusahaan</p>
                      <p className="max-w-sm text-xs text-zinc-500">
                        Ringkasan cross-selling muncul setelah perusahaan memiliki opportunity atau invoice pada brand.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="crm-scroll max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                        {visibleCompanies.map((c) => (
                          <div key={c.companyId} className="rounded-xl border bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600" aria-hidden>
                                  <Building2 className="h-4 w-4" />
                                </span>
                                <p className="truncate text-sm font-semibold text-zinc-900">{c.companyName}</p>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-zinc-900" title="Total nilai belanja semua brand">
                                {fmtIDR(c.totalValue)}
                              </span>
                            </div>

                            {c.purchases.length > 0 ? (
                              <div className="mt-3 space-y-1.5">
                                {c.purchases.map((p) => (
                                  <div key={p.brandId} className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs">
                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800">
                                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.brandColor }} aria-hidden />
                                        {p.brandName}
                                      </span>
                                      <span className="text-zinc-500">{p.serviceCount} layanan · {fmtIDR(p.totalValue)}</span>
                                    </span>
                                    {p.services.length > 0 ? (
                                      <p className="mt-0.5 truncate text-[11px] text-zinc-400" title={p.services.join(", ")}>
                                        {p.services.join(" · ")}
                                      </p>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-zinc-400">Belum ada pembelian tercatat.</p>
                            )}

                            <div className="mt-3 border-t border-zinc-100 pt-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Peluang cross-sell →</p>
                              {c.suggestions.length === 0 ? (
                                <Badge variant="outline" className="mt-1.5 border-transparent bg-emerald-50 text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" aria-hidden /> Semua brand sudah digarap
                                </Badge>
                              ) : (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {c.suggestions.map((s) => (
                                    <span
                                      key={s.brandId}
                                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600"
                                      title={s.topService ?? `Brand ${s.brandName}`}
                                    >
                                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.brandColor }} aria-hidden />
                                      <span className="font-semibold text-zinc-800">{s.brandName}</span>
                                      {s.topService ? <span className="truncate text-zinc-500">· {s.topService}</span> : null}
                                      {s.basePrice != null ? <span className="shrink-0 text-zinc-500">dari {fmtIDR(s.basePrice)}</span> : null}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {companies.length > SERVICE_MAP_VISIBLE_COMPANIES ? (
                        <Button
                          variant="ghost" size="sm" className="mt-2 text-zinc-500 hover:text-zinc-800"
                          onClick={() => setShowAll((v) => !v)}
                          aria-label={showAll ? "Tampilkan 8 perusahaan teratas saja" : `Tampilkan semua ${companies.length} perusahaan`}
                        >
                          {showAll ? "Tampilkan lebih sedikit" : `Tampilkan semua (${companies.length})`}
                          <ChevronDown className={`h-3.5 w-3.5 ${showAll ? "rotate-180" : ""}`} aria-hidden />
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ============ Module utama ============

export default function BrandsModule() {
  const user = useCrmStore((s) => s.user);

  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [draft, setDraft] = useState<BrandDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  // Ronde 29-b — dialog Pengaturan Brand (identitas/layanan/surat/integrasi)
  const [settingsBrand, setSettingsBrand] = useState<Brand | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [templates, setTemplates] = useState<FollowUpTemplateDTO[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState("");

  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FollowUpTemplateDTO | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(EMPTY_TEMPLATE_DRAFT);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.brands();
      setBrands(res.brands);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat brand");
      if (!silent) toast.error("Gagal memuat konfigurasi brand");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const res = await api.followUpTemplates();
      setTemplates(res.templates);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "Gagal memuat template follow-up");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTemplates();
  }, [load, loadTemplates]);

  const allServices = useMemo(() => {
    const set = new Set<string>();
    Object.values(BRAND_SERVICES).forEach((arr) => arr.forEach((s) => set.add(s)));
    return Array.from(set);
  }, []);

  const filteredBrands = useMemo(() => {
    if (!serviceFilter || serviceFilter === "all") return brands ?? [];
    return (brands ?? []).filter((b) => (BRAND_SERVICES[b.slug] ?? []).includes(serviceFilter));
  }, [brands, serviceFilter]);

  const templateChannels = useMemo(() => {
    const set = new Set<string>();
    (templates ?? []).forEach((t) => set.add(t.channel));
    return Array.from(set).sort().map((c) => ({ key: c, label: channelMeta(c).label }));
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    if (!channelFilter || channelFilter === "all") return templates;
    return templates.filter((t) => t.channel === channelFilter);
  }, [templates, channelFilter]);

  const brandNameById = useMemo(() => {
    const map = new Map<string, string>();
    (brands ?? []).forEach((b) => map.set(b.id, b.name));
    return map;
  }, [brands]);

  const canApproveTemplates = user?.role === "director" || user?.role === "super_admin";

  const templatePreview = useMemo(
    () => previewTemplateBody(templateDraft.body),
    [templateDraft.body],
  );

  function openTemplateCreate() {
    setEditingTemplate(null);
    setTemplateDraft(EMPTY_TEMPLATE_DRAFT);
    setTemplateOpen(true);
  }

  function openTemplateEdit(t: FollowUpTemplateDTO) {
    setEditingTemplate(t);
    setTemplateDraft({
      name: t.name,
      channel: TEMPLATE_CHANNELS.some((c) => c.key === t.channel) ? t.channel : "whatsapp",
      brandId: t.brandId ?? "all",
      stage: t.stage ?? "",
      delayDays: String(t.delayDays),
      body: t.body,
      approved: t.approved,
    });
    setTemplateOpen(true);
  }

  async function submitTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!templateDraft.name.trim()) { toast.error("Nama template wajib diisi"); return; }
    if (!templateDraft.body.trim()) { toast.error("Isi template wajib diisi"); return; }
    const delay = Number(templateDraft.delayDays);
    if (!Number.isInteger(delay) || delay < 0 || delay > 30) { toast.error("Jeda hari harus antara 0 dan 30"); return; }
    if (!user) { toast.error("Sesi berakhir — silakan login ulang"); return; }
    setTemplateSubmitting(true);
    try {
      const payload = {
        name: templateDraft.name.trim(),
        channel: templateDraft.channel,
        brandId: templateDraft.brandId === "all" ? null : templateDraft.brandId,
        stage: templateDraft.stage.trim() || null,
        delayDays: delay,
        body: templateDraft.body.trim(),
        approved: canApproveTemplates ? templateDraft.approved : (editingTemplate?.approved ?? false),
        actorName: user.name,
        actorRole: user.role,
      };
      if (editingTemplate) {
        await api.updateTemplate(editingTemplate.id, payload);
        toast.success("Template diperbarui");
      } else {
        await api.createTemplate(payload);
        toast.success("Template dibuat");
      }
      setTemplateDraft(EMPTY_TEMPLATE_DRAFT);
      setEditingTemplate(null);
      setTemplateOpen(false);
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan template");
    } finally {
      setTemplateSubmitting(false);
    }
  }

  async function handleDeleteTemplate(t: FollowUpTemplateDTO) {
    if (!window.confirm(`Hapus template "${t.name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await api.deleteTemplate(t.id);
      toast.success(`Template "${t.name}" dihapus`);
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus template");
    }
  }

  function openBrandCreate() {
    setEditingBrand(null);
    setDraft(EMPTY_DRAFT);
    setCreateOpen(true);
  }

  function handleNameChange(name: string) {
    // Mode edit: slug tidak ikut berubah otomatis (bisa diatur manual).
    setDraft((d) => (editingBrand ? { ...d, name } : { ...d, name, slug: slugify(name) }));
  }

  function handleInvoicePrefixChange(value: string) {
    const upper = value.toUpperCase();
    setDraft((d) =>
      editingBrand
        ? { ...d, invoicePrefix: upper }
        : { ...d, invoicePrefix: upper, quotePrefix: quotePrefixFrom(upper) },
    );
  }

  async function submitDraft(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.name.trim()) { toast.error("Nama brand wajib diisi"); return; }
    if (!draft.slug.trim()) { toast.error("Slug brand wajib diisi"); return; }
    const sla = Number(draft.slaHours);
    if (!Number.isFinite(sla) || sla < 1 || sla > 72) { toast.error("SLA harus antara 1 dan 72 jam"); return; }
    if (!user) { toast.error("Sesi berakhir — silakan login ulang"); return; }
    setSubmitting(true);
    try {
      const payload = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        color: draft.color,
        description: draft.description.trim(),
        website: draft.website.trim(),
        primaryCurrency: draft.primaryCurrency,
        invoicePrefix: draft.invoicePrefix.trim(),
        quotePrefix: editingBrand
          ? (draft.quotePrefix.trim() || quotePrefixFrom(draft.invoicePrefix))
          : quotePrefixFrom(draft.invoicePrefix),
        slaHours: sla,
        portalDomain: draft.portalDomain.trim(),
        active: draft.active,
        actorName: user.name,
        actorRole: user.role,
      };
      if (editingBrand) {
        await api.updateBrand(editingBrand.id, payload);
        toast.success("Brand diperbarui");
      } else {
        const res = await api.createBrand(payload);
        toast.success(`Brand ${res.brand.name} dikonfigurasi`);
      }
      setDraft(EMPTY_DRAFT);
      setEditingBrand(null);
      setCreateOpen(false);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan brand");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && brands === null) return <BrandsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Konfigurasi Brand</h1>
          <p className="text-sm text-zinc-500">Tambah brand baru tanpa mengubah source code</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang daftar brand">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
          <Button size="sm" onClick={openBrandCreate} aria-label="Tambah brand baru">
            <Plus className="h-4 w-4" aria-hidden /> Tambah Brand
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Filter layanan */}
      <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="w-full sm:w-[260px]" aria-label="Filter brand berdasarkan layanan">
              <SelectValue placeholder="Semua layanan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Layanan</SelectItem>
              {allServices.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-zinc-500 sm:ml-auto">{filteredBrands.length} dari {brands?.length ?? 0} brand</span>
      </div>

      {/* Grid brand */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredBrands.map((b) => <BrandCard key={b.id} brand={b} onSettings={(brand) => { setSettingsBrand(brand); setSettingsOpen(true); }} />)}

        {/* Kartu tambah */}
        <button
          type="button"
          onClick={openBrandCreate}
          aria-label="Tambah brand baru"
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 p-5 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600"
        >
          <Plus className="h-8 w-8" aria-hidden />
          <span className="text-sm font-semibold">Tambah Brand</span>
          <span className="max-w-[220px] text-center text-xs">Definisikan brand, warna, SLA, dan prefix invoice</span>
        </button>
      </div>

      {/* Peta Layanan & Cross-Selling (Ronde 29-b — lazy fetch saat dibuka) */}
      <ServiceMapSection />

      {/* Konfigurasi pipeline standar */}
      <section aria-label="Konfigurasi pipeline standar" className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Wand2 className="h-3.5 w-3.5" aria-hidden /> Standar Tim Sales
          </p>
          <h2 className="mt-1 text-sm font-semibold text-zinc-900">Konfigurasi Pipeline Standar (12 Stage)</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Acuan baku dari lead baru hingga deal — dipakai sebagai acuan aktivitas follow-up di semua brand.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PIPELINE_STAGES.map((s, i) => <PipelineStageCard key={s.key} stage={s} index={i} />)}
        </div>
      </section>

      {/* Template follow-up */}
      <section aria-label="Template follow-up" className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <FileText className="h-3.5 w-3.5" aria-hidden /> Template Pesan
            </p>
            <h2 className="mt-1 text-sm font-semibold text-zinc-900">Template Follow-up</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Pesan siap pakai dengan variabel kontak/brand — terkirim otomatis sesuai jeda H+ dan kanal.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Button size="sm" variant="outline" onClick={openTemplateCreate} aria-label="Tambah template follow-up baru">
              <Plus className="h-4 w-4" aria-hidden /> Template Baru
            </Button>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter template berdasarkan kanal">
                <SelectValue placeholder="Semua kanal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kanal</SelectItem>
                {templateChannels.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="hidden text-xs text-zinc-500 lg:inline">{filteredTemplates.length} template</span>
          </div>
        </div>

        {templatesLoading && templates === null ? (
          <TemplatesSkeleton />
        ) : templatesError ? (
          <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
            <span>{templatesError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadTemplates()} aria-label="Coba lagi memuat template follow-up">
              <RefreshCw className="h-4 w-4" aria-hidden /> Coba lagi
            </Button>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-200 p-8 text-center">
            <FileText className="h-8 w-8 text-zinc-300" aria-hidden />
            <p className="text-sm font-semibold text-zinc-700">Belum ada template follow-up</p>
            <p className="max-w-sm text-xs text-zinc-500">
              {channelFilter && channelFilter !== "all"
                ? "Tidak ada template untuk kanal ini — coba pilih kanal lain."
                : "Template akan muncul di sini setelah ditambahkan ke daftar pesan bawaan."}
            </p>
          </div>
        ) : (
          <div className="crm-scroll max-h-96 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredTemplates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  brandName={t.brandId ? brandNameById.get(t.brandId) : undefined}
                  onEdit={openTemplateEdit}
                  onDelete={(tpl) => void handleDeleteTemplate(tpl)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Dialog tambah / edit brand */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!submitting) { setCreateOpen(open); if (!open) setEditingBrand(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingBrand ? "Edit Brand" : "Tambah Brand Baru"}</DialogTitle>
            <DialogDescription>
              {editingBrand
                ? `Perubahan brand ${editingBrand.name} tersimpan ke database dan langsung dipakai di seluruh modul CRM.`
                : "Detail brand akan tersimpan ke database dan langsung dipakai di seluruh modul CRM — tanpa mengubah source code."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDraft} className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="brand-name">Nama Brand *</Label>
                <Input
                  id="brand-name" value={draft.name} required
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Contoh: Zenith Creative"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand-slug">Slug</Label>
                <Input
                  id="brand-slug" value={draft.slug} required
                  onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
                  placeholder="zenith_creative"
                />
                <p className="text-[11px] text-zinc-400">Unik, dipakai di URL/invoice prefix</p>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brand-color" className="items-center gap-2">
                <Palette className="h-3.5 w-3.5 text-zinc-400" aria-hidden /> Warna Brand
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="brand-color" type="color" className="h-10 w-14 cursor-pointer p-1"
                  value={draft.color}
                  onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                  aria-label="Pilih warna brand"
                />
                <span className="flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-mono text-zinc-600">
                  <span className="h-3 w-3 rounded-full border border-zinc-200" style={{ backgroundColor: draft.color }} aria-hidden />
                  {draft.color}
                </span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brand-desc">Deskripsi</Label>
              <Input
                id="brand-desc" value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Bidang layanan utama brand ini"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="brand-currency">Mata Uang</Label>
                <Select value={draft.primaryCurrency} onValueChange={(v) => setDraft((d) => ({ ...d, primaryCurrency: v }))}>
                  <SelectTrigger id="brand-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand-prefix">Prefix Invoice</Label>
                <Input
                  id="brand-prefix" value={draft.invoicePrefix}
                  onChange={(e) => handleInvoicePrefixChange(e.target.value)}
                  placeholder="ZTH-2026"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand-sla">SLA (jam)</Label>
                <Input
                  id="brand-sla" type="number" min={1} max={72} value={draft.slaHours}
                  onChange={(e) => setDraft((d) => ({ ...d, slaHours: e.target.value }))}
                  aria-label="SLA respons dalam jam (1 sampai 72)"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="brand-quote-prefix">Prefix Quotation</Label>
                <Input
                  id="brand-quote-prefix" value={draft.quotePrefix}
                  onChange={(e) => setDraft((d) => ({ ...d, quotePrefix: e.target.value.toUpperCase() }))}
                  placeholder="QZTH"
                />
                {!editingBrand ? (
                  <p className="text-[11px] text-zinc-400">Otomatis mengikuti prefix invoice — boleh diubah.</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand-website">Website</Label>
                <Input
                  id="brand-website" type="url" value={draft.website}
                  onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))}
                  placeholder="https://zenith.co.id"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand-portal">Portal Domain</Label>
                <Input
                  id="brand-portal" value={draft.portalDomain}
                  onChange={(e) => setDraft((d) => ({ ...d, portalDomain: e.target.value }))}
                  placeholder="portal.zenith.co.id"
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-zinc-50 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="brand-active" className="text-sm">Brand aktif</Label>
                  <p className="text-[11px] text-zinc-500">Brand nonaktif disembunyikan dari daftar brand.</p>
                </div>
                <Switch
                  id="brand-active"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, active: v }))}
                  aria-label="Aktifkan atau nonaktifkan brand"
                />
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="outline" onClick={() => { setCreateOpen(false); setEditingBrand(null); }} disabled={submitting}>Batal</Button>
              <Button type="submit" disabled={submitting} aria-label={editingBrand ? "Simpan perubahan brand" : "Simpan brand baru"}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : editingBrand ? <Pencil className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                {submitting ? "Menyimpan…" : editingBrand ? "Simpan Perubahan" : "Simpan Brand"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog template follow-up (baru / edit) */}
      <Dialog open={templateOpen} onOpenChange={(open) => { if (!templateSubmitting) { setTemplateOpen(open); if (!open) setEditingTemplate(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template Follow-up" : "Template Follow-up Baru"}</DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? `Mengubah isi pesan akan menaikkan versi template (saat ini v${editingTemplate.version}).`
                : "Pesan siap pakai yang terkirim otomatis sesuai jeda H+ dan kanal — tanpa mengubah source code."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitTemplate} className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="tpl-name">Nama Template *</Label>
                <Input
                  id="tpl-name" value={templateDraft.name} required
                  onChange={(e) => setTemplateDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Contoh: Follow-up Kunjungan H+1"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-channel">Kanal *</Label>
                <Select value={templateDraft.channel} onValueChange={(v) => setTemplateDraft((d) => ({ ...d, channel: v }))}>
                  <SelectTrigger id="tpl-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CHANNELS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-brand">Cakupan Brand</Label>
                <Select value={templateDraft.brandId} onValueChange={(v) => setTemplateDraft((d) => ({ ...d, brandId: v }))}>
                  <SelectTrigger id="tpl-brand"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua brand</SelectItem>
                    {(brands ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tpl-delay">Jeda (hari, H+)</Label>
                <Input
                  id="tpl-delay" type="number" min={0} max={30} value={templateDraft.delayDays} required
                  onChange={(e) => setTemplateDraft((d) => ({ ...d, delayDays: e.target.value }))}
                  aria-label="Jeda follow-up dalam hari (0 sampai 30)"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="tpl-stage">Stage Pipeline (opsional)</Label>
                <Input
                  id="tpl-stage" value={templateDraft.stage}
                  onChange={(e) => setTemplateDraft((d) => ({ ...d, stage: e.target.value }))}
                  placeholder="cth. after_visit"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-body">Isi Pesan *</Label>
              <Textarea
                id="tpl-body" rows={6} value={templateDraft.body} required
                onChange={(e) => setTemplateDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder={"Halo {namaKontak}, terima kasih sudah bertemu dengan tim {brand}. Berikut penawaran {layanan} dari kami…"}
              />
              <p className="text-[11px] text-zinc-400">
                Placeholder otomatis diganti saat pengiriman: <code className="font-mono">{"{namaKontak}"}</code>{" "}
                <code className="font-mono">{"{brand}"}</code> <code className="font-mono">{"{layanan}"}</code>
              </p>
            </div>
            <div className="rounded-lg border bg-zinc-50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Pratinjau</p>
              {templateDraft.body.trim() ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">{templatePreview}</p>
              ) : (
                <p className="text-sm text-zinc-400">Isi pesan untuk melihat pratinjau dengan contoh nilai.</p>
              )}
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border bg-zinc-50 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="tpl-approved" className="text-sm">Setujui template</Label>
                <p className="text-[11px] text-zinc-500">
                  {canApproveTemplates
                    ? "Template disetujui siap dipakai pengiriman otomatis."
                    : "Hanya Direktur/Super Admin yang bisa menandai disetujui."}
                </p>
              </div>
              <Switch
                id="tpl-approved"
                checked={canApproveTemplates ? templateDraft.approved : (editingTemplate?.approved ?? false)}
                disabled={!canApproveTemplates}
                onCheckedChange={(v) => setTemplateDraft((d) => ({ ...d, approved: v }))}
                aria-label="Tandai template disetujui"
              />
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="outline" onClick={() => { setTemplateOpen(false); setEditingTemplate(null); }} disabled={templateSubmitting}>Batal</Button>
              <Button type="submit" disabled={templateSubmitting} aria-label={editingTemplate ? "Simpan perubahan template" : "Simpan template baru"}>
                {templateSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                {templateSubmitting ? "Menyimpan…" : editingTemplate ? "Simpan Perubahan" : "Simpan Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ronde 29-b — Pengaturan Brand lengkap (identitas asli, layanan & workflow, surat, integrasi) */}
      <BrandSettingsDialog
        brand={settingsBrand}
        open={settingsOpen}
        onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsBrand(null); }}
        onSaved={(updated) => {
          setSettingsBrand((prev) => (prev && prev.id === updated.id ? updated : prev));
          setBrands((prev) => (prev ?? []).map((b) => (b.id === updated.id ? updated : b)));
        }}
      />
    </div>
  );
}
