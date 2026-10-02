import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { stageLabel } from "@/lib/crm/constants";
import { formatCurrency, formatDate } from "@/lib/crm/utils";

/**
 * Ringkasan Otomatis: ringkasan kondisi opportunity + next-best-action.
 * 100% HEURISTIK LOKAL (rule-based Bahasa Indonesia) — TANPA API chat/AI
 * eksternal, TANPA panggilan jaringan apa pun. Data hanya dari database.
 * Format respons tidak berubah: { summary } berisi 4 blok berprefix
 * RINGKASAN / SENTIMEN / NEXT-BEST-ACTION / RISIKO (diparse opportunity-detail.tsx).
 *
 * Sesi ditangani gerbang proxy.ts (semua /api butuh sesi kecuali allowlist).
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
      tasks: { orderBy: { dueDate: "asc" } },
      invoices: { include: { payments: true } },
    },
  });
  if (!opportunity) return fail("Opportunity tidak ditemukan", 404);

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // ===== Data turunan =====
  const isClosed = opportunity.stage === "won" || opportunity.stage === "lost";
  const stageText = stageLabel(opportunity.stage);

  const lastInteraction = opportunity.interactions.length
    ? opportunity.interactions[opportunity.interactions.length - 1]
    : null;
  const daysSinceLastInteraction = lastInteraction
    ? Math.floor((now - lastInteraction.createdAt.getTime()) / DAY)
    : null;

  const openTasks = opportunity.tasks.filter((t) => t.status === "open");
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate.getTime() < now);
  const overdueClose =
    opportunity.expectedCloseDate && !isClosed
      ? Math.floor((now - opportunity.expectedCloseDate.getTime()) / DAY)
      : null;

  // Outstanding invoice (hanya invoice terbit — draft/cancelled tidak dihitung).
  const issuedInvoices = opportunity.invoices.filter(
    (inv) => inv.status !== "draft" && inv.status !== "cancelled"
  );
  const outstanding = issuedInvoices.reduce((sum, inv) => {
    const paid = inv.payments.reduce((p, pay) => p + pay.amount, 0);
    return sum + Math.max(0, inv.total - paid);
  }, 0);

  // ===== Blok RINGKASAN =====
  const ringkasanParts: string[] = [];
  ringkasanParts.push(
    `Opportunity "${opportunity.title}" (${opportunity.brand.name})` +
      (opportunity.company?.name ? ` dari ${opportunity.company.name}` : ` dari ${opportunity.contact.fullName}`) +
      (opportunity.serviceName
        ? ` untuk layanan ${opportunity.serviceName}`
        : opportunity.serviceCategory
          ? ` untuk layanan ${opportunity.serviceCategory}`
          : "") +
      `.`
  );
  if (opportunity.estimatedValue && opportunity.estimatedValue > 0) {
    ringkasanParts.push(
      `Nilai estimasi ${formatCurrency(opportunity.estimatedValue, opportunity.currency)} dengan probabilitas ${opportunity.probability}% (forecast tertimbang ${formatCurrency(Math.round((opportunity.estimatedValue * opportunity.probability) / 100), opportunity.currency)}).`
    );
  } else {
    ringkasanParts.push("Nilai estimasi belum diisi.");
  }
  if (opportunity.stage === "lost") {
    ringkasanParts.push(
      `Saat ini berstatus LOST (${stageText})${opportunity.lostReason ? ` — alasan: ${opportunity.lostReason}` : ""}.`
    );
  } else if (opportunity.stage === "won") {
    ringkasanParts.push("Deal telah WON — masuk tahap produksi & penagihan.");
  } else {
    ringkasanParts.push(`Posisi pipeline: ${stageText} (prioritas ${opportunity.priority}, temperatur ${opportunity.temperature}).`);
  }
  if (opportunity.interactions.length === 0) {
    ringkasanParts.push(
      `Belum ada percakapan tercatat pada opportunity ini (sumber lead: ${opportunity.leadSource ?? "tidak tercatat"}).`
    );
  } else if (lastInteraction && daysSinceLastInteraction !== null) {
    ringkasanParts.push(
      `Total ${opportunity.interactions.length} interaksi tercatat${opportunity.interactions.length >= 40 ? "+" : ""}; interaksi terakhir ${daysSinceLastInteraction === 0 ? "hari ini" : `${daysSinceLastInteraction} hari lalu`} (${formatDate(lastInteraction.createdAt)} via ${lastInteraction.channel}).`
    );
  }
  if (openTasks.length > 0) {
    ringkasanParts.push(
      `Ada ${openTasks.length} task terbuka${overdueTasks.length > 0 ? `, ${overdueTasks.length} di antaranya sudah lewat jatuh tempo` : ""}.`
    );
  } else if (!isClosed) {
    ringkasanParts.push("Belum ada task tindak lanjut terbuka.");
  }
  if (outstanding > 0) {
    ringkasanParts.push(`Terdapat tagihan outstanding sebesar ${formatCurrency(Math.round(outstanding), opportunity.currency)}.`);
  }

  // ===== Blok SENTIMEN =====
  let sentimen: string;
  if (opportunity.stage === "lost") {
    sentimen = `Negatif — deal ditutup kalah${opportunity.lostReason ? ` (${opportunity.lostReason})` : ""}. Catat pembelajaran untuk re-offer di kemudian hari.`;
  } else if (opportunity.stage === "won") {
    sentimen = "Positif — deal dimenangkan; fokus beralih ke eksekusi project dan kepuasan klien.";
  } else if (
    opportunity.temperature === "hot" ||
    opportunity.stage === "negotiation" ||
    opportunity.stage === "verbal_agreement"
  ) {
    sentimen = `Positif — temperatur ${opportunity.temperature} dan deal sudah di tahap ${stageText}; sinyal niat beli cukup kuat.`;
  } else if (
    lastInteraction &&
    lastInteraction.direction === "inbound" &&
    (daysSinceLastInteraction ?? 999) <= 7
  ) {
    sentimen = `Positif — lead masih aktif (pesan terakhir MASUK ${daysSinceLastInteraction === 0 ? "hari ini" : `${daysSinceLastInteraction} hari lalu`}); respons cepat akan menjaga momentum.`;
  } else if (
    lastInteraction &&
    lastInteraction.direction === "outbound" &&
    opportunity.interactions.filter((i) => i.direction === "inbound").length > 0 &&
    (daysSinceLastInteraction ?? 999) > 3
  ) {
    sentimen = `Menunggu — pesan terakhir dari kita belum dibalas (${daysSinceLastInteraction} hari); beri tenggat lembut sebelum menindaklanjuti ulang.`;
  } else if (!lastInteraction) {
    sentimen = "Netral — belum ada percakapan; sentimen belum bisa dinilai, mulai kontak pertama.";
  } else {
    sentimen = `Netral — komunikasi berjalan namun tidak ada sinyal kuat; temperatur ${opportunity.temperature} perlu dijaga dengan follow-up terjadwal.`;
  }

  // ===== Blok NEXT-BEST-ACTION (1-3 langkah rule-based) =====
  const actions: string[] = [];
  if (!isClosed && !lastInteraction) {
    actions.push(
      `Hubungi ${opportunity.contact.fullName} untuk kontak pertama — belum ada percakapan tercatat (sumber lead: ${opportunity.leadSource ?? "tidak tercatat"}); gunakan kanal ${opportunity.leadSource ?? "whatsapp"}.`
    );
  } else if (!isClosed && lastInteraction && (daysSinceLastInteraction ?? 0) > 7) {
    actions.push(
      `Hubungi ulang ${opportunity.contact.fullName} — interaksi terakhir ${daysSinceLastInteraction} hari lalu via ${lastInteraction.channel}; kirim pesan follow-up singkat hari ini juga.`
    );
  }
  if (overdueTasks.length > 0) {
    const first = overdueTasks[0];
    actions.push(
      `Selesaikan task terlambat "${first.title}"${first.dueDate ? ` (jatuh tempo ${formatDate(first.dueDate)})` : ""} sebelum mengejar aktivitas baru.`
    );
  }
  if (!isClosed && (opportunity.stage === "proposal_sent" || opportunity.stage === "negotiation") && openTasks.length === 0) {
    actions.push(
      `Siapkan penawaran final / konfirmasi kesediaan anggaran — deal sudah di ${stageText} tetapi belum ada task tindak lanjut.`
    );
  }
  if (overdueClose !== null && overdueClose > 0 && opportunity.expectedCloseDate) {
    actions.push(
      `Konfirmasi ulang timeline keputusan klien — expected close ${formatDate(opportunity.expectedCloseDate)} sudah lewat ${overdueClose} hari; perbarui tanggal atau pindahkan stage.`
    );
  }
  if (opportunity.stage === "won") {
    actions.push("Pastikan kick-off project berjalan dan penagihan DP terkirim sesuai termin.");
  }
  if (opportunity.stage === "lost" && outstanding === 0) {
    actions.push(
      `Masukkan ke jadwal nurture/re-offer — deal dapat dibuka kembali saat timing atau anggaran klien membaik${opportunity.nurtureSegment ? ` (segmen saat ini: ${opportunity.nurtureSegment})` : ""}.`
    );
  }
  if (opportunity.stage === "lost" && outstanding > 0) {
    actions.push(`Tindak lanjuti tagihan outstanding ${formatCurrency(Math.round(outstanding), opportunity.currency)} — deal lost tidak menghapus kewajiban bayar.`);
  }
  if (actions.length === 0 && !isClosed) {
    actions.push(
      `Lanjutkan proses di tahap ${stageText}: jadwalkan aktivitas berikutnya dan catat hasilnya di timeline agar riwayat selalu mutakhir.`
    );
  }
  const actionText = actions.slice(0, 3).map((a, i) => `${i + 1}) ${a}`).join("\n");

  // ===== Blok RISIKO =====
  const risiko: string[] = [];
  if (!isClosed && daysSinceLastInteraction !== null && daysSinceLastInteraction > 14) {
    risiko.push(`Lead idle ${daysSinceLastInteraction} hari tanpa percakapan — berisiko dingin dan diambil kompetitor.`);
  }
  if (overdueClose !== null && overdueClose > 0 && opportunity.expectedCloseDate) {
    risiko.push(`Expected close ${formatDate(opportunity.expectedCloseDate)} terlewat ${overdueClose} hari — forecast pipeline bisa terdistorsi.`);
  }
  if (overdueTasks.length > 0) {
    risiko.push(`${overdueTasks.length} task tindak lanjut melewati jatuh tempo — service level ke lead menurun.`);
  }
  if (!isClosed && openTasks.length === 0 && opportunity.stage !== "new") {
    risiko.push("Tidak ada task tindak lanjut aktif — deal berisiko terlantar tanpa pemilik langkah berikutnya.");
  }
  if (issuedInvoices.some((inv) => inv.status === "overdue")) {
    risiko.push("Ada invoice berstatus overdue — arus kas dan relasi klien perlu dijaga.");
  }
  if (
    !isClosed &&
    opportunity.estimatedValue &&
    opportunity.probability >= 70 &&
    opportunity.stage !== "negotiation" &&
    opportunity.stage !== "verbal_agreement"
  ) {
    risiko.push("Probabilitas tinggi namun stage belum masuk negosiasi — nilai forecast berisiko terlalu optimistis.");
  }
  const risikoText = risiko.length > 0 ? risiko.map((r) => `- ${r}`).join("\n") : "-";

  const summary = [
    `RINGKASAN: ${ringkasanParts.join(" ")}`,
    `SENTIMEN: ${sentimen}`,
    `NEXT-BEST-ACTION:\n${actionText}`,
    `RISIKO:\n${risikoText}`,
  ].join("\n");

  return ok({ summary });
}
