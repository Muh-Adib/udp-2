import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNEL_TYPES, maskCredentialValue } from "@/lib/crm/channels";

/**
 * Ronde 19 — Saluran & Integrasi: aksi per koneksi.
 *
 * PATCH /api/channels/:id — action: "update" (field/credentials merge, secret kosong
 *                            tidak menimpa), "test" (uji format kredensial),
 *                            "disconnect", "reconnect".
 * DELETE /api/channels/:id — hapus koneksi (audit).
 */

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === "string" ? v : String(v ?? "");
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function maskCredentials(raw: string): Record<string, string> {
  const creds = parseJsonObject(raw);
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    masked[k] = v ? maskCredentialValue(v) : "";
  }
  return masked;
}

async function load(id: string) {
  return db.channelConfig.findUnique({
    where: { id },
    include: { brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } } },
  });
}

function serialize(row: NonNullable<Awaited<ReturnType<typeof load>>>) {
  return {
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
  };
}

/** Uji kredensial level format (demo: tanpa panggilan jaringan nyata). */
function testCredentials(channel: string, creds: Record<string, string>): { ok: boolean; note: string } {
  const meta = CHANNEL_TYPES[channel];
  if (!meta) return { ok: false, note: "Tipe kanal tidak dikenal" };
  const missing = meta.fields.filter((f) => f.required && !creds[f.key]);
  if (missing.length > 0) {
    return { ok: false, note: `Kredensial kosong: ${missing.map((f) => f.label).join(", ")}` };
  }
  // Format check ringan per kanal.
  if (channel === "whatsapp") {
    if (creds.phoneNumberId && !/^\d{6,}$/.test(creds.phoneNumberId)) {
      return { ok: false, note: "Phone Number ID seharusnya berupa angka panjang (≥6 digit)" };
    }
    if (creds.verifyToken && creds.verifyToken.length < 8) {
      return { ok: false, note: "Verify Token terlalu pendek (minimal 8 karakter)" };
    }
  }
  if (channel === "email") {
    if (creds.smtpHost && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(creds.smtpHost)) {
      return { ok: false, note: "Format host tidak valid (mis. smtp.zoho.com)" };
    }
  }
  if (channel === "instagram") {
    if (creds.accountId && !/^\d{6,}$/.test(creds.accountId)) {
      return { ok: false, note: "IG Business Account ID seharusnya angka" };
    }
  }
  return { ok: true, note: "Format kredensial valid (mode demo — tanpa panggilan jaringan)" };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const row = await load(id);
  if (!row) return fail("Koneksi kanal tidak ditemukan", 404);

  const meta = CHANNEL_TYPES[row.channel];
  const action = typeof body.action === "string" ? body.action : "update";
  const actorName = typeof body.actorName === "string" ? body.actorName : "System";
  const actorRole = typeof body.actorRole === "string" ? body.actorRole : "super_admin";

  if (action === "disconnect" || action === "reconnect") {
    const status = action === "disconnect" ? "disconnected" : "connected";
    const updated = await db.channelConfig.update({
      where: { id },
      data: {
        status,
        statusNote: action === "disconnect" ? "Diputuskan oleh pengguna" : "Disambungkan kembali oleh pengguna",
        ...(action === "reconnect" ? { connectedAt: new Date() } : {}),
      },
      include: { brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } } },
    });
    await logAudit({
      actorName, actorRole,
      action: action === "disconnect" ? "disconnect" : "connect",
      entity: "channel", entityId: id,
      entityLabel: `${action === "disconnect" ? "putuskan" : "sambung ulang"} kanal ${row.channel} (${row.displayName})`,
      field: "status", oldValue: { status: row.status }, newValue: { status },
      req,
    });
    return ok({ config: serialize(updated) });
  }

  if (action === "test") {
    const creds = parseJsonObject(row.credentials);
    const result = testCredentials(row.channel, creds);
    const updated = await db.channelConfig.update({
      where: { id },
      data: {
        status: result.ok ? (row.status === "disconnected" ? "disconnected" : "connected") : "error",
        statusNote: result.note,
        lastTestedAt: new Date(),
      },
      include: { brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } } },
    });
    await logAudit({
      actorName, actorRole,
      action: "test",
      entity: "channel", entityId: id,
      entityLabel: `uji kanal ${row.channel} (${row.displayName}) — ${result.ok ? "lulus" : "gagal"}`,
      newValue: { ok: result.ok, note: result.note },
      req,
    });
    return ok({ config: serialize(updated), test: result });
  }

  // ---------- action "update" ----------
  const data: Record<string, unknown> = {};
  if (typeof body.displayName === "string" && body.displayName.trim()) data.displayName = body.displayName.trim();
  if (typeof body.accountRef === "string" && body.accountRef.trim()) data.accountRef = body.accountRef.trim();

  const incoming = body.credentials && typeof body.credentials === "object" && !Array.isArray(body.credentials)
    ? (body.credentials as Record<string, unknown>)
    : null;
  if (incoming) {
    const current = parseJsonObject(row.credentials);
    // Secret kosong/null → pertahankan nilai lama (jangan menimpa dgn kosong).
    for (const f of meta?.fields ?? []) {
      const v = incoming[f.key];
      if (typeof v === "string" && v.trim()) current[f.key] = v.trim();
      else if (v === null && !f.secret) current[f.key] = "";
    }
    // field non-secret tak dikenal tetap boleh dirapikan: simpan hanya field katalog
    const safeCreds: Record<string, string> = {};
    for (const f of meta?.fields ?? []) {
      if (current[f.key]) safeCreds[f.key] = current[f.key];
    }
    data.credentials = JSON.stringify(safeCreds);
    const result = testCredentials(row.channel, safeCreds);
    data.status = result.ok ? "connected" : "error";
    data.statusNote = result.note;
    data.lastTestedAt = new Date();
  }

  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan");

  const updated = await db.channelConfig.update({
    where: { id },
    data,
    include: { brand: { select: { id: true, name: true, slug: true, color: true, logoEmoji: true } } },
  });
  await logAudit({
    actorName, actorRole,
    action: "update",
    entity: "channel", entityId: id,
    entityLabel: `update kanal ${row.channel} (${updated.displayName})`,
    field: "fields",
    newValue: { fields: Object.keys(data).filter((k) => k !== "credentials") },
    req,
  });
  return ok({ config: serialize(updated) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.channelConfig.findUnique({ where: { id } });
  if (!row) return fail("Koneksi kanal tidak ditemukan", 404);

  await db.channelConfig.delete({ where: { id } });
  await logAudit({
    actorName: "System", actorRole: "super_admin",
    action: "delete",
    entity: "channel", entityId: id,
    entityLabel: `hapus kanal ${row.channel} (${row.displayName})`,
    oldValue: { channel: row.channel, displayName: row.displayName },
    req,
  });
  return ok({ ok: true });
}
