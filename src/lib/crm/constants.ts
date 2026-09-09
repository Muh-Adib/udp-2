// ============ Pipeline stages (standar perusahaan) ============
// Ronde 40-C — `params` = parameter acuan: data/sinyal apa yang menjadi syarat
// stage tsb (dipakai popover info di kanban pipeline).

export const PIPELINE_STAGES = [
  { key: "new", label: "New", meaning: "Lead baru masuk", required: "Assign marketing dan SLA", params: "Lead masuk + owner terisi otomatis dari sesi; SLA follow-up ≤ SLA jam brand", color: "#78716c" },
  { key: "contact_attempted", label: "Contact Attempted", meaning: "Sudah dicoba dihubungi", required: "Catat kanal dan hasil", params: "Ada interaksi outbound pertama (interaction tercatat)", color: "#a8a29e" },
  { key: "connected", label: "Connected", meaning: "Sudah mendapat respons", required: "Verifikasi kebutuhan", params: "Kontak membalas / percakapan dua arah di Inbox", color: "#d97706" },
  { key: "qualified", label: "Qualified", meaning: "Layak diproses", required: "Budget, authority, need, timeline", params: "Kebutuhan jelas + brand & kontak valid + estimasi nilai awal", color: "#ea580c" },
  { key: "discovery", label: "Discovery", meaning: "Penggalian brief", required: "Meeting dan brief", params: "Brief klien dibuat & kebutuhan detail terkumpul", color: "#f59e0b" },
  { key: "estimation", label: "Estimation", meaning: "Penyusunan scope dan biaya", required: "Kolaborasi finance/produksi", params: "Estimasi cost breakdown diajukan (status pending_approval)", requiredKey: "finance", color: "#0d9488" },
  { key: "proposal_sent", label: "Proposal Sent", meaning: "Proposal dikirim", required: "Versi dan masa berlaku", params: "Quotation berstatus sent (sentAt terisi)", color: "#8b5cf6" },
  { key: "negotiation", label: "Negotiation", meaning: "Negosiasi berjalan", required: "Revisi scope/harga", params: "Estimasi disetujui Direktur / negosiasi harga & diskusi potongan", color: "#a855f7" },
  { key: "verbal_agreement", label: "Verbal Agreement", meaning: "Persetujuan awal", required: "Kontrak/PO/DP", params: "Quotation diterima klien (status accepted)", color: "#16a34a" },
  { key: "won", label: "Won", meaning: "Deal berhasil", required: "Buat project", params: "Kontrak & invoice DP otomatis dibuat; project otomatis ter-generate", color: "#15803d" },
  { key: "lost", label: "Lost", meaning: "Tidak berhasil", required: "Alasan wajib", params: "Alasan kalah wajib dipilih (LOST_REASONS)", color: "#dc2626" },
  { key: "nurture", label: "Nurture", meaning: "Belum siap membeli", required: "Jadwal penawaran ulang", params: "Segmen nurture dipilih (NURTURE_SEGMENTS) + tanggal follow-up", color: "#64748b" },
] as const;

export type StageKey = (typeof PIPELINE_STAGES)[number]["key"];

export const OPEN_STAGES: StageKey[] = [
  "new", "contact_attempted", "connected", "qualified", "discovery",
  "estimation", "proposal_sent", "negotiation", "verbal_agreement",
];

export function stageLabel(key: string): string {
  return PIPELINE_STAGES.find((s) => s.key === key)?.label ?? key;
}

export function stageColor(key: string): string {
  return PIPELINE_STAGES.find((s) => s.key === key)?.color ?? "#78716c";
}

// ============ Lost reasons ============

export const LOST_REASONS = [
  "Harga terlalu tinggi",
  "Tidak ada budget",
  "Memilih kompetitor",
  "Timeline tidak sesuai",
  "Kebutuhan berubah",
  "Tidak mendapat respons",
  "Scope tidak cocok",
  "Ditunda internal klien",
  "Kontak tidak valid",
  "Duplikat",
  "Tidak sesuai target pasar",
  "Alasan lainnya",
] as const;

