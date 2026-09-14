"use client";

/**
 * Ronde 57 — FORM INTAKE PUBLIK (tanpa login) via shareable link.
 * URL: /?intake=<token> → dirender PortalGate (page.tsx), TANPA shell CRM.
 *
 * Alur: calon lead mengisi data perusahaan (nama, alamat utk surat, industri dgn
 * autocomplete, kota/negara/website) + kontak + judul project + deadline +
 * "Dari mana tahu [brand]?" (autocomplete) + brief awal (target audience, tujuan,
 * keyword, deliverables, budget min-max, referensi, catatan).
 * Nama brief = judul project (tidak diminta), layanan disembunyikan, timeline
 * pengerjaan otomatis (end = deadline − 1 hari) — diatur server.
 * Estimasi close otomatis: deadline − 3 minggu; bila mepet (<3 minggu) → besok.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Building2, CalendarDays, Check, CheckCircle2, ChevronsUpDown, ClipboardList,
  ExternalLink, Loader2, Send, Target, User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import IndustryCombobox from "@/components/crm/industry-combobox";
import { api } from "@/lib/crm/api-client";
import { cn } from "@/lib/utils";

type IntakeMeta = Awaited<ReturnType<typeof api.intakeMeta>>["intake"];

const EMPTY = {
  companyName: "",
  companyAddress: "",
  industry: "",
  companyCity: "",
  companyCountry: "",
  companyWebsite: "",
  fullName: "",
  email: "",
  whatsapp: "",
  projectTitle: "",
  deadline: "",
  knowFrom: "",
  knowFromOther: "",
  targetAudience: "",
  objectives: "",
  keywords: "",
  deliverables: "",
  budgetMin: "",
  budgetMax: "",
  references: "",
  catatan: "",
};

/** Info estimasi close (mirror aturan server): deadline − 3 minggu, mepet → besok. */
function closeHint(deadline: string): string | null {
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

function Field({ label, required, hint, children, htmlFor }: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-zinc-600">
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-zinc-500">{hint}</p> : null}
    </div>
  );
}

// ============ Komponen utama ============

