import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { achievementFor, workflowFor } from "@/lib/crm/constants";
import { normalizeEmail, normalizePhone, extractDomain } from "@/lib/crm/utils";

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ===== Ronde 26 — helper validasi input (anti NaN/negatif → 500) =====

/** Angka valid → number, selain itu null (jangan biarkan NaN masuk Prisma). */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Angka valid dibatasi min–max, selain itu fallback. */
export function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = numOrNull(v);
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** String → Date valid atau null (new Date("abc") → Invalid Date ≠ 500). */
export function dateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Batas paging aman untuk findMany take. */
export function pageLimit(v: string | null, def: number, max = 200): number {
  const n = numOrNull(v) ?? def;
  return Math.min(max, Math.max(1, Math.round(n)));
}

export async function logAudit(entry: {
  actorName: string;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId: string;
  entityLabel?: string | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: string | null;
  req?: NextRequest;
}) {
  const ip =
    entry.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
  const userAgent = entry.req?.headers.get("user-agent") ?? "unknown";
  return db.auditLog.create({
    data: {
      actorName: entry.actorName,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel ?? null,
      field: entry.field ?? null,
      oldValue: entry.oldValue !== undefined && entry.oldValue !== null ? String(entry.oldValue) : null,
      newValue: entry.newValue !== undefined && entry.newValue !== null ? String(entry.newValue) : null,
      metadata: entry.metadata ?? null,
      ip,
      userAgent,
    },
  });
}

/** Ronde 35 — sumber nilai kontrak terbaik (precedence):
 * 1. Quotation berstatus accepted (nilai yang benar-benar disetujui klien)
 * 2. Estimasi approved (grandTotal incl. pajak) — estimasi detail yang disetujui Direktur
 * 3. estimatedValue (angka awal saat konversi lead)
 * Mengembalikan { value, source } agar alur bisa diaudit. */
async function resolveContractValue(oppId: string, fallback: number | null) {
  const acceptedQuote = await db.quotation.findFirst({
    where: { opportunityId: oppId, status: "accepted" },
    orderBy: { updatedAt: "desc" },
  });
  if (acceptedQuote && acceptedQuote.total > 0) {
    return { value: acceptedQuote.total, source: `Quotation ${acceptedQuote.number} (accepted)` };
  }
  const est = await db.estimation.findUnique({ where: { opportunityId: oppId } });
  if (est && est.status === "approved" && est.grandTotal > 0) {
    return { value: est.grandTotal, source: "Estimasi approved (grand total)" };
  }
  if (fallback && fallback > 0) {
    return { value: fallback, source: "Estimasi nilai awal" };
  }
  return { value: 0, source: "Belum ada nilai" };
}

/** Buat project + milestone + invoice DP ketika opportunity menjadi Won.
 * Ronde 26: seluruh penulisan dalam SATU transaksi — gagal di tengah tidak
 * menyisakan project tanpa milestone atau invoice yatim.
 * Ronde 35: nilai kontrak mengikuti sumber terbaik (quotation accepted →
 * estimasi approved → estimatedValue) & setiap milestone membawa deskripsi
 * capaian (apa yang dicapai/diserahkan di tahap itu). */
