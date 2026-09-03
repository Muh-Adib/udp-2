import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNEL_TYPES, CHANNEL_TYPE_KEYS, requiredCredentialKeys, maskCredentialValue } from "@/lib/crm/channels";
import { verifyChannel } from "@/lib/crm/channel-verify";
import { resolveActor, assertRole } from "@/lib/crm/auth";

/**
 * Ronde 19/20 — Saluran & Integrasi.
 *
 * GET  /api/channels — daftar koneksi (kredensial TERSENSA) + info webhook +
 *                      statistik aktivitas 7 hari per kanal + katalog tipe.
 * POST /api/channels — hubungkan kanal (satu konfigurasi per kanal+brand).
 */

/** Parse JSON object aman. */
function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/** Mask seluruh kredensial sebelum keluar dari server. */
function maskCredentials(raw: string): Record<string, string> {
  const creds = parseJsonObject(raw);
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    masked[k] = v ? maskCredentialValue(v) : "";
  }
  return masked;
}

type ConfigRow = Awaited<ReturnType<typeof listChannelConfigs>>[number];

function listChannelConfigs() {
  return db.channelConfig.findMany({
    include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

function serializeConfig(r: ConfigRow) {
  return {
    id: r.id,
    channel: r.channel,
    brandId: r.brandId,
    brand: r.brand,
    displayName: r.displayName,
    accountRef: r.accountRef,
    credentials: maskCredentials(r.credentials),
    status: r.status,
    statusNote: r.statusNote,
    isDemo: r.isDemo,
    connectedAt: r.connectedAt,
    lastTestedAt: r.lastTestedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function GET() {
  const rows = await listChannelConfigs();

  // Info webhook WhatsApp utk panduan setup Meta (path relatif — gateway menanganinya).
  const whatsappRows = rows.filter(
    (r) => r.channel === "whatsapp" && r.credentials && parseJsonObject(r.credentials).verifyToken
  );
  const configuredVerifyTokens = whatsappRows.map((r) => parseJsonObject(r.credentials).verifyToken);
  const configuredSecretCount = rows.filter(
    (r) => r.channel === "whatsapp" && Boolean(parseJsonObject(r.credentials).appSecret)
  ).length;
  const effectiveVerifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN || configuredVerifyTokens[0] || "grupcrm-demo-token";

  // Statistik aktivitas per kanal (lead masuk & balasan) — 7 hari + total.
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recent, allTime] = await Promise.all([
    db.interaction.groupBy({
      by: ["channel", "direction"],
      where: { createdAt: { gte: since7d }, channel: { in: CHANNEL_TYPE_KEYS } },
      _count: { _all: true },
    }),
    db.interaction.groupBy({
      by: ["channel", "direction"],
      where: { channel: { in: CHANNEL_TYPE_KEYS } },
      _count: { _all: true },
    }),
  ]);
  const bucket = (rowsIn: Array<{ channel: string; direction: string; _count: { _all: number } }>) => {
    const map: Record<string, { inbound: number; outbound: number }> = {};
    for (const r of rowsIn) {
      const entry = map[r.channel] ?? { inbound: 0, outbound: 0 };
      if (r.direction === "inbound") entry.inbound += r._count._all;
      else if (r.direction === "outbound") entry.outbound += r._count._all;
      map[r.channel] = entry;
    }
    return map;
  };
  const recentMap = bucket(recent);
  const allTimeMap = bucket(allTime);
  const stats: Record<string, { inbound7d: number; outbound7d: number; inboundTotal: number }> = {};
  for (const key of CHANNEL_TYPE_KEYS) {
    stats[key] = {
      inbound7d: recentMap[key]?.inbound ?? 0,
      outbound7d: recentMap[key]?.outbound ?? 0,
      inboundTotal: allTimeMap[key]?.inbound ?? 0,
    };
  }

  return ok({
    configs: rows.map(serializeConfig),
    webhook: {
      whatsapp: {
        path: "/api/webhooks/whatsapp",
        envVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
        envAppSecret: Boolean(process.env.WHATSAPP_APP_SECRET),
        effectiveVerifyToken,
        dbTokenCount: configuredVerifyTokens.length,
        dbSecretCount: configuredSecretCount,
      },
    },
    stats,
    types: CHANNEL_TYPES,
  });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const channel = typeof body.channel === "string" ? body.channel : "";
  if (!CHANNEL_TYPES[channel]) return fail("Tipe kanal tidak dikenal", 400);

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return fail("Nama koneksi wajib diisi", 400);

  const brandId = typeof body.brandId === "string" && body.brandId ? body.brandId : null;
  if (brandId) {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    if (!brand) return fail("Brand tidak ditemukan", 404);
  }

  const accountRef = typeof body.accountRef === "string" ? body.accountRef.trim() : "";
  if (!accountRef) return fail(`${CHANNEL_TYPES[channel].accountRefLabel} wajib diisi`, 400);

  const creds = body.credentials && typeof body.credentials === "object" && !Array.isArray(body.credentials)
    ? (body.credentials as Record<string, unknown>)
    : {};
  const missing = requiredCredentialKeys(channel).filter((k) => {
    const v = creds[k];
    return typeof v !== "string" || !v.trim();
  });
  if (missing.length > 0) {
    const labels = missing.map((k) => CHANNEL_TYPES[channel].fields.find((f) => f.key === k)?.label ?? k);
    return fail(`Kredensial wajib belum lengkap: ${labels.join(", ")}`, 400);
  }

  // Satu koneksi per kanal+brand (global = brandId null) — cek SEBELUM verifikasi jaringan.
  const existing = await db.channelConfig.findFirst({ where: { channel, brandId } });
  if (existing) {
    return fail(
      `Kanal ${CHANNEL_TYPES[channel].label} sudah terhubung${existing.brandId ? " untuk brand ini" : " (global)"} — edit atau putuskan dulu`,
      409
    );
  }

  const safeCreds: Record<string, string> = {};
  for (const f of CHANNEL_TYPES[channel].fields) {
    const v = creds[f.key];
    if (typeof v === "string" && v.trim()) safeCreds[f.key] = v.trim();
  }

  // Ronde 21: verifikasi NYATA sebelum menyimpan — kecuali operator sadar memilih
  // "tanpa verifikasi (demo)". Tanpa ini kanal bisa salah bertanda Terhubung.
  const skipVerification = body.skipVerification === true;
  const isDemo = body.isDemo === true || skipVerification;
  let statusNote: string;
  if (skipVerification) {
    statusNote = "Tersimpan TANPA verifikasi (mode demo) — tekan “Uji” untuk verifikasi nyata";
  } else {
    const v = await verifyChannel(channel, safeCreds);
    if (!v.ok) {
      return fail(v.note, 422);
    }
    statusNote = v.note;
  }

  const row = await db.channelConfig.create({
    data: {
      channel,
      brandId,
      displayName,
      accountRef,
      credentials: JSON.stringify(safeCreds),
      status: "connected",
      statusNote,
      isDemo,
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
    entityLabel: `hubungkan kanal ${channel}${isDemo ? " [demo]" : ""} (${displayName}${accountRef ? ` · ${accountRef}` : ""})`,
    newValue: { channel, displayName, accountRef, brandId, isDemo },
    req,
  });

  return ok({ config: serializeConfig(row) }, 201);
}
