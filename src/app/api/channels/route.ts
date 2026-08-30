import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNEL_TYPES, requiredCredentialKeys, maskCredentialValue } from "@/lib/crm/channels";

/**
 * Ronde 19 — Saluran & Integrasi (Fase 3).
 *
 * GET  /api/channels — daftar koneksi (kredensial TERSENSA) + info webhook + katalog tipe.
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

export async function GET() {
  const rows = await db.channelConfig.findMany({
    include: { brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } } },
    orderBy: { updatedAt: "desc" },
  });

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

  return ok({
    configs: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      brandId: r.brandId,
      brand: r.brand,
      displayName: r.displayName,
      accountRef: r.accountRef,
      credentials: maskCredentials(r.credentials),
      status: r.status,
      statusNote: r.statusNote,
      connectedAt: r.connectedAt,
      lastTestedAt: r.lastTestedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
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
    types: CHANNEL_TYPES,
  });
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
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

  // Satu koneksi per kanal+brand (global = brandId null).
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

  const row = await db.channelConfig.create({
    data: {
      channel,
      brandId,
      displayName,
      accountRef,
      credentials: JSON.stringify(safeCreds),
      status: "connected",
      statusNote: "Kredensial tersimpan (mode demo: belum ada panggilan jaringan)",
      connectedAt: new Date(),
      lastTestedAt: new Date(),
    },
    include: { brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } } },
  });

  await logAudit({
    actorName: typeof body.actorName === "string" ? body.actorName : "System",
    actorRole: typeof body.actorRole === "string" ? body.actorRole : "super_admin",
    action: "connect",
    entity: "channel",
    entityId: row.id,
    entityLabel: `hubungkan kanal ${channel} (${displayName}${accountRef ? ` · ${accountRef}` : ""})`,
    newValue: { channel, displayName, accountRef, brandId },
    req,
  });

  return ok({
    config: {
      id: row.id,
      channel: row.channel,
      brandId: row.brandId,
      brand: row.brand,
      displayName: row.displayName,
      accountRef: row.accountRef,
      credentials: maskCredentials(row.credentials),
      status: row.status,
      statusNote: row.statusNote,
      connectedAt: row.connectedAt,
      lastTestedAt: row.lastTestedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  }, 201);
}
