"use client";

/**
 * Ronde 57/58/59/60 — FORM INTAKE PUBLIK (tanpa login) via shareable link.
 * URL: /?intake=<token> → dirender PortalGate (page.tsx), TANPA shell CRM.
 *
 * Ronde 60 (masukan user):
 *  - MULTI-BAHASA: toggle EN/ID di header, default ENGLISH (diprioritaskan user).
 *    Semua label, placeholder, tooltip, error, dan layar sukses ikut berbahasa —
 *    termasuk pilihan "dari mana tahu kami" (labelEn) & saran industri (pairs EN).
 *  - Wording: "Tujuan Kampanye" → "Tujuan Project" (konsisten dgn brief internal).
 *  - "Keyword" pada form intake = PESAN UTAMA (Key Message) — "pesan utama yang
 *    harus tersampaikan ke audiens lewat project ini, mis. pengenalan produk,
 *    sejarah perusahaan, dll." → disimpan ke brief.keyMessages (BKN brief.keywords).
 *  - "Estimasi tanggal penawaran" TIDAK ditampilkan lagi di link (form & sukses).
 *  - "Dari mana Anda tahu kami" WAJIB dipilih (validasi client + server).
 *  - Kategori industri (autocomplete) dinormalisasi Title Case saat dikirim.
 *  - Setelah submit, server mengirim email salinan isi form + link portal +
 *    PDF Brief Awal via kanal email brand (lihat route intake).
 *
 * Ronde 58: email & WA wajib + validasi sistem (E.164), alamat/kota/negara wajib,
 * format Brief Awal = form brief internal, estimasi jadi field otomatis (kini dihapus).
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
// Tooltip penjelasan tiap field (Ronde 59) — ikon info, konsisten dgn form lain
import { FieldHint, FieldHintInLabel } from "@/components/crm/field-hint";
import { api } from "@/lib/crm/api-client";
import { normalizePhone, toTitleCase } from "@/lib/crm/utils";
import { emailError, nationalPhoneError } from "@/lib/crm/validate";
import { INDUSTRY_SUGGESTIONS_PAIRS } from "@/lib/crm/constants";
import { cn } from "@/lib/utils";

type IntakeMeta = Awaited<ReturnType<typeof api.intakeMeta>>["intake"];
type Lang = "en" | "id";

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
  keyMessages: "", // Ronde 60: "Keyword" intake = pesan utama → brief.keyMessages
  budgetMin: "",
  budgetMax: "",
  catatan: "",
};

// ============ Kamus multi-bahasa (EN default — diprioritaskan user) ============

const STR = {
  en: {
    brandFallback: "our brand",
    // Ronde 61 — judul halaman form request + intro tanpa prefiks redundan
    formTitle: "Form Request",
    intro: "Fill in the details below and our team will get back to you shortly.",
    loading: "Loading form…",
    loadFail: "Form unavailable",
    errRequiredReview: "Please review the fields marked in red.",
    sec1Title: "Company Details",
    sec1Sub: "The address is used for official documents (letters, contracts, invoices).",
    companyName: "Company Name",
    companyNameInfo: "Your company's official name — it will appear on quotation letters, contracts, and invoices.",
    companyNamePh: "PT Nusantara Kreatif",
    errCompanyName: "Company name is required",
    industry: "Industry",
    industryInfo: "Your company's business field (e.g. F&B, Education, Property) — helps us understand your project context. Type to search, or write a new one.",
    address: "Company Address",
    addressInfo: "Full office address (street, number, postal code) — used on quotation letters, contracts, and other official documents.",
    addressHint: "Example: Jl. Sudirman No. 12, Central Jakarta, 10220",
    errAddress: "Company address is required (used for official letters)",
    city: "City",
    cityInfo: "City/regency of your company's main office.",
    errCity: "City is required",
    country: "Country",
    countryInfo: "Country where your company is located — it affects currency & document format.",
    errCountry: "Country is required",
    website: "Website",
    websiteInfo: "Your company's official website (if any) — helps us get to know your business faster.",
    sec2Title: "Your Contact Details",
    sec2Sub: "Email and WhatsApp are required — we will reach you via either one.",
    fullName: "Full Name",
    fullNameInfo: "Your name — what we will use to address you when contacting you via email/WhatsApp.",
    fullNamePh: "Budi Santoso",
    errFullName: "Full name is required",
    email: "Email",
    emailInfo: "Active email to receive quotations, project documents, and approval links.",
    emailPh: "budi@company.co.id",
    errEmailRequired: "Email is required",
    errEmailFormat: "Invalid email format — correct example: name@company.co.id",
    whatsapp: "WhatsApp",
    whatsappInfo: "Active WhatsApp number for quick communication — pick the country code, then write the number without a leading 0 (e.g. 81234567890).",
    errWaRequired: "WhatsApp number is required",
    errWaShort: "Number is too short — minimum 5 digits.",
    errWaLong: "Number is too long — maximum 15 digits (E.164 standard).",
    errWaZero: "No leading 0 — pick the country code above, then write the number directly (e.g. 81234567890).",
    errWaChars: "Number may only contain digits, spaces, dashes, and brackets.",
    waPreview: "Saved as",
    waAria: "WhatsApp number (without country code)",
    sec3Title: "Project Details",
    projectTitle: "Project Title",
    projectTitleInfo: "A short title of your need — example: 2-Minute Company Profile Animation. This title automatically becomes the name of your initial brief.",
    projectTitlePh: "Describe your need in a short title",
    errProjectTitle: "Project title is required",
    deadline: "Target Deadline",
    deadlineInfo: "The ideal date for the project to be finished/handed over — it becomes the basis of our work plan & production schedule.",
    errDeadline: "Target deadline is required",
    knowFrom: (brand: string) => `How did you hear about ${brand}?`,
    knowFromInfo: "Where you first heard about us (e.g. Instagram, Google, a business partner) — helps us evaluate which promotion channel works.",
    knowFromPh: "Select a source…",
    knowFromAria: "Source of brand info",
    knowFromEmpty: "No options.",
    knowFromHeading: "Sources",
    errKnowFrom: "Please select how you heard about us",
    knowFromOther: "Tell us the source",
    knowFromOtherPh: "E.g. brochure, radio, street banner…",
    sec4Title: "Initial Brief",
    sec4Sub: "The more complete, the faster and more accurate our quotation.",
    audience: "Target Audience",
    audienceInfo: "Who this project should reach (e.g. HRDs of state firms, aged 30-45) — helps us set the content style & message.",
    audiencePh: "E.g. HRDs of state firms, aged 30-45",
    keyMessage: "Key Message",
    keyMessageInfo: "The main message that must come across to the audience through this project. Examples: product introduction, company history, service strengths, and so on.",
    keyMessagePh: "E.g. product introduction, company history",
    goals: "Project Goals",
    goalsInfo: "What you want to achieve with this project and how to measure it — awareness, leads, product launch, etc.",
    goalsPh: "Goals & measurable targets (awareness, leads, product launch…)",
    deliverables: "Deliverables",
    deliverablesInfo: "The work results you expect — one row = one item, fill in the quantity (e.g. 60-second animation video × 2). Click \"Add deliverable\" to add a row.",
    delivPh: "E.g. 60-second animation video",
    delivQtyAria: (n: number) => `Deliverable ${n} quantity`,
    delivNameAria: (n: number) => `Deliverable ${n} name`,
    delivAdd: "Add deliverable",
    delivRemove: (n: number) => `Remove deliverable ${n}`,
    budgetMin: (cur: string) => `Minimum Budget (${cur})`,
    budgetMinInfo: "The lowest budget you have prepared for this project — write the number only (thousand separators are optional).",
    budgetMinPh: "E.g. 50000000",
    budgetMax: (cur: string) => `Maximum Budget (${cur})`,
    budgetMaxInfo: "The highest budget you have prepared — this range helps us craft a realistic quotation.",
    budgetMaxPh: "E.g. 80000000",
    references: "References / Links",
    referencesInfo: "Links to style/video/design examples you like (YouTube, Behance, etc.) — add a label so we understand the context. Click \"Add reference\" to add a row.",
    refLabelPh: "Label (e.g. Style example)",
    refUrlPh: "https://…",
    refLabelAria: (n: number) => `Reference ${n} label`,
    refUrlAria: (n: number) => `Reference ${n} URL`,
    refAdd: "Add reference",
    refRemove: (n: number) => `Remove reference ${n}`,
    notes: "Attachment Notes",
    notesInfo: "Other supporting things we should know: logo/files to be sent, footage access, Drive links, etc.",
    notesPh: "E.g. Logo & footage available on Drive — link will be sent via WhatsApp",
    submit: "Send Request",
    submitting: "Sending…",
    submitNote: (brand: string) => `By submitting this form, your data will be processed by the ${brand} team for quotation purposes.`,
    successTitle: (first: string) => `Thank you, ${first}!`,
    successBody: (title: string, brand: string) => `Your request "${title}" has reached the ${brand} team. We will contact you via email/WhatsApp.`,
    successRef: "Brief reference number:",
    successEmailCopy: (email: string) => `A copy of this request has been sent to your email (${email}), together with the Initial Brief document and your client portal link.`,
    successVisit: (brand: string) => `Visit ${brand}`,
    errSubmitFail: "Failed to send the form — please try again",
    errLoadForm: "Failed to load the form",
    logoAlt: (brand: string) => `${brand} logo`,
  },
  id: {
    brandFallback: "brand kami",
    // Ronde 61 — judul halaman form request + intro tanpa prefiks redundan
    formTitle: "Formulir Request",
    intro: "Isi data di bawah ini — tim kami akan segera menindaklanjuti Anda.",
    loading: "Memuat formulir…",
    loadFail: "Formulir tidak dapat dibuka",
    errRequiredReview: "Periksa kembali kolom yang bertanda merah.",
    sec1Title: "Data Perusahaan",
    sec1Sub: "Alamat dipakai untuk dokumen resmi (surat, kontrak, invoice).",
    companyName: "Nama Perusahaan",
    companyNameInfo: "Nama resmi perusahaan/bisnis Anda — akan tampil di surat penawaran, kontrak, dan invoice.",
    companyNamePh: "PT Nusantara Kreatif",
    errCompanyName: "Nama perusahaan wajib diisi",
    industry: "Jenis Industri",
    industryInfo: "Bidang usaha perusahaan Anda (mis. F&B, Pendidikan, Properti) — membantu kami memahami konteks project. Ketik untuk mencari, boleh tulis industri baru.",
    address: "Alamat Perusahaan",
    addressInfo: "Alamat kantor lengkap (jalan, nomor, kode pos) — dipakai pada alamat surat penawaran, kontrak, dan dokumen resmi lainnya.",
    addressHint: "Contoh: Jl. Sudirman No. 12, Jakarta Pusat, 10220",
    errAddress: "Alamat perusahaan wajib diisi (dipakai untuk surat)",
    city: "Kota",
    cityInfo: "Kota/kabupaten lokasi kantor utama perusahaan Anda.",
    errCity: "Kota wajib diisi",
    country: "Negara",
    countryInfo: "Negara lokasi perusahaan — memengaruhi format mata uang & dokumen.",
    errCountry: "Negara wajib diisi",
    website: "Website",
    websiteInfo: "Situs resmi perusahaan (jika ada) — membantu kami mengenal bisnis Anda lebih cepat.",
    sec2Title: "Data Kontak Anda",
    sec2Sub: "Email dan WhatsApp wajib diisi — kami menghubungi Anda via salah satunya.",
    fullName: "Nama Lengkap",
    fullNameInfo: "Nama Anda — yang akan kami gunakan untuk menyapa saat menghubungi via email/WhatsApp.",
    fullNamePh: "Budi Santoso",
    errFullName: "Nama lengkap wajib diisi",
    email: "Email",
    emailInfo: "Email aktif untuk menerima penawaran, dokumen project, dan tautan approval.",
    emailPh: "budi@perusahaan.co.id",
    errEmailRequired: "Email wajib diisi",
    errEmailFormat: "Format email tidak valid — contoh yang benar: nama@perusahaan.co.id",
    whatsapp: "WhatsApp",
    whatsappInfo: "Nomor WhatsApp aktif untuk komunikasi cepat — pilih kode negara, lalu tulis nomor langsung tanpa awalan 0 (cth. 81234567890).",
    errWaRequired: "Nomor WhatsApp wajib diisi",
    errWaShort: "Nomor terlalu pendek — minimal 5 digit.",
    errWaLong: "Nomor terlalu panjang — maksimal 15 digit (standar E.164).",
    errWaZero: "Tanpa awalan 0 — pilih kode negara di atas, lalu tulis nomor langsung (cth. 81234567890).",
    errWaChars: "Nomor hanya boleh berisi angka, spasi, tanda hubung, dan kurung.",
    waPreview: "Tersimpan sebagai",
    waAria: "Nomor WhatsApp (tanpa kode negara)",
    sec3Title: "Detail Project",
    projectTitle: "Judul Project",
    projectTitleInfo: "Judul singkat kebutuhan Anda — contoh: Animasi Company Profile 2 Menit. Judul ini otomatis menjadi nama brief awal Anda.",
    projectTitlePh: "Tulis judul kebutuhan Anda",
    errProjectTitle: "Judul project wajib diisi",
    deadline: "Target Deadline",
    deadlineInfo: "Tanggal ideal project selesai/diserahkan — menjadi dasar rencana kerja & jadwal produksi kami.",
    errDeadline: "Target deadline wajib diisi",
    knowFrom: (brand: string) => `Dari mana Anda tahu ${brand}?`,
    knowFromInfo: "Sumber pertama kali Anda mengenal kami (mis. Instagram, Google, rekan bisnis) — membantu kami menilai kanal promosi yang efektif.",
    knowFromPh: "Pilih sumber…",
    knowFromAria: "Sumber info brand",
    knowFromEmpty: "Tidak ada opsi.",
    knowFromHeading: "Sumber",
    errKnowFrom: "Sumber informasi wajib dipilih",
    knowFromOther: "Sebutkan sumbernya",
    knowFromOtherPh: "Mis. brosur, radio, banner jalan…",
    sec4Title: "Brief Awal",
    sec4Sub: "Semakin lengkap, semakin cepat penawaran kami tepat sasaran.",
    audience: "Audiens Sasaran",
    audienceInfo: "Siapa yang ingin dijangkau project ini (mis. HRD BUMN, usia 30-45) — membantu kami menentukan gaya & pesan konten.",
    audiencePh: "Mis. HRD BUMN, usia 30-45",
    keyMessage: "Pesan Utama",
    keyMessageInfo: "Pesan utama yang harus tersampaikan ke audiens lewat project ini. Contohnya: pengenalan produk, sejarah perusahaan, keunggulan layanan, dan sebagainya.",
    keyMessagePh: "Mis. pengenalan produk, sejarah perusahaan",
    goals: "Tujuan Project",
    goalsInfo: "Apa yang ingin dicapai dari project ini dan bagaimana mengukurnya — awareness, leads, launch produk, dsb.",
    goalsPh: "Tujuan & target terukur (awareness, leads, launch produk…)",
    deliverables: "Deliverables",
    deliverablesInfo: "Rincian hasil kerja yang Anda harapkan — satu baris = satu item, isi jumlahnya (mis. Video animasi 60 detik × 2). Klik \"Tambah deliverable\" untuk menambah baris.",
    delivPh: "Mis. Video animasi 60 detik",
    delivQtyAria: (n: number) => `Jumlah deliverable ${n}`,
    delivNameAria: (n: number) => `Nama deliverable ${n}`,
    delivAdd: "Tambah deliverable",
    delivRemove: (n: number) => `Hapus deliverable ${n}`,
    budgetMin: (cur: string) => `Budget Minimum (${cur})`,
    budgetMinInfo: "Anggaran paling rendah yang Anda siapkan untuk project ini — tulis angka saja (boleh tanpa titik/koma).",
    budgetMinPh: "Mis. 50000000",
    budgetMax: (cur: string) => `Budget Maksimum (${cur})`,
    budgetMaxInfo: "Anggaran paling tinggi yang Anda siapkan — rentang ini membantu kami menyusun penawaran yang realistis.",
    budgetMaxPh: "Mis. 80000000",
    references: "Referensi / Tautan",
    referencesInfo: "Tautan contoh style/video/design yang Anda suka (YouTube, Behance, dsb.) — beri label agar kami paham konteksnya. Klik \"Tambah referensi\" untuk menambah baris.",
    refLabelPh: "Label (mis. Contoh style)",
    refUrlPh: "https://…",
    refLabelAria: (n: number) => `Label referensi ${n}`,
    refUrlAria: (n: number) => `URL referensi ${n}`,
    refAdd: "Tambah referensi",
    refRemove: (n: number) => `Hapus referensi ${n}`,
    notes: "Catatan Lampiran",
    notesInfo: "Hal pendukung lain yang perlu kami tahu: logo/file yang akan dikirim, akses footage, link Drive, dsb.",
    notesPh: "Mis. Logo & footage tersedia di Drive — link dikirim via WA",
    submit: "Kirim Request",
    submitting: "Mengirim…",
    submitNote: (brand: string) => `Dengan mengirim formulir, data Anda akan diproses tim ${brand} untuk keperluan penawaran.`,
    successTitle: (first: string) => `Terima kasih, ${first}!`,
    successBody: (title: string, brand: string) => `Request Anda "${title}" sudah masuk ke tim ${brand}. Kami akan menghubungi Anda melalui email/WhatsApp.`,
    successRef: "Nomor referensi brief:",
    successEmailCopy: (email: string) => `Salinan request ini dikirim ke email Anda (${email}), beserta dokumen Brief Awal dan link portal klien.`,
    successVisit: (brand: string) => `Kunjungi ${brand}`,
    errSubmitFail: "Gagal mengirim formulir — coba lagi",
    errLoadForm: "Gagal memuat formulir",
    logoAlt: (brand: string) => `Logo ${brand}`,
  },
} as const;

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

function Field({ label, required, hint, error, info, children, htmlFor }: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** Tooltip penjelasan maksud field (ikon info di samping label). */
  info?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-zinc-600">
        <span className="inline-flex items-center gap-1">
          {label} {required ? <span className="text-rose-600">*</span> : null}
          {info ? <FieldHintInLabel tip={info} /> : null}
        </span>
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