export async function handleWonTransition(oppId: string) {
  const opp = await db.opportunity.findUnique({
    where: { id: oppId },
    include: { brand: true, contact: true },
  });
  if (!opp || !opp.companyId) return null;
  // Narrowing TypeScript tidak menembus closure transaksi — tangkap ke konstanta lokal.
  const companyId: string = opp.companyId;

  return db.$transaction(async (tx) => {
    // Cek ulang DI DALAM transaksi (tutup race dua konversi Won bersamaan).
    const existing = await tx.project.findUnique({ where: { opportunityId: opp.id } });
    if (existing) return existing;

    // Ronde 35 — nilai kontrak dari sumber terbaik (dihitung sebelum tx, read-only).
    const { value: contractValue, source: valueSource } = await resolveContractValue(opp.id, opp.estimatedValue);

    const year = new Date().getFullYear();
    const count = await tx.project.count();
    const prefix = opp.brand.slug.slice(0, 3).toUpperCase().replace("_", "");
    const code = `${prefix}-${year}-${String(count + 1).padStart(3, "0")}`;

    const project = await tx.project.create({
      data: {
        code,
        name: opp.title,
        brandId: opp.brandId,
        companyId,
        opportunityId: opp.id,
        serviceCategory: opp.serviceCategory,
        status: "planning",
        progress: 0,
        pmName: "Budi Hartono",
        startDate: new Date(),
        dueDate: opp.targetDeadline ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        contractValue,
        budgetInternal: Math.round(contractValue * 0.62),
      },
    });

    const flow = workflowFor(opp.serviceCategory);
    const span = project.dueDate ? project.dueDate.getTime() - (project.startDate?.getTime() ?? Date.now()) : 60 * 24 * 60 * 60 * 1000;
    await tx.milestone.createMany({
      data: flow.map((name, i) => ({
        projectId: project.id,
        name,
        order: i,
        status: i === 0 ? "in_progress" : "pending",
        dueDate: new Date((project.startDate?.getTime() ?? Date.now()) + ((i + 1) * span) / flow.length),
        achievement: achievementFor(name),
      })),
    });

    // Draft invoice DP 50% — dari nilai kontrak sumber terbaik
    const invCount = await tx.invoice.count();
    const number = `${opp.brand.invoicePrefix}-${year}-INV-${String(invCount + 1).padStart(3, "0")}`;
    const amount = Math.round(contractValue * 0.5);
    if (amount > 0) {
      await tx.invoice.create({
        data: {
          number,
          brandId: opp.brandId,
          companyId,
          projectId: project.id,
          opportunityId: opp.id,
          description: `DP 50% - ${opp.title}${valueSource !== "Belum ada nilai" ? ` (nilai: ${valueSource})` : ""}`,
          amount,
          taxRate: 11,
          taxAmount: Math.round(amount * 0.11),
          total: Math.round(amount * 1.11),
          currency: opp.currency,
          status: "draft",
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });
    }
    return project;
  });
}

/** Ronde 26 — muat pool kontak SEKALI per request; dipakai bersama banyak panggilan
 * findMatchCandidates (mencegah N+1: 100 lead × query 500 kontak). */
export type MatchContactRow = Awaited<ReturnType<typeof loadMatchContacts>>[number];
export async function loadMatchContacts() {
  return db.contact.findMany({
    where: { deletedAt: null },
    include: { company: true },
    take: 500,
  });
}

/** Cari kandidat duplikat contact berdasar identitas ternormalisasi.
 * `pool` opsional: kumpulan kontak yang sudah dimuat (lihat loadMatchContacts). */
export async function findMatchCandidates(
  input: {
    email?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
    fullName?: string | null;
    companyName?: string | null;
  },
  pool?: MatchContactRow[],
) {
  const email = normalizeEmail(input.email);
  const whatsapp = normalizePhone(input.whatsapp);
  const phone = normalizePhone(input.phone);
  const domain = extractDomain(input.email?.split("@")[1] ? input.email : input.companyName);

  const contacts = pool ?? (await loadMatchContacts());

  const candidates = new Map<string, { score: number; reasons: string[] }>();
  for (const c of contacts) {
    let score = 0;
    const reasons: string[] = [];
    if (email && c.email && c.email === email) {
      score += 90;
      reasons.push(`Email sama: ${c.email}`);
    }
    if (whatsapp && c.whatsapp && normalizePhone(c.whatsapp) === whatsapp) {
      score += 85;
      reasons.push(`WhatsApp sama: +${whatsapp}`);
    }
    if (phone && c.phone && normalizePhone(c.phone) === phone) {
      score += 70;
      reasons.push(`Telepon sama: +${phone}`);
    }
    if (input.companyName && c.company) {
      const cd = extractDomain(c.company.website);
      if (domain && cd && domain === cd) {
        score += 60;
        reasons.push(`Domain perusahaan sama: ${domain}`);
      }
    }
    if (input.companyName && c.company) {
      const sim = nameSim(input.companyName, c.company.name);
      if (sim >= 60) {
        score += Math.round(sim * 0.4);
        reasons.push(`Nama perusahaan mirip (${sim}%): ${c.company.name}`);
      }
    }
    if (input.fullName && c.fullName) {
      const sim = nameSim(input.fullName, c.fullName);
      if (sim >= 70) {
        score += Math.round(sim * 0.3);
        reasons.push(`Nama mirip (${sim}%): ${c.fullName}`);
      }
    }
    if (score > 0) candidates.set(c.id, { score: Math.min(99, score), reasons });
  }

  const sorted = [...candidates.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5);
  const ids = sorted.map(([id]) => id);
  const full = ids.length
    ? await db.contact.findMany({ where: { id: { in: ids } }, include: { company: true } })
    : [];
  return sorted.map(([id, m]) => {
    const c = full.find((f) => f.id === id);
    return { contactId: id, score: m.score, reasons: m.reasons, contact: c };
  });
}

function nameSim(a: string, b: string): number {
  const tok = (s: string) =>
    s.toLowerCase().replace(/\b(pt|cv|tb|persero|yayasan|kementerian|dinas|dr\.|the)\b/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  const ta = new Set(tok(a));
  const tb = new Set(tok(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return Math.round((inter / new Set([...ta, ...tb]).size) * 100);
}
