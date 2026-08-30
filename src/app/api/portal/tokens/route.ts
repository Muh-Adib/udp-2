import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, logAudit, ok, readBody } from "@/lib/crm/server";

/**
 * Task 23-c — Secure link token portal klien (akses TANPA login).
 * GET  /api/portal/tokens → daftar semua token (staf) + nama perusahaan.
 *      Token TIDAK dimasking — staf perlu menyalin URL lengkap utk dibagikan.
 * POST /api/portal/tokens → { companyId, label?, actorName?, actorRole? }
 *      Token acak 48-hex (randomBytes(24)); URL klien = {origin}/?portal=<token>.
 *      Audit action "create" entity "portal_token".
 */

export async function GET() {
  const tokens = await db.clientPortalToken.findMany({
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ok({ tokens });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);

  const companyId = String(body.companyId ?? "").trim();
  if (!companyId) return fail("companyId wajib diisi", 400);

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  if (!company) return fail("Perusahaan tidak ditemukan", 404);

  const label = body.label !== undefined && body.label !== null ? String(body.label).trim() : "";

  const created = await db.clientPortalToken.create({
    data: {
      token: randomBytes(24).toString("hex"), // 48 hex — rahasia, kunci satu-satunya akses klien
      companyId,
      label: label || null,
      createdByName: body.actorName !== undefined && body.actorName !== null ? String(body.actorName).trim() || null : null,
    },
  });

  await logAudit({
    actorName: String(body.actorName ?? "System"),
    actorRole: body.actorRole !== undefined && body.actorRole !== null ? String(body.actorRole) : null,
    action: "create",
    entity: "portal_token",
    entityId: created.id,
    entityLabel: `Token portal ${company.name}`,
    newValue: `Token dibuat (${label || "tanpa label"})`,
    req,
  });

  return ok({ token: created }, 201);
}
