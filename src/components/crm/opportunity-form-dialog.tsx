"use client";

/**
 * Ronde 35 — Form opportunity BERSAMA (satu komponen, dipakai di banyak tempat):
 * Sales Pipeline ("Peluang Baru"), dan dapat dipakai ulang modul lain.
 * Field-set identik dengan form konversi lead di Lead Inbox agar pengalaman
 * sales konsisten: brand, kontak, judul, kategori/layanan, prioritas,
 * estimasi nilai, sumber lead, tanggal.
 * Ronde 40-C — kategori & layanan sinkron katalog live dari DB brand
 * (api.brandServices), fallback ke konstanta statis bila katalog kosong/gagal.
 * Field Owner dihapus: owner = pembuat, diisi server dari sesi.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { Loader2, Lock, Plus, Sparkles, UserPlus, Users } from "lucide-react";
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
import { FieldHintInLabel } from "@/components/crm/field-hint";
import { AddCatalogMenu } from "@/components/crm/catalog-add-buttons";
// Ronde 44 — form contact BERSAMA (identik dgn "Kontak Baru") + auto-estimasi dari saran harga
import {
  buildPhonePayload,
  buildWhatsappPayload,
  ContactFields,
  EMPTY_CONTACT_FORM,
  NO_VALUE,
  serviceSuggestedPrice,
  validateContactValues,
  type ContactFormValues,
} from "@/components/crm/contact-company-forms";
import { api } from "@/lib/crm/api-client";
import {
  BRAND_SERVICES, LEAD_SOURCES, PRIORITIES, SERVICE_CATEGORIES,
} from "@/lib/crm/constants";
import { useCrmStore } from "@/lib/crm/store";
import type { ContactRef, OpportunityDTO, ServiceCategoryDTO, ServiceDTO } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

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
  editData,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Dipanggil setelah opportunity berhasil dibuat. */
  onSaved?: () => void;
  /** Ronde 39 — bila terisi → mode EDIT (prefill + PATCH); brand/kontak tidak bisa diubah. */
  editData?: OpportunityDTO | null;
}) {
  const brands = useCrmStore((s) => s.brands);
  const user = useCrmStore((s) => s.user);
  const refreshBrands = useCrmStore((s) => s.refreshBrands);

  const [contacts, setContacts] = useState<ContactRef[] | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Ronde 44 — dua mode kontak: pilih existing ATAU buat baru inline (field identik Kontak Baru).
  const [contactMode, setContactMode] = useState<"existing" | "new">("existing");
  const [newContact, setNewContact] = useState<ContactFormValues>(EMPTY_CONTACT_FORM);
  // Ronde 44 — nilai estimasi terakhir yang di-auto-fill dari saran harga layanan.
  const [autoEstValue, setAutoEstValue] = useState("");

  // Ronde 40-C — katalog live dari DB brand (null = belum termuat/gagal → fallback statis).
  const [catalog, setCatalog] = useState<{ categories: ServiceCategoryDTO[]; services: ServiceDTO[] } | null>(null);

  // Field form — urutan & label sama dengan form konversi lead di Inbox.
  const [brandId, setBrandId] = useState("");
  const [contactId, setContactId] = useState("");
  const [title, setTitle] = useState("");
  const [serviceCategory, setServiceCategory] = useState("none");
  const [serviceName, setServiceName] = useState("");
  const [priority, setPriority] = useState("medium");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [leadSource, setLeadSource] = useState("none");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [targetDeadline, setTargetDeadline] = useState("");
  const [brief, setBrief] = useState("");

  // Lazy: daftar kontak dimuat sekali saat dialog dibuka.
  // Ronde 40-C — daftar brand bisa basi/kosong (brand baru dibuat setelah page mount)
  // → muat ulang dari server saat dialog dibuka bila store masih kosong.
  useEffect(() => {
    if (!open) return;
    if (useCrmStore.getState().brands.length === 0) void refreshBrands();
    api.contacts()
      .then((res) => setContacts(res.contacts))
      .catch(() => {
        setContacts([]);
        toast.error("Gagal memuat daftar kontak");
      });
  }, [open, refreshBrands]);

  // Reset setiap kali dialog dibuka — Ronde 39: mode edit prefill dari editData.
  useEffect(() => {
    if (!open) return;
    if (editData) {
      const d = (iso: string | null | undefined) => {
        try { return iso ? new Date(iso).toISOString().slice(0, 10) : ""; } catch { return ""; }
      };
      setBrandId(editData.brandId);
      setContactId(editData.contactId);
      setTitle(editData.title);
      setServiceCategory(editData.serviceCategory ?? "none");
      setServiceName(editData.serviceName ?? "");
      setPriority(editData.priority || "medium");
      setEstimatedValue(editData.estimatedValue != null ? String(editData.estimatedValue) : "");
      setLeadSource(editData.leadSource ?? "none");
      setExpectedCloseDate(d(editData.expectedCloseDate));
      setTargetDeadline(d(editData.targetDeadline));
      setBrief(editData.brief ?? "");
      setContactQuery("");
      return;
    }
    setBrandId("");
    setContactId("");
    setTitle("");
    setServiceCategory("none");
    setServiceName("");
    setPriority("medium");
    setEstimatedValue("");
    setLeadSource("none");
    setExpectedCloseDate("");
    setTargetDeadline("");
    setBrief("");
    setContactQuery("");
    setContactMode("existing"); // Ronde 44 — reset mode kontak tiap buka
    setNewContact(EMPTY_CONTACT_FORM);
    setAutoEstValue("");
  }, [open, editData]);

  // Ronde 40-C — katalog layanan live per brand: fetch saat brand berubah (guard cancel).
  useEffect(() => {
    if (!brandId) {
      setCatalog(null);
      return;
    }
    let cancelled = false;
    setCatalog(null);
    api.brandServices(brandId)
      .then((res) => {
        if (!cancelled) setCatalog({ categories: res.categories, services: res.services });
      })
      .catch(() => {
        if (!cancelled) setCatalog(null); // gagal → fallback statis di bawah
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  // Ronde 42 — refetch katalog setelah kategori/layanan baru ditambahkan dari form ini
  const reloadCatalog = useCallback(() => {
    if (!brandId) return;
    api.brandServices(brandId)
      .then((res) => setCatalog({ categories: res.categories, services: res.services }))
      .catch(() => {
        /* biarkan katalog lama */
      });
  }, [brandId]);

  const selectedBrand = useMemo(() => brands.find((b) => b.id === brandId), [brandId, brands]);

  // Ronde 42 — perubahan brand/kontak SATU PINTU: hanya Direktur/Admin.
  // Role lain melihat kartu terkunci + tooltip otorisasi (bukan input mati tanpa penjelasan).
  const canChangeLink = user?.role === "director" || user?.role === "super_admin";
  const editLocked = !!editData && !canChangeLink;
  const editContact = editData?.contact ?? null;

  // Kategori: nama kategori live dari katalog brand; fallback konstanta statis.
  // Saat edit, nilai lama tetap ditampilkan meski tidak ada di katalog (jangan hilangkan data).
  const kategoriOptions = useMemo(() => {
    const live = catalog && catalog.categories.length > 0
      ? catalog.categories.map((c) => c.name)
      : [...SERVICE_CATEGORIES];
    if (serviceCategory !== "none" && !live.includes(serviceCategory)) live.unshift(serviceCategory);
    return live;
  }, [catalog, serviceCategory]);

  // Layanan: semua nama layanan brand; bila kategori terpilih cocok dgn kategori katalog,
  // filter per kategori tsb. Nilai lama (mode edit) selalu ikut sebagai opsi.
  const serviceNameOptions = useMemo(() => {
    if (catalog) {
      const cat = catalog.categories.find((c) => c.name === serviceCategory);
      const list = (cat
        ? catalog.services.filter((s) => s.categoryId === cat.id)
        : catalog.services
      ).map((s) => s.name);
      return serviceName && !list.includes(serviceName) ? [serviceName, ...list] : list;
    }
    return selectedBrand ? BRAND_SERVICES[selectedBrand.slug] ?? [] : [];
  }, [catalog, serviceCategory, serviceName, selectedBrand]);

  const contactOptions = useMemo(() => {
    const list = contacts ?? [];
    const q = contactQuery.trim().toLowerCase();
    if (!q) return list.slice(0, 100);
    return list
      .filter((c) =>
        `${c.fullName} ${c.email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 100);
  }, [contacts, contactQuery]);

  // Ronde 40-C — saat kategori berubah, reset layanan hanya bila nilai lama
  // tidak lagi cocok dengan daftar layanan katalog untuk kategori baru.
  function handleCategoryChange(v: string) {
    setServiceCategory(v);
    if (catalog) {
      const cat = catalog.categories.find((c) => c.name === v);
      const list = (cat
        ? catalog.services.filter((s) => s.categoryId === cat.id)
        : catalog.services
      ).map((s) => s.name);
      if (serviceName && !list.includes(serviceName)) setServiceName("");
    } else {
      setServiceName("");
    }
  }

  // Ronde 44 — auto-fill Estimasi Nilai dari saran harga layanan (suggestedPrice ?? basePrice).
  // Menimpa hanya bila input kosong ATAU isian sebelumnya juga hasil auto-fill.
  function handleServiceSelect(v: string) {
    const next = v === "none" ? "" : v;
    const current = estimatedValue;
    const suggestion = serviceSuggestedPrice(catalog?.services, next);
    let nextValue = current;
    if (suggestion != null && (current.trim() === "" || current === autoEstValue)) {
      nextValue = String(suggestion);
      setAutoEstValue(nextValue);
    }
    setServiceName(next);
    setEstimatedValue(nextValue);
  }
  const estAutoFilled = estimatedValue.trim() !== "" && estimatedValue === autoEstValue;

  /** Ronde 44 — ganti mode kontak; prefill nama dari teks pencarian bila tampak seperti nama. */
  function switchContactMode(m: "existing" | "new") {
    setContactMode(m);
    if (m === "new" && contactQuery.trim() && !contactQuery.includes("@") && !newContact.firstName.trim()) {
      setNewContact((v) => ({ ...v, firstName: contactQuery.trim() }));
    }
  }

  async function submit() {
    if (!user) {
      toast.error("Sesi tidak ditemukan — muat ulang halaman");
      return;
    }
    // Ronde 39 — mode EDIT: brand & kontak tidak diubah kecuali oleh Direktur/Admin (Ronde 42).
    if (editData) {
      if (!title.trim()) { toast.error("Judul opportunity wajib diisi"); return; }
      setSaving(true);
      try {
        const res = await api.updateOpportunity(editData.id, {
          title: title.trim(),
          serviceCategory: serviceCategory === "none" ? null : serviceCategory,
          serviceName: serviceName.trim() || null,
          priority,
          estimatedValue: estimatedValue.trim() !== "" && Number(estimatedValue) > 0 ? Number(estimatedValue) : null,
          leadSource: leadSource === "none" ? null : leadSource,
          expectedCloseDate: expectedCloseDate || null,
          targetDeadline: targetDeadline || null,
          brief: brief.trim() || null,
          // Ronde 42 — kirim relasi hanya bila benar-benar berubah (server men-gate ke Direktur/Admin)
          ...(canChangeLink && brandId && brandId !== editData.brandId ? { brandId } : {}),
          ...(canChangeLink && contactId && contactId !== editData.contactId ? { contactId } : {}),
        });
        toast.success("Opportunity diperbarui", { description: res.opportunity.title });
        onOpenChange(false);
        onSaved?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan perubahan");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!brandId) { toast.error("Pilih brand untuk opportunity ini"); return; }
    if (!title.trim()) { toast.error("Judul opportunity wajib diisi"); return; }
    // Ronde 44 — mode "existing" butuh kontak terpilih; mode "new" butuh form contact valid.
    if (contactMode === "existing" && !contactId) {
      toast.error("Pilih kontak yang terkait opportunity ini");
      return;
    }
    if (contactMode === "new") {
      const vErr = validateContactValues(newContact);
      if (vErr) { toast.error(vErr); return; }
    }

    setSaving(true);
    try {
      // Ronde 44 — buat contact baru dulu (field identik Kontak Baru), lalu opportunity.
      let finalContactId = contactId;
      if (contactMode === "new") {
        const linkedCompany = newContact.companyId && newContact.companyId !== NO_VALUE;
        const created = await api.createContact({
          firstName: newContact.firstName.trim(),
          ...(newContact.lastName.trim() ? { lastName: newContact.lastName.trim() } : {}),
          ...(newContact.position.trim() ? { position: newContact.position.trim() } : {}),
          ...(newContact.email.trim() ? { email: newContact.email.trim() } : {}),
          whatsapp: buildWhatsappPayload(newContact.whatsappDial, newContact.whatsapp) || undefined,
          phone: buildPhonePayload(newContact.phoneDial, newContact.phone) || undefined,
          ...(linkedCompany
            ? { companyId: newContact.companyId }
            : { ...(newContact.companyName.trim() ? { companyName: newContact.companyName.trim() } : {}) }),
          ...(newContact.city.trim() ? { city: newContact.city.trim() } : {}),
          ...(newContact.country.trim() ? { country: newContact.country.trim() } : {}),
          ...(newContact.currency.trim() ? { currency: newContact.currency.trim() } : {}),
          preferredChannel: newContact.preferredChannel || "whatsapp",
          ...(newContact.instagram.trim() ? { instagram: newContact.instagram.trim() } : {}),
          ...(newContact.facebook.trim() ? { facebook: newContact.facebook.trim() } : {}),
          ...(newContact.tiktok.trim() ? { tiktok: newContact.tiktok.trim() } : {}),
          actorName: user.name,
          actorRole: user.role,
        });
        finalContactId = created.contact.id;
        toast.success(`Contact "${created.contact.fullName}" dibuat`, {
          description: "Kontak langsung tertaut ke opportunity ini.",
        });
      }
      const res = await api.createOpportunity({
        title: title.trim(),
        brandId,
        contactId: finalContactId,
        serviceCategory: serviceCategory === "none" ? undefined : serviceCategory,
        ...(serviceName ? { serviceName } : {}),
        priority,
        ...(estimatedValue.trim() !== "" && Number(estimatedValue) > 0 ? { estimatedValue: Number(estimatedValue) } : {}),
        // Owner tidak dikirim — server memakai aktor sesi sebagai owner (Ronde 40-C).
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
          <DialogTitle>{editData ? "Edit Peluang" : "Peluang Baru"}</DialogTitle>
          <DialogDescription>
            {editData
              ? canChangeLink
                ? "Perbarui detail peluang — sebagai Direktur/Admin Anda juga dapat mengubah brand/kontak."
                : "Perbarui detail peluang — brand & kontak terkunci (perubahan hanya oleh Direktur/Admin)."
              : "Form sama seperti konversi lead di Inbox — opportunity langsung masuk pipeline stage New."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Brand <span className="text-rose-600">*</span>
                <FieldHintInLabel
                  tip={
                    editData
                      ? canChangeLink
                        ? "Brand menentukan katalog layanan, tim, dan mata uang. Bisa diubah hanya oleh Direktur/Admin — katalog layanan ikut menyesuaikan."
                        : "Brand terkunci setelah peluang dibuat. Perubahan brand hanya oleh Direktur/Admin — hubungi mereka bila perlu."
                      : "Pemilik jasa yang menangani peluang ini — menentukan katalog layanan, tim, dan mata uang dokumen."
                  }
                />
              </Label>
              {editLocked ? (
                <div className="flex items-center gap-2 rounded-lg border bg-zinc-50 px-3 py-2 text-sm text-zinc-700" aria-label={`Brand terkunci: ${selectedBrand?.name ?? editData?.brand?.name ?? "-"}`}>
                  <Lock className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                  <span className="min-w-0 truncate font-medium">
                    {selectedBrand?.name ?? editData?.brand?.name ?? "-"}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-400">Direktur/Admin</span>
                </div>
              ) : (
                <Select value={brandId} onValueChange={(v) => { setBrandId(v); setServiceName(""); }} disabled={editLocked}>
                  <SelectTrigger className="w-full" aria-label="Brand opportunity">
                    <SelectValue placeholder="Pilih brand" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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

          {/* Kontak — Ronde 42: SATU PINTU. Mode edit non-pimpinan → kartu terkunci
              (input pencarian redundan dihapus). Direktur/Admin tetap bisa mengganti. */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              Kontak <span className="text-rose-600">*</span>
              <FieldHintInLabel
                tip={
                  editData
                    ? canChangeLink
                      ? "Kontak utama peluang (bisa diganti Direktur/Admin). Pesan, quotation, dan invoice mengikuti kontak ini."
                      : "Kontak terkunci setelah peluang dibuat. Perubahan kontak hanya oleh Direktur/Admin — satu pintu agar data konsisten."
                    : "Cari nama/email lalu pilih kontak terkait — pesan, quotation, dan invoice mengikuti kontak ini."
                }
              />
            </Label>
            {editLocked ? (
              <div className="flex items-center gap-2 rounded-lg border bg-zinc-50 px-3 py-2 text-sm text-zinc-700" aria-label={`Kontak terkunci: ${editContact?.fullName ?? "-"}`}>
                <Lock className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="min-w-0 truncate font-medium">{editContact?.fullName ?? "-"}</span>
                {editContact?.email ? <span className="min-w-0 truncate text-xs text-zinc-400">{editContact.email}</span> : null}
                <span className="ml-auto shrink-0 text-[10px] text-zinc-400">Direktur/Admin</span>
              </div>
            ) : (
              <>
                {/* Ronde 44 — dua mode: pilih kontak existing ATAU buat kontak baru inline.
                    Field buat-kontak-baru identik dgn "Kontak Baru" modul Contacts. */}
                {!editData ? (
                  <div className="flex items-center gap-1 rounded-lg border bg-zinc-100 p-0.5" role="tablist" aria-label="Mode kontak">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={contactMode === "existing"}
                      onClick={() => switchContactMode("existing")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        contactMode === "existing" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                      )}
                    >
                      <Users className="size-3.5" aria-hidden /> Kontak Existing
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={contactMode === "new"}
                      onClick={() => switchContactMode("new")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        contactMode === "new" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                      )}
                    >
                      <UserPlus className="size-3.5" aria-hidden /> Buat Kontak Baru
                    </button>
                  </div>
                ) : null}
                {contactMode === "new" ? (
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <ContactFields
                      mode="create"
                      values={newContact}
                      onChange={(patch) => setNewContact((v) => ({ ...v, ...patch }))}
                      companies={[]}
                    />
                  </div>
                ) : (
                  <>
                    <Input
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      placeholder="Cari nama / email kontak…"
                      aria-label="Cari kontak"
                    />
                    <Select
                      value={contactId}
                      onValueChange={setContactId}
                      disabled={contacts === null || (!!editData && !canChangeLink)}
                    >
                      <SelectTrigger className="w-full" aria-label="Pilih kontak">
                        <SelectValue placeholder={contacts === null ? "Memuat kontak…" : "Pilih kontak"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {contactOptions.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-zinc-400">Tidak ada kontak cocok — pindah ke “Buat Kontak Baru”.</div>
                        ) : (
                          contactOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.fullName}{c.email ? ` · ${c.email}` : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oppf-title" className="flex items-center gap-1">
              Judul Opportunity <span className="text-rose-600">*</span>
              <FieldHintInLabel tip="Nama pekerjaan/kampanye yang tampil di pipeline, quotation, dan project — buat spesifik (mis. “Website company profile PT Maju”)." />
            </Label>
            <Input
              id="oppf-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Website company profile PT Maju"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="flex items-center gap-1">
                  Kategori Layanan
                  <FieldHintInLabel tip="Grup besar jasa brand (mis. Video, Website). Daftar mengikuti katalog brand — pilih dulu agar pilihan layanan ter-filter." />
                </Label>
                {/* Ronde 42 — tambah kategori/layanan baru langsung dari sini (Direktur/Admin) */}
                <AddCatalogMenu
                  brandId={brandId}
                  categories={catalog?.categories ?? []}
                  onAdded={reloadCatalog}
                  canEdit={canChangeLink && !!brandId}
                  categoryNameHint={serviceCategory !== "none" ? serviceCategory : undefined}
                />
              </div>
              <Select value={serviceCategory} onValueChange={handleCategoryChange}>
                <SelectTrigger className="w-full" aria-label="Kategori layanan">
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {kategoriOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>{SERVICE_CATEGORY_LABELS[cat] ?? cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Layanan
                <FieldHintInLabel tip="Jasa spesifik dari katalog brand — dipakai sebagai template estimasi (saran harga) dan workflow produksi project nantinya." />
              </Label>
              {serviceNameOptions.length > 0 ? (
                <Select value={serviceName || "none"} onValueChange={handleServiceSelect}>
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
              <Label htmlFor="oppf-value" className="flex items-center gap-1">
                Estimasi Nilai ({selectedBrand?.primaryCurrency ?? "IDR"})
                <FieldHintInLabel tip="Perkiraan nilai kontrak awal — boleh dikosongkan bila belum diketahui; akan dipatenkan lewat estimasi & quotation." />
              </Label>
              <Input
                id="oppf-value"
                type="number"
                min={0}
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                placeholder="cth. 25000000"
              />
              {estAutoFilled ? (
                <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                  <Sparkles className="size-3" aria-hidden="true" />
                  Terisi otomatis dari saran harga layanan {serviceName} — masih bisa diubah.
                </p>
              ) : null}
            </div>
            {/* Ronde 40-C — field Owner dihapus: owner = pembuat (diisi server dari sesi). */}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Sumber Lead
                <FieldHintInLabel tip="Dari mana peluang ini berasal (IG, WA, referral, event…) — dipakai untuk laporan performa kanal marketing." />
              </Label>
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
              <Label htmlFor="oppf-close" className="flex items-center gap-1">
                Estimasi Close
                <FieldHintInLabel tip="Perkiraan tanggal deal — dipakai forecast pipeline bulanan." />
              </Label>
              <Input id="oppf-close" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} aria-label="Estimasi tanggal close" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oppf-deadline" className="flex items-center gap-1">
                Target Deadline
                <FieldHintInLabel tip="Tenggat yang diminta klien untuk hasil akhir — acuan penjadwalan produksi." />
              </Label>
              <Input id="oppf-deadline" type="date" value={targetDeadline} onChange={(e) => setTargetDeadline(e.target.value)} aria-label="Target deadline klien" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oppf-brief" className="flex items-center gap-1">
              Brief singkat (opsional)
              <FieldHintInLabel tip="Ringkasan kebutuhan klien 1–2 kalimat — bantuan konteks untuk estimasi & produksi. Brief lengkap dibuat di tab Brief." />
            </Label>
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
          <Button
            onClick={() => void submit()}
            disabled={saving || !title.trim() || (!editData && (!brandId || (contactMode === "existing" && !contactId)))}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            {saving ? "Menyimpan…" : editData ? "Simpan Perubahan" : "Buat Opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
