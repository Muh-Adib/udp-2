"use client";

/**
 * Ronde 57/58 — FORM INTAKE PUBLIK (tanpa login) via shareable link.
 * URL: /?intake=<token> → dirender PortalGate (page.tsx), TANPA shell CRM.
 *
 * Ronde 58 (masukan user):
 *  - Email & nomor WhatsApp WAJIB diisi + divalidasi "sesuai sistem": combobox
 *    kode dial negara + aturan nasional (5–15 digit) + preview E.164 — sama
 *    persis dengan form Kontak internal (Ronde 42/44).
 *  - Alamat, kota, negara perusahaan WAJIB diisi (dipakai untuk surat).
 *  - Format input Brief Awal disamakan dgn form brief internal (brief-panel):
 *    deliverables & referensi berupa BARIS DINAMIS (nama+qty / label+url),
 *    label & placeholder identik, budget parsing digit.
 *  - "Estimasi tanggal penawaran/disepakati" jadi field read-only otomatis:
 *    pilih deadline dulu → dihitung (deadline − 3 minggu; bila mepet — maks
 *    besok). Catatan panjang dihapus, kode form internal tidak ditampilkan.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Building2, Check, CheckCircle2, ChevronsUpDown, ClipboardList,
  ExternalLink, Loader2, Plus, Send, Target, Trash2, User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import IndustryCombobox from "@/components/crm/industry-combobox";
import { DialCodeCombobox } from "@/components/crm/dial-code-combobox";
import { api } from "@/lib/crm/api-client";
import { normalizePhone } from "@/lib/crm/utils";
import { emailError, nationalPhoneError } from "@/lib/crm/validate";
import { cn } from "@/lib/utils";

type IntakeMeta = Awaited<ReturnType<typeof api.intakeMeta>>["intake"];

/** Baris deliverable — format sama dgn form brief internal (nama + jumlah). */
interface DelivRow { name: string; qty: string }
/** Baris referensi — format sama dgn form brief internal (label + url). */
interface RefRow { label: string; url: string }

const EMPTY = {
  companyName: "",
  companyAddress: "",
  industry: "",
  companyCity: "",
  companyCountry: "",
  companyWebsite: "",
  fullName: "",
  email: "",
  whatsappDial: "+62", // default Indonesia — konsisten dgn form kontak internal
  whatsapp: "",
  projectTitle: "",
  deadline: "",
  knowFrom: "",
  knowFromOther: "",
  targetAudience: "",
  objectives: "",
  keywords: "",
  budgetMin: "",
  budgetMax: "",
  catatan: "",
};

/**
 * Estimasi tanggal penawaran/disepakati (mirror aturan server):
 * deadline − 3 minggu; bila mepet (<3 minggu dari sekarang) → maksimal besok.
 */
function closeEstimate(deadline: string): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const threeWeeksMs = 21 * 24 * 60 * 60 * 1000;
  const target = d.getTime() - now.getTime() >= threeWeeksMs
    ? new Date(d.getTime() - threeWeeksMs)
    : new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return target.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

/** Parse budget seperti form brief internal: ambil digit saja ("50 jt" → 50). */
function parseBudget(v: string): number | null {
  const digits = v.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ============ Elemen kecil ============

function SectionCard({ icon: Icon, title, subtitle, children, accent }: {
  icon: typeof Building2;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent: string;
}) {
  return (
    <section className="rounded-xl border bg-white shadow-sm" aria-label={title}>
      <header className="flex items-start gap-3 border-b px-4 py-3 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}14`, color: accent }}>
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {subtitle ? <p className="text-xs text-zinc-500">{subtitle}</p> : null}
        </div>
      </header>
      <div className="space-y-3.5 px-4 py-4 sm:px-6">{children}</div>
    </section>
  );
}

function Field({ label, required, hint, error, children, htmlFor }: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-zinc-600">
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p className="text-[11px] leading-snug text-zinc-500">{hint}</p> : null}
      {error ? <p className="text-[11px] font-medium leading-snug text-rose-600" role="alert">{error}</p> : null}
    </div>
  );
}

