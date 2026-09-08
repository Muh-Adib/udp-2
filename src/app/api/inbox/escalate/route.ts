import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNELS } from "@/lib/crm/constants";
import { resolveActor } from "@/lib/crm/auth";

function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}

/** Fase 3 — SLA escalation: buat task urgent untuk Direktur dari sebuah lead inbox. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const interactionId = body.interactionId ? String(body.interactionId) : "";
  if (!interactionId) return fail("Lead tidak ditemukan", 404);

  const interaction = await db.interaction.findUnique({
    where: { id: interactionId },
    include: { contact: { include: { company: true } }, brand: true },
  });
  if (!interaction) return fail("Lead tidak ditemukan", 404);
  if (interaction.opportunityId) return fail("Lead sudah dikonversi", 400);

  const senderLabel =
    interaction.contact?.fullName ?? interaction.senderName ?? "lead baru";
  const note = body.note ? String(body.note).trim() : "";
  const snippet =
    interaction.content.length > 160
      ? `${interaction.content.slice(0, 160)}…`
      : interaction.content;

  // Ronde 36 (audit): dedupe — satu lead hanya boleh punya SATU eskalasi terbuka.
  // Marker [lead:<id>] sama dgn pola SLA sweep; dobel-klik tombol tidak lagi
  // membuat banyak task urgent duplikat.
  const marker = `[lead:${interaction.id}]`;
  const existing = await db.task.findFirst({
    where: { type: "internal", status: "open", description: { contains: marker } },
    select: { id: true, title: true },
  });
  if (existing) {
    return fail(`Lead ini sudah dieskalasi: "${existing.title}"`, 409);
  }

  let description =
    `Lead ${channelLabel(interaction.channel)} dari brand ${interaction.brand?.name ?? "-"} ` +
    `menunggu respons melewati SLA. Pesan: "${snippet}"\n${marker}`;
  if (note) description += `\nCatatan eskalasi: ${note}`;

  // Ronde 40-B — tautkan task eskalasi ke opportunity aktif milik kontak (bila ada):
  // interaction.opportunityId selalu null di titik ini (lead terkonversi ditolak di atas),
  // jadi kaitan yang tersedia adalah opportunity terbaru milik kontak yang belum won/lost.
  let opportunityId: string | null = null;
  if (interaction.contactId) {
    const activeOpp = await db.opportunity.findFirst({
      where: { contactId: interaction.contactId, stage: { notIn: ["won", "lost"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    opportunityId = activeOpp?.id ?? null;
  }

  const task = await db.task.create({
    data: {
      title: `Eskalasi SLA: respons ${senderLabel}`,
      description,
      type: "internal",
      priority: "urgent",
      status: "open",
      assigneeName: String(body.assigneeName ?? "Direktur"),
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
      opportunityId,
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "task",
    entityId: task.id,
    entityLabel: task.title,
    field: "escalation",
    metadata: JSON.stringify({ interactionId: interaction.id, brand: interaction.brand?.name }),
    req,
  });

  return ok({ task }, 201);
}
