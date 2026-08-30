import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  const pin = String(body.pin ?? "").trim();

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active) return fail("Email tidak terdaftar atau tidak aktif", 401);
  if (user.pin !== pin) return fail("PIN salah", 401);

  // Untuk role client: temukan company dari contact dengan email sama
  let companyName: string | null = null;
  if (user.role === "client") {
    const contact = await db.contact.findFirst({
      where: { email, deletedAt: null },
      include: { company: true },
    });
    companyName = contact?.company?.name ?? null;
  }

  await logAudit({
    actorName: user.name,
    actorRole: user.role,
    action: "login",
    entity: "user",
    entityId: user.id,
    entityLabel: user.email,
    metadata: "Login berhasil",
    req,
  });

  return ok({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarColor: user.avatarColor,
      brandAccess: user.brandAccess,
      companyName,
    },
  });
}
