import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/crm/server";

/**
 * SLA auto-sweep (Fase 3): eskalasi otomatis berkala untuk lead inbound yang
 * menunggu respons melewati SLA brand + grace 4 jam dan belum ada task
 * eskalasi aktif untuk lead tersebut.
 *
 * - Dedupe: task eskalasi ditandai deskripsi `[lead:<interactionId>]` —
 *   sweep melewati lead yang sudah punya task open dengan marker itu.
 * - Throttle in-memory: sweep paling sering 1x per 5 menit per proses
 *   (dipicu dari GET /api/inbox dan GET /api/dashboard).
 * - return: jumlah task eskalasi yang dibuat pada sweep ini.
 */

const GRACE_HOURS = 4;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Modul-level (per proses server) — cukup untuk instance dev/single node.
const sweepState = { lastAt: 0 };

export async function runSlaSweep(req?: NextRequest): Promise<number> {
  const now = Date.now();
  if (now - sweepState.lastAt < SWEEP_INTERVAL_MS) return 0;
  sweepState.lastAt = now;

  const brands = await db.brand.findMany({ where: { active: true } });
  const slaByBrand = new Map(brands.map((b) => [b.id, b.slaHours]));

  // Lead inbound tanpa opportunity, lebih tua dari SLA+grace minimum.
  const minAgeMs = Math.min(...[...slaByBrand.values(), 4]) * 3600_000 + GRACE_HOURS * 3600_000;
  const staleLeads = await db.interaction.findMany({
    where: {
      direction: "inbound",
      opportunityId: null,
      respondedAt: null,
      createdAt: { lt: new Date(now - minAgeMs) },
    },
    include: { brand: true, contact: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (staleLeads.length === 0) return 0;

  // Task eskalasi aktif yang sudah ada (marker di deskripsi).
  const existing = await db.task.findMany({
    where: { status: "open", description: { contains: "[lead:" } },
    select: { description: true },
    take: 500,
  });
  const escalated = new Set(
    existing
      .map((t) => t.description?.match(/\[lead:([a-z0-9]+)\]/i)?.[1] ?? null)
      .filter((v): v is string => Boolean(v))
  );

  let created = 0;
  for (const lead of staleLeads) {
    if (escalated.has(lead.id)) continue;
    const sla = slaByBrand.get(lead.brandId ?? "") ?? 4;
    const waitHours = (now - lead.createdAt.getTime()) / 3600_000;
    if (waitHours < sla + GRACE_HOURS) continue;

    const senderLabel = lead.contact?.fullName ?? lead.senderName ?? "lead baru";
    const snippet = lead.content.length > 120 ? `${lead.content.slice(0, 120)}…` : lead.content;
    const overdue = Math.floor(waitHours - sla);

    const task = await db.task.create({
      data: {
        title: `Eskalasi Otomatis: respons ${senderLabel}`,
        description:
          `[lead:${lead.id}] Sweep SLA otomatis — lead ${lead.brand?.name ?? "-"} menunggu ` +
          `${Math.floor(waitHours)} jam (SLA ${sla} jam, lebih ${overdue} jam). Pesan: "${snippet}"`,
        type: "internal",
        priority: "urgent",
        status: "open",
        assigneeName: "Direktur",
        dueDate: new Date(now + 2 * 3600_000),
      },
    });

    await logAudit({
      actorName: "SLA Bot",
      actorRole: "system",
      action: "create",
      entity: "task",
      entityId: task.id,
      entityLabel: task.title,
      field: "sla_auto_escalation",
      metadata: JSON.stringify({ interactionId: lead.id, brand: lead.brand?.name, waitHours: Math.floor(waitHours), sla }),
      req,
    });

    created += 1;
    if (created >= 10) break; // batasi ledakan task saat sweep pertama di data lama
  }
  return created;
}
