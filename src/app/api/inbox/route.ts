import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, findMatchCandidates } from "@/lib/crm/server";
import { runSlaSweep } from "@/lib/crm/sla-sweep";
import { extractEmailFromText, isSocialHandle } from "@/lib/crm/utils";

/**
 * Ronde 24 — THREADING PERCAKAPAN PER KONTAK.
 * Semua pesan (inbound & outbound) dari identitas pengirim yang sama dirangkai
 * jadi satu thread, meskipun masuk lewat kanal berbeda (IG/WhatsApp/Email) atau
 * sudah ditautkan ke contact/opportunity. Kunci thread dipilih dengan prioritas:
 * contactId > email > nomor WA > handle sosial > nama pengirim.
 */

function digitsOnly(v: string): string {
  return v.replace(/\D+/g, "");
}

/** Ekstrak token identitas dari sebuah nama pengirim/recipient bebas. */
function senderTokens(raw: string | null | undefined): {
  email?: string; phone?: string; handle?: string; name?: string;
} {
  const s = (raw ?? "").trim();
  if (!s) return {};
  const email = extractEmailFromText(s)?.toLowerCase() ?? undefined;
  const phone = /^\+?[\d][\d\s\-()+]{5,}$/.test(s) ? digitsOnly(s).slice(-9) : undefined;
  const handle = (isSocialHandle(s) || s.startsWith("@")) && !email && !phone ? s.toLowerCase() : undefined;
  const name = !email && !phone && !handle ? s.toLowerCase() : undefined;
  return { email, phone, handle, name };
}

function threadKeyFor(x: { contactId?: string | null; senderName?: string | null; id: string }): string {
  if (x.contactId) return `c:${x.contactId}`;
  const t = senderTokens(x.senderName);
  if (t.email) return `e:${t.email}`;
  if (t.phone) return `w:${t.phone}`;
  if (t.handle) return `s:${t.handle}`;
  if (t.name) return `n:${t.name}`;
  return `raw:${x.id}`;
}

/** Ronde 24 — pesan ringkas dalam thread (tanpa field internal berat). */
function toThreadMessage(i: {
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

  // ===== Ronde 24 — kumpulkan thread percakapan per identitas =====
  // 1) Petakan contactId (milik lead maupun kandidat match) → threadKey.
  const contactIdToKey = new Map<string, string>();
  // 2) Indeks token identitas → threadKey (agar riwayat lintas kanal bisa dirangkai).
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

  // 3) Tarik riwayat interaksi terkait (dua arah, termasuk yang sudah tertaut).
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

  // 4) Kelompokkan riwayat ke thread masing-masing.
  const threadMessages = new Map<string, ReturnType<typeof toThreadMessage>[]>();
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
    arr.push(toThreadMessage(i));
    threadMessages.set(key, arr);
  }

  // 5) Tempelkan thread ke tiap lead (dedupe by id, urut waktu naik, maks 60 pesan).
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
    };
  });

  return ok({ leads: leadsWithThread, autoEscalated });
}
