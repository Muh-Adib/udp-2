import { db } from "@/lib/db";
import { ok, pageLimit } from "@/lib/crm/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = pageLimit(searchParams.get("limit"), 100, 300); // FIX r26: limit=abc dulu → take NaN → 500
  const entity = searchParams.get("entity");
  const action = searchParams.get("action");

  const logs = await db.auditLog.findMany({
    where: {
      ...(entity && entity !== "all" ? { entity } : {}),
      ...(action && action !== "all" ? { action } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return ok({ logs });
}
