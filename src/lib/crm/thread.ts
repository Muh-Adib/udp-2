/**
 * Ronde 25 — Thread percakapan per kontak + aturan kanal balasan.
 * Dipakai bersama oleh GET /api/inbox, POST /api/inbox/convert, POST /api/inbox/respond.
 *
 * Prinsip (permintaan user):
 * 1. Pesan dari berbagai sumber (email/WhatsApp/Instagram/website) milik identitas
 *    yang sama dirangkai jadi SATU percakapan berdasarkan kontak.
 * 2. Balasan hanya boleh dikirim via kanal yang benar-benar punya alamat tujuan
 *    (email → butuh alamat email, WhatsApp → nomor, Instagram → handle).
 * 3. Brand berasal dari sumber lead — tiap brand punya akun kanal sendiri
 *    (ChannelConfig.accountRef), jadi brand di-infer dari akun penerima pesan.
 */

import { extractEmailFromText, isSocialHandle } from "@/lib/crm/utils";
import type { InteractionAttachment } from "@/lib/crm/types";

/** Ronde 34-b — kolom attachments (JSON string) di Interaction → array terstruktur utk DTO. */
export function serializeInteractionAttachments(raw: string | null): InteractionAttachment[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? (arr as InteractionAttachment[]) : null;
  } catch {
    return null;
  }
}

export function digitsOnly(v: string): string {
  return v.replace(/\D+/g, "");
}

const PHONE_RE = /^\+?[\d][\d\s\-()+]{5,}$/;

export function looksLikePhone(v: string | null | undefined): boolean {
  return PHONE_RE.test((v ?? "").trim());
}

/** Ekstrak token identitas dari sebuah nama pengirim/recipient bebas. */
export function senderTokens(raw: string | null | undefined): {
  email?: string; phone?: string; handle?: string; name?: string;
} {
  const s = (raw ?? "").trim();
  if (!s) return {};
  const email = extractEmailFromText(s)?.toLowerCase() ?? undefined;
  const phone = PHONE_RE.test(s) ? digitsOnly(s).slice(-9) : undefined;
  const handle = (isSocialHandle(s) || s.startsWith("@")) && !email && !phone ? s.toLowerCase() : undefined;
  const name = !email && !phone && !handle ? s.toLowerCase() : undefined;
  return { email, phone, handle, name };
}

export function threadKeyFor(x: { contactId?: string | null; senderName?: string | null; id: string }): string {
  if (x.contactId) return `c:${x.contactId}`;
  const t = senderTokens(x.senderName);
  if (t.email) return `e:${t.email}`;
  if (t.phone) return `w:${t.phone}`;
  if (t.handle) return `s:${t.handle}`;
  if (t.name) return `n:${t.name}`;
  return `raw:${x.id}`;
}

// ===== Ronde 25 — kanal balasan (hanya kanal yang punya alamat tujuan) =====

export const REPLY_CHANNELS = ["whatsapp", "email", "instagram", "phone"] as const;
export type ReplyChannel = (typeof REPLY_CHANNELS)[number];

export interface ReplyIdentitySource {
  senderName?: string | null;
  contact?: {
    email?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
    instagram?: string | null;
    socialProfile?: string | null;
  } | null;
}

/** Alamat tujuan yang bisa dijangkau utk sebuah kanal balasan (null = tidak bisa dibalas via kanal ini). */
export function reachableAddress(channel: string, x: ReplyIdentitySource): string | null {
  const sender = (x.senderName ?? "").trim();
  const c = x.contact ?? null;
  switch (channel) {
    case "email": {
      const addr = c?.email ?? extractEmailFromText(sender);
      return addr ? addr : null;
    }
    case "whatsapp": {
      if (c?.whatsapp) return c.whatsapp;
      return looksLikePhone(sender) ? sender : null;
    }
    case "instagram": {
      if (c?.instagram) return c.instagram;
      if (c?.socialProfile && isSocialHandle(c.socialProfile)) return c.socialProfile;
      return isSocialHandle(sender) || sender.startsWith("@") ? sender : null;
    }
    case "phone": {
      if (c?.phone) return c.phone;
      if (c?.whatsapp) return c.whatsapp;
      return looksLikePhone(sender) ? sender : null;
    }
    default:
      return null;
  }
}

