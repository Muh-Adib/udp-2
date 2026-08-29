"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock3, ExternalLink, Globe, Layers, Link2, Palette, Plus, RefreshCw, Tag, Wand2,
} from "lucide-react";
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
import { api } from "@/lib/crm/api-client";
import { BRAND_SERVICES, PIPELINE_STAGES } from "@/lib/crm/constants";
import type { Brand } from "@/lib/crm/types";

// ============ Meta ============

const CURRENCIES = ["IDR", "USD", "SGD", "EUR", "AUD"] as const;

interface BrandDraft {
  name: string;
  slug: string;
  color: string;
  logoEmoji: string;
  description: string;
  primaryCurrency: string;
  invoicePrefix: string;
  slaHours: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EMPTY_DRAFT: BrandDraft = {
  name: "", slug: "", color: "#ea580c", logoEmoji: "✨",
  description: "", primaryCurrency: "IDR", invoicePrefix: "", slaHours: "24",
};

// ============ Sub-komponen kecil ============

function BrandCard({ brand }: { brand: Brand }) {
  const services = BRAND_SERVICES[brand.slug] ?? [];
  return (
    <div className="flex flex-col rounded-xl border bg-white p-5 shadow-sm transition-colors hover:border-zinc-300">
      <div className="flex items-start gap-3">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-3xl"
          style={{ backgroundColor: `${brand.color}1a` }}
          aria-hidden
        >
          {brand.logoEmoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold text-zinc-900">{brand.name}</p>
            {!brand.active ? <Badge variant="outline" className="border-transparent bg-zinc-100 px-1.5 text-zinc-500">Nonaktif</Badge> : null}
          </div>
          <p className="truncate font-mono text-xs text-zinc-500">{brand.slug}</p>
          {brand.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{brand.description}</p>
          ) : null}
        </div>
      </div>

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
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Layanan {brand.name}</p>
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
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

// ============ Module utama ============

export default function BrandsModule() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<BrandDraft>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<BrandDraft | null>(null);

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

  useEffect(() => { void load(); }, [load]);

  const allServices = useMemo(() => {
    const set = new Set<string>();
    Object.values(BRAND_SERVICES).forEach((arr) => arr.forEach((s) => set.add(s)));
    return Array.from(set);
  }, []);

  const filteredBrands = useMemo(() => {
    if (!serviceFilter || serviceFilter === "all") return brands ?? [];
    return (brands ?? []).filter((b) => (BRAND_SERVICES[b.slug] ?? []).includes(serviceFilter));
  }, [brands, serviceFilter]);

  function handleNameChange(name: string) {
    setDraft((d) => ({ ...d, name, slug: slugify(name) }));
  }

  function submitDraft(e: React.FormEvent) {
    e?.preventDefault();
    if (!draft.name.trim()) { toast.error("Nama brand wajib diisi"); return; }
    if (!draft.slug.trim()) { toast.error("Slug brand wajib diisi"); return; }
    const sla = Number(draft.slaHours);
    if (!Number.isFinite(sla) || sla <= 0) { toast.error("SLA harus angka jam yang valid"); return; }
    // Endpoint POST /api/brands belum tersedia — tampilkan pratinjau lokal + info fase berikutnya.
    setPreview(draft);
    setCreateOpen(false);
    toast.info("Konfigurasi brand baru tersedia di fase berikutnya — struktur DB sudah siap");
  }

  if (loading && brands === null) return <BrandsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">Brand Configuration</h1>
          <p className="text-sm text-zinc-500">Tambah brand baru tanpa mengubah source code</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Muat ulang daftar brand">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /> Muat ulang
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} aria-label="Tambah brand baru">
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
        {filteredBrands.map((b) => <BrandCard key={b.id} brand={b} />)}

        {/* Pratinjau brand baru (lokal) */}
        {preview ? (
          <div className="flex flex-col rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-3xl" style={{ backgroundColor: `${preview.color}1a` }} aria-hidden>
                {preview.logoEmoji || "✨"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-zinc-900">{preview.name || "Brand Baru"}</p>
                <p className="truncate font-mono text-xs text-zinc-500">{preview.slug || "-"}</p>
                {preview.description ? <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{preview.description}</p> : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-zinc-600">
                <span className="h-3 w-3 rounded-full border border-zinc-200" style={{ backgroundColor: preview.color }} aria-hidden />
                <span className="font-mono">{preview.color}</span>
              </span>
              <Badge variant="outline" className="border-transparent bg-zinc-100 text-zinc-600">{preview.primaryCurrency}</Badge>
              {preview.invoicePrefix ? <Badge variant="outline" className="border-transparent bg-zinc-100 font-mono text-zinc-600">{preview.invoicePrefix}</Badge> : null}
              <Badge variant="outline" className="border-transparent bg-amber-50 text-amber-700">
                <Clock3 className="h-3 w-3" aria-hidden /> SLA {preview.slaHours || "0"} jam
              </Badge>
            </div>
            <p className="mt-auto pt-4 text-[11px] font-medium text-emerald-700">
              Pratinjau lokal — penyimpanan brand baru tersedia di fase berikutnya.
            </p>
          </div>
        ) : null}

        {/* Kartu tambah */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Tambah brand baru"
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 p-5 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-600"
        >
          <Plus className="h-8 w-8" aria-hidden />
          <span className="text-sm font-semibold">Tambah Brand</span>
          <span className="max-w-[220px] text-center text-xs">Definisikan brand, warna, SLA, dan prefix invoice</span>
        </button>
      </div>

      {/* Konfigurasi pipeline standar (pengganti template follow-up yang endpoint-nya belum ada) */}
      <section aria-label="Konfigurasi pipeline standar" className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <Wand2 className="h-4 w-4 text-zinc-400" aria-hidden /> Konfigurasi Pipeline Standar (12 Stage)
          </h2>
          <p className="text-xs text-zinc-500">
            Acuan baku dari lead baru hingga deal — dipakai sebagai template aktivitas follow-up di semua brand.
            Daftar template follow-up siap pakai akan tersedia di fase berikutnya.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PIPELINE_STAGES.map((s, i) => <PipelineStageCard key={s.key} stage={s} index={i} />)}
        </div>
      </section>

      {/* Dialog tambah brand */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tambah Brand Baru</DialogTitle>
            <DialogDescription>
              Struktur database sudah siap. Penyimpanan brand baru akan diaktifkan di fase berikutnya — untuk sekarang Anda mendapat pratinjau konfigurasi.
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
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
                <Label htmlFor="brand-emoji">Logo Emoji</Label>
                <Input
                  id="brand-emoji" value={draft.logoEmoji} maxLength={4}
                  onChange={(e) => setDraft((d) => ({ ...d, logoEmoji: e.target.value }))}
                  placeholder="✨"
                />
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
                <Label htmlFor="brand-currency">Currency</Label>
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
                  onChange={(e) => setDraft((d) => ({ ...d, invoicePrefix: e.target.value.toUpperCase() }))}
                  placeholder="ZTH-2026"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="brand-sla">SLA (jam)</Label>
                <Input
                  id="brand-sla" type="number" min={1} value={draft.slaHours}
                  onChange={(e) => setDraft((d) => ({ ...d, slaHours: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
              <Button type="submit" aria-label="Simpan pratinjau brand baru">Simpan Pratinjau</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
