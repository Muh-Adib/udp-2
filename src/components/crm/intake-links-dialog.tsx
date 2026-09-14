"use client";

/**
 * Ronde 57 — Dialog "Formulir Lead Publik" (Sales Pipeline).
 * Buat & kelola shareable intake link per brand: URL publik /?intake=<token>
 * diberikan ke calon lead (bisa lewat WhatsApp/email/sosmed). Setiap submit
 * otomatis membuat Company (+alamat) + Contact + Opportunity (stage New) +
 * draft Brief — tanpa login, brand sudah terkunci sesuai link.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy, ExternalLink, Loader2, Link2, Plus, RefreshCw, Trash2, TriangleAlert,
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
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import type { Brand, IntakeLinkDTO } from "@/lib/crm/types";
import { formatDateTime } from "@/lib/crm/utils";

interface IntakeLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dipanggil setelah ada perubahan link (mis. pipeline ingin refetch). */
  onChanged?: () => void;
}

export default function IntakeLinksDialog({ open, onOpenChange, onChanged }: IntakeLinksDialogProps) {
  const user = useCrmStore((s) => s.user);
  const storeBrands = useCrmStore((s) => s.brands);
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [links, setLinks] = useState<IntakeLinkDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form buat link baru
  const [brandId, setBrandId] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [linkRes, brandRes] = await Promise.all([
        api.intakeLinks(),
        storeBrands.length > 0 ? Promise.resolve({ brands: storeBrands }) : api.brands(),
      ]);
      setLinks(linkRes.links);
      setBrands(brandRes.brands);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat link formulir");
    } finally {
      setLoading(false);
    }
  }, [storeBrands]);

  // Muat tiap kali dialog dibuka — brand default: filter aktif → brand pertama.
  useEffect(() => {
    if (!open) return;
    void load();
    if (storeBrands.length > 0) {
      setBrandId((prev) => prev || (activeBrandFilter !== "all" ? activeBrandFilter : storeBrands[0].id));
    }
  }, [open, load, storeBrands, activeBrandFilter]);

  const brandOptions = useMemo(
    () => (brands.length > 0 ? brands : storeBrands),
    [brands, storeBrands],
  );

  const createLink = async () => {
    if (!brandId) { toast.error("Pilih brand untuk link ini"); return; }
    setCreating(true);
    try {
      const res = await api.createIntakeLink({ brandId, ...(label.trim() ? { label: label.trim() } : {}) });
      toast.success("Link formulir dibuat", { description: "Bagikan URL publik ke calon lead." });
      setLabel("");
      setLinks((prev) => [res.link, ...prev]);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat link");
    } finally {
      setCreating(false);
    }
  };

  const copyUrl = async (link: IntakeLinkDTO) => {
    const url = `${window.location.origin}/?intake=${link.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL disalin", { description: url });
    } catch {
      // Fallback: tampilkan di prompt bila clipboard API diblok (iframe/HTTP lama)
      toast.info("Salin URL berikut", { description: url, duration: 10000 });
    }
  };

  const openUrl = (link: IntakeLinkDTO) => {
    window.open(`/?intake=${link.token}`, "_blank", "noopener");
  };

  const toggleActive = async (link: IntakeLinkDTO, active: boolean) => {
    setBusyId(link.id);
    try {
      const res = await api.updateIntakeLink(link.id, { active });
      setLinks((prev) => prev.map((l) => (l.id === link.id ? res.link : l)));
      toast.success(active ? "Link diaktifkan" : "Link dimatikan — URL tidak bisa diakses lagi");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah status link");
    } finally {
      setBusyId(null);
    }
  };

  const removeLink = async (link: IntakeLinkDTO) => {
    setBusyId(link.id);
    try {
      await api.deleteIntakeLink(link.id);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      toast.success("Link dihapus permanen");
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus link");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto crm-scroll sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4.5" aria-hidden="true" />
            Formulir Lead Publik
          </DialogTitle>
          <DialogDescription>
            Bagikan link ke calon lead — form sudah terkunci per brand. Setiap pengisian otomatis
            membuat perusahaan + kontak + peluang baru + draft brief di pipeline Anda.
          </DialogDescription>
        </DialogHeader>

        {/* Buat link baru */}
        <div className="space-y-3 rounded-xl border bg-zinc-50 p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <Plus className="size-3.5" aria-hidden="true" /> Buat Link Baru
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-600">Brand <span className="text-rose-600">*</span></Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger aria-label="Pilih brand untuk link">
                  <SelectValue placeholder="Pilih brand…" />
                </SelectTrigger>
                <SelectContent>
                  {brandOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: b.color }} aria-hidden="true" />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-600">Label (opsional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Mis. Iklan IG Mei" maxLength={120} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={createLink} disabled={creating || !brandId}>
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
              Buat Link
            </Button>
          </div>
        </div>

        {/* Daftar link */}
        {loading ? (
          <div className="space-y-2" aria-label="Memuat link">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : links.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-zinc-500" role="status">
            <Link2 className="mx-auto mb-2 size-8 text-zinc-300" aria-hidden="true" />
            Belum ada link formulir — buat link pertama di atas.
          </div>
        ) : (
          <ul className="crm-scroll max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Daftar link formulir">
            {links.map((link) => (
              <li
                key={link.id}
                className={`rounded-xl border bg-white p-3 shadow-sm transition-colors ${link.active ? "" : "opacity-60"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: link.brand?.color ?? "#a1a1aa" }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-zinc-900">{link.brand?.name ?? "Brand"}</span>
                  {link.label ? <Badge variant="secondary" className="bg-zinc-100 text-zinc-600">{link.label}</Badge> : null}
                  <span className="ml-auto flex items-center gap-2">
                    <span
                      className="text-xs text-zinc-500"
                      title={link.lastSubmissionAt ? `Terakhir masuk ${formatDateTime(link.lastSubmissionAt)}` : undefined}
                    >
                      {link.submissionCount} masuk
                    </span>
                    {busyId === link.id ? (
                      <Loader2 className="size-4 animate-spin text-zinc-400" aria-hidden="true" />
                    ) : null}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="crm-scroll min-w-0 flex-1 truncate rounded-md border bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-zinc-600" title={`/?intake=${link.token}`}>
                    /?intake={link.token.slice(0, 14)}…
                  </code>
                  <Button size="icon" variant="outline" className="size-8" aria-label="Salin URL formulir" title="Salin URL" onClick={() => copyUrl(link)}>
                    <Copy className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button size="icon" variant="outline" className="size-8" aria-label="Buka formulir di tab baru" title="Buka form" onClick={() => openUrl(link)}>
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8 text-rose-600 hover:bg-rose-50"
                    aria-label="Hapus link permanen"
                    title="Hapus link"
                    onClick={() => removeLink(link)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                  <span className="ml-1 flex items-center gap-1.5" title={link.active ? "Aktif — bisa diisi calon lead" : "Dimatikan — URL tidak bisa diakses"}>
                    <Switch
                      checked={link.active}
                      onCheckedChange={(v) => toggleActive(link, v)}
                      aria-label={link.active ? "Matikan link" : "Aktifkan link"}
                    />
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Dibuat {formatDateTime(link.createdAt)}{link.createdByName ? ` oleh ${link.createdByName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-lg border bg-amber-50 px-3 py-2.5 text-[11px] leading-snug text-amber-800" role="note">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            URL memuat token rahasia — siapa pun yang punya link dapat mengirim lead ke pipeline.
            Jangan bagikan di tempat publik; matikan (switch) bila link bocor.
          </span>
        </div>

        <DialogFooter className="items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Muat ulang daftar link">
            <RefreshCw className="size-3.5" aria-hidden="true" /> Muat ulang
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Selesai</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
