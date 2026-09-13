import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { CHANNEL_TYPES, maskCredentialValue } from "@/lib/crm/channels";
import { verifyChannel } from "@/lib/crm/channel-verify";
import { resolveActor, assertRole } from "@/lib/crm/auth";

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
    include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
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
    isDemo: row.isDemo,
    connectedAt: row.connectedAt,
    lastTestedAt: row.lastTestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Pracheck format murah SEBELUM verifikasi jaringan nyata (ronde 21). */
function precheckCredentials(channel: string, creds: Record<string, string>): { ok: boolean; note: string } {
  const meta = CHANNEL_TYPES[channel];
  if (!meta) return { ok: false, note: "Tipe kanal tidak dikenal" };
  const missing = meta.fields.filter((f) => f.required && !creds[f.key]);
  if (missing.length > 0) {
    return { ok: false, note: `Kredensial kosong: ${missing.map((f) => f.label).join(", ")}` };
  }
  if (channel === "whatsapp") {
    if (creds.phoneNumberId && !/^\d{6,}$/.test(creds.phoneNumberId)) {
      return { ok: false, note: "Phone Number ID seharusnya berupa angka panjang (≥6 digit)" };
    }
    if (creds.verifyToken && creds.verifyToken.length < 8) {
      return { ok: false, note: "Verify Token terlalu pendek (minimal 8 karakter)" };
    }
  }
  if (channel === "email") {
    // Hostname (smtp.zoho.com) ATAU alamat IP (relay internal, mis. 192.168.1.10 / 127.0.0.1).
    const isHostname = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(creds.smtpHost ?? "");
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(creds.smtpHost ?? "") || /^\[[0-9a-f:]+\]$/i.test(creds.smtpHost ?? "");
    if (creds.smtpHost && !isHostname && !isIp) {
      return { ok: false, note: "Format host tidak valid (mis. smtp.zoho.com)" };
    }
  }
  if (channel === "instagram") {
    if (creds.accountId && !/^\d{6,}$/.test(creds.accountId)) {
      return { ok: false, note: "IG Business Account ID seharusnya angka" };
    }
  }
  return { ok: true, note: "Pracheck format lulus" };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  // Ronde 27: identitas aktor diambil dari sesi (cookie) — body tidak dipercaya lagi.
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const row = await load(id);
  if (!row) return fail("Koneksi kanal tidak ditemukan", 404);

  const meta = CHANNEL_TYPES[row.channel];
  const action = typeof body.action === "string" ? body.action : "update";
  const actorName = actor.name;
  const actorRole = actor.role;

  if (action === "disconnect" || action === "reconnect") {
    const status = action === "disconnect" ? "disconnected" : "connected";
    const updated = await db.channelConfig.update({
      where: { id },
      data: {
        status,
        statusNote: action === "disconnect" ? "Diputuskan oleh pengguna" : "Disambungkan kembali oleh pengguna",
        ...(action === "reconnect" ? { connectedAt: new Date() } : {}),
      },
      include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
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
    // Koneksi demo memakai kredensial buatan — tidak adil diuji ke penyedia;
    // beri status jujur tanpa panggilan jaringan (bukan error palsu).
    if (row.isDemo) {
      const updated = await db.channelConfig.update({
        where: { id },
        data: {
          status: "connected",
          statusNote: "Koneksi demo — kredensial buatan, verifikasi nyata dilewati",
          lastTestedAt: new Date(),
        },
        include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
      });
      await logAudit({
        actorName, actorRole,
        action: "test",
        entity: "channel", entityId: id,
        entityLabel: `uji kanal demo ${row.channel} (${row.displayName}) — dilewati (demo)`,
        newValue: { ok: true, note: "demo — verifikasi dilewati" },
        req,
      });
      return ok({ config: serialize(updated), test: { ok: true, note: "Koneksi demo — kredensial buatan, verifikasi nyata dilewati" } });
    }

    const creds = parseJsonObject(row.credentials);
    // Ronde 21: pracheck format → lalu verifikasi NYATA (SMTP/IMAP/Graph API).
    const pre = precheckCredentials(row.channel, creds);
    const result = pre.ok ? await verifyChannel(row.channel, creds) : pre;
    const updated = await db.channelConfig.update({
      where: { id },
      data: {
        status: result.ok ? (row.status === "disconnected" ? "disconnected" : "connected") : "error",
        statusNote: result.note,
        lastTestedAt: new Date(),
      },
      include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
    });
    await logAudit({
      actorName, actorRole,
      action: "test",
      entity: "channel", entityId: id,
      entityLabel: `uji nyata kanal ${row.channel} (${row.displayName}) — ${result.ok ? "lulus" : "gagal"}`,
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
    // Bugfix (Ronde 51 audit SMTP): kredensial diganti kredensial asli → kanal TIDAK lagi demo.
    // Dulu isDemo tetap true sehingga tombol "Uji" memakai jalur demo (tanpa uji
    // jaringan) dan menimpa hasil verifikasi nyata dgn catatan "Koneksi demo" —
    // error autentikasi asli jadi tak terlihat dan email tak pernah terkirim nyata.
    data.isDemo = false;
    const pre = precheckCredentials(row.channel, safeCreds);
    const result = pre.ok ? await verifyChannel(row.channel, safeCreds) : pre;
    data.status = result.ok ? "connected" : "error";
    data.statusNote = result.note;
    data.lastTestedAt = new Date();
  }

  if (Object.keys(data).length === 0) return fail("Tidak ada perubahan");

  const updated = await db.channelConfig.update({
    where: { id },
    data,
    include: { brand: { select: { id: true, name: true, slug: true, color: true } } },
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
  // Ronde 27: identitas aktor diambil dari sesi (cookie).
  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  const gate = assertRole(actor, ["super_admin", "director"]);
  if (!gate.ok) return fail(gate.reason, 403);
  const { id } = await params;
  const row = await db.channelConfig.findUnique({ where: { id } });
  if (!row) return fail("Koneksi kanal tidak ditemukan", 404);

  await db.channelConfig.delete({ where: { id } });
  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "delete",
    entity: "channel", entityId: id,
    entityLabel: `hapus kanal ${row.channel} (${row.displayName})`,
    oldValue: { channel: row.channel, displayName: row.displayName },
    req,
  });
  return ok({ ok: true });
}
