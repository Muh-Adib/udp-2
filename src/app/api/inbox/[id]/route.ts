import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 61 — hapus & pulihkan pesan Lead Inbox (anti spam / bukan lead).
 *
 * DELETE /api/inbox/:id  { mode?: "archive" | "permanent", ids?: string[] }
 *  - mode "archive" (DEFAULT): SOFT DELETE — archivedAt diisi, pesan hilang dari
 *    semua tampilan inbox tapi masih bisa dipulihkan dari tab Arsip (recoverable).
 *  - mode "permanent": hapus baris interaction permanen — HANYA untuk pesan yang
 *    sudah berada di Arsip (dua langkah, mencegah salah klik hilang selamanya).
 *  - `ids`: pesan TAMBAHAN dalam thread yang sama (batch) — kartu percakapan
 *    bisa berisi beberapa pesan inbound; semua ikut diarsipkan/dihapus sekalian.
 *
 * PATCH /api/inbox/:id  { archived: false, ids?: string[] } → pulihkan dari Arsip.
 *
 * Guard keamanan (berlaku utk semua pesan target):
 *  - hanya pesan direction=inbound (outbound adalah riwayat respons staf);
 *  - pesan yang sudah tertaut opportunity (thread klien aktif) TIDAK boleh
 *    dihapus — kelola lewat Sales Pipeline; ini menjaga riwayat chat deal.
 */

type Params = { params: Promise<{ id: string }> };

const SNIPPET = 160;
const MAX_IDS = 200;

/** Kumpulkan id target unik: id route + ids tambahan body (batch thread). */
function collectIds(id: string, body: Record<string, unknown>): string[] {
  const ids = new Set<string>([id]);
  if (Array.isArray(body.ids)) {
    for (const raw of body.ids) {
      const s = String(raw ?? "").trim();
      if (s) ids.add(s);
      if (ids.size > MAX_IDS) break;
    }
  }
  return [...ids].slice(0, MAX_IDS);
}

function labelOf(row: {
  senderName: string | null;
  content: string;
  channel: string;
  brand?: { name: string } | null;
}) {
  const sender = (row.senderName ?? "").trim() || "Tanpa nama";
  const snippet = row.content.replace(/\s+/g, " ").trim().slice(0, SNIPPET);
  const label = `${sender}${row.brand?.name ? ` · ${row.brand.name}` : ""} (${row.channel})`;
  return { sender, snippet, label };
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  if (actor.role === "client") return fail("Tidak diizinkan", 403);

  const mode = body.mode === "permanent" ? "permanent" : "archive";
  const ids = collectIds(id, body);

  const rows = await db.interaction.findMany({
    where: { id: { in: ids } },
    include: { brand: { select: { name: true } } },
  });
  if (rows.length === 0) return fail("Pesan tidak ditemukan", 404);

  for (const row of rows) {
    if (row.direction !== "inbound") {
      return fail("Hanya pesan masuk (inbound) yang bisa dihapus dari inbox", 400);
    }
    if (row.opportunityId) {
      return fail("Percakapan sudah dikonversi menjadi opportunity — tidak bisa dihapus. Kelola lewat Sales Pipeline.", 400);
    }
  }
  const primary = rows.find((r) => r.id === id) ?? rows[0];
  const { snippet, label } = labelOf(primary);
  const affectedIds = rows.map((r) => r.id);
  const suffix = rows.length > 1 ? ` +${rows.length - 1} pesan lain dalam thread` : "";

  if (mode === "permanent") {
    const notArchived = rows.filter((r) => !r.archivedAt);
    if (notArchived.length > 0) {
      return fail("Hapus permanen hanya untuk pesan di tab Arsip — arsipkan dulu bila perlu", 400);
    }
    await db.interaction.deleteMany({ where: { id: { in: affectedIds } } });
    await logAudit({
      actorName: actor.name,
      actorRole: actor.role,
      action: "delete",
      entity: "interaction",
      entityId: id,
      entityLabel: `Hapus permanen pesan inbox: ${label}${suffix}`,
      metadata: `isi: ${snippet}`,
      req,
    });
    return ok({ deleted: true, mode: "permanent", affected: affectedIds.length });
  }

  // mode archive — soft delete
  const archivedAt = new Date();
  await db.interaction.updateMany({
    where: { id: { in: affectedIds } },
    data: { archivedAt },
  });
  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    entity: "interaction",
    entityId: id,
    entityLabel: `Arsipkan pesan inbox: ${label}${suffix}`,
    field: "archivedAt",
    oldValue: null,
    newValue: archivedAt.toISOString(),
    metadata: `isi: ${snippet}`,
    req,
  });
  return ok({ deleted: true, mode: "archive", affected: affectedIds.length });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);
  if (actor.role === "client") return fail("Tidak diizinkan", 403);

  if (body.archived !== false) return fail("Tidak ada perubahan");

  const ids = collectIds(id, body);
  const rows = await db.interaction.findMany({
    where: { id: { in: ids } },
    include: { brand: { select: { name: true } } },
  });
  if (rows.length === 0) return fail("Pesan tidak ditemukan", 404);
  const restorable = rows.filter((r) => r.archivedAt);
  if (restorable.length === 0) return ok({ restored: false, affected: 0 });

  await db.interaction.updateMany({
    where: { id: { in: restorable.map((r) => r.id) } },
    data: { archivedAt: null },
  });
  const primary = restorable.find((r) => r.id === id) ?? restorable[0];
  const { snippet, label } = labelOf(primary);
  const suffix = restorable.length > 1 ? ` +${restorable.length - 1} pesan lain dalam thread` : "";
  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    entity: "interaction",
    entityId: id,
    entityLabel: `Pulihkan pesan inbox dari arsip: ${label}${suffix}`,
    field: "archivedAt",
    oldValue: primary.archivedAt?.toISOString() ?? null,
    newValue: null,
    metadata: `isi: ${snippet}`,
    req,
  });
  return ok({ restored: true, affected: restorable.length });
}
