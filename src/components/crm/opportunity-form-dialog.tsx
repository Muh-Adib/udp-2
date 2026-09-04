"use client";

/**
 * Ronde 35 — Form opportunity BERSAMA (satu komponen, dipakai di banyak tempat):
 * Sales Pipeline ("Peluang Baru"), dan dapat dipakai ulang modul lain.
 * Field-set identik dengan form konversi lead di Lead Inbox agar pengalaman
 * sales konsisten: brand, kontak, judul, kategori/layanan, prioritas,
 * estimasi nilai, owner, sumber lead, tanggal.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/crm/api-client";
import {
  BRAND_SERVICES, LEAD_SOURCES, PRIORITIES, SERVICE_CATEGORIES,
} from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type { ContactRef } from "@/lib/crm/types";

const PRIORITY_LABELS: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi", urgent: "Urgent" };

const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  animation: "Animasi", website: "Website", video: "Video",
  immersive: "Immersive / AR-VR", digital_marketing: "Digital Marketing",
};

const LEAD_SOURCE_LABELS: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  email: "Email",
  website: "Website",
  referral: "Referral",
  event: "Event",
  cold_outreach: "Cold Outreach",
  linkedin: "LinkedIn",
};

export default function OpportunityFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Dipanggil setelah opportunity berhasil dibuat. */
  onSaved?: () => void;
}) {
  const brands = useCrmStore((s) => s.brands);
  const user = useCrmStore((s) => s.user);

  const [contacts, setContacts] = useState<ContactRef[] | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Field form — urutan & label sama dengan form konversi lead di Inbox.
  const [brandId, setBrandId] = useState("");
  const [contactId, setContactId] = useState("");
  const [title, setTitle] = useState("");
  const [serviceCategory, setServiceCategory] = useState("none");
  const [serviceName, setServiceName] = useState("");
  const [priority, setPriority] = useState("medium");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [leadSource, setLeadSource] = useState("none");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [targetDeadline, setTargetDeadline] = useState("");
  const [brief, setBrief] = useState("");

  // Lazy: daftar kontak dimuat sekali saat dialog dibuka.
  useEffect(() => {
    if (!open) return;
    api.contacts()
      .then((res) => setContacts(res.contacts))
      .catch(() => {
        setContacts([]);
        toast.error("Gagal memuat daftar kontak");
      });
  }, [open]);

  // Reset setiap kali dialog dibuka.
  useEffect(() => {
    if (!open) return;
    setBrandId("");
    setContactId("");
    setTitle("");
    setServiceCategory("none");
    setServiceName("");
    setPriority("medium");
    setEstimatedValue("");
    setOwnerName(user?.name ?? "");
    setLeadSource("none");
    setExpectedCloseDate("");
    setTargetDeadline("");
    setBrief("");
    setContactQuery("");
  }, [open, user?.name]);

  const serviceNameOptions = useMemo(() => {
    const brand = brands.find((b) => b.id === brandId);
    return brand ? BRAND_SERVICES[brand.slug] ?? [] : [];
  }, [brandId, brands]);

  const contactOptions = useMemo(() => {
    const list = contacts ?? [];
    const q = contactQuery.trim().toLowerCase();
    if (!q) return list.slice(0, 100);
    return list
      .filter((c) =>
        `${c.fullName} ${c.email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 100);
  }, [contacts, contactQuery]);

  async function submit() {
    if (!user) {
      toast.error("Sesi tidak ditemukan — muat ulang halaman");
      return;
    }
    if (!brandId) { toast.error("Pilih brand untuk opportunity ini"); return; }
    if (!contactId) { toast.error("Pilih kontak yang terkait opportunity ini"); return; }
    if (!title.trim()) { toast.error("Judul opportunity wajib diisi"); return; }

    setSaving(true);
    try {
      const res = await api.createOpportunity({
        title: title.trim(),
        brandId,
        contactId,
        serviceCategory: serviceCategory === "none" ? undefined : serviceCategory,
        ...(serviceName ? { serviceName } : {}),
        priority,
        ...(estimatedValue.trim() !== "" && Number(estimatedValue) > 0 ? { estimatedValue: Number(estimatedValue) } : {}),
        ...(ownerName.trim() ? { ownerName: ownerName.trim() } : {}),
        ...(leadSource !== "none" ? { leadSource } : {}),
        ...(expectedCloseDate ? { expectedCloseDate } : {}),
        ...(targetDeadline ? { targetDeadline } : {}),
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        actorName: user.name,
        actorRole: user.role,
      });
      toast.success("Opportunity dibuat", {
        description: `${res.opportunity.title} — lanjutkan di pipeline: kirim estimasi & quotation.`,
      });
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat opportunity");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Peluang Baru</DialogTitle>
          <DialogDescription>
            Form sama seperti konversi lead di Inbox — opportunity langsung masuk pipeline stage New.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Brand <span className="text-rose-600">*</span></Label>
              <Select value={brandId} onValueChange={(v) => { setBrandId(v); setServiceName(""); }}>
                <SelectTrigger className="w-full" aria-label="Brand opportunity">
                  <SelectValue placeholder="Pilih brand" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioritas</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full" aria-label="Prioritas opportunity">
                  <SelectValue placeholder="Pilih prioritas" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABELS[p] ?? p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Kontak — cari dulu, lalu pilih (daftar dibatasi 100 agar ringan) */}
          <div className="space-y-1.5">
            <Label>Kontak <span className="text-rose-600">*</span></Label>
            <Input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Cari nama / email kontak…"
              aria-label="Cari kontak"
            />
            <Select
              value={contactId}
              onValueChange={setContactId}
              disabled={contacts === null}
            >
              <SelectTrigger className="w-full" aria-label="Pilih kontak">
                <SelectValue placeholder={contacts === null ? "Memuat kontak…" : "Pilih kontak"} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {contactOptions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-400">Tidak ada kontak cocok.</div>
                ) : (
                  contactOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName}{c.email ? ` · ${c.email}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oppf-title">Judul Opportunity <span className="text-rose-600">*</span></Label>
            <Input
              id="oppf-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Website company profile PT Maju"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kategori Layanan</Label>
              <Select value={serviceCategory} onValueChange={(v) => { setServiceCategory(v); setServiceName(""); }}>
                <SelectTrigger className="w-full" aria-label="Kategori layanan">
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{SERVICE_CATEGORY_LABELS[cat] ?? cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Layanan</Label>
              {serviceNameOptions.length > 0 ? (
                <Select value={serviceName || "none"} onValueChange={(v) => setServiceName(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full" aria-label="Layanan">
                    <SelectValue placeholder="Pilih layanan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Tanpa layanan spesifik</SelectItem>
                    {serviceNameOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-zinc-400">Pilih brand dengan katalog layanan terlebih dahulu.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="oppf-value">Estimasi Nilai (Rp)</Label>
              <Input
                id="oppf-value"
                type="number"
                min={0}
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                placeholder="cth. 25000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oppf-owner">Owner</Label>
              <Input
                id="oppf-owner"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Nama owner"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Sumber Lead</Label>
              <Select value={leadSource} onValueChange={setLeadSource}>
                <SelectTrigger className="w-full" aria-label="Sumber lead">
                  <SelectValue placeholder="Sumber" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tidak ditentukan</SelectItem>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oppf-close">Estimasi Close</Label>
              <Input id="oppf-close" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} aria-label="Estimasi tanggal close" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oppf-deadline">Target Deadline</Label>
              <Input id="oppf-deadline" type="date" value={targetDeadline} onChange={(e) => setTargetDeadline(e.target.value)} aria-label="Target deadline klien" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oppf-brief">Brief singkat (opsional)</Label>
            <Textarea
              id="oppf-brief"
              rows={2}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Kebutuhan klien dalam satu dua kalimat…"
              aria-label="Brief singkat opportunity"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={() => void submit()} disabled={saving || !brandId || !contactId || !title.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            {saving ? "Menyimpan…" : "Buat Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