export default function LeadIntakeForm({ token }: { token: string }) {
  const [meta, setMeta] = useState<IntakeMeta | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState({ ...EMPTY });
  const [knowFromOpen, setKnowFromOpen] = useState(false);
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
  const set = (k: keyof typeof EMPTY) => (v: string) => setValues((s) => ({ ...s, [k]: v }));
  const hint = useMemo(() => closeHint(values.deadline), [values.deadline]);

  const submit = async () => {
    setFormError("");
    if (!values.fullName.trim()) { setFormError("Nama lengkap wajib diisi"); return; }
    if (!values.companyName.trim()) { setFormError("Nama perusahaan wajib diisi"); return; }
    if (!values.projectTitle.trim()) { setFormError("Judul project wajib diisi"); return; }
    if (!values.deadline) { setFormError("Target deadline wajib diisi"); return; }
    if (!values.email.trim() && !values.whatsapp.trim()) { setFormError("Isi minimal salah satu: email atau WhatsApp"); return; }

    setSaving(true);
    try {
      const res = await api.intakeSubmit(token, {
        ...values,
        knowFrom: values.knowFrom === "other" ? (values.knowFromOther.trim() || "other") : values.knowFrom,
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
            {meta.label ? <span className="mt-1 block text-xs text-zinc-400">Kode form: {meta.label}</span> : null}
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
            <Field label="Nama Perusahaan" required htmlFor="int-company">
              <Input id="int-company" value={values.companyName} onChange={(e) => set("companyName")(e.target.value)} placeholder="PT Nusantara Kreatif" autoComplete="organization" />
            </Field>
            <Field label="Jenis Industri" hint="Ketik untuk mencari — boleh tulis industri baru.">
              <IndustryCombobox value={values.industry} onChange={set("industry")} suggestions={meta.industries} />
            </Field>
          </div>
          <Field label="Alamat Perusahaan" hint="Alamat lengkap kantor (jalan, nomor, kota/kabupaten, kode pos)." htmlFor="int-address">
            <Textarea id="int-address" value={values.companyAddress} onChange={(e) => set("companyAddress")(e.target.value)} rows={2} placeholder="Jl. Sudirman No. 12, Jakarta Pusat, 10220" />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Kota" htmlFor="int-city">
              <Input id="int-city" value={values.companyCity} onChange={(e) => set("companyCity")(e.target.value)} placeholder="Jakarta" />
            </Field>
            <Field label="Negara" htmlFor="int-country">
              <Input id="int-country" value={values.companyCountry} onChange={(e) => set("companyCountry")(e.target.value)} placeholder="Indonesia" />
            </Field>
            <Field label="Website" htmlFor="int-web">
              <Input id="int-web" value={values.companyWebsite} onChange={(e) => set("companyWebsite")(e.target.value)} placeholder="perusahaan.co.id" />
            </Field>
          </div>
        </SectionCard>

        {/* 2 — Kontak */}
        <SectionCard icon={User} title="Data Kontak Anda" subtitle="Minimal salah satu: email atau WhatsApp." accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Nama Lengkap" required htmlFor="int-name">
              <Input id="int-name" value={values.fullName} onChange={(e) => set("fullName")(e.target.value)} placeholder="Budi Santoso" autoComplete="name" />
            </Field>
            <Field label="Email" htmlFor="int-email">
              <Input id="int-email" type="email" value={values.email} onChange={(e) => set("email")(e.target.value)} placeholder="budi@perusahaan.co.id" autoComplete="email" />
            </Field>
            <Field label="WhatsApp" htmlFor="int-wa">
              <Input id="int-wa" type="tel" value={values.whatsapp} onChange={(e) => set("whatsapp")(e.target.value)} placeholder="0812xxxxxxx" autoComplete="tel" />
            </Field>
          </div>
        </SectionCard>

        {/* 3 — Detail project */}
        <SectionCard icon={Target} title="Detail Project" accent={accent}>
          <Field label="Judul Project" required hint="Contoh: Animasi Company Profile 2 Menit" htmlFor="int-title">
            <Input id="int-title" value={values.projectTitle} onChange={(e) => set("projectTitle")(e.target.value)} placeholder="Tulis judul kebutuhan Anda" />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Target Deadline" required htmlFor="int-deadline">
              <Input id="int-deadline" type="date" value={values.deadline} onChange={(e) => set("deadline")(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
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
          <div className="flex items-start gap-2 rounded-lg border bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600" role="note">
            <ClipboardList className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
            <span>
              Estimasi tanggal penawaran/disepakati dihitung otomatis:{" "}
              {hint ? <strong className="text-zinc-900">{hint}</strong> : "pilih deadline terlebih dahulu"}{" "}
              (3 minggu sebelum deadline; bila deadline mepet — maksimal besok).
            </span>
          </div>
        </SectionCard>

        {/* 4 — Brief awal */}
        <SectionCard icon={ClipboardList} title="Brief Awal" subtitle="Semakin lengkap, semakin cepat penawaran kami tepat sasaran." accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Target Audience" htmlFor="int-audience">
              <Input id="int-audience" value={values.targetAudience} onChange={(e) => set("targetAudience")(e.target.value)} placeholder="Mis. calon investor, pelajar, ibu rumah tangga…" />
            </Field>
            <Field label="Keyword" htmlFor="int-keyword">
              <Input id="int-keyword" value={values.keywords} onChange={(e) => set("keywords")(e.target.value)} placeholder="Kata kunci utama, pisahkan koma" />
            </Field>
          </div>
          <Field label="Tujuan / Objective" htmlFor="int-objective" hint="Apa yang ingin dicapai dari project ini?">
            <Textarea id="int-objective" value={values.objectives} onChange={(e) => set("objectives")(e.target.value)} rows={3} placeholder="Mis. meningkatkan awareness produk baru ke audiens usia 20–35…" />
          </Field>
          <Field label="Deliverables" hint="Satu item per baris." htmlFor="int-deliverables">
            <Textarea id="int-deliverables" value={values.deliverables} onChange={(e) => set("deliverables")(e.target.value)} rows={3} placeholder={"Video animasi 2D 60 detik\nScript + voice over\nSubtitle Indonesia & Inggris"} />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={`Budget Minimum (${brand?.primaryCurrency ?? "IDR"})`} htmlFor="int-bmin">
              <Input id="int-bmin" inputMode="numeric" value={values.budgetMin} onChange={(e) => set("budgetMin")(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Mis. 10000000" />
            </Field>
            <Field label={`Budget Maksimum (${brand?.primaryCurrency ?? "IDR"})`} htmlFor="int-bmax">
              <Input id="int-bmax" inputMode="numeric" value={values.budgetMax} onChange={(e) => set("budgetMax")(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Mis. 25000000" />
            </Field>
          </div>
          <Field label="Referensi / Tautan" hint="Satu tautan per baris — contoh video/design yang Anda suka." htmlFor="int-refs">
            <Textarea id="int-refs" value={values.references} onChange={(e) => set("references")(e.target.value)} rows={2} placeholder={"https://youtube.com/watch?v=xxx\nhttps://behance.net/gallery/xxx"} />
          </Field>
          <Field label="Catatan Tambahan" htmlFor="int-notes">
            <Textarea id="int-notes" value={values.catatan} onChange={(e) => set("catatan")(e.target.value)} rows={2} placeholder="Hal lain yang ingin kami ketahui…" />
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

