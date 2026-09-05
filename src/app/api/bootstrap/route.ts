import { NextRequest } from "next/server";
import { seedDatabase } from "@/lib/crm/seed";
import { db } from "@/lib/db";
import { ok, fail, readBody } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

export async function GET() {
  const brandCount = await db.brand.count();
  if (brandCount === 0) await seedDatabase();
  return ok({ ready: true });
}

/**
 * Ronde 26 engineering: reseed paksa (force=true menghapus SEMUA data) kini
 * hanya diizinkan di development atau bila env ALLOW_RESEED=1 —
 * sebelumnya satu POST tak-terautentikasi bisa menghapus seluruh database.
 * Ronde 36 (audit): di ATAS gerbang env itu, force kini JUGA wajib sesi
 * Super Admin yang sedang masuk — bila env terlewat, wipe tetap tidak bisa
 * dilakukan anonim.
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const force = Boolean(body.force);
  if (force) {
    const actor = await resolveActor(req, body);
    if (actor.denied || actor.role !== "super_admin") {
      return fail("Reseed paksa hanya boleh dilakukan Super Admin yang sedang masuk", 403);
    }
  }
  const reseedAllowed =
    process.env.NODE_ENV !== "production" || process.env.ALLOW_RESEED === "1";
  if (force && !reseedAllowed) {
    return ok({ error: "Reseed dinonaktifkan di produksi (set ALLOW_RESEED=1 bila benar-benar perlu)" }, 403);
  }
  const result = await seedDatabase(force);
  return ok(result);
}
