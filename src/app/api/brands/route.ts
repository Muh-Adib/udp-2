import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";

export async function GET() {
  const brands = await db.brand.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });
  return ok({ brands });
}
