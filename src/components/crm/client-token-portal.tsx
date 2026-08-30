"use client";

/**
 * Task 23-d — Client Token Portal.
 * Halaman publik secure-link klien (tanpa login): dibuka lewat `/?portal=<token>`.
 * Berisi MoU/dokumen, catatan rapat, dan deliverable proyek yang bisa direview
 * langsung oleh klien (Setujui / Minta Revisi). Standalone — TANPA chrome CRM.
 * Palet: zinc/orange/emerald/amber.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Building2, CalendarDays, Check, ExternalLink, FileSignature, FileText, Link2, ListChecks,
  Lock, Paperclip, ShieldAlert, Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { portalApi } from "@/lib/crm/api-client";
import type { ClientDocumentDTO, PortalTokenPayload, ProjectDeliverableDTO } from "@/lib/crm/types";
import { formatDate, formatDateTime } from "@/lib/crm/utils";

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Perencanaan", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
  in_progress: { label: "Berjalan", cls: "bg-amber-100 text-amber-700 border-transparent" },
  review: { label: "Review", cls: "bg-amber-100 text-amber-700 border-transparent" },
  completed: { label: "Selesai", cls: "bg-emerald-100 text-emerald-700 border-transparent" },
  cancelled: { label: "Dibatalkan", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
};

const DELIVERABLE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Menunggu Review", cls: "bg-zinc-100 text-zinc-600 border-transparent" },
  approved: { label: "Disetujui", cls: "bg-emerald-100 text-emerald-700 border-transparent" },
  revision: { label: "Revisi Diminta", cls: "bg-amber-100 text-amber-700 border-transparent" },
};

function kb(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024));
}

export default function ClientTokenPortal({ token }: { token: string }) {
  const [data, setData] = useState<PortalTokenPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  if (error || !data) return <PortalError message={error ?? "Tautan tidak tersedia."} />;

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
                  {[data.company.industry, data.company.city].filter(Boolean).join(" · ") || "Portal klien"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Badge className="bg-zinc-900 text-white">Portal Klien</Badge>
              {data.token.label ? (
                <Badge variant="outline" className="border-zinc-300 text-zinc-600">
                  {data.token.label}
                </Badge>
              ) : null}
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Akses aman tanpa login — tautan ini bersifat rahasia.
          </p>
        </section>

        <div className="mt-6 space-y-6">
          {/* ===== (a) Dokumen & MoU ===== */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100">
                <FileSignature className="h-4 w-4 text-orange-600" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900">Dokumen &amp; MoU</h2>
              {documents.length > 0 ? (
                <span className="text-xs text-zinc-400">{documents.length}</span>
              ) : null}
            </div>

            {documents.length === 0 ? (
              <EmptyState text="Belum ada dokumen yang dibagikan." />
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {documents.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} />
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
              <h2 className="text-base font-semibold text-zinc-900">Catatan Rapat</h2>
              {meetingNotes.length > 0 ? (
                <span className="text-xs text-zinc-400">{meetingNotes.length}</span>
              ) : null}
            </div>

            {meetingNotes.length === 0 ? (
              <EmptyState text="Belum ada catatan rapat yang dibagikan." />
            ) : (
              <div className="mt-4 ml-3 space-y-6 border-l-2 border-zinc-200 pl-5">
                {meetingNotes.map((n) => {
                  const date = n.meetingAt ? formatDateTime(n.meetingAt) : formatDate(n.createdAt);
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
              <h2 className="text-base font-semibold text-zinc-900">Deliverable &amp; Review</h2>
            </div>

            {data.projects.length === 0 ? (
              <EmptyState text="Belum ada proyek yang dibagikan." />
            ) : (
              <div className="mt-4 space-y-4">
                {data.projects.map((p) => {
                  const st = PROJECT_STATUS[p.status] ?? { label: p.status, cls: "bg-zinc-100 text-zinc-600 border-transparent" };
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
                            {[p.brandName, p.dueDate ? `Target: ${formatDate(p.dueDate)}` : null]
                              .filter(Boolean)
                              .join(" · ") || "Proyek"}
                          </p>
                        </div>
                        <Badge className={st.cls}>{st.label}</Badge>
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-3">
                          <Progress value={p.progress} className="h-2 flex-1 [&>div]:bg-orange-500" />
                          <span className="w-10 shrink-0 text-right text-xs font-medium text-zinc-500">
                            {p.progress}%
                          </span>
                        </div>

                        <div className="mt-3 divide-y divide-zinc-100">
                          {p.deliverables.length === 0 ? (
                            <p className="py-3 text-sm text-zinc-400">Belum ada deliverable pada proyek ini.</p>
                          ) : (
                            p.deliverables.map((d) => (
                              <DeliverableRow key={d.id} token={token} deliverable={d} onReviewed={load} />
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
        </div>

        {/* ===== Footer ===== */}
        <footer className="mt-8 pb-4 text-center">
          <p className="inline-flex max-w-md items-start justify-center gap-1.5 text-xs leading-relaxed text-zinc-400">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Tautan aman khusus untuk {data.company.name}. Jangan bagikan ke pihak lain.</span>
          </p>
        </footer>
      </main>
    </div>
  );
}

// ============ Sub-komponen ============

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-zinc-200 p-6 text-center">
      <p className="text-sm text-zinc-400">{text}</p>
    </div>
  );
}

function KindChip({ kind }: { kind: string }) {
  if (kind === "mou") {
    return (
      <Badge variant="outline" className="shrink-0 border-orange-300 bg-orange-50 text-orange-700">
        MoU
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 border-zinc-200 text-zinc-500">
      Dokumen
    </Badge>
  );
}

function DocumentCard({ doc }: { doc: ClientDocumentDTO }) {
  const isFile = Boolean(doc.fileName && doc.fileData);
  return (
    <article className="flex flex-col rounded-xl border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold leading-snug text-zinc-900">{doc.title}</p>
        <KindChip kind={doc.kind} />
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
          <span className="truncate">Buka tautan</span>
        </a>
      ) : null}
      {doc.content ? <p className="mt-2 line-clamp-3 text-sm text-zinc-500">{doc.content}</p> : null}
      <p className="mt-auto pt-2 text-xs text-zinc-400">
        {formatDate(doc.createdAt)}
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

function DeliverableStatusBadge({ status }: { status: string }) {
  const st = DELIVERABLE_STATUS[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-600 border-transparent" };
  return <Badge className={`shrink-0 ${st.cls}`}>{st.label}</Badge>;
}

function DeliverableRow({
  token,
  deliverable: d,
  onReviewed,
}: {
  token: string;
  deliverable: ProjectDeliverableDTO;
  onReviewed: () => void;
}) {
  const [reviewerName, setReviewerName] = useState("");
  const [comment, setComment] = useState("");
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState<"approved" | "revision" | null>(null);

  const isPending = d.status === "pending";

  async function submit(decision: "approved" | "revision") {
    if (!reviewerName.trim()) {
      setNameError(true);
      toast.error("Isi nama Anda terlebih dahulu.");
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
      toast.success("Terima kasih, review tersimpan.");
      onReviewed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan review. Coba lagi.");
    } finally {
      setBusy(null);
    }
  }

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
        <DeliverableStatusBadge status={d.status} />
      </div>

      {d.note ? <p className="ml-6 mt-1 text-sm text-zinc-500">{d.note}</p> : null}

      {isPending ? (
        <div className="ml-0 mt-3 rounded-lg bg-zinc-50 p-3 sm:ml-6">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`reviewer-${d.id}`} className="sr-only">
                Nama Anda
              </label>
              <Input
                id={`reviewer-${d.id}`}
                value={reviewerName}
                onChange={(e) => {
                  setReviewerName(e.target.value);
                  if (e.target.value.trim()) setNameError(false);
                }}
                placeholder="Nama Anda"
                maxLength={80}
                aria-invalid={nameError}
                className={`h-11 min-h-11 bg-white ${nameError ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
              />
            </div>
            <div>
              <label htmlFor={`comment-${d.id}`} className="sr-only">
                Komentar (opsional)
              </label>
              <Input
                id={`comment-${d.id}`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Komentar (opsional)"
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
              Setujui
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void submit("revision")}
              className="h-11 min-h-11 flex-1 border-amber-300 bg-white text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            >
              Minta Revisi
            </Button>
          </div>
        </div>
      ) : (
        <>
          {d.reviewComment ? <p className="ml-6 mt-1 text-sm text-zinc-600">{d.reviewComment}</p> : null}
          {d.reviewedBy ? (
            <p className="ml-6 mt-0.5 text-xs text-zinc-400">
              oleh {d.reviewedBy}
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

function PortalError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <ShieldAlert className="h-8 w-8 text-rose-600" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-zinc-900">Tautan tidak tersedia</h1>
        <p className="mt-2 text-sm text-zinc-500">{message}</p>
        <p className="mt-4 text-xs text-zinc-400">
          Minta tautan baru kepada tim Unimasi Group atau balas chat yang mengirim tautan ini.
        </p>
      </div>
    </div>
  );
}