export const NURTURE_SEGMENTS = [
  { key: "reoffer_30", label: "Re-offer 30 hari" },
  { key: "reoffer_90", label: "Re-offer 90 hari" },
  { key: "budget_season", label: "Re-offer periode anggaran" },
  { key: "cross_sell", label: "Cross-sell brand lain" },
  { key: "smaller_package", label: "Paket lebih kecil" },
  { key: "alternative_service", label: "Layanan alternatif" },
] as const;

// ============ Channels ============

export const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp", icon: "MessageCircle" },
  { key: "email", label: "Email", icon: "Mail" },
  { key: "instagram", label: "Instagram", icon: "Instagram" },
  { key: "website", label: "Website", icon: "Globe" },
  { key: "phone", label: "Telepon", icon: "Phone" },
  { key: "meeting", label: "Meeting", icon: "Video" },
  { key: "portal", label: "Client Portal", icon: "LayoutDashboard" },
] as const;

export const LEAD_SOURCES = [
  "instagram", "whatsapp", "email", "website", "referral", "event", "cold_outreach", "linkedin",
] as const;

// ============ Roles ============

export const ROLES = [
  { key: "super_admin", label: "Super Admin", description: "Brand, user, role, permission, pipeline, template, integrasi, master data, audit log" },
  { key: "director", label: "Direktur", description: "Semua dashboard, revenue forecast, pipeline, workload, approval" },
  { key: "manager", label: "Manajer", description: "Pantauan tim & SLA, pipeline, proyek produksi, laporan — tanpa keuangan" },
  { key: "hr", label: "HR", description: "Data pengguna & beban kerja tim, tugas internal" },
  { key: "marketing", label: "Marketing", description: "Lead inbox, contact, opportunity, komunikasi, follow-up, proposal" },
  { key: "finance", label: "Keuangan", description: "Estimasi, budget, quotation, pajak, invoice, pembayaran, profitability" },
  { key: "production", label: "Produksi", description: "Brief, scope, resource planning, timeline, milestone, task, deliverable" },
  { key: "client", label: "Client", description: "Project, milestone, file, approval, invoice miliknya sendiri" },
] as const;

export type RoleKey = (typeof ROLES)[number]["key"];

// ============ Brand service catalogs ============

export const BRAND_SERVICES: Record<string, string[]> = {
  unimasi: ["Animasi Company Profile", "Animasi Pembelajaran", "Video Infografis", "Animasi Program/Produk", "Video Sosialisasi", "Video Marketing"],
  segia_tech: ["Website Company Profile", "Website E-Commerce", "SEO Optimization", "UI/UX Design", "Produksi Konten Digital", "Web Application"],
  erfo_multimedia: ["Dokumentasi Foto/Video", "Shooting Iklan", "Live Streaming", "Drone Videography", "Video AI", "Video 360"],
  unicam_studio: ["Corporate Video", "Animasi 2D/3D", "AI Video Production", "AR/VR Experience", "Virtual Tour", "Projection Mapping", "Immersive Experience"],
};

export const SERVICE_CATEGORIES = [
  "animation", "website", "video", "immersive", "digital_marketing",
] as const;

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export const TEMPERATURES = [
  { key: "hot", label: "Hot", color: "#dc2626" },
  { key: "warm", label: "Warm", color: "#f59e0b" },
  { key: "cold", label: "Cold", color: "#0891b2" },
] as const;

export const PROJECT_WORKFLOWS: Record<string, string[]> = {
  website: ["Discovery", "Sitemap & Wireframe", "UI/UX Design", "Development", "QA & Testing", "Launch"],
  video: ["Pre-Production", "Shooting", "Editing", "Revision", "Final Delivery"],
  animation: ["Script", "Storyboard", "Asset Production", "Animation", "Sound Design", "Revision", "Final Render"],
  immersive: ["Survey Lokasi", "Technical Plan", "Production", "Setup & Install", "Event / Go-Live", "Archive"],
};

/** Ronde 35 — capaian default per milestone template (apa yang dicapai/diserahkan
 * saat milestone selesai). Dipakai saat project dibuat otomatis dari deal Won,
 * sehingga timeline produksi langsung menjelaskan deliverable tiap tahap. */
