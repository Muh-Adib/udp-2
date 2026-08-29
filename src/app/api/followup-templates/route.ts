import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const brandId = searchParams.get("brandId");
  const templates = await db.followUpTemplate.findMany({
    where: brandId && brandId !== "all" ? { brandId } : {},
    orderBy: { delayDays: "asc" },
  });
  return ok({ templates });
}
