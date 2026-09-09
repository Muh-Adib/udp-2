"use client";

/**
 * Ronde 44 — SATU SUMBER form Contact & Perusahaan (shared).
 *
 * Sebelumnya tiga tempat punya form contact masing-masing dengan field berbeda:
 * modul Contacts ("Kontak Baru"), modal Konversi Lead (Inbox), dan Peluang Baru
 * (Pipeline). Kini semuanya memakai `ContactFields` + `CompanyDetailModal` dari
 * file ini sehingga input selalu identik & pemeliharaan satu tempat:
 *
 * - `ContactFields`    : field-set lengkap Kontak Baru (dial-code WA/telepon,
 *                        negara→mata uang, kanal preferensi, medsos, tag).
 *                        Mode create memunculkan modal Detail Perusahaan saat
 *                        pengguna mengisi nama perusahaan baru (blur / tombol).
 * - `CompanyDetailModal` : modal detail perusahaan (industri, website, negara,
 *                        kota, ukuran, mata uang default) — cek duplikat by name,
 *                        pakai existing bila sudah ada, buat baru bila belum.
 * - Helper payload/validasi dipakai bersama (E.164, error email/nomor).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Building2, Check, ChevronDown, Loader2, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CountryCombobox, CurrencySelect } from "@/components/crm/country-combobox";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import { COUNTRIES } from "@/lib/crm/countries";
import { CHANNELS } from "@/lib/crm/constants";
import { normalizePhone } from "@/lib/crm/utils";
import { emailError, nationalPhoneError } from "@/lib/crm/validate";
import type { ServiceDTO } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

// ============ Bentuk data form ============

/** Ronde 44 — bentuk form contact BERSAMA (identik dgn "Kontak Baru" modul Contacts). */
export interface ContactFormValues {
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  whatsapp: string;
  /** Kode negara terpilih utk WhatsApp ("+62") atau "" = tanpa kode (legacy). */
  whatsappDial: string;
  phone: string;
  /** Kode negara utk Telepon — bisa berbeda dari negara kontak (WNI pakai nomor MY dll). */
  phoneDial: string;
  companyName: string;
  /** ID perusahaan tertaut (hasil modal Detail Perusahaan) atau "none"/"". */
  companyId: string;
  city: string;
  country: string;
  /** Mata uang preferensi kontak (ISO 4217); otomatis mengikuti negara, bisa dioverride. */
  currency: string;
  preferredChannel: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  tagsText: string;
}

export const EMPTY_CONTACT_FORM: ContactFormValues = {
  firstName: "",
  lastName: "",
  position: "",
  email: "",
  whatsapp: "",
  whatsappDial: "",
  phone: "",
  phoneDial: "",
  companyName: "",
  companyId: "none",
  city: "",
  country: "",
  currency: "",
  preferredChannel: "whatsapp",
  instagram: "",
  facebook: "",
  tiktok: "",
  tagsText: "",
};

/** Bentuk form detail perusahaan (modal). */
export interface CompanyFormValues {
  name: string;
  industry: string;
  website: string;
  country: string;
  city: string;
  size: string;
  defaultCurrency: string;
}

export const EMPTY_COMPANY_FORM: CompanyFormValues = {
  name: "",
  industry: "",
  website: "",
  country: "",
  city: "",
  size: "none",
  defaultCurrency: "IDR",
};

export const NO_VALUE = "none";

const SIZE_OPTIONS = [
  { value: "startup", label: "Startup" },
  { value: "sme", label: "SME" },
  { value: "enterprise", label: "Enterprise" },
  { value: "government", label: "Government" },
];

const CURRENCY_OPTIONS = [
  { value: "IDR", label: "IDR — Rupiah" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "SGD", label: "SGD — Dollar Singapura" },
];

// ============ Helper payload nomor & validasi (dipakai lintas form) ============

/**
 * Gabung dial + nomor nasional utk payload WhatsApp.
 * Tanpa dial → raw dipertahankan (server tetap normalisasi legacy 0xx → 62xx).
 */
export function buildWhatsappPayload(dial: string, national: string): string | null {
  const raw = (national ?? "").trim();
  if (!raw) return null;
  if (!dial) return raw;
  return normalizePhone(raw, dial) ?? raw;
}

