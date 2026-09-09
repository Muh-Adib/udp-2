import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole, hashSecret } from "@/lib/crm/auth";
import { ROLES } from "@/lib/crm/constants";

/**
 * Ronde 46 — MANAJEMEN PENGGUNA NYATA (RBAC dari DB, bukan hardcode).
 * GET   → daftar pengguna (semua yang login; tanpa hash).
 * POST  → buat pengguna + kredensial (password & PIN di-hash scrypt) —
 *         hanya super_admin (assertRole, mirror matriks role).
 */

const VALID_ROLES = new Set<string>(ROLES.map((r) => r.key));

export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);

  // Tanpa sesi (layar login): daftar MINIMAL persona aktif — kompromi desain
  // terdokumentasi Ronde 36 (chip login butuh nama/role/avatar, tanpa kredensial).
  // Dengan sesi: daftar lengkap untuk modul User & Access.
  const full = !actor.denied;

  const users = await db.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, avatarColor: true,
      active: true, phone: full, brandAccess: full, password: full, pin: full, createdAt: full,
    },
    orderBy: { createdAt: "asc" },
    ...(full ? {} : { where: { active: true } }),
  });
  return ok({
    users: users.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, avatarColor: u.avatarColor,
      active: u.active,
      ...(full ? {
        phone: u.phone, brandAccess: u.brandAccess,
        hasPassword: !!u.password,
        legacyPin: !u.pin.startsWith("scrypt$"),
        createdAt: u.createdAt,
      } : {}),
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const body = await readBody(req);
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "marketing").trim();
  const password = typeof body.password === "string" ? body.password : "";
  const pin = String(body.pin ?? "1234").trim();

  if (!name || !email) return fail("Nama dan email wajib diisi", 400);
  if (!VALID_ROLES.has(role)) return fail("Peran tidak dikenal", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Format email tidak valid", 400);
  if (password.length < 8) return fail("Password minimal 8 karakter", 400);
  if (!/^\d{4,8}$/.test(pin)) return fail("PIN harus 4–8 digit angka", 400);

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return fail("Email sudah terdaftar", 409);

  const created = await db.user.create({
    data: {
      name, email, role,
      password: hashSecret(password),
      pin: hashSecret(pin),
      avatarColor: String(body.avatarColor ?? "#f97316").slice(0, 9),
      phone: body.phone ? String(body.phone).slice(0, 32) : null,
      brandAccess: String(body.brandAccess ?? "all").slice(0, 200),
    },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role, action: "create", entity: "user",
    entityId: created.id, entityLabel: created.email,
    metadata: `Pengguna baru ${created.name} (${created.role}) dibuat`, req,
  });

  return ok({
    user: {
      id: created.id, name: created.name, email: created.email, role: created.role,
      avatarColor: created.avatarColor, active: created.active, phone: created.phone,
      brandAccess: created.brandAccess, hasPassword: true, legacyPin: false, createdAt: created.createdAt,
    },
  }, 201);
}
