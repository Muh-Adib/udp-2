import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNELS } from "@/lib/crm/constants";

function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}

/** Fase 3 — SLA escalation: buat task urgent untuk Direktur dari sebuah lead inbox. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
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

  let description =
    `Lead ${channelLabel(interaction.channel)} dari brand ${interaction.brand?.name ?? "-"} ` +
    `menunggu respons melewati SLA. Pesan: "${snippet}"`;
  if (note) description += `\nCatatan eskalasi: ${note}`;

  const task = await db.task.create({
    data: {
      title: `Eskalasi SLA: respons ${senderLabel}`,
      description,
      type: "internal",
      priority: "urgent",
      status: "open",
      assigneeName: String(body.assigneeName ?? "Direktur"),
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
      opportunityId: null,
    },
  });

  await logAudit({
    actorName: String(body.actorName ?? "Marketing"),
    actorRole: String(body.actorRole ?? "marketing"),
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
