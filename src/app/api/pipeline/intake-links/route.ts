import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 57 — Shareable intake link per brand (Sales Pipeline).
 *
 * GET  /api/pipeline/intake-links              — daftar link (include brand) urut terbaru.
 * POST /api/pipeline/intake-links              — buat link baru { brandId, label?, expiresAt? }.
 * URL publik yang dihasilkan: {origin}/?intake=<token> (tanpa login).
 */

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brandId = sp.get("brandId");
  const links = await db.leadIntakeLink.findMany({
    where: brandId ? { brandId } : undefined,
    include: {
      brand: { select: { id: true, name: true, slug: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({ links });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  // Role gate ringan: marketing ke atas boleh (pemilik pipeline). Client tidak boleh.
  if (actor.role === "client") return fail("Tidak diizinkan", 403);

  const brandId = String(body.brandId ?? "").trim();
  if (!brandId) return fail("Brand wajib dipilih");
  const brand = await db.brand.findUnique({ where: { id: brandId } });
  if (!brand) return fail("Brand tidak ditemukan", 404);

  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;
  const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? new Date(body.expiresAt) : null;

  const link = await db.leadIntakeLink.create({
    data: {
      token: randomBytes(24).toString("hex"), // 48 hex — rahasia, kunci akses publik
      brandId,
      label,
      expiresAt,
      createdByName: actor.name,
    },
    include: {
      brand: { select: { id: true, name: true, slug: true, color: true } },
    },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    entity: "intake_link",
    entityId: link.id,
    entityLabel: `link form intake ${brand.name}${label ? ` (${label})` : ""}`,
    newValue: { brandId, label },
    req,
  });

  return ok({ link }, 201);
}
