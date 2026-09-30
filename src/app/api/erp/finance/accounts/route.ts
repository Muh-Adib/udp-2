import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, isUniqueViolation } from "@/lib/crm/server";
import { gate, FINANCE_READ_ROLES, FINANCE_WRITE_ROLES, strOrNull, isAccountType } from "../_lib";

/**
 * FASE 7 — Bagan akun (COA).
 * GET  ?type=&q= : finance/director/super_admin — daftar akun (q = kode/nama, case-insensitive).
 * POST           : finance/director — {code, name, type} — kode unik (409 bila duplikat).
 */

export async function GET(req: NextRequest) {
  const g = await gate(req, FINANCE_READ_ROLES);
  if (g.res) return g.res;

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type")?.trim();
  const q = sp.get("q")?.trim().toLowerCase();

  const accounts = await db.account.findMany({
    where: type && isAccountType(type) ? { type } : undefined,
    orderBy: { code: "asc" },
    take: 500,
  });

  // SQLite tidak mendukung `insensitive` Prisma — filter q in-memory (case-insensitive).
  const filtered = q
    ? accounts.filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    : accounts;

  return ok({ accounts: filtered });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const g = await gate(req, FINANCE_WRITE_ROLES, body);
  if (g.res) return g.res;

  const code = strOrNull(body.code);
  const name = strOrNull(body.name);
  const type = strOrNull(body.type);
  if (!code) return fail("Kode akun wajib diisi");
  if (!name) return fail("Nama akun wajib diisi");
  if (!type || !isAccountType(type)) {
    return fail("Tipe akun tidak valid (asset/liability/equity/revenue/expense)");
  }

  try {
    const account = await db.account.create({
      data: { code, name: name.slice(0, 120), type, active: true },
    });
    await logAudit({
      actorName: g.actor.name, actorRole: g.actor.role,
      action: "create", entity: "account", entityId: account.id, entityLabel: `${account.code} — ${account.name}`,
      field: "type", newValue: account.type, metadata: "Bagan akun baru", req,
    });
    return ok({ account }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) return fail(`Kode akun ${code} sudah dipakai`, 409);
    throw err;
  }
}