/** Sama dgn WhatsApp, tapi utk field Telepon (dial terpisah dari negara). */
export function buildPhonePayload(dial: string, national: string): string | null {
  return buildWhatsappPayload(dial, national);
}

/**
 * Pisah nomor tersimpan menjadi { dial, national } utk prefill form.
 * "+628123456789" → { dial: "+62", national: "8123456789" }; nomor lokal (08…)
 * yang tidak cocok dial mana pun tetap utuh tanpa kode. Sisa nomor nasional
 * minimal 6 digit agar nomor pendek tidak salah potong.
 */
export function splitPhoneParts(full: string): { dial: string; national: string } {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return { dial: "", national: "" };
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return { dial: "", national: trimmed };
  const candidates = COUNTRIES.filter((c) => digits.startsWith(c.dial.slice(1)))
    .sort((a, b) => b.dial.length - a.dial.length);
  const best = candidates[0];
  // sisa nomor harus cukup panjang agar nomor lokal pendek tidak salah potong
  if (best && digits.length - (best.dial.length - 1) >= 6) {
    return { dial: best.dial, national: digits.slice(best.dial.length - 1) };
  }
  return { dial: "", national: trimmed };
}

/** Preview E.164 di bawah input WhatsApp (mis. "+6281234567890"). */
export function whatsappE164Preview(dial: string, national: string): string | null {
  const raw = (national ?? "").trim();
  if (!raw) return null;
  if (dial) {
    const n = normalizePhone(raw, dial);
    return n ? `+${n}` : null;
  }
  if (raw.replace(/\D/g, "").startsWith("0")) {
    const n = normalizePhone(raw);
    return n ? `+${n}` : null;
  }
  return null;
}

/**
 * Validasi lengkap form contact — pesan error pertama, atau null bila lolos.
 * Nama depan wajib + format email + nomor WA/telepon (aturan Ronde 42).
 */
export function validateContactValues(v: ContactFormValues): string | null {
  if (!v.firstName.trim()) return "Nama depan wajib diisi";
  const vEmail = emailError(v.email);
  if (vEmail) return vEmail;
  const vWa = nationalPhoneError(v.whatsapp, !v.whatsappDial);
  if (vWa) return `WhatsApp: ${vWa}`;
  const vPhone = nationalPhoneError(v.phone, !v.phoneDial);
  if (vPhone) return `Telepon: ${vPhone}`;
  return null;
}

/**
 * Ronde 44 — saran harga layanan dari katalog brand (dipakai auto-fill Estimasi Nilai
 * di Konversi Lead & Peluang Baru): suggestedPrice ?? basePrice, null bila tidak ada.
 */
export function serviceSuggestedPrice(services: ServiceDTO[] | null | undefined, serviceName: string): number | null {
  if (!services || !serviceName) return null;
  const s = services.find((x) => x.name === serviceName);
  if (!s) return null;
  const price = s.suggestedPrice ?? s.basePrice;
  return typeof price === "number" && price > 0 ? price : null;
}

// ============ Elemen kecil ============

/** Wrapper field (label + kontrol) — padanan FormField di modul Contacts. */
function CrmField({
  label,
  required,
  className,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1 text-xs font-medium text-zinc-600">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      {children}
    </div>
  );
}

/** Ronde 44 — judul section kecil (Media Sosial / Detail Perusahaan). */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </h4>
  );
}

// ============ Combobox kode dial negara ============

