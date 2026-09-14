"use client";

/**
 * Task 23-d — Client Token Portal.
 * Halaman publik secure-link klien (tanpa login): dibuka lewat `/?portal=<token>`.
 * Berisi MoU/dokumen, catatan rapat, dan deliverable proyek yang bisa direview
 * langsung oleh klien (Setujui / Minta Revisi). Standalone — TANPA chrome CRM.
 * Palet: zinc/orange/emerald/amber.
 *
 * Ronde 60 (masukan user):
 *  - MULTI-BAHASA: toggle EN/ID, default ENGLISH (diprioritaskan user) — semua
 *    judul section, status, tombol, empty state, footer, dan tanggal ikut bahasa.
 *  - Invoice DRAFT tidak muncul (difilter di API); kini tiap card invoice punya
 *    DETAIL: klik baris → dialog rinci (item, subtotal/diskon/pajak/total,
 *    amount in words, jadwal termin, nomor PO/project).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Building2, CalendarDays, Check, ChevronRight, ExternalLink, FileSignature, FileText, Link2, ListChecks,
  Lock, Milestone, Paperclip, Receipt, ShieldAlert, Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { portalApi } from "@/lib/crm/api-client";
import type { ClientDocumentDTO, PortalInvoiceSummary, PortalTokenPayload, ProjectDeliverableDTO } from "@/lib/crm/types";
import { formatCurrencyFull, formatDate, formatDateTime } from "@/lib/crm/utils";
import { describeDueEn } from "@/lib/crm/payment-terms";
import { cn } from "@/lib/utils";

type Lang = "en" | "id";

// ============ Kamus multi-bahasa (EN default — diprioritaskan user) ============

const STR = {
  en: {
    portalBadge: "Client Portal",
    secureNote: "Secure access without login — this link is confidential.",
    secDocs: "Documents & MoU",
    secNotes: "Meeting Notes",
    secDeliv: "Deliverables & Review",
    secInv: "Invoices & Billing",
    emptyDocs: "No documents have been shared yet.",
    emptyNotes: "No meeting notes have been shared yet.",
    emptyProjects: "No projects have been shared yet.",
    emptyDeliv: "No deliverables on this project yet.",
    emptyInvoices: "No invoices have been issued yet.",
    invoiceNote: "For payment confirmation or billing questions, please contact our team through the agreed channel.",
    kindMou: "MoU",
    kindDoc: "Document",
    openLink: "Open link",
    target: "Target",
    milestones: "Project Milestones",
    reviewerPh: "Your name",
    commentPh: "Comment (optional)",
    approve: "Approve",
    requestRevision: "Request Revision",
    reviewSaved: "Thank you, your review has been saved.",
    reviewNameErr: "Please fill in your name first.",
    reviewFail: "Failed to save review. Please try again.",
    by: "by",
    footerNote: (company: string) => `Secure link dedicated to ${company}. Please do not share it with others.`,
    errLoad: "Something went wrong while loading the portal.",
    errUnavailable: "Link unavailable",
    errHint: "Ask our team for a new link, or reply to the chat that sent you this link.",
    // Detail invoice
    invoiceDetail: "Invoice Detail",
    invNumber: "Invoice No.",
    invDate: "Issued",
    invDue: "Due",
    invProject: "Project",
    invPo: "Purchase No.",
    invBrand: "Brand",
    invAttn: "Attention",
    invItems: "Items",
    invDesc: "Description",
    invQty: "Qty",
    invUnit: "Unit",
    invUnitPrice: "Unit Price",
    invAmount: "Amount",
    invSubtotal: "Amount",
    invDiscount: "Discount",
    invTax: (name: string, pct: number) => `${name} (${pct}%)`,
    invTotal: "Total",
    invTotalPayment: "Total Payment",
    invGrossUp: "Gross-Up",
    invLess: "Less",
    invWords: "Amount in words",
    invTerms: "Payment Terms",
    invNoItems: "No line items on this invoice.",
    invEmpty: "-",
    close: "Close",
    viewDetail: "View detail",
    inclTax: "including tax",
    errLoadInvoice: "Failed to load invoice details.",
  },
  id: {
    portalBadge: "Portal Klien",
    secureNote: "Akses aman tanpa login — tautan ini bersifat rahasia.",
    secDocs: "Dokumen & MoU",
    secNotes: "Catatan Rapat",
    secDeliv: "Deliverable & Review",
    secInv: "Tagihan & Invoice",
    emptyDocs: "Belum ada dokumen yang dibagikan.",
    emptyNotes: "Belum ada catatan rapat yang dibagikan.",
    emptyProjects: "Belum ada proyek yang dibagikan.",
    emptyDeliv: "Belum ada deliverable pada proyek ini.",
    emptyInvoices: "Belum ada tagihan yang diterbitkan.",
    invoiceNote: "Untuk konfirmasi pembayaran atau pertanyaan tagihan, silakan hubungi tim kami melalui kanal yang sudah disepakati.",
    kindMou: "MoU",
    kindDoc: "Dokumen",
    openLink: "Buka tautan",
    target: "Target",
    milestones: "Tahapan Proyek",
    reviewerPh: "Nama Anda",
    commentPh: "Komentar (opsional)",
    approve: "Setujui",
    requestRevision: "Minta Revisi",
    reviewSaved: "Terima kasih, review tersimpan.",
    reviewNameErr: "Isi nama Anda terlebih dahulu.",
    reviewFail: "Gagal menyimpan review. Coba lagi.",
    by: "oleh",
    footerNote: (company: string) => `Tautan aman khusus untuk ${company}. Jangan bagikan ke pihak lain.`,
    errLoad: "Terjadi kesalahan saat memuat portal.",
    errUnavailable: "Tautan tidak tersedia",
    errHint: "Minta tautan baru kepada tim kami atau balas chat yang mengirim tautan ini.",
    // Detail invoice
    invoiceDetail: "Detail Invoice",
    invNumber: "No. Invoice",
    invDate: "Terbit",
    invDue: "Jatuh Tempo",
    invProject: "Project",
    invPo: "No. PO",
    invBrand: "Brand",
    invAttn: "Untuk",
    invItems: "Rincian Item",
    invDesc: "Deskripsi",
    invQty: "Qty",
    invUnit: "Satuan",
    invUnitPrice: "Harga Satuan",
    invAmount: "Jumlah",
    invSubtotal: "Jumlah",
    invDiscount: "Diskon",
    invTax: (name: string, pct: number) => `${name} (${pct}%)`,
    invTotal: "Total",
    invTotalPayment: "Total Pembayaran",
    invGrossUp: "Gross-Up",
    invLess: "Dikurangi",
    invWords: "Jumlah dalam huruf",
    invTerms: "Term Pembayaran",
    invNoItems: "Tidak ada rincian item pada invoice ini.",
    invEmpty: "-",
    close: "Tutup",
    viewDetail: "Lihat detail",
    inclTax: "termasuk pajak",
    errLoadInvoice: "Gagal memuat detail invoice.",
  },
} as const;

// ============ Status maps (bilingual) ============

const PROJECT_STATUS: Record<string, { en: string; id: string; cls: string }> = {
  planning: { en: "Planning", id: "Perencanaan", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
  in_progress: { en: "In Progress", id: "Berjalan", cls: "bg-amber-100 text-amber-700 border-transparent" },
  review: { en: "Review", id: "Review", cls: "bg-amber-100 text-amber-700 border-transparent" },
  completed: { en: "Completed", id: "Selesai", cls: "bg-emerald-100 text-emerald-700 border-transparent" },
  cancelled: { en: "Cancelled", id: "Dibatalkan", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
};

const DELIVERABLE_STATUS: Record<string, { en: string; id: string; cls: string }> = {
  pending: { en: "Pending Review", id: "Menunggu Review", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
  approved: { en: "Approved", id: "Disetujui", cls: "bg-emerald-100 text-emerald-700 border-transparent" },
  revision: { en: "Revision Requested", id: "Revisi Diminta", cls: "bg-amber-100 text-amber-700 border-transparent" },
};

// Ronde 48 — status milestone & invoice untuk secure link klien
const MILESTONE_DOT: Record<string, string> = {
  pending: "bg-zinc-300",
  in_progress: "bg-amber-500",
  done: "bg-emerald-500",
};
// Ronde 60 — draft tidak pernah muncul (difilter API); label tetap disediakan utk data lama
const INVOICE_STATUS: Record<string, { en: string; id: string; cls: string }> = {
  draft: { en: "Draft", id: "Draf", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
  sent: { en: "Sent", id: "Terkirim", cls: "bg-amber-100 text-amber-700 border-transparent" },
  partial: { en: "Partially Paid", id: "Dibayar Sebagian", cls: "bg-amber-100 text-amber-700 border-transparent" },
  paid: { en: "Paid", id: "Lunas", cls: "bg-emerald-100 text-emerald-700 border-transparent" },
  overdue: { en: "Overdue", id: "Jatuh Tempo", cls: "bg-rose-100 text-rose-700 border-transparent" },
};

function kb(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024));
}

/** Toggle bahasa EN/ID — EN default (diprioritaskan user). */
function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center rounded-full border bg-white p-0.5" role="group" aria-label="Language / Bahasa">
      {(["en", "id"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={lang === l}
          className={cn(
            "min-h-6 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase transition-colors",
            lang === l ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800",
          )}
        >
          {l === "en" ? "EN" : "ID"}
        </button>
      ))}
    </div>
  );
}