/** Baris dinamis dgn tombol hapus — pola sama dgn form brief internal. */
function RowList({ ariaLabel, children, onRemove }: {
  ariaLabel: string;
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-zinc-400 hover:bg-red-50 hover:text-red-600"
        aria-label={ariaLabel}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ============ Komponen utama ============

export default function LeadIntakeForm({ token }: { token: string }) {
  const [meta, setMeta] = useState<IntakeMeta | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState({ ...EMPTY });
  const [deliverables, setDeliverables] = useState<DelivRow[]>([{ name: "", qty: "1" }]);
  const [references, setReferences] = useState<RefRow[]>([{ label: "", url: "" }]);
  const [knowFromOpen, setKnowFromOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState<{ title: string; briefCode: string; expectedCloseDate: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api.intakeMeta(token)
      .then((res) => {
        if (!alive) return;
        setMeta(res.intake);
        setLoadState("ok");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : "Gagal memuat formulir");
        setLoadState("error");
      });
    return () => { alive = false; };
  }, [token]);

  const brand = meta?.brand;
  const accent = brand?.color ?? "#18181b";
  const set = (k: keyof typeof EMPTY) => (v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); // hapus error saat mengetik
  };

  const estimate = useMemo(() => closeEstimate(values.deadline), [values.deadline]);

  /** Preview E.164 di bawah input WA — identik dgn form kontak internal. */
  const waPreview = useMemo(() => {
    const raw = values.whatsapp.trim();
    if (!raw) return null;
    if (values.whatsappDial) {
      const n = normalizePhone(raw, values.whatsappDial);
      return n ? `+${n}` : null;
    }
    if (raw.replace(/\D/g, "").startsWith("0")) {
      const n = normalizePhone(raw);
      return n ? `+${n}` : null;
    }
    return null;
  }, [values.whatsapp, values.whatsappDial]);

  const submit = async () => {
    setFormError("");
    // ===== Validasi "sesuai sistem" (pola Ronde 42/44) — semua wajib =====
    const e: Record<string, string> = {};
    if (!values.fullName.trim()) e.fullName = "Nama lengkap wajib diisi";
    if (!values.companyName.trim()) e.companyName = "Nama perusahaan wajib diisi";
    if (!values.companyAddress.trim()) e.companyAddress = "Alamat perusahaan wajib diisi (dipakai untuk surat)";
    if (!values.companyCity.trim()) e.companyCity = "Kota wajib diisi";
    if (!values.companyCountry.trim()) e.companyCountry = "Negara wajib diisi";
    if (!values.projectTitle.trim()) e.projectTitle = "Judul project wajib diisi";
    if (!values.deadline) e.deadline = "Target deadline wajib diisi";
    // Email: wajib + format valid (validator sistem).
    const vEmail = emailError(values.email);
    if (!values.email.trim()) e.email = "Email wajib diisi";
    else if (vEmail) e.email = vEmail;
    // WhatsApp: wajib + aturan nomor nasional sistem (5–15 digit, tanpa 0 di depan bila pakai kode negara).
    const wa = values.whatsapp.trim();
    if (!wa) e.whatsapp = "Nomor WhatsApp wajib diisi";
    else {
      const vWa = nationalPhoneError(wa, !values.whatsappDial);
      if (vWa) e.whatsapp = vWa;
    }
    setErrors(e);
    if (Object.values(e).some(Boolean)) {
      setFormError("Periksa kembali kolom yang bertanda merah.");
      return;
    }

    setSaving(true);
    try {
      // Payload WhatsApp: gabung kode dial + nomor (pola buildWhatsappPayload internal).
      const whatsappPayload = values.whatsappDial
        ? (normalizePhone(values.whatsapp.trim(), values.whatsappDial) ?? values.whatsapp.trim())
        : values.whatsapp.trim();
      const res = await api.intakeSubmit(token, {
        ...values,
        whatsapp: whatsappPayload,
        knowFrom: values.knowFrom === "other" ? (values.knowFromOther.trim() || "other") : values.knowFrom,
        deliverables: deliverables
          .filter((d) => d.name.trim())
          .map((d) => ({ name: d.name.trim().slice(0, 160), qty: Math.max(1, Math.min(999, Number(d.qty) || 1)) })),
        references: references
          .filter((r) => r.url.trim())
          .map((r) => ({ label: (r.label.trim() || r.url.trim()).slice(0, 80), url: r.url.trim().slice(0, 500) })),
      });
      setDone({ title: res.opportunity.title, briefCode: res.briefCode, expectedCloseDate: res.expectedCloseDate });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengirim formulir — coba lagi");
    } finally {
      setSaving(false);
    }
  };

  // ===== Layar sukses =====
  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 py-10">
        <div className="w-full max-w-lg rounded-xl border bg-white p-6 text-center shadow-sm sm:p-8" role="status">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-zinc-900">Terima kasih, {values.fullName.split(" ")[0]}!</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Request Anda <span className="font-semibold">{done.title}</span> sudah masuk ke tim{" "}
            <span className="font-semibold" style={{ color: accent }}>{brand?.name}</span>.
            Kami akan menghubungi Anda melalui email/WhatsApp.
          </p>
          <div className="mt-4 space-y-1.5 rounded-lg border bg-zinc-50 px-4 py-3 text-left text-xs text-zinc-600">
            <p>Nomor referensi brief: <span className="font-mono font-semibold text-zinc-900">{done.briefCode}</span></p>
            {fmtDate(done.expectedCloseDate) ? <p>Estimasi target penawaran/disepakati: <span className="font-semibold">{fmtDate(done.expectedCloseDate)}</span></p> : null}
          </div>
          {brand?.website ? (
            <a
              href={brand.website}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              style={{ color: accent }}
            >
              Kunjungi {brand.name} <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </main>
    );
  }

  // ===== Loading / error / link mati =====
  if (loadState !== "ok") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
        {loadState === "loading" ? (
          <div className="flex flex-col items-center gap-3 text-zinc-500" role="status" aria-label="Memuat formulir">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            <p className="text-xs">Memuat formulir…</p>
          </div>
        ) : (
          <div className="w-full max-w-md rounded-xl border bg-white p-6 text-center shadow-sm">
            <AlertTriangle className="mx-auto size-10 text-amber-500" aria-hidden="true" />
            <h1 className="mt-3 text-base font-bold text-zinc-900">Formulir tidak dapat dibuka</h1>
            <p className="mt-1 text-sm text-zinc-600">{loadError}</p>
          </div>
        )}
      </main>
    );
  }

  // Guard TS: setelah gate di atas, meta pasti sudah termuat.
  if (!meta) return null;

  const knowFromLabel = meta.knowFrom.find((k) => k.key === values.knowFrom)?.label
    ?? (values.knowFrom ? values.knowFrom : "");
  const currency = brand?.primaryCurrency ?? "IDR";

  return (
    <main className="min-h-screen bg-zinc-100 pb-16">
      {/* Header brand */}
      <header className="border-b bg-white" style={{ borderTop: `4px solid ${accent}` }}>
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-6 sm:items-center sm:text-center">
          <div className="flex items-center gap-3 sm:flex-col sm:gap-2">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={`Logo ${brand.name}`} className="h-10 w-auto rounded-md sm:h-14" />
            ) : (
              <span className="flex size-11 items-center justify-center rounded-xl text-base font-black text-white" style={{ backgroundColor: accent }} aria-hidden="true">
                {brand?.name?.charAt(0) ?? "F"}
              </span>
            )}
            <div>
              <h1 className="text-lg font-bold leading-tight text-zinc-900 sm:text-xl">{brand?.name}</h1>
              {brand?.tagline ? <p className="text-xs text-zinc-500 sm:text-sm">{brand.tagline}</p> : null}
            </div>
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600">
            Formulir request project — isi data di bawah, tim kami akan menindaklanjuti Anda.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-6">
        {formError ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        ) : null}

        {/* 1 — Data perusahaan */}
        <SectionCard icon={Building2} title="Data Perusahaan" subtitle="Alamat dipakai untuk dokumen resmi (surat, kontrak, invoice)." accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Nama Perusahaan" required error={errors.companyName} htmlFor="int-company">
              <Input id="int-company" value={values.companyName} onChange={(e) => set("companyName")(e.target.value)} placeholder="PT Nusantara Kreatif" autoComplete="organization" aria-invalid={!!errors.companyName} />
            </Field>
            <Field label="Jenis Industri" hint="Ketik untuk mencari — boleh tulis industri baru.">
              <IndustryCombobox value={values.industry} onChange={set("industry")} suggestions={meta.industries} />
            </Field>
          </div>
          <Field label="Alamat Perusahaan" required hint="Alamat lengkap kantor (jalan, nomor, kota/kabupaten, kode pos)." error={errors.companyAddress} htmlFor="int-address">
            <Textarea id="int-address" value={values.companyAddress} onChange={(e) => set("companyAddress")(e.target.value)} rows={2} placeholder="Jl. Sudirman No. 12, Jakarta Pusat, 10220" aria-invalid={!!errors.companyAddress} />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Kota" required error={errors.companyCity} htmlFor="int-city">
              <Input id="int-city" value={values.companyCity} onChange={(e) => set("companyCity")(e.target.value)} placeholder="Jakarta" aria-invalid={!!errors.companyCity} />
            </Field>
            <Field label="Negara" required error={errors.companyCountry} htmlFor="int-country">
              <Input id="int-country" value={values.companyCountry} onChange={(e) => set("companyCountry")(e.target.value)} placeholder="Indonesia" aria-invalid={!!errors.companyCountry} />
            </Field>
            <Field label="Website" htmlFor="int-web">
              <Input id="int-web" value={values.companyWebsite} onChange={(e) => set("companyWebsite")(e.target.value)} placeholder="perusahaan.co.id" />
            </Field>
          </div>
        </SectionCard>

        {/* 2 — Kontak: email + WA wajib & validasi sistem */}
        <SectionCard icon={User} title="Data Kontak Anda" subtitle="Email dan WhatsApp wajib diisi — kami menghubungi Anda via salah satunya." accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Nama Lengkap" required error={errors.fullName} htmlFor="int-name">
              <Input id="int-name" value={values.fullName} onChange={(e) => set("fullName")(e.target.value)} placeholder="Budi Santoso" autoComplete="name" aria-invalid={!!errors.fullName} />
            </Field>
            <Field label="Email" required error={errors.email} htmlFor="int-email">
              <Input id="int-email" type="email" value={values.email} onChange={(e) => set("email")(e.target.value)} placeholder="budi@perusahaan.co.id" autoComplete="email" aria-invalid={!!errors.email} />
            </Field>
          </div>
          <Field label="WhatsApp" required error={errors.whatsapp} hint="Pilih kode negara, lalu tulis nomor langsung tanpa awalan 0 (cth. 81234567890).">
            <div className="flex gap-2">
              <div className="w-[122px] shrink-0 sm:w-[150px]">
                <DialCodeCombobox value={values.whatsappDial} onSelect={set("whatsappDial")} />
              </div>
              <Input
                type="tel"
                value={values.whatsapp}
                onChange={(e) => set("whatsapp")(e.target.value)}
                placeholder="81234567890"
                inputMode="tel"
                aria-label="Nomor WhatsApp (tanpa kode negara)"
                aria-invalid={!!errors.whatsapp}
              />
            </div>
            {waPreview && !errors.whatsapp ? <p className="text-[11px] text-zinc-400">Tersimpan sebagai {waPreview}</p> : null}
          </Field>
        </SectionCard>

        {/* 3 — Detail project */}
        <SectionCard icon={Target} title="Detail Project" accent={accent}>
          <Field label="Judul Project" required hint="Contoh: Animasi Company Profile 2 Menit" error={errors.projectTitle} htmlFor="int-title">
            <Input id="int-title" value={values.projectTitle} onChange={(e) => set("projectTitle")(e.target.value)} placeholder="Tulis judul kebutuhan Anda" aria-invalid={!!errors.projectTitle} />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Target Deadline" required error={errors.deadline} htmlFor="int-deadline">
              <Input id="int-deadline" type="date" value={values.deadline} onChange={(e) => set("deadline")(e.target.value)} min={new Date().toISOString().slice(0, 10)} aria-invalid={!!errors.deadline} />
            </Field>
            <Field label={`Dari mana Anda tahu ${brand?.name ?? "brand kami"}?`}>
              <Popover open={knowFromOpen} onOpenChange={setKnowFromOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" aria-expanded={knowFromOpen} aria-label="Sumber info brand" className={cn("w-full justify-between bg-white font-normal", !knowFromLabel && "text-zinc-500")}>
                    <span className="truncate">{knowFromLabel || "Pilih sumber…"}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandList className="crm-scroll max-h-60">
                      {meta.knowFrom.length === 0 ? <CommandEmpty>Tidak ada opsi.</CommandEmpty> : (
                        <CommandGroup heading="Sumber">
                          {meta.knowFrom.map((k) => (
                            <CommandItem key={k.key} value={k.key} onSelect={() => { set("knowFrom")(k.key); setKnowFromOpen(false); }}>
                              <Check className={cn("mr-2 size-4", values.knowFrom === k.key ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                              {k.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>
          </div>
          {values.knowFrom === "other" ? (
            <Field label="Sebutkan sumbernya" htmlFor="int-knowother">
              <Input id="int-knowother" value={values.knowFromOther} onChange={(e) => set("knowFromOther")(e.target.value)} placeholder="Mis. brosur, radio, banner jalan…" />
            </Field>
          ) : null}
          {/* Estimasi otomatis — field read-only, tidak bisa diubah */}
          <Field
            label="Estimasi Tanggal Penawaran/Disepakati"
            hint="Dihitung otomatis — 3 minggu sebelum deadline; bila deadline mepet, maksimal besok."
          >
            <Input
              readOnly
              disabled
              value={estimate ?? ""}
              placeholder="Pilih deadline terlebih dahulu"
              aria-label="Estimasi tanggal penawaran/disepakati (otomatis)"
              className="cursor-not-allowed bg-zinc-50 font-medium text-zinc-700"
            />
          </Field>
        </SectionCard>

        {/* 4 — Brief awal: format input = persis form brief internal (brief-panel) */}
        <SectionCard icon={ClipboardList} title="Brief Awal" subtitle="Semakin lengkap, semakin cepat penawaran kami tepat sasaran." accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Audiens Sasaran" htmlFor="int-audience">
              <Input id="int-audience" value={values.targetAudience} onChange={(e) => set("targetAudience")(e.target.value)} placeholder="Mis. HRD BUMN, usia 30-45" />
            </Field>
            <Field label="Keyword" htmlFor="int-keyword">
              <Input id="int-keyword" value={values.keywords} onChange={(e) => set("keywords")(e.target.value)} placeholder="Kata kunci utama, pisahkan koma" />
            </Field>
          </div>
          <Field label="Tujuan Kampanye" htmlFor="int-objective">
            <Textarea id="int-objective" value={values.objectives} onChange={(e) => set("objectives")(e.target.value)} rows={2} placeholder="Tujuan & target terukur (awareness, leads, launch produk…)" />
          </Field>
          {/* Deliverables — baris dinamis (nama + jumlah), sama dgn brief internal */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-zinc-600">Deliverables</p>
            <div className="space-y-1.5">
              {deliverables.map((d, i) => (
                <RowList key={i} ariaLabel={`Hapus deliverable ${i + 1}`} onRemove={() => setDeliverables((rows) => rows.filter((_, j) => j !== i))}>
                  <Input
                    value={d.name}
                    onChange={(e) => setDeliverables((rows) => rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder="Mis. Video animasi 60 detik"
                    aria-label={`Nama deliverable ${i + 1}`}
                  />
                  <Input
                    type="number"
                    min={1}
                    value={d.qty}
                    onChange={(e) => setDeliverables((rows) => rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    className="w-16 shrink-0"
                    aria-label={`Jumlah deliverable ${i + 1}`}
                  />
                </RowList>
              ))}
            </div>
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setDeliverables((rows) => [...rows, { name: "", qty: "1" }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                Tambah deliverable
              </Button>
            </div>
          </div>
          {/* Budget — label & placeholder sama dgn brief internal (digit diparse saat kirim) */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={`Budget Minimum (${currency})`} htmlFor="int-bmin">
              <Input id="int-bmin" inputMode="numeric" value={values.budgetMin} onChange={(e) => set("budgetMin")(e.target.value)} placeholder="Mis. 50000000" />
            </Field>
            <Field label={`Budget Maksimum (${currency})`} htmlFor="int-bmax">
              <Input id="int-bmax" inputMode="numeric" value={values.budgetMax} onChange={(e) => set("budgetMax")(e.target.value)} placeholder="Mis. 80000000" />
            </Field>
          </div>
          {/* Referensi — baris dinamis (label + url), sama dgn brief internal */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-zinc-600">Referensi / Tautan</p>
            <div className="space-y-1.5">
              {references.map((r, i) => (
                <RowList key={i} ariaLabel={`Hapus referensi ${i + 1}`} onRemove={() => setReferences((rows) => rows.filter((_, j) => j !== i))}>
                  <Input
                    value={r.label}
                    onChange={(e) => setReferences((rows) => rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    placeholder="Label (mis. Contoh style)"
                    className="w-2/5 shrink-0"
                    aria-label={`Label referensi ${i + 1}`}
                  />
                  <Input
                    value={r.url}
                    onChange={(e) => setReferences((rows) => rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    placeholder="https://…"
                    aria-label={`URL referensi ${i + 1}`}
                  />
                </RowList>
              ))}
            </div>
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setReferences((rows) => [...rows, { label: "", url: "" }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                Tambah referensi
              </Button>
            </div>
          </div>
          <Field label="Catatan Lampiran" htmlFor="int-notes">
            <Input id="int-notes" value={values.catatan} onChange={(e) => set("catatan")(e.target.value)} placeholder="Mis. Logo & footage tersedia di Drive — link dikirim via WA" />
          </Field>
        </SectionCard>

        {/* Submit */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button size="lg" className="w-full max-w-md" onClick={submit} disabled={saving} style={{ backgroundColor: accent }}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {saving ? "Mengirim…" : "Kirim Request"}
          </Button>
          <p className="text-center text-[11px] text-zinc-500">
            Dengan mengirim formulir, data Anda akan diproses tim {brand?.name} untuk keperluan penawaran.
          </p>
        </div>
      </div>
    </main>
  );
}