/** Toggle bahasa EN/ID — EN default (diprioritaskan user). Ronde 61: sentuh lebih besar. */
function LangToggle({ lang, onChange, accent }: { lang: Lang; onChange: (l: Lang) => void; accent: string }) {
  return (
    <div className="inline-flex items-center rounded-full border bg-white p-0.5 shadow-sm" role="group" aria-label="Language / Bahasa">
      {(["en", "id"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={lang === l}
          className={cn(
            "min-h-7 rounded-full px-3 py-1 text-xs font-semibold uppercase transition-colors",
            lang === l ? "text-white" : "text-zinc-500 hover:text-zinc-800",
          )}
          style={lang === l ? { backgroundColor: accent } : undefined}
        >
          {l === "en" ? "EN" : "ID"}
        </button>
      ))}
    </div>
  );
}

// ============ Komponen utama ============

export default function LeadIntakeForm({ token }: { token: string }) {
  const [meta, setMeta] = useState<IntakeMeta | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [lang, setLang] = useState<Lang>("en"); // EN default — diprioritaskan user
  const [values, setValues] = useState({ ...EMPTY });
  const [deliverables, setDeliverables] = useState<DelivRow[]>([{ name: "", qty: "1" }]);
  const [references, setReferences] = useState<RefRow[]>([{ label: "", url: "" }]);
  const [knowFromOpen, setKnowFromOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState<{ title: string; briefCode: string; emailStatus: string } | null>(null);

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
  // Ronde 62 — palet warna brand: aksen form ikut palette.accent bila diatur (fallback brand.color)
  const palette = useMemo(() => {
    try {
      const p = JSON.parse(brand?.palette ?? "{}") as Record<string, unknown>;
      return {
        accent: typeof p.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(p.accent) ? p.accent : "",
        background: typeof p.background === "string" && /^#[0-9a-fA-F]{6}$/.test(p.background) ? p.background : "",
        text: typeof p.text === "string" && /^#[0-9a-fA-F]{6}$/.test(p.text) ? p.text : "",
      };
    } catch { return { accent: "", background: "", text: "" }; }
  }, [brand?.palette]);
  const accent = palette.accent || (brand?.color ?? "#18181b");
  const t = STR[lang];
  const set = (k: keyof typeof EMPTY) => (v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e)); // hapus error saat mengetik
  };

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

  /** Saran industri sesuai bahasa: konstanta ID dipetakan ke EN (nilai DB lain apa adanya). */
  const industryOptions = useMemo(() => {
    const list = meta?.industries ?? [];
    if (lang === "id") return list;
    const pairMap = new Map(INDUSTRY_SUGGESTIONS_PAIRS.map((p) => [p.id, p.en]));
    return Array.from(new Set(list.map((item) => pairMap.get(item) ?? item))).sort((a, b) => a.localeCompare(b));
  }, [meta, lang]);

  const submit = async () => {
    setFormError("");
    // ===== Validasi "sesuai sistem" (pola Ronde 42/44) — pesan sesuai bahasa =====
    const e: Record<string, string> = {};
    if (!values.fullName.trim()) e.fullName = t.errFullName;
    if (!values.companyName.trim()) e.companyName = t.errCompanyName;
    if (!values.companyAddress.trim()) e.companyAddress = t.errAddress;
    if (!values.companyCity.trim()) e.companyCity = t.errCity;
    if (!values.companyCountry.trim()) e.companyCountry = t.errCountry;
    if (!values.projectTitle.trim()) e.projectTitle = t.errProjectTitle;
    if (!values.deadline) e.deadline = t.errDeadline;
    // Email: wajib + format valid (aturan validator sistem, pesan bilingual).
    const vEmail = emailError(values.email);
    if (!values.email.trim()) e.email = t.errEmailRequired;
    else if (vEmail) e.email = t.errEmailFormat;
    // WhatsApp: wajib + aturan nomor nasional sistem (5–15 digit, tanpa 0 di depan bila pakai kode negara).
    const wa = values.whatsapp.trim();
    if (!wa) e.whatsapp = t.errWaRequired;
    else {
      const vWa = nationalPhoneError(wa, !values.whatsappDial);
      if (vWa) {
        // Pesan validator (ID) dipetakan ke pesan bahasa pilihan — aturan tetap "sesuai sistem".
        if (vWa.includes("pendek")) e.whatsapp = t.errWaShort;
        else if (vWa.includes("panjang")) e.whatsapp = t.errWaLong;
        else if (vWa.includes("awalan")) e.whatsapp = t.errWaZero;
        else e.whatsapp = t.errWaChars;
      }
    }
    // Ronde 60 — "Dari mana Anda tahu kami" WAJIB.
    if (!values.knowFrom) e.knowFrom = t.errKnowFrom;
    setErrors(e);
    if (Object.values(e).some(Boolean)) {
      setFormError(t.errRequiredReview);
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
        industry: toTitleCase(values.industry), // kategori industri → Title Case
        whatsapp: whatsappPayload,
        lang, // bahasa form → bahasa email salinan
        knowFrom: values.knowFrom === "other" ? (values.knowFromOther.trim() || "other") : values.knowFrom,
        deliverables: deliverables
          .filter((d) => d.name.trim())
          .map((d) => ({ name: d.name.trim().slice(0, 160), qty: Math.max(1, Math.min(999, Number(d.qty) || 1)) })),
        references: references
          .filter((r) => r.url.trim())
          .map((r) => ({ label: (r.label.trim() || r.url.trim()).slice(0, 80), url: r.url.trim().slice(0, 500) })),
      });
      setDone({ title: res.opportunity.title, briefCode: res.briefCode, emailStatus: res.emailStatus ?? "skipped" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t.errSubmitFail);
    } finally {
      setSaving(false);
    }
  };

  // ===== Layar sukses =====
  if (done) {
    const brandName = brand?.name ?? t.brandFallback;
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 py-10">
        <div className="w-full max-w-lg rounded-xl border bg-white p-6 text-center shadow-sm sm:p-8" role="status">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-zinc-900">{t.successTitle(values.fullName.split(" ")[0])}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t.successBody(done.title, brandName)}
          </p>
          <div className="mt-4 space-y-1.5 rounded-lg border bg-zinc-50 px-4 py-3 text-left text-xs text-zinc-600">
            <p>{t.successRef} <span className="font-mono font-semibold text-zinc-900">{done.briefCode}</span></p>
            {(done.emailStatus === "sent" || done.emailStatus === "simulated") ? (
              <p>{t.successEmailCopy(values.email)}</p>
            ) : null}
          </div>
          {brand?.website ? (
            <a
              href={brand.website}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              style={{ color: accent }}
            >
              {t.successVisit(brandName)} <ExternalLink className="size-3.5" aria-hidden="true" />
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
          <div className="flex flex-col items-center gap-3 text-zinc-500" role="status" aria-label={t.loading}>
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            <p className="text-xs">{t.loading}</p>
          </div>
        ) : (
          <div className="w-full max-w-md rounded-xl border bg-white p-6 text-center shadow-sm">
            <AlertTriangle className="mx-auto size-10 text-amber-500" aria-hidden="true" />
            <h1 className="mt-3 text-base font-bold text-zinc-900">{t.loadFail}</h1>
            <p className="mt-1 text-sm text-zinc-600">{loadError}</p>
          </div>
        )}
      </main>
    );
  }

  // Guard TS: setelah gate di atas, meta pasti sudah termuat.
  if (!meta) return null;

  const currency = brand?.primaryCurrency ?? "IDR";
  const brandName = brand?.name ?? t.brandFallback;
  const knowFromLabel = meta.knowFrom.find((k) => k.key === values.knowFrom)
    ? ((lang === "en" ? meta.knowFrom.find((k) => k.key === values.knowFrom)?.labelEn : undefined) ?? meta.knowFrom.find((k) => k.key === values.knowFrom)?.label)
    : (values.knowFrom === "other" || !values.knowFrom ? "" : values.knowFrom);

  return (
    <main className="min-h-screen bg-zinc-100 pb-16">
      {/* Header brand — Ronde 61: toggle bahasa di baris sendiri (kanan-atas, tidak lagi
          menempel di kiri atas konten), blok brand terpusat, dan JUDUL "Form Request" jelas. */}
      <header className="border-b bg-white" style={{ borderTop: `4px solid ${accent}` }}>
        <div className="mx-auto max-w-3xl px-4 py-5 sm:py-6">
          <div className="flex justify-end">
            <LangToggle lang={lang} onChange={setLang} accent={accent} />
          </div>
          <div className="-mt-1 flex flex-col items-center gap-1.5 text-center sm:gap-2">
            {/* Ronde 62 — latar logo: logo putih (mis. Segia) tampil jelas di latar gelap */}
            {brand?.logoUrl ? (
              <span
                className="inline-flex max-w-full items-center justify-center rounded-lg px-2.5 py-1.5"
                style={{ backgroundColor: (brand.logoBg ?? "").trim() || "transparent" }}
              >
                <img src={brand.logoUrl} alt={t.logoAlt(brandName)} className="h-11 w-auto object-contain sm:h-14" />
              </span>
            ) : (
              <span className="flex size-11 items-center justify-center rounded-xl text-base font-black text-white sm:size-12" style={{ backgroundColor: accent }} aria-hidden="true">
                {brand?.name?.charAt(0) ?? "F"}
              </span>
            )}
            <div>
              <p className="text-base font-bold leading-tight text-zinc-900 sm:text-lg">{brand?.name}</p>
              {brand?.tagline ? <p className="text-xs text-zinc-500 sm:text-sm">{brand.tagline}</p> : null}
            </div>
            {/* Ronde 61 — judul halaman yang diminta user: "Form Request" */}
            <h1
              className="mt-1.5 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-bold tracking-wide sm:text-base"
              style={{ borderColor: `${accent}59`, backgroundColor: `${accent}0d`, color: accent }}
            >
              <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
              {t.formTitle}
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-600">{t.intro}</p>
          </div>
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
        <SectionCard icon={Building2} title={t.sec1Title} subtitle={t.sec1Sub} accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={t.companyName} required info={t.companyNameInfo} error={errors.companyName} htmlFor="int-company">
              <Input id="int-company" value={values.companyName} onChange={(e) => set("companyName")(e.target.value)} placeholder={t.companyNamePh} autoComplete="organization" aria-invalid={!!errors.companyName} />
            </Field>
            <Field label={t.industry} info={t.industryInfo}>
              <IndustryCombobox value={values.industry} onChange={set("industry")} suggestions={industryOptions} />
            </Field>
          </div>
          {/* R62-c — hint dihilangkan: teks contoh sama persis dgn placeholder di dalam field (duplikat saat kosong) */}
          <Field label={t.address} required info={t.addressInfo} error={errors.companyAddress} htmlFor="int-address">
            <Textarea id="int-address" value={values.companyAddress} onChange={(e) => set("companyAddress")(e.target.value)} rows={2} placeholder={t.addressHint} aria-invalid={!!errors.companyAddress} />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label={t.city} required info={t.cityInfo} error={errors.companyCity} htmlFor="int-city">
              <Input id="int-city" value={values.companyCity} onChange={(e) => set("companyCity")(e.target.value)} placeholder="Jakarta" aria-invalid={!!errors.companyCity} />
            </Field>
            <Field label={t.country} required info={t.countryInfo} error={errors.companyCountry} htmlFor="int-country">
              <Input id="int-country" value={values.companyCountry} onChange={(e) => set("companyCountry")(e.target.value)} placeholder="Indonesia" aria-invalid={!!errors.companyCountry} />
            </Field>
            <Field label={t.website} info={t.websiteInfo}>
              <Input id="int-web" value={values.companyWebsite} onChange={(e) => set("companyWebsite")(e.target.value)} placeholder="company.co.id" />
            </Field>
          </div>
        </SectionCard>

        {/* 2 — Kontak: email + WA wajib & validasi sistem */}
        <SectionCard icon={User} title={t.sec2Title} subtitle={t.sec2Sub} accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={t.fullName} required info={t.fullNameInfo} error={errors.fullName} htmlFor="int-name">
              <Input id="int-name" value={values.fullName} onChange={(e) => set("fullName")(e.target.value)} placeholder={t.fullNamePh} autoComplete="name" aria-invalid={!!errors.fullName} />
            </Field>
            <Field label={t.email} required info={t.emailInfo} error={errors.email} htmlFor="int-email">
              <Input id="int-email" type="email" value={values.email} onChange={(e) => set("email")(e.target.value)} placeholder={t.emailPh} autoComplete="email" aria-invalid={!!errors.email} />
            </Field>
          </div>
          <Field label={t.whatsapp} required info={t.whatsappInfo} error={errors.whatsapp}>
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
                aria-label={t.waAria}
                aria-invalid={!!errors.whatsapp}
              />
            </div>
            {waPreview && !errors.whatsapp ? <p className="text-[11px] text-zinc-400">{t.waPreview} {waPreview}</p> : null}
          </Field>
        </SectionCard>

        {/* 3 — Detail project */}
        <SectionCard icon={Target} title={t.sec3Title} accent={accent}>
          <Field label={t.projectTitle} required info={t.projectTitleInfo} error={errors.projectTitle} htmlFor="int-title">
            <Input id="int-title" value={values.projectTitle} onChange={(e) => set("projectTitle")(e.target.value)} placeholder={t.projectTitlePh} aria-invalid={!!errors.projectTitle} />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={t.deadline} required info={t.deadlineInfo} error={errors.deadline} htmlFor="int-deadline">
              <Input id="int-deadline" type="date" value={values.deadline} onChange={(e) => set("deadline")(e.target.value)} min={new Date().toISOString().slice(0, 10)} aria-invalid={!!errors.deadline} />
            </Field>
            <Field label={t.knowFrom(brandName)} required info={t.knowFromInfo} error={errors.knowFrom}>
              <Popover open={knowFromOpen} onOpenChange={setKnowFromOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" aria-expanded={knowFromOpen} aria-label={t.knowFromAria} className={cn("w-full justify-between bg-white font-normal", !knowFromLabel && "text-zinc-500")}>
                    <span className="truncate">{knowFromLabel || t.knowFromPh}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandList className="crm-scroll max-h-60">
                      {meta.knowFrom.length === 0 ? <CommandEmpty>{t.knowFromEmpty}</CommandEmpty> : (
                        <CommandGroup heading={t.knowFromHeading}>
                          {meta.knowFrom.map((k) => (
                            <CommandItem key={k.key} value={k.key} onSelect={() => { set("knowFrom")(k.key); setKnowFromOpen(false); }}>
                              <Check className={cn("mr-2 size-4", values.knowFrom === k.key ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                              {lang === "en" ? (k.labelEn ?? k.label) : k.label}
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
            <Field label={t.knowFromOther} htmlFor="int-knowother">
              <Input id="int-knowother" value={values.knowFromOther} onChange={(e) => set("knowFromOther")(e.target.value)} placeholder={t.knowFromOtherPh} />
            </Field>
          ) : null}
        </SectionCard>

        {/* 4 — Brief awal: format input = persis form brief internal (brief-panel) */}
        <SectionCard icon={ClipboardList} title={t.sec4Title} subtitle={t.sec4Sub} accent={accent}>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={t.audience} info={t.audienceInfo} htmlFor="int-audience">
              <Input id="int-audience" value={values.targetAudience} onChange={(e) => set("targetAudience")(e.target.value)} placeholder={t.audiencePh} />
            </Field>
            {/* Ronde 60 — Keyword intake = PESAN UTAMA (keyMessages), beda dgn keyword brief internal */}
            <Field label={t.keyMessage} info={t.keyMessageInfo} htmlFor="int-keymessage">
              <Input id="int-keymessage" value={values.keyMessages} onChange={(e) => set("keyMessages")(e.target.value)} placeholder={t.keyMessagePh} />
            </Field>
          </div>
          <Field label={t.goals} info={t.goalsInfo} htmlFor="int-objective">
            <Textarea id="int-objective" value={values.objectives} onChange={(e) => set("objectives")(e.target.value)} rows={2} placeholder={t.goalsPh} />
          </Field>
          {/* Deliverables — baris dinamis (nama + jumlah), sama dgn brief internal */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-zinc-600">{t.deliverables}</p>
              <FieldHint tip={t.deliverablesInfo} />
            </div>
            <div className="space-y-1.5">
              {deliverables.map((d, i) => (
                <RowList key={i} ariaLabel={t.delivRemove(i + 1)} onRemove={() => setDeliverables((rows) => rows.filter((_, j) => j !== i))}>
                  <Input
                    value={d.name}
                    onChange={(e) => setDeliverables((rows) => rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    placeholder={t.delivPh}
                    aria-label={t.delivNameAria(i + 1)}
                  />
                  <Input
                    type="number"
                    min={1}
                    value={d.qty}
                    onChange={(e) => setDeliverables((rows) => rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    className="w-16 shrink-0"
                    aria-label={t.delivQtyAria(i + 1)}
                  />
                </RowList>
              ))}
            </div>
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setDeliverables((rows) => [...rows, { name: "", qty: "1" }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t.delivAdd}
              </Button>
            </div>
          </div>
          {/* Budget — label & placeholder sama dgn brief internal (digit diparse saat kirim) */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label={t.budgetMin(currency)} info={t.budgetMinInfo} htmlFor="int-bmin">
              <Input id="int-bmin" inputMode="numeric" value={values.budgetMin} onChange={(e) => set("budgetMin")(e.target.value)} placeholder={t.budgetMinPh} />
            </Field>
            <Field label={t.budgetMax(currency)} info={t.budgetMaxInfo} htmlFor="int-bmax">
              <Input id="int-bmax" inputMode="numeric" value={values.budgetMax} onChange={(e) => set("budgetMax")(e.target.value)} placeholder={t.budgetMaxPh} />
            </Field>
          </div>
          {/* Referensi — baris dinamis (label + url), sama dgn brief internal */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-zinc-600">{t.references}</p>
              <FieldHint tip={t.referencesInfo} />
            </div>
            <div className="space-y-1.5">
              {references.map((r, i) => (
                <RowList key={i} ariaLabel={t.refRemove(i + 1)} onRemove={() => setReferences((rows) => rows.filter((_, j) => j !== i))}>
                  <Input
                    value={r.label}
                    onChange={(e) => setReferences((rows) => rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    placeholder={t.refLabelPh}
                    className="w-2/5 shrink-0"
                    aria-label={t.refLabelAria(i + 1)}
                  />
                  <Input
                    value={r.url}
                    onChange={(e) => setReferences((rows) => rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    placeholder={t.refUrlPh}
                    aria-label={t.refUrlAria(i + 1)}
                  />
                </RowList>
              ))}
            </div>
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setReferences((rows) => [...rows, { label: "", url: "" }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t.refAdd}
              </Button>
            </div>
          </div>
          <Field label={t.notes} info={t.notesInfo} htmlFor="int-notes">
            <Input id="int-notes" value={values.catatan} onChange={(e) => set("catatan")(e.target.value)} placeholder={t.notesPh} />
          </Field>
        </SectionCard>

        {/* Submit */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button size="lg" className="w-full max-w-md" onClick={submit} disabled={saving} style={{ backgroundColor: accent }}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {saving ? t.submitting : t.submit}
          </Button>
          <p className="text-center text-[11px] text-zinc-500">{t.submitNote(brandName)}</p>
        </div>
      </div>
    </main>
  );
}
