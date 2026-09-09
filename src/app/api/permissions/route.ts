import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, readBody, logAudit, fail } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import {
  assertModuleLevel, ACCESS_LEVELS, MODULE_KEYS, isAccessLevel,
  loadPermissionMatrix, invalidatePermissionCache, ensureDefaultPermissions,
} from "@/lib/crm/permissions";

/**
 * Ronde 47 — API matriks hak akses dinamis (RBAC tanpa hardcode).
 *
 * GET  : (butuh sesi) seluruh matriks role→module→level — dipakai UI untuk
 *        filter navigasi (canAccess) dan editor admin. Default dijamin ter-seed.
 * PUT  : (super_admin/director + level users "full") simpan massal entri
 *        {role, module, level}; di-upsert dalam satu transaksi + audit log.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req, {});
  if (actor.denied) return fail(actor.reason, 401);
  const matrix = await loadPermissionMatrix();
  return ok({
    permissions: matrix,
    modules: MODULE_KEYS,
    levels: ACCESS_LEVELS,
  });
}

export async function PUT(req: NextRequest) {
  const body = await readBody(req);
  const actor = await resolveActor(req, {});
  if (actor.denied) return fail(actor.reason, 401);
  // Dua lapis gerbang: role statis + level modul dinamis (users = full).
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const moduleGate = await assertModuleLevel(actor, "users", "full");
  if (!moduleGate.ok) return fail(moduleGate.reason, 403);

  const entries = Array.isArray(body.entries) ? body.entries : null;
  if (!entries || entries.length === 0) return fail("Daftar entri hak akses kosong", 400);

  // Validasi ketat sebelum menulis — satu entri salah = seluruh batch ditolak.
  const valid: { role: string; module: string; level: string }[] = [];
  for (const raw of entries) {
    const role = String((raw as Record<string, unknown>)?.role ?? "").trim();
    const moduleKey = String((raw as Record<string, unknown>)?.module ?? "").trim();
    const level = String((raw as Record<string, unknown>)?.level ?? "").trim();
    if (!role || !moduleKey) return fail("Setiap entri wajib punya role & module", 400);
    if (!(MODULE_KEYS as readonly string[]).includes(moduleKey)) {
      return fail(`Modul tidak dikenal: ${moduleKey}`, 400);
    }
    if (!isAccessLevel(level)) {
      return fail(`Level tidak dikenal: ${level} (harus ${ACCESS_LEVELS.join("/")})`, 400);
    }
    valid.push({ role, module: moduleKey, level });
  }

  await ensureDefaultPermissions();
  await db.$transaction(
    valid.map((e) =>
      db.modulePermission.upsert({
        where: { role_module: { role: e.role, module: e.module } },
        create: e,
        update: { level: e.level },
      }),
    ),
  );
  invalidatePermissionCache();

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "module_permission", entityId: "matrix",
    entityLabel: "Matriks Hak Akses",
    newValue: `${valid.length} entri diperbarui (${valid.slice(0, 5).map((e) => `${e.role}/${e.module}=${e.level}`).join(", ")}${valid.length > 5 ? ", …" : ""})`,
    req,
  });

  const matrix = await loadPermissionMatrix();
  return ok({ permissions: matrix, updated: valid.length });
}
