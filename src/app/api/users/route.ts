import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";

export async function GET() {
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, avatarColor: true, active: true },
    orderBy: { createdAt: "asc" },
  });
  return ok({ users });
}
