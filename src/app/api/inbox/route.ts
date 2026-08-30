import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, findMatchCandidates } from "@/lib/crm/server";
import { runSlaSweep } from "@/lib/crm/sla-sweep";
import { extractEmailFromText } from "@/lib/crm/utils";

/** Unified Lead Inbox: pesan inbound yang belum ditautkan ke opportunity. */
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

  return ok({ leads: enriched, autoEscalated });
}
