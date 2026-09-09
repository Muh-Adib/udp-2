import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor, assertRole, hashSecret } from "@/lib/crm/auth";
import { ROLES } from "@/lib/crm/constants";

/**
 * Ronde 46 — kelola satu pengguna (super_admin/direktur; audit per perubahan).
 * PATCH: name/role/avatarColor/phone/brandAccess/active + reset password/pin.
 * Proteksi: admin tidak bisa menonaktifkan/menurunkan dirinya sendiri
 * (mencegah terkunci dari sistem tanpa admin lain).
 */
const VALID_ROLES = new Set<string>(ROLES.map((r) => r.key));

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  // Ronde 46-b — direktur ikut mengelola pengguna (tim UDP tanpa super_admin khusus).
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);

  const { id } = await params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return fail("Pengguna tidak ditemukan", 404);

  const body = await readBody(req);
  const data: Record<string, string | boolean | null> = {};
  const changes: string[] = [];

  if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== target.name) {
    data.name = body.name.trim().slice(0, 80);
    changes.push(`nama → ${data.name}`);
  }
  if (typeof body.role === "string" && body.role !== target.role) {
    if (!VALID_ROLES.has(body.role)) return fail("Peran tidak dikenal", 400);
    if (target.id === actor.id) return fail("Tidak bisa menurunkan peran akun sendiri — minta admin lain", 400);
    data.role = body.role;
    changes.push(`peran → ${body.role}`);
  }
  if (typeof body.active === "boolean" && body.active !== target.active) {
    if (target.id === actor.id && !body.active) return fail("Tidak bisa menonaktifkan akun sendiri", 400);
    data.active = body.active;
    changes.push(body.active ? "diaktifkan" : "dinonaktifkan");
  }
  if (typeof body.avatarColor === "string" && body.avatarColor !== target.avatarColor) {
    data.avatarColor = body.avatarColor.slice(0, 9);
    changes.push("warna avatar");
  }
  if ("phone" in body) {
    const phone = body.phone ? String(body.phone).slice(0, 32) : null;
    if (phone !== target.phone) {
      data.phone = phone;
      changes.push("telepon");
    }
  }
  if (typeof body.brandAccess === "string" && body.brandAccess !== target.brandAccess) {
    data.brandAccess = body.brandAccess.slice(0, 200);
    changes.push("akses brand");
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) return fail("Password minimal 8 karakter", 400);
    data.password = hashSecret(body.password);
    changes.push("password direset");
  }
  if (typeof body.pin === "string" && body.pin) {
    if (!/^\d{4,8}$/.test(body.pin)) return fail("PIN harus 4–8 digit angka", 400);
    data.pin = hashSecret(body.pin);
    changes.push("PIN direset");
  }

  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan", 400);

  const updated = await db.user.update({ where: { id }, data });

  await logAudit({
    actorName: actor.name, actorRole: actor.role, action: "update", entity: "user",
    entityId: updated.id, entityLabel: updated.email,
    metadata: `Kelola pengguna: ${changes.join(", ")}`, req,
  });

  return ok({
    user: {
      id: updated.id, name: updated.name, email: updated.email, role: updated.role,
      avatarColor: updated.avatarColor, active: updated.active, phone: updated.phone,
      brandAccess: updated.brandAccess, hasPassword: !!updated.password,
      legacyPin: !updated.pin.startsWith("scrypt$"), createdAt: updated.createdAt,
    },
  });
}
