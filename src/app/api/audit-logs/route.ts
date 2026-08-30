import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? 100);
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");

  const logs = await db.auditLog.findMany({
    where: {
      ...(entity && entity !== "all" ? { entity } : {}),
      ...(action && action !== "all" ? { action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 300),
  });
  return ok({ logs });
}
