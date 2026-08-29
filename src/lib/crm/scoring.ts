// Lead Scoring (Fase 4) — library murni rule-based, tanpa dependency server/klien.
// Bisa dipakai di API routes maupun komponen client.

import type { OpportunityDTO } from "@/lib/crm/types";

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export interface ScoreTier {
  label: string;
  cls: string;
  ring: string;
}

/** Field minimal yang dibutuhkan untuk menghitung skor. */
export type LeadScoreInput = Pick<
  OpportunityDTO,
  "stage" | "temperature" | "priority" | "estimatedValue" | "expectedCloseDate" | "nextAction" | "updatedAt" | "createdAt"
>;

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_SCORE = 30;

const STAGE_POINTS: Record<string, number> = {
  new: 0,
  contact_attempted: 4,
  connected: 8,
  qualified: 12,
  discovery: 14,
  estimation: 16,
  proposal_sent: 18,
  negotiation: 20,
  verbal_agreement: 25,
};

const STAGE_REASON_LABELS: Record<string, string> = {
  new: "New",
  contact_attempted: "Contact Attempted",
  connected: "Connected",
  qualified: "Qualified",
  discovery: "Discovery",
  estimation: "Estimation",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
  verbal_agreement: "Verbal Agreement",
};

const PRIORITY_POINTS: Record<string, number> = {
  urgent: 8,
  high: 5,
  medium: 2,
  low: 0,
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const TEMPERATURE_POINTS: Record<string, number> = {
  hot: 12,
  warm: 6,
  cold: 0,
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Menghitung skor lead 0–100 dari atribut opportunity + jumlah interaksi/tugas.
 * Alasan berbentuk teks Indonesia dengan poin bertanda, mis. "Stage Negotiation (+20)".
 */
export function computeLeadScore(
  opp: LeadScoreInput,
  counts?: { interactions?: number; tasks?: number }
): ScoreResult {
  // Stage terminal langsung mengembalikan skor ekstrem.
  if (opp.stage === "won") return { score: 100, reasons: ["Deal Won"] };
  if (opp.stage === "lost") return { score: 0, reasons: ["Deal Lost"] };

  const reasons: string[] = [];
  let score = BASE_SCORE;

  // Stage
  const stagePts = STAGE_POINTS[opp.stage] ?? 0;
  if (stagePts > 0) {
    const label = STAGE_REASON_LABELS[opp.stage] ?? capitalize(opp.stage);
    reasons.push(`Stage ${label} (+${stagePts})`);
    score += stagePts;
  }

  // Temperature
  const tempPts = TEMPERATURE_POINTS[opp.temperature] ?? 0;
  if (tempPts > 0) {
    reasons.push(`Temperatur ${capitalize(opp.temperature)} (+${tempPts})`);
    score += tempPts;
  }
  const interactions = counts?.interactions ?? 0;
  if (opp.temperature === "cold" && interactions === 0) {
    reasons.push("Lead dingin tanpa interaksi (-4)");
    score -= 4;
  }

  // Priority
  const prioPts = PRIORITY_POINTS[opp.priority] ?? 0;
  if (prioPts > 0) {
    const label = PRIORITY_LABELS[opp.priority] ?? capitalize(opp.priority);
    reasons.push(`Prioritas ${label} (+${prioPts})`);
    score += prioPts;
  }

  // Nilai estimasi (rupiah)
  const value = opp.estimatedValue ?? 0;
  if (value >= 500_000_000) {
    reasons.push("Nilai ≥ Rp 500 jt (+12)");
    score += 12;
  } else if (value >= 200_000_000) {
    reasons.push("Nilai ≥ Rp 200 jt (+8)");
    score += 8;
  } else if (value >= 50_000_000) {
    reasons.push("Nilai ≥ Rp 50 jt (+5)");
    score += 5;
  } else if (value > 0) {
    reasons.push("Ada estimasi nilai (+2)");
    score += 2;
  }

  // Aktivitas interaksi
  if (interactions >= 6) {
    reasons.push(`Sangat aktif (${interactions} interaksi) (+10)`);
    score += 10;
  } else if (interactions >= 3) {
    reasons.push(`Aktif (${interactions} interaksi) (+6)`);
    score += 6;
  } else if (interactions >= 1) {
    reasons.push(`Ada interaksi (${interactions}) (+3)`);
    score += 3;
  } else {
    reasons.push("Belum ada interaksi (-6)");
    score -= 6;
  }

  // Expected close date
  const closeMs = opp.expectedCloseDate ? new Date(opp.expectedCloseDate).getTime() : NaN;
  if (!Number.isNaN(closeMs)) {
    const now = Date.now();
    if (closeMs < now) {
      reasons.push("Close date terlewat (-5)");
      score -= 5;
    } else if (closeMs <= now + 7 * DAY_MS) {
      reasons.push("Close date ≤ 7 hari (+8)");
      score += 8;
    } else if (closeMs <= now + 30 * DAY_MS) {
      reasons.push("Close date ≤ 30 hari (+5)");
      score += 5;
    }
  }

  // Aktivitas terakhir (updatedAt)
  const updatedMs = opp.updatedAt ? new Date(opp.updatedAt).getTime() : NaN;
  if (!Number.isNaN(updatedMs)) {
    const ageDays = (Date.now() - updatedMs) / DAY_MS;
    if (ageDays > 30) {
      reasons.push("Stagnan > 30 hari (-8)");
      score -= 8;
    } else if (ageDays <= 3) {
      reasons.push("Aktif 3 hari terakhir (+6)");
      score += 6;
    } else if (ageDays <= 7) {
      reasons.push("Aktif 7 hari terakhir (+3)");
      score += 3;
    }
  }

  // Next action
  if (opp.nextAction && opp.nextAction.trim()) {
    reasons.push("Ada next action (+4)");
    score += 4;
  }

  // Mode nurture membatasi skor maksimal 40.
  if (opp.stage === "nurture") {
    score = Math.min(score, 40);
    reasons.push("Mode Nurture");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/** Tier visual skor untuk chip/badge (konvensi warna: Hot merah, Warm amber, Cold cyan). */
export function scoreTier(score: number): ScoreTier {
  if (score >= 70) return { label: "Hot", cls: "bg-red-100 text-red-700", ring: "#dc2626" };
  if (score >= 45) return { label: "Warm", cls: "bg-amber-100 text-amber-700", ring: "#f59e0b" };
  return { label: "Cold", cls: "bg-cyan-100 text-cyan-700", ring: "#0891b2" };
}