export const PROJECT_WORKFLOW_ACHIEVEMENTS: Record<string, string> = {
  // website
  "Discovery": "Brief final, riset kompetitor & sitemap disetujui klien",
  "Sitemap & Wireframe": "Wireframe seluruh halaman disetujui — konten & struktur final",
  "UI/UX Design": "Desain visual (hi-fi) disetujui — siap dipindah ke development",
  "Development": "Build selesai di staging — semua fitur berfungsi sesuai scope",
  "QA & Testing": "Uji lintas browser/perangkat lulus — bug kritis nihil",
  "Launch": "Website live di domain produksi + serah terima akses & dokumentasi",
  // video
  "Pre-Production": "Naskah, storyboard & jadwal produksi disetujui klien",
  "Shooting": "Seluruh footage terkumpul sesuai shotlist — backup aman",
  "Editing": "Draft edit (rough cut) dikirim untuk ditinjau klien",
  "Revision": "Revisi selesai sesuai catatan review — versi final siap",
  // animation
  "Script": "Naskah final disetujui — voice over bisa direkam",
  "Storyboard": "Storyboard lengkap disetujui — produksi aset dimulai",
  "Asset Production": "Seluruh aset (karakter, background, properti) selesai",
  "Animation": "Animasi penuh (full anim) dikirim untuk review",
  "Sound Design": "Musik, SFX & mixing selesai — audio final",
  "Final Render": "Master render final (resolusi & format lengkap) diserahkan",
  // immersive
  "Survey Lokasi": "Data survei lokasi & kebutuhan teknis terdokumentasi",
  "Technical Plan": "Rencana teknis & 3D mockup setup disetujui klien",
  "Production": "Konten immersive (render/video interaktif) selesai diproduksi",
  "Setup & Install": "Instalasi perangkat & konten di lokasi teruji",
  "Event / Go-Live": "Event/go-live berjalan — sistem beroperasi penuh",
  "Archive": "Dokumentasi, backup konten & serah terima aset selesai",
};

/** Ronde 35 — capaian bawaan untuk nama milestone yang tidak ada di template
 * (mis. milestone manual buatan user): tetap dapat deskripsi bermakna. */
export function achievementFor(milestoneName: string): string {
  return (
    PROJECT_WORKFLOW_ACHIEVEMENTS[milestoneName] ??
    `Hasil kerja "${milestoneName}" selesai & disetujui — siap dikirim ke tahap berikutnya`
  );
}

export function workflowFor(category?: string | null): string[] {
  if (!category) return PROJECT_WORKFLOWS.video;
  const c = category.toLowerCase();
  if (c.includes("website") || c.includes("digital")) return PROJECT_WORKFLOWS.website;
  if (c.includes("anim")) return PROJECT_WORKFLOWS.animation;
  if (c.includes("immersive") || c.includes("tour") || c.includes("projection") || c.includes("ar") || c.includes("vr")) return PROJECT_WORKFLOWS.immersive;
  return PROJECT_WORKFLOWS.video;
}

// ============ Ronde 42 — Tipe task BERSAMA (Follow-up Center + form tugas) ============
// Tipe disesuaikan permintaan user: "internal" diganti tipe yang bermakna untuk
// alur agensi (produksi/revisi), "admin" diperjelas labelnya jadi "Administrasi".
// Setiap tipe punya hint singkat — ditampilkan sebagai tooltip & deskripsi opsi.
export const TASK_TYPES: { key: string; label: string; hint: string }[] = [
  { key: "follow_up", label: "Follow-up", hint: "Tindak lanjut ke lead/klien — chat, telepon, atau kirim penawaran." },
  { key: "meeting", label: "Meeting", hint: "Rapat/presentasi dengan jam mulai — dapat reminder otomatis 1 jam sebelumnya." },
  { key: "production", label: "Produksi", hint: "Pekerjaan produksi: shooting, editing, render, dsb." },
  { key: "revision", label: "Revisi", hint: "Menangani permintaan revisi dari klien atau internal." },
  { key: "admin", label: "Administrasi", hint: "Urusan dokumen: kontrak, PO, invoice, arsip, dan pelaporan." },
];

/** Label tipe task utk tampilan (fallback ke nilai mentah bila tak dikenal — data lama). */
export function taskTypeLabel(type?: string | null): string {
  return TASK_TYPES.find((t) => t.key === type)?.label ?? type ?? "Task";
}
