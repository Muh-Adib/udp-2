import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

const TEMPLATE_CHANNELS = ["whatsapp", "instagram", "email"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const brandId = searchParams.get("brandId");
  const templates = await db.followUpTemplate.findMany({
    where: brandId && brandId !== "all" ? { brandId } : {},
    orderBy: { delayDays: "asc" },
  });
  return ok({ templates });
}

/**
 * Task 22-3 — CRUD template follow-up.
 * POST /api/followup-templates — buat template baru (version selalu 1).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);

  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama template wajib diisi");

  const text = String(body.body ?? "").trim();
  if (!text) return fail("Isi template wajib diisi");

  const channel = String(body.channel ?? "whatsapp").trim();
  if (!TEMPLATE_CHANNELS.includes(channel)) {
    return fail("Kanal harus salah satu dari: whatsapp, instagram, email");
  }

  const delayDays = body.delayDays === undefined ? 1 : Number(body.delayDays);
  if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > 30) {
    return fail("Jeda hari (delayDays) harus bilangan bulat 0–30");
  }

  const brandId = body.brandId ? String(body.brandId) : null;
  if (brandId) {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    if (!brand) return fail("Brand tidak ditemukan", 404);
  }

  const stage = body.stage ? String(body.stage).trim() : null;
  const language = String(body.language ?? "id").trim() || "id";

  const template = await db.followUpTemplate.create({
    data: {
      name,
      brandId,
      channel,
      language,
      stage,
      delayDays,
      body: text,
      version: 1,
      approved: Boolean(body.approved ?? false),
    },
  });

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: String(body.actorRole ?? "system"),
    action: "create",
    entity: "template",
    entityId: template.id,
    entityLabel: template.name,
    newValue: `Template baru "${name}" (${channel}, H+${delayDays}, v1)`,
    req,
  });

  return ok({ template }, 201);
}
