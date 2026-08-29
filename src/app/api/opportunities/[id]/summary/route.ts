import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { stageLabel } from "@/lib/crm/constants";
import { formatCurrency, formatDate } from "@/lib/crm/utils";

/**
 * AI Summary: ringkasan percakapan + next-best-action untuk opportunity.
 * Menggunakan z-ai-web-dev-sdk di backend.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunity = await db.opportunity.findUnique({
    where: { id },
    include: {
      brand: true,
      contact: { include: { company: true } },
      company: true,
      interactions: { orderBy: { createdAt: "asc" }, take: 40 },
      notes: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!opportunity) return fail("Opportunity tidak ditemukan", 404);

  const conversation = opportunity.interactions
    .map((i) => `[${formatDate(i.createdAt)}] (${i.direction === "inbound" ? "MASUK" : "KELUAR"} via ${i.channel}) ${i.senderName ?? "-"}: ${i.content}`)
    .join("\n");

  const context = `Data opportunity:
- Judul: ${opportunity.title}
- Brand: ${opportunity.brand.name}
- Layanan: ${opportunity.serviceName ?? "-"} (${opportunity.serviceCategory ?? "-"})
- Stage saat ini: ${stageLabel(opportunity.stage)}
- Nilai estimasi: ${formatCurrency(opportunity.estimatedValue, opportunity.currency)}
- Contact: ${opportunity.contact.fullName} (${opportunity.contact.position ?? "-"})
- Perusahaan: ${opportunity.company?.name ?? "-"} (${opportunity.company?.industry ?? "-"}, ${opportunity.company?.city ?? "-"})
- Sumber lead: ${opportunity.leadSource ?? "-"}
- Prioritas: ${opportunity.priority}, Temperatur: ${opportunity.temperature}
- Notes internal: ${opportunity.notes.map((n) => n.body).join(" | ") || "-"}

Riwayat percakapan:
${conversation || "(belum ada percakapan)"}`;

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Kamu adalah asisten CRM untuk grup agensi kreatif Indonesia (brand Unimasi, Segia Tech, Erfo Multimedia, Unicam Studio). " +
            "Bantu tim marketing meringkas percakapan lead dan memberi rekomendasi tindakan. Jawab DALAM BAHASA INDONESIA. " +
            "Format jawaban dengan struktur:\nRINGKASAN: (2-4 kalimat kondisi terkini)\nSENTIMEN: (positif/netral/negatif + alasan singkat)\nNEXT-BEST-ACTION: (1 tindakan paling tepat + alasan)\nRISIKO: (risiko yang perlu diwaspadai atau '-' jika tidak ada)",
        },
        { role: "user", content: context },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const summary = completion.choices[0]?.message?.content ?? "";
    return ok({ summary });
  } catch (err) {
    console.error("AI summary error:", err);
    return fail("Gagal membuat ringkasan AI. Coba lagi nanti.", 500);
  }
}
