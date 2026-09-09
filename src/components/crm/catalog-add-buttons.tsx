"use client";

/**
 * Ronde 42 — Tambah Kategori & Layanan langsung dari form mana pun yang memilih
 * layanan (opportunity baru/edit, konversi lead di Inbox, dsb.).
 *
 * - Struktur mengikuti katalog yang ada: kategori baru ditempatkan di brand;
 *   layanan baru WAJIB memilih kategori (bisa "tanpa kategori" sesuai struktur).
 * - Harga dasar opsional — memicu perhitungan saran harga di estimasi.
 * - Server hanya mengizinkan super_admin/director: tombol disabled + tooltip
 *   otorisasi untuk role lain (konsisten dengan aturan satu pintu).
 */

import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/crm/api-client";
import type { ServiceCategoryDTO } from "@/lib/crm/types";

export function AddCatalogMenu({
  brandId,
  categories,
  onAdded,
  canEdit,
  categoryNameHint,
}: {
  brandId: string;
  /** Kategori live dari katalog brand (layanan baru memilih salah satunya). */
  categories: ServiceCategoryDTO[];
  /** Dipanggil setelah kategori/layanan berhasil dibuat — pemanggil refetch katalog. */
  onAdded: () => void | Promise<void>;
  /** true bila user boleh menulis katalog (director/super_admin). */
  canEdit: boolean;
  /** Label pilihan kategori default terpilih (mis. kategori yang sedang dipilih di form). */
  categoryNameHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"category" | "service">("service");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const triggerBtn = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-7 w-7 shrink-0 text-zinc-400 hover:border-zinc-400 hover:text-zinc-900"
      disabled={!canEdit}
      aria-label="Tambah kategori atau layanan baru"
    >
      <Plus className="size-3.5" aria-hidden />
    </Button>
  );

  if (!canEdit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{triggerBtn}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-56 text-[11px]" role="tooltip">
          Menambah kategori/layanan hanya oleh Direktur/Admin — minta mereka memperbarui katalog brand.
        </TooltipContent>
      </Tooltip>
    );
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Nama wajib diisi");
      return;
    }
    if (kind === "service" && !categoryId) {
      toast.error("Pilih kategori untuk layanan baru (sesuai struktur katalog)");
      return;
    }
    setSaving(true);
    try {
      if (kind === "category") {
        await api.brandServiceMutate(brandId, { kind: "category", name: trimmed }, "POST");
        toast.success(`Kategori "${trimmed}" ditambahkan ke katalog brand`);
      } else {
        const numeric = price.replace(/[^\d]/g, "");
        await api.brandServiceMutate(
          brandId,
          {
            kind: "service",
            name: trimmed,
            categoryId,
            basePrice: numeric ? Number(numeric) : null,
          },
          "POST"
        );
        toast.success(`Layanan "${trimmed}" ditambahkan`, {
          description: numeric
            ? "Harga dasar tersimpan — estimasi akan menawarkan saran harga dari katalog."
            : "Isi rincian biaya di Pengaturan Brand bila ingin saran harga otomatis.",
        });
      }
      setName("");
      setPrice("");
      setCategoryId("");
      setOpen(false);
      await onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menambahkan ke katalog");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && categoryNameHint) {
          const match = categories.find((c) => c.name === categoryNameHint);
          if (match) {
            setKind("service");
            setCategoryId(match.id);
          }
        }
      }}
    >
      <PopoverTrigger asChild>{triggerBtn}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <p className="text-xs font-semibold text-zinc-900">Tambah ke katalog brand</p>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={kind === "category" ? "default" : "outline"}
            className={`h-7 flex-1 text-xs ${kind === "category" ? "bg-zinc-900 hover:bg-zinc-800" : ""}`}
            onClick={() => setKind("category")}
          >
            Kategori
          </Button>
          <Button
            type="button"
            size="sm"
            variant={kind === "service" ? "default" : "outline"}
            className={`h-7 flex-1 text-xs ${kind === "service" ? "bg-zinc-900 hover:bg-zinc-800" : ""}`}
            onClick={() => setKind("service")}
          >
            Layanan
          </Button>
        </div>

        {kind === "service" ? (
          <div className="space-y-1.5">
            <Label className="text-[11px]">Kategori *</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Kategori layanan baru">
                <SelectValue placeholder="Pilih kategori sesuai struktur" />
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {categories.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-400">
                    Belum ada kategori — buat kategori dulu.
                  </div>
                ) : (
                  categories.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label className="text-[11px]">{kind === "category" ? "Nama kategori *" : "Nama layanan *"}</Label>
          <Input
            className="h-8 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "category" ? "mis. Video" : "mis. Company Profile Video"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            autoFocus
          />
        </div>

        {kind === "service" ? (
          <div className="space-y-1.5">
            <Label className="text-[11px]">Harga dasar (opsional)</Label>
            <Input
              className="h-8 text-xs"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="mis. 25000000 — jadi acuan saran harga estimasi"
            />
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 bg-zinc-900 text-xs hover:bg-zinc-800"
            disabled={saving || !name.trim()}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Check className="size-3" aria-hidden />}
            Tambah
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