export default function ClientTokenPortal({ token }: { token: string }) {
  const [data, setData] = useState<PortalTokenPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en"); // EN default — diprioritaskan user
  const [detailInv, setDetailInv] = useState<PortalInvoiceSummary | null>(null);

  const t = STR[lang];
  const locale = lang === "en" ? "en-GB" : "id-ID";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await portalApi.byToken(token);
      setData(payload);
      setError(null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat portal.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PortalSkeleton />;
  if (error || !data) return <PortalError message={error ?? t.errLoad} hint={t.errHint} title={t.errUnavailable} />;

  const documents = data.documents.filter((d) => d.kind !== "meeting_note");
  const meetingNotes = data.documents.filter((d) => d.kind === "meeting_note");

  return (
    <div className="min-h-screen bg-zinc-100">
      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* ===== Header ===== */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                <Building2 className="h-6 w-6 text-orange-600" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-zinc-900">{data.company.name}</h1>
                <p className="truncate text-sm text-zinc-500">
                  {[data.company.industry, data.company.city].filter(Boolean).join(" · ") || t.portalBadge}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge className="bg-zinc-900 text-white">{t.portalBadge}</Badge>
              {data.token.label ? (
                <Badge variant="outline" className="border-zinc-300 text-zinc-600">
                  {data.token.label}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t.secureNote}
            </p>
            <LangToggle lang={lang} onChange={setLang} />
          </div>
        </section>

        <div className="mt-6 space-y-6">
          {/* ===== (a) Dokumen & MoU ===== */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                <FileSignature className="h-4 w-4 text-orange-600" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900">{t.secDocs}</h2>
              {documents.length > 0 ? (
                <span className="text-xs text-zinc-400">{documents.length}</span>
              ) : null}
            </div>

            {documents.length === 0 ? (
              <EmptyState text={t.emptyDocs} />
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {documents.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} t={t} locale={locale} />
                ))}
              </div>
            )}
          </section>

          {/* ===== (b) Catatan Rapat ===== */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                <CalendarDays className="h-4 w-4 text-orange-600" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900">{t.secNotes}</h2>
              {meetingNotes.length > 0 ? (
                <span className="text-xs text-zinc-400">{meetingNotes.length}</span>
              ) : null}
            </div>

            {meetingNotes.length === 0 ? (
              <EmptyState text={t.emptyNotes} />
            ) : (
              <div className="mt-4 ml-3 space-y-6 border-l-2 border-zinc-200 pl-5">
                {meetingNotes.map((n) => {
                  const date = n.meetingAt ? formatDateTime(n.meetingAt, locale) : formatDate(n.createdAt, locale);
                  return (
                    <div key={n.id} className="relative">
                      <span
                        className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-4 ring-white"
                        aria-hidden="true"
                      />
                      <p className="text-xs font-medium text-zinc-500">{date}</p>
                      <p className="mt-1 font-bold text-zinc-900">{n.title}</p>
                      {n.attendees ? <AttendeeChips attendees={n.attendees} /> : null}
                      {n.content ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{n.content}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ===== (c) Deliverable & Review ===== */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                <ListChecks className="h-4 w-4 text-orange-600" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900">{t.secDeliv}</h2>
            </div>

            {data.projects.length === 0 ? (
              <EmptyState text={t.emptyProjects} />
            ) : (
              <div className="mt-4 space-y-4">
                {data.projects.map((p) => {
                  const st = PROJECT_STATUS[p.status]
                    ?? { en: p.status, id: p.status, cls: "bg-zinc-100 text-zinc-600 border-transparent" };
                  return (
                    <div key={p.id} className="rounded-xl border border-zinc-200">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-zinc-900">
                            <span className="font-mono text-sm text-zinc-400">{p.code}</span>
                            {" · "}
                            {p.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {[p.brandName, p.dueDate ? `${t.target}: ${formatDate(p.dueDate, locale)}` : null]
                              .filter(Boolean)
                              .join(" · ") || t.portalBadge}
                          </p>
                        </div>
                        <Badge className={st.cls}>{lang === "en" ? st.en : st.id}</Badge>
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-3">
                          <Progress value={p.progress} className="h-2 flex-1 [&>div]:bg-orange-500" />
                          <span className="w-10 shrink-0 text-right text-xs font-medium text-zinc-500">
                            {p.progress}%
                          </span>
                        </div>

                        {/* Ronde 48 — timeline milestone: klien tahu tahapan proyeknya */}
                        {p.milestones.length > 0 ? (
                          <div className="mt-4">
                            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                              <Milestone className="h-3.5 w-3.5" aria-hidden /> {t.milestones}
                            </p>
                            <ol className="ml-2 space-y-2.5 border-l-2 border-zinc-100 pl-4">
                              {p.milestones.map((m) => (
                                <li key={m.id} className="relative">
                                  <span
                                    className={`absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white ${MILESTONE_DOT[m.status] ?? "bg-zinc-300"}`}
                                    aria-hidden="true"
                                  />
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <p className={`text-sm ${m.status === "done" ? "font-medium text-zinc-500 line-through decoration-zinc-300" : "font-medium text-zinc-800"}`}>
                                      {m.name}
                                    </p>
                                    {m.dueDate ? (
                                      <span className="text-[11px] text-zinc-400">{t.target.toLowerCase()} {formatDate(m.dueDate, locale)}</span>
                                    ) : null}
                                  </div>
                                  {m.achievement ? (
                                    <p className="mt-0.5 text-xs leading-snug text-zinc-500">{m.achievement}</p>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}

                        <div className="mt-3 divide-y divide-zinc-100">
                          {p.deliverables.length === 0 ? (
                            <p className="py-3 text-sm text-zinc-400">{t.emptyDeliv}</p>
                          ) : (
                            p.deliverables.map((d) => (
                              <DeliverableRow key={d.id} token={token} deliverable={d} onReviewed={load} t={t} lang={lang} />
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ===== (d) Tagihan & Invoice — Ronde 48 / 60 ===== */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                <Receipt className="h-4 w-4 text-orange-600" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900">{t.secInv}</h2>
              {data.invoices.length > 0 ? (
                <span className="text-xs text-zinc-400">{data.invoices.length}</span>
              ) : null}
            </div>

            {data.invoices.length === 0 ? (
              <EmptyState text={t.emptyInvoices} />
            ) : (
              <div className="mt-4 space-y-3">
                {data.invoices.map((inv) => {
                  const st = INVOICE_STATUS[inv.status]
                    ?? { en: inv.status, id: inv.status, cls: "bg-zinc-100 text-zinc-600 border-transparent" };
                  return (
                    // Ronde 60 — tiap card invoice bisa dibuka detailnya
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setDetailInv(inv)}
                      aria-label={`${t.viewDetail}: ${inv.number}`}
                      className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-zinc-900">{inv.number}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {[inv.description, inv.issueDate ? `${t.invDate} ${formatDate(inv.issueDate, locale)}` : null, inv.dueDate ? `${t.invDue} ${formatDate(inv.dueDate, locale)}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-zinc-900">{formatCurrencyFull(inv.total, inv.currency)}</p>
                          <p className="text-[10px] text-zinc-400">{t.inclTax}</p>
                        </div>
                        <Badge className={st.cls}>{lang === "en" ? st.en : st.id}</Badge>
                        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                      </div>
                    </button>
                  );
                })}
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  {t.invoiceNote}
                </p>
              </div>
            )}
          </section>
        </div>

        {/* ===== Footer ===== */}
        <footer className="mt-8 pb-4 text-center">
          <p className="inline-flex max-w-md items-start justify-center gap-1.5 text-xs leading-relaxed text-zinc-400">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t.footerNote(data.company.name)}</span>
          </p>
        </footer>
      </main>

      {/* ===== Dialog detail invoice (Ronde 60) ===== */}
      <InvoiceDetailDialog
        invoice={detailInv}
        lang={lang}
        locale={locale}
        onClose={() => setDetailInv(null)}
      />
    </div>
  );
}

// ============ Dialog detail invoice (Ronde 60) ============

function InvoiceDetailDialog({ invoice, lang, locale, onClose }: {
  invoice: PortalInvoiceSummary | null;
  lang: Lang;
  locale: string;
  onClose: () => void;
}) {
  const t = STR[lang];
  if (!invoice) return null;
  const inv = invoice;
  const st = INVOICE_STATUS[inv.status]
    ?? { en: inv.status, id: inv.status, cls: "bg-zinc-100 text-zinc-600 border-transparent" };

  const subtotal = inv.items.length > 0
    ? inv.items.reduce((s, it) => s + Math.round((Number(it.qty) || 1) * (Number(it.unitPrice) || 0)), 0)
    : Math.round(inv.amount || 0);
  const discount = Math.max(0, Math.round(Number(inv.discountAmount) || 0));
  const afterDiscount = subtotal - discount;
  const taxName = (inv.taxName ?? "").trim();
  const taxPct = taxName ? Math.max(0, Number(inv.taxRate) || 0) : 0;
  const taxMode = inv.taxMode ?? "add";

  // Baris blok total — meniru gaya faktur Unicam (R56)
  const totalRows: Array<{ label: string; value: string; bold?: boolean; muted?: boolean; red?: boolean }> = [];
  if (discount > 0) totalRows.push({ label: t.invDiscount, value: `-${formatCurrencyFull(discount, inv.currency)}`, red: true });
  totalRows.push({ label: t.invSubtotal, value: formatCurrencyFull(afterDiscount, inv.currency) });
  if (taxMode === "grossup" && taxName) totalRows.push({ label: t.invGrossUp, value: formatCurrencyFull(inv.taxAmount, inv.currency), muted: true });
  else if (taxName) totalRows.push({ label: t.invTax(taxName, taxPct), value: formatCurrencyFull(inv.taxAmount, inv.currency), muted: true });
  totalRows.push({ label: t.invTotal, value: formatCurrencyFull(inv.total, inv.currency), bold: true });
  if (taxMode === "grossup" && taxName) totalRows.push({ label: t.invLess, value: `-${formatCurrencyFull(inv.taxAmount, inv.currency)}`, red: true });
  if (taxMode === "grossup" && taxName) totalRows.push({ label: t.invTotalPayment, value: formatCurrencyFull(afterDiscount, inv.currency), bold: true });

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="font-mono">{inv.number}</span>
            <Badge className={st.cls}>{lang === "en" ? st.en : st.id}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Meta */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-zinc-50 p-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-zinc-400">{t.invDate}</dt>
            <dd className="font-medium text-zinc-800">{formatDate(inv.issueDate, locale)}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">{t.invDue}</dt>
            <dd className="font-medium text-zinc-800">{inv.dueDate ? formatDate(inv.dueDate, locale) : t.invEmpty}</dd>
          </div>
          {inv.brandName ? (
            <div>
              <dt className="text-zinc-400">{t.invBrand}</dt>
              <dd className="truncate font-medium text-zinc-800">{inv.brandName}</dd>
            </div>
          ) : null}
          {inv.projectName ? (
            <div>
              <dt className="text-zinc-400">{t.invProject}</dt>
              <dd className="truncate font-medium text-zinc-800">{inv.projectName}</dd>
            </div>
          ) : null}
          {inv.purchaseNumber ? (
            <div>
              <dt className="text-zinc-400">{t.invPo}</dt>
              <dd className="truncate font-mono font-medium text-zinc-800">{inv.purchaseNumber}</dd>
            </div>
          ) : null}
        </dl>

        {inv.description ? <p className="text-sm text-zinc-600">{inv.description}</p> : null}

        {/* Items */}
        {inv.items.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-zinc-500">
                  <th className="px-3 py-2 font-medium">{t.invDesc}</th>
                  <th className="px-3 py-2 text-center font-medium">{t.invQty}</th>
                  <th className="px-3 py-2 text-right font-medium">{t.invUnitPrice}</th>
                  <th className="px-3 py-2 text-right font-medium">{t.invAmount}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {inv.items.map((it, i) => (
                  <tr key={i} className="text-zinc-700">
                    <td className="px-3 py-2">{it.description || t.invEmpty}</td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {Number(it.qty) || 1}{it.unit ? ` ${it.unit}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrencyFull(Number(it.unitPrice) || 0, inv.currency)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrencyFull(Number(it.total) || (Number(it.qty) || 1) * (Number(it.unitPrice) || 0), inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">{t.invNoItems}</p>
        )}

        {/* Totals */}
        <div className="ml-auto w-full max-w-xs space-y-1 text-xs sm:w-64">
          {totalRows.map((r, i) => (
            <div key={i} className={cn(
              "flex items-center justify-between gap-3 border-b border-zinc-100 py-1.5",
              r.bold && "text-sm font-bold text-zinc-900",
              !r.bold && !r.red && !r.muted && "text-zinc-700",
              r.muted && "text-zinc-500",
              r.red && "font-medium text-rose-600",
            )}>
              <span>{r.label}</span>
              <span className="tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>

        {inv.totalInWords ? (
          <p className="text-xs italic text-zinc-500">
            <span className="font-medium not-italic text-zinc-600">{t.invWords}: </span>
            {inv.totalInWords}
          </p>
        ) : null}

        {/* Payment terms schedule */}
        {inv.terms.length > 0 ? (
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t.invTerms}</p>
            <ol className="space-y-1.5">
              {inv.terms.map((term, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-700">
                  <span className="font-medium">{i + 1}. {term.label || "-"}</span>
                  <span className="text-zinc-500">{Math.round(Number(term.pct) || 0)}%</span>
                  <span className="text-zinc-400">({describeDueEn(term.dueEvent, term.dueDays)}{Number(term.dueDays) > 0 && term.dueEvent !== "invoice" ? ` — H+${term.dueDays}` : ""})</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <Separator />
        <p className="text-[11px] leading-relaxed text-zinc-400">{t.invoiceNote}</p>
      </DialogContent>
    </Dialog>
  );
}

// ============ Sub-komponen ============

type Str = (typeof STR)[Lang];

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-zinc-200 p-6 text-center">
      <p className="text-sm text-zinc-400">{text}</p>
    </div>
  );
}

function KindChip({ kind, t }: { kind: string; t: Str }) {
  if (kind === "mou") {
    return (
      <Badge variant="outline" className="shrink-0 border-orange-300 bg-orange-50 text-orange-700">
        {t.kindMou}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 border-zinc-200 text-zinc-500">
      {t.kindDoc}
    </Badge>
  );
}

function DocumentCard({ doc, t, locale }: { doc: ClientDocumentDTO; t: Str; locale: string }) {
  const isFile = Boolean(doc.fileName && doc.fileData);
  return (
    <article className="flex flex-col rounded-xl border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold leading-snug text-zinc-900">{doc.title}</p>
        <KindChip kind={doc.kind} t={t} />
      </div>
      {isFile ? (
        <a
          href={doc.fileData ?? "#"}
          download={doc.fileName ?? undefined}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-orange-700 hover:text-orange-800 hover:underline"
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {doc.fileName}
            {doc.sizeBytes ? <span className="ml-1 text-xs font-normal text-zinc-400">({kb(doc.sizeBytes)} KB)</span> : null}
          </span>
        </a>
      ) : null}
      {doc.url ? (
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-orange-700 hover:text-orange-800 hover:underline"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.openLink}</span>
        </a>
      ) : null}
      {doc.content ? <p className="mt-2 line-clamp-3 text-sm text-zinc-500">{doc.content}</p> : null}
      <p className="mt-auto pt-2 text-xs text-zinc-400">
        {formatDate(doc.createdAt, locale)}
        {doc.createdByName ? ` · ${doc.createdByName}` : ""}
      </p>
    </article>
  );
}

function AttendeeChips({ attendees }: { attendees: string }) {
  const list = attendees
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const shown = list.slice(0, 4);
  const rest = list.length - shown.length;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {shown.map((a) => (
        <Badge
          key={a}
          variant="outline"
          className="border-zinc-200 px-2 py-0 text-[11px] font-normal text-zinc-600"
        >
          <Users className="h-3 w-3" aria-hidden="true" />
          {a}
        </Badge>
      ))}
      {rest > 0 ? <span className="text-[11px] text-zinc-400">+{rest}</span> : null}
    </div>
  );
}

function DeliverableRow({
  token,
  deliverable: d,
  onReviewed,
  t,
  lang,
}: {
  token: string;
  deliverable: ProjectDeliverableDTO;
  onReviewed: () => void;
  t: Str;
  lang: Lang;
}) {
  const [reviewerName, setReviewerName] = useState("");
  const [comment, setComment] = useState("");
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState<"approved" | "revision" | null>(null);

  const isPending = d.status === "pending";

  async function submit(decision: "approved" | "revision") {
    if (!reviewerName.trim()) {
      setNameError(true);
      toast.error(t.reviewNameErr);
      return;
    }
    setNameError(false);
    setBusy(decision);
    try {
      await portalApi.review(token, {
        deliverableId: d.id,
        decision,
        comment: comment.trim() ? comment.trim() : undefined,
        reviewerName: reviewerName.trim(),
      });
      toast.success(t.reviewSaved);
      onReviewed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.reviewFail);
    } finally {
      setBusy(null);
    }
  }

  const st = DELIVERABLE_STATUS[d.status]
    ?? { en: d.status, id: d.status, cls: "bg-zinc-100 text-zinc-600 border-transparent" };

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {d.kind === "file" ? (
            <Paperclip className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          ) : (
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          )}
          <div className="min-w-0">
            {d.kind === "link" && d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-medium text-orange-700 hover:text-orange-800 hover:underline"
              >
                {d.name}
              </a>
            ) : (
              <p className="truncate text-sm font-medium text-zinc-900">{d.name}</p>
            )}
            {d.kind === "file" && d.fileName ? (
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                {d.fileName}
                {d.sizeBytes ? ` · ${kb(d.sizeBytes)} KB` : ""}
              </p>
            ) : null}
          </div>
        </div>
        <Badge className={`shrink-0 ${st.cls}`}>{lang === "en" ? st.en : st.id}</Badge>
      </div>

      {d.note ? <p className="ml-6 mt-1 text-sm text-zinc-500">{d.note}</p> : null}

      {isPending ? (
        <div className="ml-0 mt-3 rounded-lg bg-zinc-50 p-3 sm:ml-6">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`reviewer-${d.id}`} className="sr-only">
                {t.reviewerPh}
              </label>
              <Input
                id={`reviewer-${d.id}`}
                value={reviewerName}
                onChange={(e) => {
                  setReviewerName(e.target.value);
                  if (e.target.value.trim()) setNameError(false);
                }}
                placeholder={t.reviewerPh}
                maxLength={80}
                aria-invalid={nameError}
                className={`h-11 min-h-11 bg-white ${nameError ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
              />
            </div>
            <div>
              <label htmlFor={`comment-${d.id}`} className="sr-only">
                {t.commentPh}
              </label>
              <Input
                id={`comment-${d.id}`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t.commentPh}
                maxLength={300}
                className="h-11 min-h-11 bg-white"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void submit("approved")}
              className="h-11 min-h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {t.approve}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void submit("revision")}
              className="h-11 min-h-11 flex-1 border-amber-300 bg-white text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            >
              {t.requestRevision}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {d.reviewComment ? <p className="ml-6 mt-1 text-sm text-zinc-600">{d.reviewComment}</p> : null}
          {d.reviewedBy ? (
            <p className="ml-6 mt-0.5 text-xs text-zinc-400">
              {t.by} {d.reviewedBy}
              {d.reviewedAt ? ` · ${formatDateTime(d.reviewedAt)}` : ""}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-100">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3.5 w-36" />
            </div>
            <Skeleton className="hidden h-6 w-24 rounded-md sm:block" />
          </div>
          <Skeleton className="mt-4 h-3.5 w-72" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Skeleton className="h-28 rounded-xl" />
              <Skeleton className="h-28 rounded-xl" />
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}

function PortalError({ message, title, hint }: { message: string; title: string; hint: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <ShieldAlert className="h-8 w-8 text-rose-600" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-zinc-900">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{message}</p>
        <p className="mt-4 text-xs text-zinc-400">{hint}</p>
      </div>
    </div>
  );
}