/** Daftar kanal balasan yang tersedia utk sebuah lead (urut: kanal asal lead dulu). */
export function computeReplyChannels(x: ReplyIdentitySource & { channel?: string | null }): ReplyChannel[] {
  const avail = REPLY_CHANNELS.filter((ch) => reachableAddress(ch, x) !== null);
  // Kanal asal lead diutamakan bila tersedia.
  const origin = x.channel && avail.includes(x.channel as ReplyChannel) ? x.channel as ReplyChannel : null;
  return origin ? [origin, ...avail.filter((c) => c !== origin)] : avail;
}

// ===== Ronde 25 — inferensi brand dari sumber lead =====

export interface ChannelAccountRef {
  channel: string;
  brandId: string | null;
  accountRef: string | null;
  status: string;
}

/**
 * Brand di-infer dari akun penerima pesan (recipientName = alamat akun bisnis,
 * mis. "hello@unimasi.co.id" → brand Unimasi yg memiliki akun tsb di ChannelConfig).
 */
export function inferBrandIdFromSource(
  lead: { channel?: string | null; recipientName?: string | null; senderName?: string | null; externalId?: string | null },
  configs: ChannelAccountRef[],
): string | null {
  const candidates = configs.filter((c) => c.brandId && c.status !== "disconnected");
  const haystacks = [lead.recipientName, lead.senderName, lead.externalId]
    .map((v) => (v ?? "").toLowerCase())
    .filter((v) => v.length > 0);
  if (haystacks.length === 0) return null;

  // 1) cocokkan akun pada kanal yang sama persis (paling spesifik)
  for (const c of candidates) {
    if (lead.channel && c.channel !== lead.channel) continue;
    const ref = (c.accountRef ?? "").toLowerCase().trim();
    if (ref.length >= 5 && haystacks.some((h) => h.includes(ref))) return c.brandId;
  }
  // 2) fallback: akun pada kanal apa pun
  for (const c of candidates) {
    const ref = (c.accountRef ?? "").toLowerCase().trim();
    if (ref.length >= 5 && haystacks.some((h) => h.includes(ref))) return c.brandId;
  }
  return null;
}

// ===== Ronde 25 — pencocokan identitas kontak (untuk unify thread saat konversi) =====

export interface ContactIdentityLike {
  email?: string | null;
  emailAlt?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  instagram?: string | null;
  socialProfile?: string | null;
  fullName?: string | null;
}

/** Kumpulan token identitas milik sebuah kontak (utk mencocokkan pesan lain dengannya). */
export function contactIdentityTokens(c: ContactIdentityLike): Set<string> {
  const t = new Set<string>();
  const add = (v: string | null | undefined, prefix: string) => {
    const s = (v ?? "").trim().toLowerCase();
    if (s) t.add(`${prefix}:${s}`);
  };
  add(c.email, "e");
  add(c.emailAlt, "e");
  if (c.whatsapp) t.add(`w:${digitsOnly(c.whatsapp).slice(-9)}`);
  if (c.phone) t.add(`w:${digitsOnly(c.phone).slice(-9)}`);
  if (c.instagram) t.add(`s:${c.instagram.trim().toLowerCase()}`);
  if (c.socialProfile && isSocialHandle(c.socialProfile)) t.add(`s:${c.socialProfile.trim().toLowerCase()}`);
  add(c.fullName, "n");
  return t;
}

/** ThreadKey sebuah pesan bila dipandang dari identitas kontak: cocok token → c:<contactId>. */
export function threadKeyForWithContact(
  x: { contactId?: string | null; senderName?: string | null; recipientName?: string | null; id: string },
  contactTokens: Set<string>,
  contactId: string,
): string {
  if (x.contactId === contactId) return `c:${contactId}`;
  const from = senderTokens(x.senderName);
  const to = senderTokens(x.recipientName);
  const t = { email: from.email ?? to.email, phone: from.phone ?? to.phone, handle: from.handle ?? to.handle, name: from.name ?? to.name };
  if (t.email && contactTokens.has(`e:${t.email}`)) return `c:${contactId}`;
  if (t.phone && contactTokens.has(`w:${t.phone}`)) return `c:${contactId}`;
  if (t.handle && contactTokens.has(`s:${t.handle}`)) return `c:${contactId}`;
  if (t.name && contactTokens.has(`n:${t.name}`)) return `c:${contactId}`;
  return threadKeyFor(x);
}
