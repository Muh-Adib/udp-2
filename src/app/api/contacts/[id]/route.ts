import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { normalizeEmail, normalizePhone } from "@/lib/crm/utils";
import { resolveActor } from "@/lib/crm/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const current = await db.contact.findUnique({ where: { id } });
  if (!current) return fail("Contact tidak ditemukan", 404);

  const fields = ["firstName", "lastName", "position", "emailAlt", "country", "city", "timezone", "language", "preferredChannel", "socialProfile", "linkedin", "instagram", "facebook", "tiktok", "notes", "consentStatus"];
  const data: Record<string, unknown> = {};
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];

  for (const f of fields) {
    if (!(f in body)) continue;
    const value = body[f] === "" ? null : body[f];
    if ((current as unknown as Record<string, unknown>)[f] !== value) {
      data[f] = value;
      changes.push({ field: f, oldValue: (current as unknown as Record<string, unknown>)[f], newValue: value });
    }
  }
  if ("email" in body) {
    const email = normalizeEmail(body.email ? String(body.email) : null);
    if (current.email !== email) { data.email = email; changes.push({ field: "email", oldValue: current.email, newValue: email }); }
  }
  if ("whatsapp" in body) {
    const wa = normalizePhone(body.whatsapp ? String(body.whatsapp) : null);
    if (current.whatsapp !== wa) { data.whatsapp = wa; changes.push({ field: "whatsapp", oldValue: current.whatsapp, newValue: wa }); }
  }
  if ("phone" in body) {
    const ph = normalizePhone(body.phone ? String(body.phone) : null);
    if (current.phone !== ph) { data.phone = ph; changes.push({ field: "phone", oldValue: current.phone, newValue: ph }); }
  }
  if ("tags" in body) data.tags = JSON.stringify(body.tags);
  if ("companyId" in body) data.companyId = body.companyId ? String(body.companyId) : null;
  if (data.firstName || data.lastName) {
    const first = (data.firstName as string) ?? current.firstName;
    const last = (data.lastName as string) ?? current.lastName ?? "";
    data.fullName = `${first} ${last}`.trim();
  }

  const contact = await db.contact.update({ where: { id }, data, include: { company: true } });

  for (const ch of changes) {
    await logAudit({
      actorName: actor.name, actorRole: actor.role,
      action: "update", entity: "contact", entityId: id, entityLabel: contact.fullName,
      field: ch.field, oldValue: ch.oldValue, newValue: ch.newValue, req,
    });
  }

  return ok({ contact });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Ronde 27: identitas aktor diambil dari sesi (cookie).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const { id } = await params;
  const current = await db.contact.findUnique({ where: { id } });
  if (!current) return fail("Contact tidak ditemukan", 404);
  await db.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  await logAudit({
    actorName: actor.name, action: "delete", entity: "contact", entityId: id,
    entityLabel: current.fullName, metadata: "Soft delete contact", req,
  });
  return ok({ deleted: true });
}
