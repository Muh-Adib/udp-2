import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflowFor } from "@/lib/crm/constants";
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

/** Buat project + milestone + invoice DP ketika opportunity menjadi Won. */
export async function handleWonTransition(oppId: string) {
  const opp = await db.opportunity.findUnique({
    where: { id: oppId },
    include: { brand: true, contact: true },
  });
  if (!opp || !opp.companyId) return null;

  const existing = await db.project.findUnique({ where: { opportunityId: opp.id } });
  if (existing) return existing;

  const year = new Date().getFullYear();
  const count = await db.project.count();
  const prefix = opp.brand.slug.slice(0, 3).toUpperCase().replace("_", "");
  const code = `${prefix}-${year}-${String(count + 1).padStart(3, "0")}`;

  const project = await db.project.create({
    data: {
      code,
      name: opp.title,
      brandId: opp.brandId,
      companyId: opp.companyId,
      opportunityId: opp.id,
      serviceCategory: opp.serviceCategory,
      status: "planning",
      progress: 0,
      pmName: "Budi Hartono",
      startDate: new Date(),
      dueDate: opp.targetDeadline ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      contractValue: opp.estimatedValue ?? 0,
      budgetInternal: Math.round((opp.estimatedValue ?? 0) * 0.62),
    },
  });

  const flow = workflowFor(opp.serviceCategory);
  const span = project.dueDate ? project.dueDate.getTime() - (project.startDate?.getTime() ?? Date.now()) : 60 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < flow.length; i++) {
    await db.milestone.create({
      data: {
        projectId: project.id,
        name: flow[i],
        order: i,
        status: i === 0 ? "in_progress" : "pending",
        dueDate: new Date((project.startDate?.getTime() ?? Date.now()) + ((i + 1) * span) / flow.length),
      },
    });
  }

  // Draft invoice DP 50%
  const invCount = await db.invoice.count();
  const number = `${opp.brand.invoicePrefix}-${year}-INV-${String(invCount + 1).padStart(3, "0")}`;
  const amount = Math.round((opp.estimatedValue ?? 0) * 0.5);
  if (amount > 0) {
    await db.invoice.create({
      data: {
        number,
        brandId: opp.brandId,
        companyId: opp.companyId,
        projectId: project.id,
        opportunityId: opp.id,
        description: `DP 50% - ${opp.title}`,
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
}

/** Cari kandidat duplikat contact berdasar identitas ternormalisasi. */
export async function findMatchCandidates(input: {
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  fullName?: string | null;
  companyName?: string | null;
}) {
  const email = normalizeEmail(input.email);
  const whatsapp = normalizePhone(input.whatsapp);
  const phone = normalizePhone(input.phone);
  const domain = extractDomain(input.email?.split("@")[1] ? input.email : input.companyName);

  const contacts = await db.contact.findMany({
    where: { deletedAt: null },
    include: { company: true },
    take: 500,
  });

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
