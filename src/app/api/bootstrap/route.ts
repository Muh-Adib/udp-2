import { NextRequest } from "next/server";
import { seedDatabase } from "@/lib/crm/seed";
import { db } from "@/lib/db";
import { ok, readBody } from "@/lib/crm/server";

export async function GET() {
  const brandCount = await db.brand.count();
  if (brandCount === 0) await seedDatabase();
  return ok({ ready: true });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const force = Boolean(body.force);
  const result = await seedDatabase(force);
  return ok(result);
}
