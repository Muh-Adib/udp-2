import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, findMatchCandidates, logAudit } from "@/lib/crm/server";
import { runSlaSweep } from "@/lib/crm/sla-sweep";
import { extractEmailFromText } from "@/lib/crm/utils";
import { computeReplyChannels, inferBrandIdFromSource, senderTokens, threadKeyFor } from "@/lib/crm/thread";

/**
 * Unified Lead Inbox: pesan inbound yang belum ditautkan ke opportunity
 * + thread percakapan per kontak + daftar kanal balasan yang tersedia.
 *
 * Ronde 25:
 * - `replyChannels` per lead — balasan hanya lewat kanal yang benar-benar punya alamat tujuan.
 * - sweep=1 memicu auto-unify (skor ≥80 → tautkan ke contact) + inferensi brand dari akun sumber.
 */

/** Ronde 24 — pesan ringkas dalam thread (tanpa field internal berat). */
function serializeThreadMessage(i: {
  id: string; channel: string; direction: string; subject: string | null;
  content: string; senderName: string | null; recipientName: string | null;
  respondedBy: string | null; deliveryStatus: string | null; createdAt: Date; externalId: string | null;
}) {
  return {
    id: i.id,
    channel: i.channel,
    direction: i.direction,
    subject: i.subject,
    content: i.content,
    senderName: i.senderName,
    recipientName: i.recipientName,
    respondedBy: i.respondedBy,
    deliveryStatus: i.deliveryStatus,
    externalId: i.externalId,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Ronde 25 — auto-unify: lead tanpa contactId dengan kandidat skor ≥80 ditautkan otomatis. */
async function autoUnifyLeads(
  leads: Array<{ id: string; contactId: string | null; candidates: Array<{ contactId: string; score: number }>; brandId: string | null; channel: string; recipientName: string | null; senderName: string | null; externalId: string | null }>,
  actorName: string,
  req: NextRequest,
): Promise<number> {
  let linked = 0;
  const configs = await db.channelConfig.findMany({
    select: { channel: true, brandId: true, accountRef: true, status: true },
  });
  for (const lead of leads) {
    if (lead.contactId) continue;
    const best = lead.candidates.reduce<{ contactId: string; score: number } | null>(
      (acc, c) => (!acc || c.score > acc.score ? c : acc), null,
    );
    if (!best || best.score < 80) continue;
    const contact = await db.contact.findUnique({
      where: { id: best.contactId },
      select: { id: true, companyId: true, fullName: true },
    });
    if (!contact) continue;
    const data: Record<string, unknown> = { contactId: contact.id, companyId: contact.companyId };
    // Brand dari sumber lead bila belum ada
    if (!lead.brandId) {
      const brandId = inferBrandIdFromSource(lead, configs);
      if (brandId) data.brandId = brandId;
    }
    await db.interaction.update({ where: { id: lead.id }, data });
    await logAudit({
      actorName,
      actorRole: "system",
      action: "update",
      entity: "interaction",
      entityId: lead.id,
      entityLabel: `Auto-unify lead ke ${contact.fullName}`,
      field: "contactId",
      oldValue: null,
      newValue: contact.id,
      metadata: `skor identitas ${best.score}`,
      req,
    });
    lead.contactId = contact.id; // agar thread & replyChannels ikut terupdate
    linked += 1;
  }
  return linked;
}

/** Ronde 25 — isi brandId lead yang masih kosong dari akun sumber (ChannelConfig.accountRef). */
async function inferMissingBrands(
  leads: Array<{ id: string; brandId: string | null; channel: string; recipientName: string | null; senderName: string | null; externalId: string | null }>,
  req: NextRequest,
): Promise<number> {
  const missing = leads.filter((l) => !l.brandId);
  if (missing.length === 0) return 0;
  const configs = await db.channelConfig.findMany({
    select: { channel: true, brandId: true, accountRef: true, status: true },
  });
  let filled = 0;
  for (const lead of missing) {
    const brandId = inferBrandIdFromSource(lead, configs);
    if (!brandId) continue;
    await db.interaction.update({ where: { id: lead.id }, data: { brandId } });
    lead.brandId = brandId;
    filled += 1;
  }
  return filled;
}

/** Unified Lead Inbox: pesan inbound yang belum ditautkan ke opportunity + thread percakapan. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const channelId = sp.get("channel");
  const brandId = sp.get("brandId");

  // Sweep berjalan ketika modul inbox dibuka (throttle 5 menit di lib).
  let autoEscalated = 0;
  if (sp.get("sweep") === "1") {
    try {
      autoEscalated = await runSlaSweep(req);
    } catch {
      autoEscalated = 0; // sweep gagal tidak boleh menggagalkan inbox
    }
  }

  const leads = await db.interaction.findMany({
    where: {
      direction: "inbound",
      opportunityId: null,
      ...(channelId && channelId !== "all" ? { channel: channelId } : {}),
      ...(brandId && brandId !== "all" ? { brandId } : {}),
    },
    include: { contact: { include: { company: true } }, brand: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Untuk setiap lead, cari kandidat identitas + hitung SLA
  const enriched = await Promise.all(
    leads.map(async (lead) => {
      // FIX r22: handle IG bukan email — hanya email valid (x@y.tld) yang dipakai utk pencocokan.
      const candidates = await findMatchCandidates({
        email: extractEmailFromText(lead.senderName),
        whatsapp: lead.senderName && /^\+?[\d][\d\s\-()+]{5,}$/.test(lead.senderName.trim()) ? lead.senderName : null,
        fullName: lead.contact?.fullName ?? null,
        companyName: lead.contact?.company?.name ?? null,
      });
      const waitHours = Math.floor((Date.now() - lead.createdAt.getTime()) / (60 * 60 * 1000));
      return {
        ...lead,
        slaHours: waitHours,
        candidates: candidates.filter((c) => c.score >= 40),
      };
    })
  );

  // ===== Ronde 25 — auto-unify berdasarkan kontak + inferensi brand dari sumber =====
  let autoUnified = 0;
  let brandInferred = 0;
  if (sp.get("sweep") === "1") {
    try {
      autoUnified = await autoUnifyLeads(enriched, "Sistem (Auto-unify)", req);
      brandInferred = await inferMissingBrands(enriched, req);
    } catch {
      // gagal auto-unify tidak boleh menggagalkan inbox
    }
  }

  // ===== Kumpulkan thread percakapan per identitas =====
  const contactIdToKey = new Map<string, string>();
  const tokenIndex = { email: new Map<string, string>(), phone: new Map<string, string>(), handle: new Map<string, string>(), name: new Map<string, string>() };
  const rawNames = new Set<string>();
  const replyMarkers = new Set<string>();

  for (const lead of enriched) {
    const key = threadKeyFor(lead);
    (lead as { threadKey?: string }).threadKey = key;
    if (lead.contactId) contactIdToKey.set(lead.contactId, key);
    for (const c of lead.candidates) {
      if (!contactIdToKey.has(c.contactId)) contactIdToKey.set(c.contactId, key);
    }
    const t = senderTokens(lead.senderName);
    if (t.email) tokenIndex.email.set(t.email, key);
    if (t.phone) tokenIndex.phone.set(t.phone, key);
    if (t.handle) tokenIndex.handle.set(t.handle, key);
    if (t.name) tokenIndex.name.set(t.name, key);
    if ((lead.senderName ?? "").trim()) rawNames.add((lead.senderName ?? "").trim());
    replyMarkers.add(`inbox-reply:${lead.id}`);
  }

  // Tarik riwayat interaksi terkait (dua arah, termasuk yang sudah tertaut).
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000); // 120 hari
  const contactIds = [...contactIdToKey.keys()];
  const rawNameList = [...rawNames];
  const history = rawNameList.length + contactIds.length > 0
    ? await db.interaction.findMany({
        where: {
          createdAt: { gte: since },
          OR: [
            ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
            ...(rawNameList.length
              ? [
                  { senderName: { in: rawNameList } },
                  { recipientName: { in: rawNameList } },
                ]
              : []),
            { externalId: { in: [...replyMarkers] } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 400,
      })
    : [];

  const threadMessages = new Map<string, ReturnType<typeof serializeThreadMessage>[]>();
  for (const i of history) {
    let key: string | undefined;
    if (i.contactId && contactIdToKey.has(i.contactId)) {
      key = contactIdToKey.get(i.contactId);
    } else {
      const s = senderTokens(i.senderName);
      const r = senderTokens(i.recipientName);
      key =
        (s.email && tokenIndex.email.get(s.email)) ||
        (r.email && tokenIndex.email.get(r.email)) ||
        (s.phone && tokenIndex.phone.get(s.phone)) ||
        (r.phone && tokenIndex.phone.get(r.phone)) ||
        (s.handle && tokenIndex.handle.get(s.handle)) ||
        (r.handle && tokenIndex.handle.get(r.handle)) ||
        (s.name && tokenIndex.name.get(s.name)) ||
        (r.name && tokenIndex.name.get(r.name)) ||
        undefined;
    }
    if (!key) continue;
    const arr = threadMessages.get(key) ?? [];
    arr.push(serializeThreadMessage(i));
    threadMessages.set(key, arr);
  }

  // Tempelkan thread + replyChannels ke tiap lead.
  const leadsWithThread = enriched.map((lead) => {
    const key = (lead as { threadKey?: string }).threadKey ?? threadKeyFor(lead);
    const seen = new Set<string>();
    const messages = (threadMessages.get(key) ?? [])
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .slice(-60);
    const channels = [...new Set(messages.map((m) => m.channel))];
    return {
      ...lead,
      threadKey: key,
      thread: {
        key,
        messageCount: messages.length,
        channels,
        lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : lead.createdAt.toISOString(),
        messages,
      },
      // Ronde 25 — kanal balasan legal utk lead ini (kontak punya alamatnya).
      replyChannels: computeReplyChannels(lead),
    };
  });

  return ok({ leads: leadsWithThread, autoEscalated, autoUnified, brandInferred });
}


