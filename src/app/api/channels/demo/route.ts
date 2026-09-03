import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNEL_TYPES, DEMO_CONNECTIONS, brandDemoConnection } from "@/lib/crm/channels";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Ronde 20 — Mode Demo: hubungkan kanal dengan 1 klik (kredensial buatan).
 * Tujuan: user yang kesulitan setup manual tetap bisa melihat alur end-to-end
 * tanpa akun Meta / server SMTP. Koneksi ditandai isDemo di UI & audit log.
 *
 * Ronde 29-b — PER BRAND: bila brandId diberikan, akun demo mengikuti data
 * asli brand (nomor WA / IG / Threads / email milik brand tersebut), jadi
 * tiap brand punya integrasinya sendiri-sendiri.
 *
 * POST /api/channels/demo — body: { channel, brandId?, actorName?, actorRole? }
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const channel = typeof body.channel === "string" ? body.channel : "";
  if (!CHANNEL_TYPES[channel]) return fail("Tipe kanal tidak dikenal", 400);

  const brandId = typeof body.brandId === "string" && body.brandId ? body.brandId : null;
  // Ronde 29-b — PER BRAND: bila brandId diberikan, akun demo mengikuti data
  // asli brand (nomor WA / IG / Threads / email milik brand tersebut).
  let preset: { displayName: string; accountRef: string; credentials: Record<string, string> } | null = null;
  if (brandId) {
    const brand = await db.brand.findUnique({
      where: { id: brandId },
      select: { name: true, whatsappNumber: true, instagramHandle: true, threadsHandle: true, email: true },
    });
    if (!brand) return fail("Brand tidak ditemukan", 404);
    preset = brandDemoConnection(channel, brand);
  } else {
    preset = DEMO_CONNECTIONS[channel] ?? null;
  }
  if (!preset) return fail("Preset demo belum tersedia untuk kanal ini", 400);
  const demo = preset;

  const existing = await db.channelConfig.findFirst({ where: { channel, brandId } });
  if (existing) {
    return fail(
      `Kanal ${CHANNEL_TYPES[channel].label} sudah terhubung${existing.brandId ? " untuk brand ini" : " (global)"} — edit atau putuskan dulu`,
      409
    );
  }

  const row = await db.channelConfig.create({
    data: {
      channel,
      brandId,
      displayName: demo.displayName,
      accountRef: demo.accountRef,
      credentials: JSON.stringify(demo.credentials),
      status: "connected",
      statusNote: "Koneksi mode demo — kredensial buatan, tidak memanggil API penyedia",
      isDemo: true,
      connectedAt: new Date(),
      lastTestedAt: new Date(),
    },
    include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
  });

  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "connect",
    entity: "channel",
    entityId: row.id,
    entityLabel: `hubungkan kanal ${channel} [demo 1-klik] (${demo.displayName})`,
    newValue: { channel, brandId, isDemo: true, accountRef: demo.accountRef },
    req,
  });

  return ok(
    {
      config: {
        id: row.id,
        channel: row.channel,
        brandId: row.brandId,
        brand: row.brand,
        displayName: row.displayName,
        accountRef: row.accountRef,
        credentials: {},
        status: row.status,
        statusNote: row.statusNote,
        isDemo: row.isDemo,
        connectedAt: row.connectedAt,
        lastTestedAt: row.lastTestedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    },
    201
  );
}
