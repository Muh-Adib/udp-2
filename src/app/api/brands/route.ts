import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export async function GET() {
  const brands = await db.brand.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  return ok({ brands });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const name = String(body.name ?? "").trim();
  if (!name) return fail("Nama brand wajib diisi");

  const slug = slugify(String(body.slug ?? name));
  const exists = await db.brand.findUnique({ where: { slug } });
  if (exists) return fail(`Brand dengan slug "${slug}" sudah ada`);

  const brand = await db.brand.create({
    data: {
      name,
      slug,
      color: body.color ? String(body.color) : "#f97316",
      description: body.description ? String(body.description) : null,
      website: body.website ? String(body.website) : null,
      primaryCurrency: body.primaryCurrency ? String(body.primaryCurrency) : "IDR",
      invoicePrefix: body.invoicePrefix ? String(body.invoicePrefix).toUpperCase() : slug.slice(0, 3).toUpperCase(),
      quotePrefix: body.quotePrefix ? String(body.quotePrefix).toUpperCase() : `Q${slug.slice(0, 2).toUpperCase()}`,
      slaHours: Number(body.slaHours ?? 4),
      portalDomain: body.portalDomain ? String(body.portalDomain) : null,
    },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "create", entity: "brand", entityId: brand.id, entityLabel: brand.name,
    metadata: `Brand baru dikonfigurasi: ${brand.name} (${slug}) tanpa mengubah source code`, req,
  });

  return ok({ brand }, 201);
}