/** Combobox kode negara (dial) utk nomor WhatsApp/Telepon. Value = "+62" | "" (tanpa kode). */
export function DialCodeCombobox({
  value,
  onSelect,
  disabled,
}: {
  value: string;
  onSelect: (dial: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Kode negara nomor telepon"
          disabled={disabled}
          className={cn("w-full justify-between px-2.5 font-normal", !value && "text-zinc-400")}
        >
          <span className="min-w-0 truncate text-left">{value || "Kode"}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(18rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari kode/negara…" />
          <CommandList className="crm-scroll max-h-64">
            <CommandEmpty>Tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="tanpa kode negara"
                onSelect={() => {
                  onSelect("");
                  setOpen(false);
                }}
              >
                <Check className={cn("size-4 shrink-0", !value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                <span className="text-zinc-500">Tanpa kode negara</span>
              </CommandItem>
              {COUNTRIES.map((c) => (
                <CommandItem
                  key={c.iso2}
                  value={`${c.name} ${c.dial} ${c.currency}`}
                  onSelect={() => {
                    onSelect(c.dial);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4 shrink-0", value === c.dial ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="w-12 shrink-0 font-medium tabular-nums">{c.dial}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============ Modal Detail Perusahaan ============

/**
 * Perusahaan yang dihasilkan modal (struktur minimum yang dipakai pemanggil;
 * detail opsional ikut dikirim agar daftar opsi pemanggil bisa diperbarui tanpa refetch).
 */
export type SavedCompany = {
  id: string;
  name: string;
  industry?: string | null;
  website?: string | null;
  country?: string | null;
  city?: string | null;
  size?: string | null;
  defaultCurrency?: string;
};

/**
 * Ronde 45 — opsi perusahaan utk autocomplete & modal edit. Semua field selain
 * id/name opsional sehingga pemanggil bisa mengirim daftar ringkas maupun lengkap
 * (CompanyRecord modul Contacts kompatibel secara struktural).
 */
export interface CompanyOption {
  id: string;
  name: string;
  industry?: string | null;
  website?: string | null;
  country?: string | null;
  city?: string | null;
  size?: string | null;
  defaultCurrency?: string;
}

/**
 * Ronde 44 — Modal detail perusahaan: muncul saat menambah perusahaan baru
 * (Kontak Baru, Konversi Lead, Peluang Baru) supaya perusahaan tersimpan lengkap
 * (industri, website, negara, kota, ukuran, mata uang) — bukan cuma namanya.
 * Simpan = pakai existing bila nama sudah ada (anti duplikat), buat baru bila belum.
 *
 * Ronde 45 — mode EDIT: kirim `editCompany` utk memperbarui perusahaan existing
 * (prefill semua field, simpan = PATCH /api/companies/:id). Dipakai tombol Edit
 * di modul Contacts (tabel & detail sheet) dan tombol "Edit" di form contact.
 */
export function CompanyDetailModal({
  open,
  onOpenChange,
  initial,
  onSaved,
  editCompany = null,
  onCompanyUpserted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nilai awal (mis. nama yang diketik user + negara/kota dari form contact) — mode create. */
  initial?: Partial<CompanyFormValues>;
  /** Dipanggil setelah perusahaan siap dipakai (existing atau baru dibuat). */
  onSaved: (company: SavedCompany) => void;
  /** Perusahaan yang diedit — null/undefined = mode create (perusahaan baru). */
  editCompany?: CompanyOption | null;
  /** Ronde 45 — notify pemanggil agar daftar perusahaan di modul ikut segar. */
  onCompanyUpserted?: (company: SavedCompany) => void;
}) {
  const user = useCrmStore((s) => s.user);
  const [values, setValues] = useState<CompanyFormValues>(EMPTY_COMPANY_FORM);
  const [saving, setSaving] = useState(false);
  const [currencyAutoSynced, setCurrencyAutoSynced] = useState(false);
  const isEdit = !!editCompany;

  // Simpan initial di ref agar reset saat open tidak bergantung identitas objek initial.
  const initialRef = useRef<Partial<CompanyFormValues>>(initial ?? {});
  initialRef.current = initial ?? {};

  useEffect(() => {
    if (open) {
      if (editCompany) {
        // Ronde 45 — mode edit: prefill dari data perusahaan existing.
        setValues({
          name: editCompany.name ?? "",
          industry: editCompany.industry ?? "",
          website: editCompany.website ?? "",
          country: editCompany.country ?? "",
          city: editCompany.city ?? "",
          size: editCompany.size || NO_VALUE,
          defaultCurrency: editCompany.defaultCurrency || "IDR",
        });
      } else {
        setValues({ ...EMPTY_COMPANY_FORM, ...initialRef.current });
      }
      setCurrencyAutoSynced(false);
    }
  }, [open]);

  function patch(p: Partial<CompanyFormValues>) {
    setValues((v) => ({ ...v, ...p }));
  }
  const setField = (key: keyof CompanyFormValues) => (value: string) => patch({ [key]: value } as Partial<CompanyFormValues>);

  const currencyOptions = useMemo(() => {
    const opts = [...CURRENCY_OPTIONS];
    if (values.defaultCurrency && !opts.some((o) => o.value === values.defaultCurrency)) {
      opts.push({ value: values.defaultCurrency, label: values.defaultCurrency });
    }
    return opts;
  }, [values.defaultCurrency]);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Ronde 44 — modal ini dirender via portal di dalam form pemanggil (mis. "Contact Baru").
    // Event React naik lewat fiber tree — tanpa stopPropagation, submit modal ikut
    // memicu onSubmit form induk (contact ter-create tanpa sengaja).
    e.stopPropagation();
    if (!values.name.trim()) {
      toast.error("Nama perusahaan wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editCompany) {
        // Ronde 45 — mode edit: PATCH perusahaan existing (server menolak nama duplikat).
        const res = await api.updateCompany(editCompany.id, {
          name: values.name.trim(),
          industry: values.industry.trim(),
          website: values.website.trim(),
          country: values.country.trim(),
          city: values.city.trim(),
          size: values.size === NO_VALUE ? "" : values.size,
          defaultCurrency: values.defaultCurrency,
          actorName: user?.name ?? "System",
        });
        toast.success(`Perubahan perusahaan "${res.company.name}" tersimpan`, {
          description: "Data baru berlaku untuk semua kontak, peluang & quotation yang tertaut.",
        });
        const saved: SavedCompany = {
          id: res.company.id,
          name: res.company.name,
          industry: res.company.industry ?? null,
          website: res.company.website ?? null,
          country: res.company.country ?? null,
          city: res.company.city ?? null,
          size: res.company.size ?? null,
          defaultCurrency: res.company.defaultCurrency,
        };
        onSaved(saved);
        onCompanyUpserted?.(saved);
        onOpenChange(false);
        return;
      }
      // Anti-duplikat: nama sama (case-insensitive) → pakai perusahaan existing.
      const nameLc = values.name.trim().toLowerCase();
      const existing = await api.companies();
      const match = existing.companies.find((c) => c.name.trim().toLowerCase() === nameLc);
      if (match) {
        toast.info(`Perusahaan "${match.name}" sudah ada — memakai data existing`, {
          description: "Detailnya bisa diperbarui lewat tombol Edit di modul Contacts › tab Perusahaan.",
        });
        onSaved({ id: match.id, name: match.name });
        onCompanyUpserted?.({ id: match.id, name: match.name });
        onOpenChange(false);
        return;
      }
      const res = await api.createCompany({
        name: values.name.trim(),
        industry: values.industry.trim() || undefined,
        website: values.website.trim() || undefined,
        country: values.country.trim() || undefined,
        city: values.city.trim() || undefined,
        size: values.size === NO_VALUE ? undefined : values.size,
        defaultCurrency: values.defaultCurrency,
        actorName: user?.name ?? "System",
      });
      toast.success(`Perusahaan "${res.company.name}" tersimpan lengkap`);
      const saved: SavedCompany = {
        id: res.company.id,
        name: res.company.name,
        industry: values.industry.trim() || null,
        website: values.website.trim() || null,
        country: values.country.trim() || null,
        city: values.city.trim() || null,
        size: values.size === NO_VALUE ? null : values.size,
        defaultCurrency: values.defaultCurrency,
      };
      onSaved(saved);
      onCompanyUpserted?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan perusahaan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto crm-scroll sm:max-w-lg" aria-label="Detail perusahaan">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white" aria-hidden="true">
              <Building2 className="size-3.5" />
            </span>
            {isEdit ? "Edit Perusahaan" : "Detail Perusahaan"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Perbarui data perusahaan — perubahan berlaku untuk semua kontak, peluang & quotation yang tertaut."
              : "Lengkapi data perusahaan sekarang — nanti tidak perlu mengisi ulang saat membuat quotation & invoice."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CrmField label="Nama perusahaan" required className="sm:col-span-2">
              <Input value={values.name} onChange={(e) => setField("name")(e.target.value)} placeholder="cth. PT Maju Jaya Abadi" disabled={saving} />
            </CrmField>
            <CrmField label="Industri">
              <Input value={values.industry} onChange={(e) => setField("industry")(e.target.value)} placeholder="cth. Perbankan" disabled={saving} />
            </CrmField>
            <CrmField label="Website">
              <Input value={values.website} onChange={(e) => setField("website")(e.target.value)} placeholder="cth. majujaya.co.id" disabled={saving} />
            </CrmField>
            <CrmField label="Negara">
              <CountryCombobox
                value={values.country}
                onSelect={(c) => {
                  // auto-sync: mata uang ikut negara — masih bisa dioverride manual
                  patch({ country: c.name, defaultCurrency: c.currency });
                  setCurrencyAutoSynced(true);
                }}
                disabled={saving}
              />
            </CrmField>
            <CrmField label="Kota">
              <Input value={values.city} onChange={(e) => setField("city")(e.target.value)} placeholder="cth. Bandung" disabled={saving} />
            </CrmField>
            <CrmField label="Ukuran">
              <Select value={values.size} onValueChange={setField("size")} disabled={saving}>
                <SelectTrigger className="w-full" aria-label="Pilih ukuran perusahaan">
                  <SelectValue placeholder="Pilih ukuran" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>— Tanpa ukuran —</SelectItem>
                  {SIZE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CrmField>
            <CrmField label="Mata uang default">
              <Select
                value={values.defaultCurrency}
                onValueChange={(v) => {
                  setField("defaultCurrency")(v);
                  setCurrencyAutoSynced(false);
                }}
                disabled={saving}
              >
                <SelectTrigger className="w-full" aria-label="Pilih mata uang default">
                  <SelectValue placeholder="Pilih mata uang" />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currencyAutoSynced && (
                <p className="text-[11px] text-zinc-400">Mata uang otomatis mengikuti negara</p>
              )}
            </CrmField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {isEdit ? "Batal" : "Lewati — nanti saja"}
            </Button>
            <Button type="submit" className="bg-zinc-900 text-white hover:bg-zinc-800" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : isEdit ? <Pencil className="size-4" /> : <Building2 className="size-4" />}
              {saving ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Simpan Perusahaan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ Field-set contact BERSAMA ============

/**
 * Field-set form contact — IDENTIK dengan "Kontak Baru" modul Contacts.
 * Dipakai modul Contacts, modal Konversi Lead (Inbox), dan Peluang Baru (Pipeline).
 *
 * Mode create: input nama perusahaan + modal Detail Perusahaan (muncul otomatis
 * saat blur dgn nama baru, atau lewat tombol "Detail") — perusahaan tertaut penuh.
 */
export function ContactFields({
  values,
  onChange,
  disabled,
  mode,
  companies = [],
  onCompanyUpserted,
}: {
  values: ContactFormValues;
  onChange: (patch: Partial<ContactFormValues>) => void;
  disabled?: boolean;
  mode: "create" | "edit";
  /**
   * Daftar perusahaan — mode edit (select + tombol Edit) & mode create
   * (autocomplete auto-text). Bila kosong di mode create, daftar diambil
   * otomatis dari /api/companies saat field perusahaan disentuh (lazy fetch).
   */
  companies?: CompanyOption[];
  /** Ronde 45 — notify pemanggil setelah perusahaan dibuat/diedit agar daftar modul ikut segar. */
  onCompanyUpserted?: (company: SavedCompany) => void;
}) {
  const setField = (key: keyof ContactFormValues) => (value: string) =>
    onChange({ [key]: value } as Partial<ContactFormValues>);

  // Ronde 44 — modal Detail Perusahaan (create & edit via editTarget)
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companyModalInit, setCompanyModalInit] = useState<Partial<CompanyFormValues>>({});
  const [editTarget, setEditTarget] = useState<CompanyOption | null>(null);
  const companyHandledFor = useRef<string>(""); // nama terakhir yang sudah ditawarkan modal

  // Ronde 45 — opsi perusahaan utk auto-text autocomplete
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>(companies);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const optionsFetched = useRef(false);

  // Sinkron dari prop hanya bila pemanggil mengirim daftar nyata — prop `[]` literal
  // (identitas baru tiap render) tidak boleh menimpa hasil lazy-fetch.
  useEffect(() => {
    if (companies.length > 0) setCompanyOptions(companies);
  }, [companies]);

  async function ensureCompanies() {
    if (optionsFetched.current || optionsLoading) return;
    optionsFetched.current = true;
    setOptionsLoading(true);
    try {
      const res = await api.companies();
      setCompanyOptions(res.companies as CompanyOption[]);
    } catch {
      optionsFetched.current = false; // boleh dicoba lagi nanti
    } finally {
      setOptionsLoading(false);
    }
  }

  const companyLinked = !!values.companyId && values.companyId !== NO_VALUE;
  const linkedOption = companyLinked ? companyOptions.find((c) => c.id === values.companyId) ?? null : null;

  // Ronde 45 — auto-text: kecocokan nama yang diketik terhadap daftar perusahaan
  const nameTrim = values.companyName.trim();
  const nameLc = nameTrim.toLowerCase();
  const exactOption = nameTrim
    ? companyOptions.find((c) => c.name.trim().toLowerCase() === nameLc) ?? null
    : null;
  const nameMatches = useMemo(() => {
    if (!nameTrim) return [];
    return companyOptions
      .filter((c) => c.name.toLowerCase().includes(nameLc))
      .sort((a, b) => {
        const aExact = a.name.trim().toLowerCase() === nameLc ? 0 : 1;
        const bExact = b.name.trim().toLowerCase() === nameLc ? 0 : 1;
        return aExact - bExact || a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [companyOptions, nameLc, nameTrim]);

  function openCompanyModal() {
    const name = values.companyName.trim();
    setEditTarget(null);
    setCompanyModalInit({
      name,
      country: values.country,
      city: values.city,
      defaultCurrency: values.currency || "IDR",
    });
    setCompanyModalOpen(true);
  }

  /**
   * Ronde 45 — buka modal mode EDIT utk perusahaan tertaut (tombol Edit).
   * Bila data opsi belum lengkap (tanpa defaultCurrency), detail diambil dulu.
   */
  async function openCompanyEdit() {
    if (!companyLinked) return;
    let target = linkedOption;
    if (target && target.defaultCurrency === undefined) {
      try {
        const res = await api.companies();
        const fresh = (res.companies as CompanyOption[]).find((c) => c.id === values.companyId);
        if (fresh) {
          target = fresh;
          setCompanyOptions((opts) =>
            opts.some((o) => o.id === fresh.id)
              ? opts.map((o) => (o.id === fresh.id ? fresh : o))
              : [...opts, fresh],
          );
        }
      } catch {
        /* biarkan prefill fallback */
      }
    }
    setEditTarget(target);
    setCompanyModalInit({});
    setCompanyModalOpen(true);
  }

  /** Ronde 45 — tautkan perusahaan existing dari saran auto-text. */
  function pickCompany(c: CompanyOption) {
    companyHandledFor.current = c.name.trim().toLowerCase();
    setSuggestOpen(false);
    onChange({ companyName: c.name, companyId: c.id });
  }

  /**
   * Ronde 45 — saat blur: nama cocok perusahaan existing → tautkan otomatis
   * (tanpa modal); nama belum terdaftar → modal Detail Perusahaan muncul otomatis.
   */
  function handleCompanyBlur() {
    setSuggestOpen(false);
    const name = values.companyName.trim();
    if (!name || companyLinked) return;
    if (companyHandledFor.current === name.toLowerCase()) return;
    if (exactOption) {
      companyHandledFor.current = name.toLowerCase();
      onChange({ companyId: exactOption.id });
      return;
    }
    openCompanyModal();
  }

  const waPreview = whatsappE164Preview(values.whatsappDial, values.whatsapp);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CrmField label="Nama depan" required>
          <Input value={values.firstName} onChange={(e) => setField("firstName")(e.target.value)} placeholder="cth. Ratna" disabled={disabled} />
        </CrmField>
        <CrmField label="Nama belakang">
          <Input value={values.lastName} onChange={(e) => setField("lastName")(e.target.value)} placeholder="cth. Wijaya" disabled={disabled} />
        </CrmField>
        <CrmField label="Jabatan di Perusahaan">
          <Input value={values.position} onChange={(e) => setField("position")(e.target.value)} placeholder="cth. Marketing Manager" disabled={disabled} />
        </CrmField>
        <CrmField label="Email">
          <Input type="email" value={values.email} onChange={(e) => setField("email")(e.target.value)} placeholder="nama@perusahaan.com" disabled={disabled} />
        </CrmField>
        <CrmField label="WhatsApp" className="sm:col-span-2">
          <div className="flex gap-2">
            <div className="w-[122px] shrink-0 sm:w-[150px]">
              <DialCodeCombobox value={values.whatsappDial} onSelect={setField("whatsappDial")} disabled={disabled} />
            </div>
            <Input
              value={values.whatsapp}
              onChange={(e) => setField("whatsapp")(e.target.value)}
              placeholder="81234567890"
              inputMode="tel"
              aria-label="Nomor WhatsApp (tanpa kode negara)"
              disabled={disabled}
            />
          </div>
          {waPreview && <p className="text-[11px] text-zinc-400">Tersimpan sebagai {waPreview}</p>}
        </CrmField>
        <CrmField label="Telepon" className="sm:col-span-2">
          <div className="flex gap-2">
            <div className="w-[122px] shrink-0 sm:w-[150px]">
              <DialCodeCombobox value={values.phoneDial} onSelect={setField("phoneDial")} disabled={disabled} />
            </div>
            <Input
              value={values.phone}
              onChange={(e) => setField("phone")(e.target.value)}
              placeholder="8215550123"
              inputMode="tel"
              aria-label="Nomor telepon (tanpa kode negara)"
              disabled={disabled}
            />
          </div>
          {(() => {
            const preview = whatsappE164Preview(values.phoneDial, values.phone);
            return preview ? <p className="text-[11px] text-zinc-400">Tersimpan sebagai {preview}</p> : null;
          })()}
        </CrmField>

        {mode === "create" ? (
          <CrmField label="Perusahaan" className="sm:col-span-2">
            <div className="relative">
              <div className="flex gap-2">
                <Input
                  value={values.companyName}
                  onChange={(e) => {
                    // ganti nama → lepas tautan perusahaan lama
                    onChange({
                      companyName: e.target.value,
                      ...(companyLinked ? { companyId: NO_VALUE } : {}),
                    });
                    setSuggestOpen(true);
                  }}
                  onFocus={() => {
                    setSuggestOpen(true);
                    void ensureCompanies();
                  }}
                  onBlur={handleCompanyBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSuggestOpen(false);
                  }}
                  role="combobox"
                  aria-expanded={suggestOpen && !!nameTrim}
                  aria-controls="company-suggest-list"
                  aria-autocomplete="list"
                  aria-label="Nama perusahaan"
                  placeholder="cth. PT Maju Jaya (detail bisa dilengkapi)"
                  disabled={disabled}
                />
                {companyLinked ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 gap-1.5 px-3"
                    onClick={() => void openCompanyEdit()}
                    disabled={disabled}
                    title="Edit detail perusahaan tertaut (industri, website, negara…)"
                    aria-label="Edit detail perusahaan tertaut"
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 gap-1.5 px-3"
                    onClick={openCompanyModal}
                    disabled={disabled}
                    title="Lengkapi detail perusahaan (industri, website, alamat…)"
                    aria-label="Lengkapi detail perusahaan"
                  >
                    <Building2 className="size-3.5" /> Detail
                  </Button>
                )}
              </div>
              {suggestOpen && nameTrim ? (
                <div
                  id="company-suggest-list"
                  role="listbox"
                  aria-label="Saran perusahaan"
                  className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
                >
                  {optionsLoading ? (
                    <p className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Memuat daftar perusahaan…
                    </p>
                  ) : null}
                  {nameMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={companyLinked && values.companyId === c.id}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100"
                      // onMouseDown + preventDefault: pilihan diproses sebelum blur menutup daftar
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickCompany(c);
                      }}
                    >
                      <Building2 className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      <span className="max-w-[45%] truncate text-[11px] text-zinc-400">
                        {[c.industry, c.city || c.country].filter(Boolean).join(" · ")}
                      </span>
                      {companyLinked && values.companyId === c.id ? (
                        <Check className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                  {!optionsLoading && !exactOption && !companyLinked ? (
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="flex w-full items-start gap-2 border-t px-3 py-2 text-left text-xs text-emerald-700 transition-colors hover:bg-emerald-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSuggestOpen(false);
                        openCompanyModal();
                      }}
                    >
                      <Plus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        Buat perusahaan baru <span className="font-semibold">“{nameTrim}”</span> — lengkapi detailnya sekarang
                      </span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {companyLinked ? (
              <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                <Check className="size-3" aria-hidden="true" />
                Perusahaan tertaut: {values.companyName.trim() || "(tanpa nama)"} — detail lengkap tersimpan
              </p>
            ) : (
              <p className="text-[11px] text-zinc-400">
                Ketik utk mencari perusahaan existing, atau lengkapi perusahaan baru lewat <span className="font-medium text-zinc-500">Detail</span>.
              </p>
            )}
          </CrmField>
        ) : (
          <CrmField label="Perusahaan">
            <div className="flex gap-2">
              <Select value={values.companyId} onValueChange={setField("companyId")} disabled={disabled}>
                <SelectTrigger className="w-full" aria-label="Pilih perusahaan">
                  <SelectValue placeholder="Pilih perusahaan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>Tanpa perusahaan</SelectItem>
                  {companyOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0 gap-1.5 px-3"
                onClick={() => void openCompanyEdit()}
                disabled={disabled || !companyLinked}
                title="Edit detail perusahaan terpilih"
                aria-label="Edit detail perusahaan terpilih"
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            </div>
            {companyLinked && linkedOption && !linkedOption.industry && !linkedOption.website && !linkedOption.country ? (
              <p className="text-[11px] text-amber-600">Detail perusahaan belum lengkap — klik Edit untuk melengkapinya.</p>
            ) : null}
          </CrmField>
        )}

        <CrmField label="Kota">
          <Input value={values.city} onChange={(e) => setField("city")(e.target.value)} placeholder="cth. Jakarta" disabled={disabled} />
        </CrmField>
        <CrmField label="Negara">
          <CountryCombobox
            value={values.country}
            onSelect={(c) => {
              setField("country")(c.name);
              setField("currency")(c.currency);
            }}
            disabled={disabled}
          />
        </CrmField>
        <CrmField label="Mata uang">
          <CurrencySelect
            value={values.currency}
            onValueChange={setField("currency")}
            disabled={disabled}
          />
        </CrmField>
        <CrmField label="Kanal preferensi">
          <Select value={values.preferredChannel} onValueChange={setField("preferredChannel")} disabled={disabled}>
            <SelectTrigger className="w-full" aria-label="Pilih kanal preferensi">
              <SelectValue placeholder="Pilih kanal" />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CrmField>
      </div>

      <section aria-label="Media sosial" className="space-y-2">
        <SectionTitle>Media Sosial</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CrmField label="Instagram">
            <Input value={values.instagram} onChange={(e) => setField("instagram")(e.target.value)} placeholder="cth. @rani.creativehouse" disabled={disabled} />
          </CrmField>
          <CrmField label="Facebook">
            <Input value={values.facebook} onChange={(e) => setField("facebook")(e.target.value)} placeholder="cth. facebook.com/nama" disabled={disabled} />
          </CrmField>
          <CrmField label="TikTok">
            <Input value={values.tiktok} onChange={(e) => setField("tiktok")(e.target.value)} placeholder="cth. @namabrand" disabled={disabled} />
          </CrmField>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CrmField label="Tag (pisahkan dengan koma)" className="sm:col-span-2">
          <Input value={values.tagsText} onChange={(e) => setField("tagsText")(e.target.value)} placeholder="cth: retainer, priority, q3-campaign" disabled={disabled} />
        </CrmField>
      </div>

      {/* Ronde 44/45 — modal Detail/Edit Perusahaan (portal, dipakai create & edit mode).
          Diletakkan di luar grid agar bisa dibuka dari kedua mode. */}
      <CompanyDetailModal
        open={companyModalOpen}
        onOpenChange={(o) => {
          setCompanyModalOpen(o);
          // ditutup tanpa menyimpan (mode create) → tandai agar modal tidak mengganggu lagi utk nama ini
          if (!o && !editTarget && !companyLinked) {
            companyHandledFor.current = values.companyName.trim().toLowerCase();
          }
        }}
        initial={companyModalInit}
        editCompany={editTarget}
        onSaved={(company) => {
          companyHandledFor.current = company.name.trim().toLowerCase();
          if (editTarget) {
            // mode edit: nama perusahaan bisa berubah — sinkron form & daftar opsi
            setCompanyOptions((opts) => opts.map((o) => (o.id === company.id ? { ...o, ...company } : o)));
            onChange({ companyName: company.name });
          } else {
            setCompanyOptions((opts) =>
              opts.some((o) => o.id === company.id)
                ? opts.map((o) => ({ ...o, ...company }))
                : [...opts, company],
            );
            onChange({ companyId: company.id, companyName: company.name });
          }
          onCompanyUpserted?.(company);
        }}
      />
    </div>
  );
}
