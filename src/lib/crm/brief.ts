/**
 * Ronde 18 — Brief Builder (Fase 2): util murni untuk skor kelengkapan brief.
 * Dipakai oleh BriefPanel (tampilan + dialog edit) — tanpa dependensi React/Prisma.
 */

export interface BriefCompletenessInput {
  title: string;
  serviceTypes: string[];
  objectives?: string | null;
  targetAudience?: string | null;
  keyMessages?: string | null;
  deliverables: { name: string; qty: number }[];
  timelineStart?: string | null;
  timelineEnd?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  references: { label: string; url: string }[];
}

/** 9 bagian brief yang dinilai kelengkapannya (urutan tampil di UI). */
export const BRIEF_SECTIONS = [
  { key: "title", label: "Judul" },
  { key: "serviceTypes", label: "Layanan" },
  { key: "objectives", label: "Tujuan" },
  { key: "targetAudience", label: "Audiens" },
  { key: "keyMessages", label: "Pesan kunci" },
  { key: "deliverables", label: "Deliverables" },
  { key: "timeline", label: "Timeline" },
  { key: "budget", label: "Budget" },
  { key: "references", label: "Referensi" },
] as const;

function hasText(v?: string | null): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Hitung kelengkapan brief: berapa bagian terisi, persentase, dan daftar
 * bagian yang masih kosong (untuk hint "lengkapi X").
 */
export function computeBriefCompleteness(b: BriefCompletenessInput): {
  filled: number;
  total: number;
  pct: number;
  missing: string[];
} {
  const filledMap: Record<string, boolean> = {
    title: hasText(b.title),
    serviceTypes: Array.isArray(b.serviceTypes) && b.serviceTypes.length > 0,
    objectives: hasText(b.objectives),
    targetAudience: hasText(b.targetAudience),
    keyMessages: hasText(b.keyMessages),
    deliverables: Array.isArray(b.deliverables) && b.deliverables.some((d) => hasText(d.name)),
    timeline: Boolean(b.timelineStart) || Boolean(b.timelineEnd),
    budget: (typeof b.budgetMin === "number" && b.budgetMin > 0) || (typeof b.budgetMax === "number" && b.budgetMax > 0),
    references: Array.isArray(b.references) && b.references.some((r) => hasText(r.url)),
  };

  const missing = BRIEF_SECTIONS.filter((s) => !filledMap[s.key]).map((s) => s.label);
  const filled = BRIEF_SECTIONS.length - missing.length;
  const total = BRIEF_SECTIONS.length;
  return { filled, total, pct: Math.round((filled / total) * 100), missing };
}

/** Warna & label status brief (dipakai Badge + stepper). */
export const BRIEF_STATUS_META: Record<string, { label: string; badgeCls: string; dotCls: string }> = {
  draft: { label: "Draft", badgeCls: "bg-zinc-100 text-zinc-700 border-zinc-200", dotCls: "bg-zinc-400" },
  in_review: { label: "Dalam Review", badgeCls: "bg-amber-50 text-amber-700 border-amber-200", dotCls: "bg-amber-500" },
  approved: { label: "Disetujui", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200", dotCls: "bg-emerald-500" },
  revision: { label: "Perlu Revisi", badgeCls: "bg-red-50 text-red-700 border-red-200", dotCls: "bg-red-500" },
};
