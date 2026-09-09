import { db } from "@/lib/db";
import { hashSecret } from "@/lib/crm/auth";

/** Ronde 46-b — kredensial tim UDP: login PASSWORD + PIN kunci layar (semuanya scrypt). */
const DEMO_PASSWORD = "udp1234";
const DEMO_PIN = "1234";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
function ago(days: number) { return new Date(Date.now() - days * DAY); }
function ahead(days: number) { return new Date(Date.now() + days * DAY); }

/**
 * Ronde 36 (audit): kunci in-process agar dua pemanggilan seed bersamaan
 * (mis. dua tab pertama dibuka bersamaan) TIDAK saling menghapus datanya —
 * pemanggil kedua menunggu hasil pemanggil pertama lalu melihat "data already exists".
 */
let seedInFlight: Promise<{ seeded: boolean; reason?: string }> | null = null;

export async function seedDatabase(force = false) {
  if (seedInFlight) return seedInFlight;
  seedInFlight = runSeed(force).finally(() => {
    seedInFlight = null;
  });
  return seedInFlight;
}

async function runSeed(force = false): Promise<{ seeded: boolean; reason?: string; counts?: Record<string, number> }> {
  const existing = await db.brand.count();
  if (existing > 0 && !force) return { seeded: false, reason: "data already exists" };

  // Clean (order matters) — tabel tanpa cascade FK harus dihapus sebelum opportunity/brand.
  await db.changeRequest.deleteMany();
  await db.approvalRequest.deleteMany();
  await db.notificationState.deleteMany();
  await db.estimation.deleteMany();
  await db.quotation.deleteMany();
  await db.auditLog.deleteMany();
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.milestone.deleteMany();
  await db.projectDeliverable.deleteMany();
  await db.project.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.interaction.deleteMany();
  await db.clientDocument.deleteMany();
  await db.clientPortalToken.deleteMany();
  await db.userPreference.deleteMany();
  await db.channelConfig.deleteMany();
  await db.clientBrief.deleteMany();
  await db.workflowStage.deleteMany();
  await db.service.deleteMany();
  await db.serviceCategory.deleteMany();
  await db.opportunity.deleteMany();
  await db.contact.deleteMany();
  await db.company.deleteMany();
  await db.followUpTemplate.deleteMany();
  await db.user.deleteMany();
  await db.brand.deleteMany();

  // ============ BRANDS — data asli dari situs resmi masing-masing ============
  // Logo asli diunduh dari situs resmi (tanpa generate) → public/brands/.
  const [unimasi, segia, erfo, unicam] = await Promise.all([
    db.brand.create({ data: {
      name: "Unimasi", slug: "unimasi", color: "#eab308",
      description: "Penyedia jasa video animasi profesional: company profile, pembelajaran, marketing, dan infografis.",
      website: "https://www.unimasi.com",
      logoUrl: "/brands/logo-unimasi.png",
      tagline: "Jagonya Buat Animasi",
      address: "Jl. Raya Tajem, Denokan, Maguwoharjo, Kec. Depok, Kab. Sleman, Daerah Istimewa Yogyakarta 55281",
      city: "Sleman, DIY",
      phone: "+6281215082608",
      whatsappNumber: "+6281215082608",
      instagramHandle: "@unimasi_",
      threadsHandle: "@unimasi_",
      email: "info@unimasi.com",
      invoicePrefix: "UMS", slaHours: 4,
    } }),
    db.brand.create({ data: {
      name: "Segia Tech", slug: "segia_tech", color: "#059669",
      description: "Jasa pembuatan website dengan desain responsif, SEO teroptimasi, dan solusi UI/UX yang intuitif.",
      website: "https://www.segiatech.com",
      logoUrl: "/brands/logo-segia.png",
      tagline: "Jasa Pembuatan Website & AI Apps",
      city: "Jakarta",
      phone: "+6281225929178",
      whatsappNumber: "+6281225929178",
      instagramHandle: "@segiatech",
      threadsHandle: "@segiatech",
      email: "marketing@udp.co.id",
      invoicePrefix: "SGT", slaHours: 2,
    } }),
    db.brand.create({ data: {
      name: "Erfo Multimedia", slug: "erfo_multimedia", color: "#e11d48",
      description: "Jasa video profesional: dokumentasi, live streaming, video shooting, serta video 360 di Yogyakarta dan sekitarnya.",
      website: "https://www.erfomultimedia.com",
      logoUrl: "/brands/logo-erfo.png",
      tagline: "Jasa Video Dokumentasi, Streaming & 360",
      city: "Yogyakarta",
      phone: "+6281215082607",
      whatsappNumber: "+6281215082607",
      instagramHandle: "@erfomultimedia",
      threadsHandle: "@erfomultimedia",
      email: "info@erfomultimedia.com",
      invoicePrefix: "EFM", slaHours: 6,
    } }),
    db.brand.create({ data: {
      name: "Unicam Studio", slug: "unicam_studio", color: "#be123c",
      description: "Production house: corporate video, 3D animation, AI video, virtual tour & immersive experience.",
      website: "https://www.unicamstudio.com",
      logoUrl: "/brands/logo-unicam.png",
      tagline: "Creative Visual & Technology",
      city: "Yogyakarta · Jakarta",
      phone: "+6281336359525",
      whatsappNumber: "+6281336359525",
      instagramHandle: "@unicam.studio",
      threadsHandle: "@unicam.studio",
      email: "marketing@udp.co.id",
      invoicePrefix: "UCS", slaHours: 8,
    } }),
  ]);

  // ============ KATALOG LAYANAN & WORKFLOW PER BRAND (Ronde 29-b) ============
  // Tiap brand punya kategori & layanan core berbeda + workflow produksi custom.
  const seedCatalog = async (
    brandId: string,
    categories: Array<{ name: string; description?: string; services: Array<{
      name: string; unit?: string; basePrice?: number; targetMarginPct?: number;
      workflow?: Array<{ phase: string; name: string; isMilestone?: boolean }>;
      cost?: Array<{ name: string; amount: number; note?: string }>;
    }> }>
  ) => {
    for (const [ci, cat] of categories.entries()) {
      const created = await db.serviceCategory.create({
        data: { brandId, name: cat.name, description: cat.description ?? null, order: ci },
      });
      for (const [si, svc] of cat.services.entries()) {
        const createdSvc = await db.service.create({
          data: {
            brandId, categoryId: created.id, name: svc.name,
            unit: svc.unit ?? null, basePrice: svc.basePrice ?? null, order: si,
            costItems: svc.cost?.length ? JSON.stringify(svc.cost) : null,
            targetMarginPct: svc.targetMarginPct ?? 30,
          },
        });
        if (svc.workflow?.length) {
          await db.workflowStage.createMany({
            data: svc.workflow.map((w, wi) => ({
              serviceId: createdSvc.id, phase: w.phase, name: w.name,
              isMilestone: w.isMilestone === true, order: wi,
            })),
          });
        }
      }
    }
  };

  // Unimasi — contoh workflow user: Pra Production(Creative Concept & Story Board) → Production(milestone) → Post Production(milestone)
  await seedCatalog(unimasi.id, [
    {
      name: "Animasi 3D", description: "Animasi 3D untuk pembelajaran, produk, dan promosi.",
      services: [
        { name: "Pembuatan Video Pembelajaran Anak Anak 3D", unit: "episode", basePrice: 35000000, cost: [ { name: "Creative Concept & Storyboard", amount: 4500000, note: "2 putaran revisi" }, { name: "Modeling 3D & Rigging", amount: 8500000 }, { name: "Animasi & Rendering", amount: 11000000 }, { name: "Sound Design & Musik", amount: 2500000 }, { name: "Manajemen Proyek", amount: 1500000 } ], workflow: [
          { phase: "Pra Production", name: "Creative Concept & Story Board" },
          { phase: "Production", name: "Modeling, Rigging & Animasi 3D", isMilestone: true },
          { phase: "Post Production", name: "Rendering, Compositing & Final Delivery", isMilestone: true },
        ] },
        { name: "Animasi 3D Company Profile", unit: "video", basePrice: 45000000, cost: [ { name: "Konsep & Naskah", amount: 5000000 }, { name: "Modeling & Material", amount: 12000000 }, { name: "Animasi 3D", amount: 13000000 }, { name: "Rendering & Compositing", amount: 6500000 }, { name: "Manajemen Proyek", amount: 2000000 } ], workflow: [
          { phase: "Pra Production", name: "Konsep & Naskah" },
          { phase: "Production", name: "Produksi Animasi 3D", isMilestone: true },
          { phase: "Post Production", name: "Editing & Final Render", isMilestone: true },
        ] },
      ],
    },
    {
      name: "Ilustrasi 3D",
      services: [
        { name: "Ilustrasi 3D Produk", unit: "asset", basePrice: 12000000, cost: [ { name: "Referensi & Sketch", amount: 1500000 }, { name: "Modeling & Material", amount: 4500000 }, { name: "Lighting & Render Final", amount: 2500000 } ], workflow: [
          { phase: "Pra Production", name: "Referensi & Sketch" },
          { phase: "Production", name: "Modeling & Material", isMilestone: true },
          { phase: "Post Production", name: "Lighting & Render Final", isMilestone: true },
        ] },
      ],
    },
    {
      name: "Animasi 2D",
      services: [
        { name: "Animasi Video Sosialisasi", unit: "video", basePrice: 25000000, cost: [ { name: "Naskah & Storyboard", amount: 3000000 }, { name: "Produksi Animasi 2D", amount: 10500000 }, { name: "Sound Design & Delivery", amount: 3000000 } ], workflow: [
          { phase: "Pra Production", name: "Naskah & Storyboard" },
          { phase: "Production", name: "Produksi Animasi 2D", isMilestone: true },
          { phase: "Post Production", name: "Sound Design & Delivery", isMilestone: true },
        ] },
        { name: "Animasi Video Infografis", unit: "video", basePrice: 20000000, cost: [ { name: "Naskah & Storyboard", amount: 2500000 }, { name: "Animasi Infografis", amount: 8500000 }, { name: "Sound Design", amount: 2000000 } ] },
        { name: "Animasi Video Marketing/Iklan", unit: "video", basePrice: 30000000, cost: [ { name: "Konsep Kreatif & Naskah", amount: 4000000 }, { name: "Produksi Animasi", amount: 13000000 }, { name: "Sound & Final Delivery", amount: 3500000 } ] },
      ],
    },
  ]);

  await seedCatalog(segia.id, [
    {
      name: "Website", description: "Pembuatan website responsif & SEO teroptimasi.",
      services: [
        { name: "Website Company Profile", unit: "proyek", basePrice: 8500000, cost: [ { name: "UI/UX Design", amount: 2000000 }, { name: "Development Frontend & CMS", amount: 3000000 }, { name: "Hosting & Domain (tahun 1)", amount: 800000 }, { name: "QA & SEO Setup", amount: 700000 } ], workflow: [
          { phase: "Discovery", name: "Analisis Kebutuhan & Sitemap" },
          { phase: "Design", name: "UI/UX Design", isMilestone: true },
          { phase: "Development", name: "Development & QA", isMilestone: true },
          { phase: "Launch", name: "Deploy & SEO Setup", isMilestone: true },
        ] },
        { name: "Web Application", unit: "proyek", basePrice: 35000000, cost: [ { name: "Analisis & Arsitektur Sistem", amount: 4500000 }, { name: "Development Backend & Frontend", amount: 16000000 }, { name: "Testing & QA", amount: 2500000 }, { name: "Deployment & Dokumentasi", amount: 2000000 } ] },
        { name: "Website E-Commerce", unit: "proyek", basePrice: 28000000, cost: [ { name: "UI/UX + Katalog Produk", amount: 4500000 }, { name: "Development Payment Gateway", amount: 13000000 }, { name: "QA & Launch", amount: 2000000 } ] },
      ],
    },
    {
      name: "AI Apps", description: "Pengembangan aplikasi berbasis AI.",
      services: [
        { name: "AI Apps Production", unit: "proyek", basePrice: 60000000, cost: [ { name: "Use Case & Data Audit", amount: 6000000 }, { name: "Prototipe AI & Prompt Engineering", amount: 22000000 }, { name: "Integrasi & Testing", amount: 9000000 }, { name: "Infrastruktur & Monitoring", amount: 3500000 } ], workflow: [
          { phase: "Discovery", name: "Use Case & Data Audit" },
          { phase: "Build", name: "Prototipe AI", isMilestone: true },
          { phase: "Build", name: "Integrasi & Testing", isMilestone: true },
          { phase: "Launch", name: "Go Live & Monitoring", isMilestone: true },
        ] },
      ],
    },
    {
      name: "Digital Marketing",
      services: [
        { name: "SEO Optimization", unit: "bulan", basePrice: 5000000, targetMarginPct: 55, cost: [ { name: "Audit & Riset Keyword", amount: 750000 }, { name: "Optimasi On-Page", amount: 1250000 }, { name: "Konten & Backlink", amount: 1000000 } ] },
      ],
    },
  ]);

  await seedCatalog(erfo.id, [
    {
      name: "Dokumentasi", description: "Foto & video dokumentasi profesional.",
      services: [
        { name: "Dokumentasi Foto/Video", unit: "hari", basePrice: 15000000, cost: [ { name: "Kru & Kamera (per hari)", amount: 6000000 }, { name: "Transport & Konsumsi Kru", amount: 1500000 }, { name: "Editing & Color Grading", amount: 2500000 }, { name: "Perangkat (drone/stabilizer)", amount: 1500000 } ], workflow: [
          { phase: "Pra Produksi", name: "Rundown & Scaling Ekspisi" },
          { phase: "Produksi", name: "Shooting di Lokasi", isMilestone: true },
          { phase: "Pasca Produksi", name: "Editing & Color Grading", isMilestone: true },
        ] },
        { name: "Shooting Iklan", unit: "proyek", basePrice: 80000000, cost: [ { name: "Talent & Kru Profesional", amount: 22000000 }, { name: "Set & Properti", amount: 12000000 }, { name: "Perangkat Kamera & Lighting", amount: 10000000 }, { name: "Pasca Produksi (edit, grading, VFX)", amount: 14000000 } ] },
      ],
    },
    {
      name: "Live Streaming",
      services: [
        { name: "Live Streaming Event", unit: "hari", basePrice: 25000000, cost: [ { name: "Multi-Kamera & Operator", amount: 7000000 }, { name: "Encoder & Internet Dedicated", amount: 3500000 }, { name: "Kru Switcher & Audio", amount: 4000000 } ], workflow: [
          { phase: "Pra Produksi", name: "Survey Lokasi & Setup Plan" },
          { phase: "Produksi", name: "Live Run Multi-Kamera", isMilestone: true },
          { phase: "Pasca Produksi", name: "Highlight & Arsip", isMilestone: true },
        ] },
      ],
    },
    {
      name: "Video 360",
      services: [
        { name: "Video 360 / Virtual Tour 360", unit: "lokasi", basePrice: 18000000, cost: [ { name: "Capture Kamera 360", amount: 4500000 }, { name: "Stitching & Retouch Panorama", amount: 3500000 }, { name: "Publikasi Hosting Tour", amount: 1200000 } ], workflow: [
          { phase: "Pra Produksi", name: "Mapping Titik Panorama" },
          { phase: "Produksi", name: "Capture 360", isMilestone: true },
          { phase: "Pasca Produksi", name: "Stitching & Publikasi Tour", isMilestone: true },
        ] },
      ],
    },
  ]);

  await seedCatalog(unicam.id, [
    {
      name: "Video Production",
      services: [
        { name: "Corporate Video", unit: "video", basePrice: 65000000, cost: [ { name: "Concept & Script", amount: 7000000 }, { name: "Shooting (kru, kamera, talent)", amount: 22000000 }, { name: "Editing & Motion Graphics", amount: 11000000 }, { name: "Voice Over & Musik Lisensi", amount: 4500000 } ], workflow: [
          { phase: "Pre Production", name: "Concept & Script" },
          { phase: "Production", name: "Shooting", isMilestone: true },
          { phase: "Post Production", name: "Editing & Motion Graphics", isMilestone: true },
        ] },
        { name: "3D Advertising Video", unit: "video", basePrice: 95000000, cost: [ { name: "Concept & 3D Storyboard", amount: 9000000 }, { name: "3D Modeling & Animation", amount: 32000000 }, { name: "Rendering Farm & Compositing", amount: 18000000 }, { name: "Sound Design & Mixing", amount: 5000000 } ] },
      ],
    },
    {
      name: "AI Video",
      services: [
        { name: "AI Video Production", unit: "video", basePrice: 38000000, cost: [ { name: "Prompt Design & Asset Prep", amount: 5500000 }, { name: "AI Generation & Curation", amount: 12000000 }, { name: "Final Assembly & QC", amount: 4500000 } ], workflow: [
          { phase: "Pre Production", name: "Prompt Design & Asset Prep" },
          { phase: "Production", name: "AI Generation & Curation", isMilestone: true },
          { phase: "Post Production", name: "Final Assembly", isMilestone: true },
        ] },
        { name: "AI Short Film Production", unit: "film", basePrice: 120000000, cost: [ { name: "Screenplay & Storyboard", amount: 10000000 }, { name: "AI Generation Pipeline", amount: 45000000 }, { name: "Editing & Sound", amount: 15000000 } ] },
      ],
    },
    {
      name: "Immersive",
      services: [
        { name: "Virtual Tour", unit: "lokasi", basePrice: 45000000, cost: [ { name: "Survey & Scene Plan", amount: 4000000 }, { name: "Capture & Interactive Build", amount: 16000000 }, { name: "Publish & QA Device", amount: 5000000 } ], workflow: [
          { phase: "Pre Production", name: "Survey & Scene Plan" },
          { phase: "Production", name: "Capture & Interactive Build", isMilestone: true },
          { phase: "Post Production", name: "Publish & QA Device", isMilestone: true },
        ] },
        { name: "Projection Mapping", unit: "event", basePrice: 150000000, cost: [ { name: "Konsep & Visual Mapping", amount: 18000000 }, { name: "Konten Proyeksi (animasi)", amount: 45000000 }, { name: "Perangkat Projector & Instalasi", amount: 30000000 } ] },
      ],
    },
  ]);

  // ============ KANAL & INTEGRASI PER BRAND (Ronde 29-b) ============
  // Tiap brand memiliki integrasinya sendiri-sendiri: WhatsApp, Instagram,
  // Threads, Email — akun asli brand, kredensial buatan (mode demo).
  const brandChannelMeta: Array<{ id: string; name: string; wa: string; ig: string; email: string }> = [
    { id: unimasi.id, name: unimasi.name, wa: "+6281215082608", ig: "@unimasi_", email: "info@unimasi.com" },
    { id: segia.id, name: segia.name, wa: "+6281225929178", ig: "@segiatech", email: "marketing@udp.co.id" },
    { id: erfo.id, name: erfo.name, wa: "+6281215082607", ig: "@erfomultimedia", email: "info@erfomultimedia.com" },
    { id: unicam.id, name: unicam.name, wa: "+6281336359525", ig: "@unicam.studio", email: "marketing@udp.co.id" },
  ];
  const seedDemoChannels = brandChannelMeta.flatMap((b) => [
    {
      channel: "whatsapp", brandId: b.id, displayName: `WhatsApp Business — ${b.name}`, accountRef: b.wa,
      credentials: JSON.stringify({ phoneNumberId: `1093${b.id.slice(-6).replace(/\D/g, "") || "215904"}`, wabaId: "2039187654xx", accessToken: "EAAG-seed-demo-token", verifyToken: `seed-vt-${b.id.slice(-8)}` }),
    },
    {
      channel: "instagram", brandId: b.id, displayName: `Instagram Direct — ${b.name}`, accountRef: b.ig,
      credentials: JSON.stringify({ accountId: "1784145267xx", accessToken: "IGQV-seed-demo-token" }),
    },
    {
      channel: "threads", brandId: b.id, displayName: `Threads — ${b.name}`, accountRef: b.ig,
      credentials: JSON.stringify({ accountId: "9123456789xx", accessToken: "THQV-seed-demo-token" }),
    },
    {
      channel: "email", brandId: b.id, displayName: `Email Bisnis — ${b.name}`, accountRef: b.email,
      credentials: JSON.stringify({ provider: "zoho", smtpHost: "smtp.zoho.com", smtpPort: "465", smtpUser: b.email, smtpPassword: "seed-demo-pass", imapHost: "imap.zoho.com", imapPort: "993", imapUser: b.email, imapPassword: "seed-demo-pass" }),
    },
  ]);
  await db.channelConfig.createMany({
    data: seedDemoChannels.map((c) => ({
      channel: c.channel, brandId: c.brandId, displayName: c.displayName, accountRef: c.accountRef,
      credentials: c.credentials, status: "connected",
      statusNote: "Koneksi demo — akun asli brand, kredensial buatan (seed)",
      isDemo: true, connectedAt: new Date(), lastTestedAt: new Date(),
    })),
  });

  // ============ USERS — tim UDP, 9 akun nyata dgn kredensial ter-hash (Ronde 46-b) ============
  // Login: email + password. PIN BUKAN untuk login — PIN membuka layar terkunci.
  // Struktur tim: 1 Direktur · 1 Manajer · 4 Produksi · 1 Finance · 1 HR · 1 Marketing.
  await db.user.createMany({ data: [
    { name: "Andri Saputro", email: "andri@udp.co.id", role: "director", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#0f766e" },
    { name: "Budi M. Kurniawan", email: "budi@udp.co.id", role: "manager", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#b45309" },
    { name: "Yusi", email: "yusi@udp.co.id", role: "production", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#be123c" },
    { name: "Rustam Aji", email: "rustam@udp.co.id", role: "production", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#7c3aed" },
    { name: "Fais", email: "fais@udp.co.id", role: "production", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#0369a1" },
    { name: "Adib", email: "adib@udp.co.id", role: "production", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#4d7c0f" },
    { name: "Sika", email: "sika@udp.co.id", role: "finance", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#db2777" },
    { name: "Latifa", email: "latifa@udp.co.id", role: "hr", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#ca8a04" },
    { name: "Fadel", email: "fadel@udp.co.id", role: "marketing", pin: hashSecret(DEMO_PIN), password: hashSecret(DEMO_PASSWORD), avatarColor: "#ea580c" },
  ]});

  // ============ COMPANIES ============
  const companies = await Promise.all([
    db.company.create({ data: { name: "PT Nusantara Digital Raya", industry: "Teknologi", website: "https://nusantaranet.com", websiteDomain: "nusantaranet.com", country: "Indonesia", city: "Jakarta", size: "enterprise", defaultCurrency: "IDR", tags: JSON.stringify(["priority", "retainer"]), lifetimeValue: 485000000 } }),
    db.company.create({ data: { name: "Kementerian Pendidikan dan Kebudayaan", industry: "Pemerintahan", website: "kemdikbud.go.id", websiteDomain: "kemdikbud.go.id", country: "Indonesia", city: "Jakarta", size: "government", defaultCurrency: "IDR", tags: JSON.stringify(["government"]) } }),
    db.company.create({ data: { name: "PT Sawit Sejahtera Abadi", industry: "Agrikultur", website: "sawitsejahtera.co.id", websiteDomain: "sawitsejahtera.co.id", country: "Indonesia", city: "Medan", size: "enterprise", defaultCurrency: "IDR" } }),
    db.company.create({ data: { name: "Bank Berkah Sentosa", industry: "Perbankan", website: "bankberkah.co.id", websiteDomain: "bankberkah.co.id", country: "Indonesia", city: "Surabaya", size: "enterprise", defaultCurrency: "IDR", tags: JSON.stringify(["finance"]) } }),
    db.company.create({ data: { name: "PT Karya Wisata Nusantara", industry: "Pariwisata", website: "wisatanusantara.id", websiteDomain: "wisatanusantara.id", country: "Indonesia", city: "Denpasar", size: "sme", defaultCurrency: "IDR" } }),
    db.company.create({ data: { name: "RS Harapan Sehat", industry: "Kesehatan", website: "harapansehat.co.id", websiteDomain: "harapansehat.co.id", country: "Indonesia", city: "Bandung", size: "enterprise", defaultCurrency: "IDR" } }),
    db.company.create({ data: { name: "CV Manggala Kreatif", industry: "Kreatif", country: "Indonesia", city: "Yogyakarta", size: "sme", defaultCurrency: "IDR" } }),
    db.company.create({ data: { name: "PT Logistik Prima Indonesia", industry: "Logistik", website: "logistikprima.co.id", websiteDomain: "logistikprima.co.id", country: "Indonesia", city: "Semarang", size: "enterprise", defaultCurrency: "IDR" } }),
    db.company.create({ data: { name: "Global EdTech Pte Ltd", industry: "Pendidikan", website: "globaledtech.com", websiteDomain: "globaledtech.com", country: "Singapore", city: "Singapore", size: "sme", defaultCurrency: "USD" } }),
    db.company.create({ data: { name: "Dinas Pariwisata Daerah Kota Bandung", industry: "Pemerintahan", country: "Indonesia", city: "Bandung", size: "government", defaultCurrency: "IDR" } }),
  ]);

  // ============ CONTACTS ============
  const contacts = await Promise.all([
    db.contact.create({ data: { firstName: "Hendra", lastName: "Wijaya", fullName: "Hendra Wijaya", position: "Chief Marketing Officer", email: "hendra@nusantaranet.com", whatsapp: "+6281234567890", phone: "+62215551001", country: "Indonesia", city: "Jakarta", timezone: "Asia/Jakarta", companyId: companies[0].id, preferredChannel: "whatsapp", linkedin: "linkedin.com/in/hendrawijaya", tags: JSON.stringify(["decision-maker"]) } }),
    db.contact.create({ data: { firstName: "Ratna", lastName: "Sari", fullName: "Ratna Sari", position: "Kepala Biro Komunikasi", email: "ratna.sari@kemdikbud.go.id", emailAlt: "ratna.kemdikbud@gmail.com", whatsapp: "+628128001234", phone: "+62215791234", country: "Indonesia", city: "Jakarta", timezone: "Asia/Jakarta", companyId: companies[1].id, preferredChannel: "email", tags: JSON.stringify(["government", "procurement"]) } }),
    db.contact.create({ data: { firstName: "Bambang", lastName: "Sutrisno", fullName: "Bambang Sutrisno", position: "Public Relations Manager", email: "bambang@sawitsejahtera.co.id", whatsapp: "+6281370012345", country: "Indonesia", city: "Medan", timezone: "Asia/Jakarta", companyId: companies[2].id, preferredChannel: "whatsapp" } }),
    db.contact.create({ data: { firstName: "Lina", lastName: "Hartati", fullName: "Lina Hartati", position: "Head of Digital Banking", email: "lina.hartati@bankberkah.co.id", whatsapp: "+6281170023456", country: "Indonesia", city: "Surabaya", timezone: "Asia/Jakarta", companyId: companies[3].id, preferredChannel: "email", language: "id" } }),
    db.contact.create({ data: { firstName: "Kadek", lastName: "Adnyana", fullName: "Kadek Adnyana", position: "Owner", email: "kadek@wisatanusantara.id", whatsapp: "+6281235098765", country: "Indonesia", city: "Denpasar", timezone: "Asia/Makassar", companyId: companies[4].id, preferredChannel: "whatsapp" } }),
    db.contact.create({ data: { firstName: "dr. Amelia", lastName: "Rahmawati", fullName: "dr. Amelia Rahmawati", position: "Direktur Umum", email: "amelia@harapansehat.co.id", whatsapp: "+6281220987654", country: "Indonesia", city: "Bandung", timezone: "Asia/Jakarta", companyId: companies[5].id, preferredChannel: "email" } }),
    db.contact.create({ data: { firstName: "Yoga", lastName: "Prasetyo", fullName: "Yoga Prasetyo", position: "Creative Director", email: "yoga@manggalakreatif.id", whatsapp: "+6281345012345", country: "Indonesia", city: "Yogyakarta", companyId: companies[6].id, preferredChannel: "instagram" } }),
    db.contact.create({ data: { firstName: "Sinta", lastName: "Mardiani", fullName: "Sinta Mardiani", position: "Ops Manager", email: "sinta@logistikprima.co.id", whatsapp: "+6281390012345", country: "Indonesia", city: "Semarang", companyId: companies[7].id, preferredChannel: "email" } }),
    db.contact.create({ data: { firstName: "Wei Ling", lastName: "Tan", fullName: "Wei Ling Tan", position: "Regional Marketing Head", email: "weiling@globaledtech.com", whatsapp: "+6591234567", country: "Singapore", city: "Singapore", timezone: "Asia/Singapore", language: "en", companyId: companies[8].id, preferredChannel: "email" } }),
    db.contact.create({ data: { firstName: "Dedy", lastName: "Kurniawan", fullName: "Dedy Kurniawan", position: "Kepala Seksi Promosi", email: "dedy@pariwisata.bandung.go.id", whatsapp: "+6281510012345", country: "Indonesia", city: "Bandung", companyId: companies[9].id, preferredChannel: "whatsapp" } }),
    // Kontak mirip (untuk demo duplicate warning)
    db.contact.create({ data: { firstName: "Ibu Ratna", fullName: "Ibu Ratna", position: "Staff Humas", email: "ratna.humas@kemdikbud.go.id", whatsapp: "+628128001234", country: "Indonesia", city: "Jakarta", companyId: companies[1].id, preferredChannel: "whatsapp" } }),
    db.contact.create({ data: { firstName: "Putri", lastName: "Ayunda", fullName: "Putri Ayunda", position: "Marketing Staff", email: "putri.ayunda@gmail.com", whatsapp: "+6281990456789", country: "Indonesia", city: "Jakarta", preferredChannel: "instagram" } }),
  ]);

  // ============ OPPORTUNITIES ============
  type OppSeed = {
    title: string; brand: string; company?: number; contact: number;
    serviceCategory: string; serviceName: string; leadSource: string;
    stage: string; value?: number; probability?: number; owner?: string;
    temperature?: string; priority?: string; expectedClose?: number;
    lostReason?: string; lostNotes?: string; competitor?: string;
    nurtureSegment?: string; createdDaysAgo: number; brief?: string; nextAction?: string;
    currency?: string; lastOfferValue?: number; followUpDate?: Date;
  };
  const oppSeeds: OppSeed[] = [
    { title: "Website corporate baru + SEO", brand: segia.id, company: 0, contact: 0, serviceCategory: "website", serviceName: "Website Company Profile", leadSource: "referral", stage: "won", value: 245000000, probability: 100, owner: "Fadel", temperature: "hot", createdDaysAgo: 75, brief: "Redesign total website korporat dengan CMS, multibahasa, dan SEO on-page untuk 50 halaman." },
    { title: "Video company profile 2025", brand: unicam.id, company: 0, contact: 0, serviceCategory: "video", serviceName: "Corporate Video", leadSource: "instagram", stage: "won", value: 185000000, probability: 100, owner: "Fadel", createdDaysAgo: 60, brief: "Video profile 3 menit dengan drone dan motion graphic untuk investor relation." },
    { title: "Animasi edukasi literasi digital", brand: unimasi.id, company: 1, contact: 1, serviceCategory: "animation", serviceName: "Animasi Pembelajaran", leadSource: "website", stage: "won", value: 320000000, probability: 100, owner: "Fadel", createdDaysAgo: 90, brief: "12 episode animasi pembelajaran literasi digital untuk siswa SMA." },
    { title: "Dokumentasi pabrik + drone", brand: erfo.id, company: 2, contact: 2, serviceCategory: "video", serviceName: "Dokumentasi Foto/Video", leadSource: "whatsapp", stage: "negotiation", value: 96000000, probability: 60, owner: "Fadel", temperature: "hot", createdDaysAgo: 20, nextAction: "Kirim revisi penawaran final" },
    { title: "Live streaming economic forum", brand: erfo.id, company: 3, contact: 3, serviceCategory: "video", serviceName: "Live Streaming", leadSource: "event", stage: "proposal_sent", value: 145000000, probability: 50, owner: "Budi M. Kurniawan", createdDaysAgo: 15, nextAction: "Follow-up proposal 3 kamera" },
    { title: "Virtual tour destinasi wisata", brand: unicam.id, company: 4, contact: 4, serviceCategory: "immersive", serviceName: "Virtual Tour", leadSource: "instagram", stage: "discovery", value: 210000000, probability: 40, owner: "Fadel", createdDaysAgo: 12, nextAction: "Jadwalkan survey lokasi" },
    { title: "Website booking + UI/UX", brand: segia.id, company: 4, contact: 4, serviceCategory: "website", serviceName: "Web Application", leadSource: "referral", stage: "estimation", value: 165000000, probability: 45, owner: "Budi M. Kurniawan", createdDaysAgo: 18 },
    { title: "Animasi 3D edukasi rumah sakit", brand: unimasi.id, company: 5, contact: 5, serviceCategory: "animation", serviceName: "Animasi 3D", leadSource: "email", stage: "qualified", value: 275000000, probability: 35, owner: "Fadel", createdDaysAgo: 9 },
    { title: "Projection mapping annual night", brand: unicam.id, company: 9, contact: 9, serviceCategory: "immersive", serviceName: "Projection Mapping", leadSource: "event", stage: "connected", value: 385000000, probability: 30, owner: "Fadel", priority: "high", createdDaysAgo: 7 },
    { title: "Video AI onboarding karyawan", brand: unicam.id, company: 7, contact: 7, serviceCategory: "video", serviceName: "AI Video Production", leadSource: "linkedin", stage: "proposal_sent", value: 88000000, probability: 55, owner: "Budi M. Kurniawan", createdDaysAgo: 22 },
    { title: "SEO & konten digital 6 bulan", brand: segia.id, company: 2, contact: 2, serviceCategory: "digital_marketing", serviceName: "SEO Optimization", leadSource: "website", stage: "verbal_agreement", value: 120000000, probability: 85, owner: "Fadel", temperature: "hot", createdDaysAgo: 30, nextAction: "Tunggu PO resmi" },
    { title: "Animasi sosialisasi K3", brand: unimasi.id, company: 7, contact: 7, serviceCategory: "animation", serviceName: "Video Sosialisasi", leadSource: "whatsapp", stage: "contact_attempted", value: 65000000, probability: 20, owner: "Fadel", createdDaysAgo: 4 },
    { title: "Video profil internasional EN", brand: unicam.id, company: 8, contact: 8, serviceCategory: "video", serviceName: "Corporate Video", leadSource: "linkedin", stage: "negotiation", value: 28000000, currency: "USD", probability: 65, owner: "Fadel", createdDaysAgo: 25 },
    { title: "Dokumentasi seminar nasional", brand: erfo.id, company: 1, contact: 10, serviceCategory: "video", serviceName: "Dokumentasi Foto/Video", leadSource: "email", stage: "new", value: 55000000, probability: 15, createdDaysAgo: 1 },
    { title: "Animasi laporan keuangan", brand: unimasi.id, company: 3, contact: 3, serviceCategory: "animation", serviceName: "Video Infografis", leadSource: "website", stage: "new", value: 72000000, probability: 15, createdDaysAgo: 2 },
    // Lost + alasan
    { title: "Shooting iklan ramadan", brand: erfo.id, company: 3, contact: 3, serviceCategory: "video", serviceName: "Shooting Iklan", leadSource: "referral", stage: "lost", value: 320000000, probability: 0, owner: "Fadel", createdDaysAgo: 70, lostReason: "Harga terlalu tinggi", lostNotes: "Klien memilih vendor dengan harga 35% lebih rendah, kualitas set resiko.", competitor: "Kroma Pictures", lastOfferValue: 320000000 },
    { title: "Redesign portal vendor", brand: segia.id, company: 7, contact: 7, serviceCategory: "website", serviceName: "Web Application", leadSource: "cold_outreach", stage: "lost", value: 190000000, probability: 0, owner: "Fadel", createdDaysAgo: 45, lostReason: "Ditunda internal klien", lostNotes: "Budget 2026 dialihkan ke ERP, reaktivasi awal 2026." },
    { title: "Animasi campaign antikorupsi", brand: unimasi.id, company: 9, contact: 9, serviceCategory: "animation", serviceName: "Video Marketing", leadSource: "instagram", stage: "lost", value: 95000000, probability: 0, owner: "Fadel", createdDaysAgo: 50, lostReason: "Memilih kompetitor", competitor: "Studio Animasi Nusantara", lostNotes: "Rekomendasi re-offer untuk campaign 17 Agustus." },
    // Nurture
    { title: "Company profile keberlanjutan", brand: unicam.id, company: 2, contact: 2, serviceCategory: "video", serviceName: "Corporate Video", leadSource: "whatsapp", stage: "nurture", value: 155000000, probability: 25, owner: "Fadel", createdDaysAgo: 40, nurtureSegment: "budget_season", followUpDate: ahead(21) },
    { title: "Website marketplace UMKM", brand: segia.id, company: 6, contact: 6, serviceCategory: "website", serviceName: "Website E-Commerce", leadSource: "instagram", stage: "nurture", value: 135000000, probability: 25, owner: "Fadel", createdDaysAgo: 35, nurtureSegment: "reoffer_30", followUpDate: ahead(9) },
    // Cross-sell dari won
    { title: "Animasi produk digital banking", brand: unimasi.id, company: 3, contact: 3, serviceCategory: "animation", serviceName: "Animasi Program/Produk", leadSource: "referral", stage: "estimation", value: 110000000, probability: 45, owner: "Fadel", createdDaysAgo: 14, brief: "Cross-sell dari Bank Berkah setelah sukses live streaming." },
  ];

  const opps: Awaited<ReturnType<typeof db.opportunity.create>>[] = [];
  for (const s of oppSeeds) {
    const o = await db.opportunity.create({ data: {
      title: s.title,
      brandId: s.brand,
      companyId: s.company !== undefined ? companies[s.company].id : null,
      contactId: contacts[s.contact].id,
      serviceCategory: s.serviceCategory,
      serviceName: s.serviceName,
      leadSource: s.leadSource,
      brief: s.brief ?? "Brief awal dari komunikasi awal klien.",
      estimatedValue: s.value ?? null,
      currency: s.currency ?? "IDR",
      probability: s.probability ?? 20,
      ownerName: s.owner ?? null,
      stage: s.stage,
      temperature: s.temperature ?? (s.stage === "new" ? "warm" : "warm"),
      priority: s.priority ?? "medium",
      expectedCloseDate: s.expectedClose !== undefined ? ahead(s.expectedClose) : (["won", "lost", "nurture"].includes(s.stage) ? null : ahead(30 + Math.floor(Math.random() * 30))),
      lostReason: s.lostReason ?? null,
      lostNotes: s.lostNotes ?? null,
      competitor: s.competitor ?? null,
      lastOfferValue: s.lastOfferValue ?? null,
      nurtureSegment: s.nurtureSegment ?? null,
      followUpDate: s.followUpDate ?? (s.nurtureSegment ? ahead(14) : null),
      nextAction: s.nextAction ?? null,
      nextActionDate: s.nextAction ? ahead(2) : null,
      createdAt: ago(s.createdDaysAgo),
      updatedAt: ago(Math.max(0, s.createdDaysAgo - 5)),
    }});
    opps.push(o);
  }

  // ============ BRIEF AWAL (Ronde 46 — struktur brief kini bagian seed) ============
  // Satu approved (alur penuh), satu in_review (menunggu keputusan → memicu
  // notifikasi/push review), satu draft (dikerjakan marketing).
  const YEAR = new Date().getFullYear();
  await db.clientBrief.create({ data: {
    code: `BRF-${YEAR}-0001`, opportunityId: opps[0].id, brandId: segia.id,
    title: "Brief Website corporate baru + SEO",
    serviceTypes: JSON.stringify(["Website Company Profile"]),
    objectives: "Redesign total website korporat dengan CMS, multibahasa, dan SEO on-page untuk 50 halaman.",
    targetAudience: "Enterprise & calon klien korporat",
    keyMessages: "Kredibilitas teknologi, portofolio, kemudahan kontak",
    deliverables: JSON.stringify([
      { name: "Desain UI/UX", qty: 1, notes: "Termasuk design system" },
      { name: "Halaman CMS", qty: 50, notes: "Multibahasa ID/EN" },
      { name: "SEO on-page", qty: 50, notes: "Keyword riset + meta + schema" },
    ]),
    timelineStart: ago(70), timelineEnd: ahead(30),
    budgetMin: 220000000, budgetMax: 260000000, currency: "IDR",
    status: "approved", createdBy: "Fadel", submittedAt: ago(72),
    approvedAt: ago(68), approvedBy: "Andri Saputro",
    createdAt: ago(75),
  }});
  await db.clientBrief.create({ data: {
    code: `BRF-${YEAR}-0002`, opportunityId: opps[4].id, brandId: erfo.id,
    title: "Brief Live streaming economic forum",
    serviceTypes: JSON.stringify(["Live Streaming"]),
    objectives: "Live streaming forum ekonomi 2 hari, 3 kamera, multitrip ke YouTube & Zoom.",
    targetAudience: "Peserta forum & publik online",
    keyMessages: "Profesional, stabil, multi-platform",
    deliverables: JSON.stringify([
      { name: "Setup 3 kamera", qty: 1, notes: "Termasuk operator" },
      { name: "Multistream", qty: 2, notes: "YouTube + Zoom" },
      { name: "Highlight reel", qty: 1, notes: "Dirender H+2" },
    ]),
    timelineStart: ahead(10), timelineEnd: ahead(12),
    budgetMin: 130000000, budgetMax: 160000000, currency: "IDR",
    status: "in_review", createdBy: "Fadel", submittedAt: ago(1),
    createdAt: ago(3),
  }});
  await db.clientBrief.create({ data: {
    code: `BRF-${YEAR}-0003`, opportunityId: opps[5].id, brandId: unicam.id,
    title: "Brief Virtual tour destinasi wisata",
    serviceTypes: JSON.stringify(["Virtual Tour"]),
    objectives: "Virtual tour 360° untuk 12 titik destinasi wisata dengan hotspot informasi.",
    targetAudience: "Wisatawan domestik & internasional",
    deliverables: JSON.stringify([
      { name: "Titik panorama 360°", qty: 12, notes: "Sewa drone + kamera 360" },
      { name: "Hotspot info", qty: 24, notes: "Teks + audio" },
    ]),
    timelineStart: ahead(14), timelineEnd: ahead(45),
    budgetMin: 190000000, budgetMax: 230000000, currency: "IDR",
    status: "draft", createdBy: "Fadel",
    createdAt: ago(2),
  }});

  // ============ INTERACTIONS ============
  async function inter(oppIdx: number, data: {
    channel: string; direction: string; content: string; subject?: string;
    sender?: string; recipient?: string; hoursAfterCreated?: number; respondedBy?: string;
  }) {
    const o = opps[oppIdx];
    const createdAt = new Date(o.createdAt.getTime() + (data.hoursAfterCreated ?? 0) * HOUR);
    return db.interaction.create({ data: {
      channel: data.channel, direction: data.direction, content: data.content,
      subject: data.subject ?? null, senderName: data.sender ?? null, recipientName: data.recipient ?? null,
      brandId: o.brandId, opportunityId: o.id, contactId: o.contactId, companyId: o.companyId,
      respondedBy: data.respondedBy ?? null, respondedAt: data.direction === "inbound" && data.respondedBy ? new Date(createdAt.getTime() + 2 * HOUR) : null,
      deliveryStatus: data.direction === "outbound" ? "read" : "delivered",
      createdAt,
    }});
  }

  await inter(0, { channel: "referral", direction: "inbound", content: "Hendra dari Nusantara Digital minta info paket redesign website korporat, direferensikan oleh Bpk. Darmawan.", sender: "Hendra Wijaya", respondedBy: "Fadel" });
  await inter(0, { channel: "email", direction: "outbound", content: "Terima kasih Pak Hendra, kami kirimkan company deck Segia Tech dan jadwal discovery call minggu ini.", respondedBy: "Fadel" });
  await inter(0, { channel: "meeting", direction: "inbound", content: "Discovery call 45 menit: kebutuhan CMS, multibahasa, integrasi HRIS, timeline Q2.", sender: "Tim Segia" });
  await inter(1, { channel: "instagram", direction: "inbound", content: "DM Instagram: Kak, kami butuh video company profile untuk investor summit bulan depan. Bisa info paketnya?", sender: "hendra.wijaya", respondedBy: "Fadel" });
  await inter(2, { channel: "website", direction: "inbound", content: "Form website: Permintaan proposal animasi pembelajaran literasi digital 12 episode, anggaran APBN 2025.", sender: "Ratna Sari", subject: "Request Proposal - Website Form", respondedBy: "Fadel" });
  await inter(2, { channel: "email", direction: "outbound", content: "Lampiran proposal animasi literasi digital dengan breakdown episode, timeline 4 bulan.", subject: "Proposal Animasi Pembelajaran - Unimasi" });
  await inter(3, { channel: "whatsapp", direction: "inbound", content: "Pak Bambang: Butuh tim dokumentasi pabrik 2 hari + drone untuk laporan keberlanjutan.", sender: "Bambang Sutrisno", respondedBy: "Fadel" });
  await inter(4, { channel: "email", direction: "inbound", content: "Rundown economic forum 2 hari, est. 800 peserta. Mohon penawaran live streaming multi-kamera.", sender: "Lina Hartati", subject: "RFQ Live Streaming Economic Forum", respondedBy: "Fadel" });
  await inter(5, { channel: "instagram", direction: "inbound", content: "DM: Minat virtual tour 360 untuk 5 destinasi wisata unggulan.", sender: "kadek.wisata", respondedBy: "Fadel" });
  await inter(8, { channel: "linkedin", direction: "inbound", content: "LinkedIn InMail:Butuh video onboarding AI presenter virtual untuk 300 karyawan baru/tahun.", sender: "Wei Ling Tan", respondedBy: "Fadel" });

  // Lead inbox mentah (belum jadi opportunity)
  const rawLeads = [
    { channel: "whatsapp", sender: "+6281277345561", content: "Selamat siang, saya Dian dari PT Agro Makmur Lestari Medan. Kami butuh jasa foto produk dan video katalog untuk 40 produk kami. Estimasi budget? Mohon info ya.", contactIdx: null, brand: erfo.id },
    { channel: "instagram", sender: "@rani.creativehouse", content: "Halo kak! Saya Rani, content creator. Kami mau kolaborasi video AI untuk klien korporat kami. Boleh minta portfolio dan price list?", brand: unicam.id },
    { channel: "email", sender: "procurement@metroland.co.id", content: "Kepada Yth. Tim Unicam Studio,\n\nKami PT Metro Land Property mengundang Anda untuk tender pembuatan video profil proyek perumahan bersubsidi tahun 2026. Mohon kirim company profile dan legalitas sebelum akhir bulan.\n\nHormat kami,\nBagian Pengadaan", subject: "Invitation to Tender - Video Profil Proyek", brand: unicam.id },
    { channel: "website", sender: "farhan.hakim@gmail.com", content: "Halo, saya Farhan dari komunitas UMKM Bandung. Apakah bisa dibuatkan website toko online untuk 50 member UMKM dengan sistem payment gateway? Kira-kira estimasi biaya berapa?", brand: segia.id },
    { channel: "whatsapp", sender: "+6281399887766", content: "Permisi, saya sekretaris direksi RS. Kami rencananya mau buat animasi edukasi pasien tentang prosedur rawat inap. Mohon dikirimkan portofolio animasi rumah sakit.", brand: unimasi.id },
    // Duplikat dari identitas existing (Ratna Sari) — untuk demo identity matching
    { channel: "whatsapp", sender: "+62 812-8001-234", content: "Selamat pagi, ini Ratna lagi (Kementerian). Kami ada tambahan kebutuhan video sosialisasi program merit untuk 5 provinsi. Boleh dijadwalkan meeting pekan ini?", brand: unimasi.id },
  ];
  for (const l of rawLeads) {
    await db.interaction.create({ data: {
      channel: l.channel, direction: "inbound", content: l.content, senderName: l.sender,
      brandId: l.brand, deliveryStatus: "delivered", createdAt: ago(Math.random() * 3),
    }});
  }

  // Interaksi tambahan utk opp aktif
  await inter(3, { channel: "meeting", direction: "inbound", content: "Meeting teknis di kantor Erfo: review shotlist, jadwal shooting, dan breakdown drone.", sender: "Tim Erfo + Bambang" });
  await inter(4, { channel: "email", direction: "outbound", content: "Proposal live streaming 3 kamera + LED wall + operator, berlaku 14 hari.", subject: "Proposal Live Streaming - Erfo Multimedia" });
  await inter(6, { channel: "whatsapp", direction: "inbound", content: "Kadek kirim referensi virtual tour dari hotel kompetitor, minta yang lebih interaktif dengan hotspot info.", sender: "Kadek Adnyana" });
  await inter(9, { channel: "email", direction: "inbound", content: "Wei Ling setuju scope, nego diskon 8% untuk kontrak 2 video per tahun.", sender: "Wei Ling Tan" });
  await inter(10, { channel: "whatsapp", direction: "inbound", content: "Pak Bambang: PO SEO bakal turun minggu ini, tolong siapkan onboarding.", sender: "Bambang Sutrisno", respondedBy: "Fadel" });

  // ============ TASKS (Ronde 46-b — bentuk task baru: assignees JSON multi-tag) ============
  const taskSeeds: Array<{ title: string; type: string; priority: string; assignee: string; assignees?: string[]; due: Date; opp?: number; status?: string }> = [
    { title: "Follow-up 1: konfirmasi pesan diterima", type: "follow_up", priority: "high", assignee: "Fadel", due: ahead(1), opp: 13 },
    { title: "Kirim portfolio animasi RS", type: "follow_up", priority: "high", assignee: "Fadel", due: ahead(0), opp: 14 },
    { title: "Jadwalkan survey lokasi Denpasar", type: "meeting", priority: "medium", assignee: "Fadel", due: ahead(3), opp: 5 },
    { title: "Siapkan estimasi biaya virtual tour", type: "internal", priority: "high", assignee: "Sika", due: ahead(2), opp: 5 },
    { title: "Final revisi penawaran dokumentasi pabrik", type: "follow_up", priority: "urgent", assignee: "Fadel", due: ahead(0), opp: 3 },
    { title: "Meeting negosiasi diskon Video AI", type: "meeting", priority: "high", assignee: "Fadel", due: ahead(1), opp: 9 },
    { title: "Tunggu & verifikasi PO SEO", type: "admin", priority: "medium", assignee: "Fadel", due: ahead(5), opp: 10 },
    { title: "Re-offer animasi K3 setelah 7 hari", type: "follow_up", priority: "low", assignee: "Fadel", due: ahead(7), opp: 11 },
    { title: "Brief produksi: animasi literasi EP1-3", type: "internal", priority: "high", assignee: "Yusi", due: ago(2), opp: 2, status: "done" },
    { title: "Persiapan aset video episode 4-6", type: "internal", priority: "medium", assignee: "Rustam Aji", due: ahead(4), opp: 2 },
    { title: "QC footage drone dokumentasi pabrik", type: "internal", priority: "high", assignee: "Fais", assignees: ["Fais", "Adib"], due: ahead(2), opp: 3 },
    { title: "Draft storyboard virtual tour", type: "internal", priority: "medium", assignee: "Adib", due: ahead(5), opp: 5 },
    { title: "Kirim invoice termin 2 website Nusantara", type: "admin", priority: "high", assignee: "Sika", due: ahead(1), opp: 0 },
    { title: "Follow-up ulang marketplace UMKM", type: "follow_up", priority: "medium", assignee: "Fadel", due: ahead(9), opp: 19 },
    { title: "Reaktivasi campaign antikorupsi (17 Agustus)", type: "follow_up", priority: "low", assignee: "Fadel", due: ahead(45), opp: 17 },
    // Manajer & HR — task internal tanpa opportunity terkait
    { title: "Review beban kerja tim produksi mingguan", type: "internal", priority: "medium", assignee: "Budi M. Kurniawan", due: ahead(3) },
    { title: "Onboarding checklist personel baru", type: "admin", priority: "low", assignee: "Latifa", due: ahead(6) },
  ];
  for (const t of taskSeeds) {
    const assigneeList = t.assignees ?? [t.assignee];
    await db.task.create({ data: {
      title: t.title, type: t.type, priority: t.priority,
      assignees: JSON.stringify(assigneeList),
      assigneeName: t.assignee,
      dueDate: t.due, opportunityId: t.opp !== undefined ? opps[t.opp].id : null, status: t.status ?? "open",
      completedAt: t.status === "done" ? ago(1) : null,
    }});
  }

  // ============ NOTES ============
  await db.note.create({ data: { body: "Direktur: Nilai nego maksimal -5% dari offer terakhir. Prioritaskan closing sebelum akhir kuartal.", authorName: "Andri Saputro", type: "director_feedback", opportunityId: opps[3].id } });
  await db.note.create({ data: { body: "Klien sensitif harga tapi volume besar. Tawarkan paket dokumentasi 3 hari + bonus 1 hari drone.", authorName: "Fadel", type: "internal", opportunityId: opps[3].id } });
  await db.note.create({ data: { body: "Kompetitor utama: vendor lokal Medan dengan harga murah. Kami unggul di kualitas equipment dan tim bersertifikasi.", authorName: "Fadel", type: "internal", opportunityId: opps[3].id } });
  await db.note.create({ data: { body: "Direktur: Approve diskon 8% untuk kontrak multi-video Global EdTech. Jaga margin minimal 30%.", authorName: "Andri Saputro", type: "director_feedback", opportunityId: opps[12].id } });
  await db.note.create({ data: { body: "Pemerintahan: siapkan dokumen administrasi lengkap (NPWP, NIB, pengalaman kerja). Pembayaran via LS karena APBN.", authorName: "Fadel", type: "internal", opportunityId: opps[2].id } });
  await db.note.create({ data: { body: "Cross-sell potensi animasi edukasi pasien setelah virtual tour selesai.", authorName: "Fadel", type: "internal", opportunityId: opps[5].id } });

  // ============ PROJECTS dari Won ============
  const wonDefs = [
    { opp: 0, code: "SGT-2025-001", name: "Redesign Website PT Nusantara Digital Raya", pm: "Budi M. Kurniawan", progress: 72, status: "in_progress", category: "website", start: ago(50), due: ahead(20) },
    { opp: 1, code: "UCS-2025-014", name: "Corporate Video Nusantara 2025", pm: "Budi M. Kurniawan", progress: 45, status: "in_progress", category: "video", start: ago(30), due: ahead(25) },
    { opp: 2, code: "UMS-2025-007", name: "Animasi Edukasi Literasi Digital 12 Episode", pm: "Budi M. Kurniawan", progress: 88, status: "review", category: "animation", start: ago(80), due: ahead(10) },
  ];
  for (const w of wonDefs) {
    const opp = opps[w.opp];
    const project = await db.project.create({ data: {
      code: w.code, name: w.name, brandId: opp.brandId, companyId: opp.companyId!,
      opportunityId: opp.id, serviceCategory: w.category, status: w.status, progress: w.progress,
      pmName: w.pm, startDate: w.start, dueDate: w.due,
      contractValue: opp.estimatedValue ?? 0, budgetInternal: Math.round((opp.estimatedValue ?? 0) * 0.62),
    }});
    const flow = (await import("@/lib/crm/constants")).workflowFor(w.category);
    const doneCount = Math.floor((w.progress / 100) * flow.length);
    for (let i = 0; i < flow.length; i++) {
      await db.milestone.create({ data: {
        projectId: project.id, name: flow[i], order: i,
        status: i < doneCount ? "done" : i === doneCount ? "in_progress" : "pending",
        dueDate: new Date(w.start.getTime() + ((i + 1) * (w.due.getTime() - w.start.getTime())) / flow.length),
      }});
    }
  }

  // ============ INVOICES ============
  const invDefs = [
    { opp: 0, projIdx: 0, number: "SGT-2025-INV-001", desc: "Termin 1 (50%) - Redesign Website PT Nusantara Digital Raya", amount: 122500000, status: "paid", issue: ago(48), due: ago(33), pay: [{ amount: 122500000, method: "transfer", reference: "TRF-BCA-88120", at: ago(35) }] },
    { opp: 0, projIdx: 0, number: "SGT-2025-INV-002", desc: "Termin 2 (40%) - Milestone Development", amount: 98000000, status: "partial", issue: ago(10), due: ahead(5), pay: [{ amount: 49000000, method: "transfer", reference: "TRF-BCA-99341", at: ago(4) }] },
    { opp: 1, projIdx: 1, number: "UCS-2025-INV-014", desc: "DP 50% - Corporate Video Nusantara 2025", amount: 92500000, status: "paid", issue: ago(28), due: ago(14), pay: [{ amount: 92500000, method: "transfer", reference: "TRF-MANDIRI-4412", at: ago(20) }] },
    { opp: 2, projIdx: 2, number: "UMS-2025-INV-007", desc: "Termin 1 (30%) - Animasi Literasi Digital", amount: 96000000, status: "paid", issue: ago(75), due: ago(60), pay: [{ amount: 96000000, method: "transfer", reference: "LS-KEMDIKBUD-1207", at: ago(58) }] },
    { opp: 2, projIdx: 2, number: "UMS-2025-INV-008", desc: "Termin 2 (40%) - Episode 1-6 Approved", amount: 128000000, status: "overdue", issue: ago(25), due: ago(4) },
  ];
  for (const inv of invDefs) {
    const opp = opps[inv.opp];
    const taxAmount = Math.round(inv.amount * 0.11);
    const created = await db.invoice.create({ data: {
      number: inv.number, brandId: opp.brandId, companyId: opp.companyId!,
      opportunityId: opp.id, description: inv.desc, amount: inv.amount,
      taxRate: 11, taxAmount, total: inv.amount + taxAmount, currency: "IDR",
      status: inv.status, issueDate: inv.issue, dueDate: inv.due,
    }});
    for (const p of inv.pay ?? []) {
      await db.payment.create({ data: { invoiceId: created.id, amount: p.amount, method: p.method, reference: p.reference, paidAt: p.at } });
    }
  }

  // ============ ESTIMATION, QUOTATION, APPROVAL (Fase 2) ============
  // Estimasi lengkap utk opp "Virtual tour destinasi wisata" (discovery) — draft
  const oppVt = opps[5];
  const estVtCost = { laborInternal: 28000000, vendorFreelance: 12000000, equipment: 18000000, transport: 6500000, accommodation: 9000000, talent: 0, locationFee: 4000000, softwareLicense: 3000000, hostingDomain: 1500000 };
  const vtTotalCost = Object.values(estVtCost).reduce((a, b) => a + b, 0);
  const vtRevenue = 210000000;
  const vtContingency = Math.round(vtTotalCost * 0.05);
  const vtMgmt = Math.round(vtTotalCost * 0.05);
  const vtMargin = vtRevenue - (vtTotalCost + vtContingency + vtMgmt);
  await db.estimation.create({ data: {
    opportunityId: oppVt.id, ...estVtCost,
    contingencyPct: 5, managementFeePct: 5, discountPct: 0, taxPct: 11, targetMarginPct: 30,
    totalCost: vtTotalCost, contingency: vtContingency, managementFee: vtMgmt,
    revenue: vtRevenue, discountAmount: 0, netRevenue: vtRevenue, taxAmount: Math.round(vtRevenue * 0.11),
    grandTotal: Math.round(vtRevenue * 1.11), margin: vtMargin,
    marginPct: Math.round((vtMargin / vtRevenue) * 1000) / 10,
    status: "draft", createdBy: "Fadel",
    notes: "Survey 5 lokasi, kamera 360 + drone, hosting tour 1 tahun.",
  }});

  // Estimasi utk opp "Live streaming economic forum" (proposal_sent) — PENDING APPROVAL (diskon 8%)
  const oppLs = opps[4];
  const lsCost = { laborInternal: 35000000, vendorFreelance: 22000000, equipment: 42000000, transport: 8000000, accommodation: 12000000, talent: 15000000, locationFee: 0, softwareLicense: 6000000, hostingDomain: 2000000 };
  const lsTotalCost = Object.values(lsCost).reduce((a, b) => a + b, 0);
  const lsRevenue = 145000000;
  const lsCont = Math.round(lsTotalCost * 0.05);
  const lsMgmt = Math.round(lsTotalCost * 0.05);
  const lsDiscount = Math.round(lsRevenue * 0.08);
  const lsNet = lsRevenue - lsDiscount;
  const lsMargin = lsNet - (lsTotalCost + lsCont + lsMgmt);
  const estLs = await db.estimation.create({ data: {
    opportunityId: oppLs.id, ...lsCost,
    contingencyPct: 5, managementFeePct: 5, discountPct: 8, taxPct: 11, targetMarginPct: 30,
    totalCost: lsTotalCost, contingency: lsCont, managementFee: lsMgmt,
    revenue: lsRevenue, discountAmount: lsDiscount, netRevenue: lsNet,
    taxAmount: Math.round(lsNet * 0.11), grandTotal: Math.round(lsNet * 1.11), margin: lsMargin,
    marginPct: Math.round((lsMargin / lsNet) * 1000) / 10,
    status: "pending_approval", createdBy: "Fadel",
    notes: "Diskon 8% untuk event 2 hari — butuh approval Direktur karena margin di bawah target.",
  }});
  await db.approvalRequest.create({ data: {
    entityType: "estimation", entityId: estLs.id,
    entityLabel: "Estimasi — Live streaming economic forum",
    opportunityId: oppLs.id, requestedBy: "Fadel",
    amount: Math.round(lsNet * 1.11), discountPct: 8,
    note: "Margin " + (Math.round((lsMargin / lsNet) * 1000) / 10) + "% (di bawah target 30%) karena kompetitif. Mohon persetujuan diskon 8%.",
  }});

  // Quotation utk opp "Video AI onboarding karyawan" (proposal_sent) — sudah terkirim
  const oppAi = opps[9];
  const qItems = [
    { description: "Video AI presenter virtual (2 video, max 3 menit)", qty: 2, unitPrice: 38000000, subtotal: 76000000 },
    { description: "Script & storyboard", qty: 1, unitPrice: 8000000, subtotal: 8000000 },
    { description: "Voice over profesional EN", qty: 2, unitPrice: 2000000, subtotal: 4000000 },
  ];
  const qSubtotal = qItems.reduce((a, i) => a + i.subtotal, 0);
  const qTax = Math.round(qSubtotal * 0.11);
  await db.quotation.create({ data: {
    number: "UCS-2026-0001", brandId: oppAi.brandId, opportunityId: oppAi.id, companyId: oppAi.companyId!,
    items: JSON.stringify(qItems), subtotal: qSubtotal, discountPct: 0, discountAmount: 0,
    taxPct: 11, taxAmount: qTax, total: qSubtotal + qTax, currency: "IDR",
    status: "sent", validUntil: ahead(10), sentAt: ago(3),
    notes: "Harga berlaku 14 hari. Termasuk 2 kali revisi.",
  }});

  // Quotation accepted utk opp "Dokumentasi pabrik + drone" (negotiation)
  const oppDok = opps[3];
  const dItems = [
    { description: "Dokumentasi foto & video pabrik 2 hari", qty: 1, unitPrice: 72000000, subtotal: 72000000 },
    { description: "Drone videography + lisensi udara", qty: 1, unitPrice: 18000000, subtotal: 18000000 },
    { description: "Editing final + color grading", qty: 1, unitPrice: 12000000, subtotal: 12000000 },
  ];
  const dSubtotal = dItems.reduce((a, i) => a + i.subtotal, 0);
  const dDiscount = Math.round(dSubtotal * 0.05);
  const dTax = Math.round((dSubtotal - dDiscount) * 0.11);
  await db.quotation.create({ data: {
    number: "EFM-2026-0001", brandId: oppDok.brandId, opportunityId: oppDok.id, companyId: oppDok.companyId!,
    items: JSON.stringify(dItems), subtotal: dSubtotal, discountPct: 5, discountAmount: dDiscount,
    taxPct: 11, taxAmount: dTax, total: dSubtotal - dDiscount + dTax, currency: "IDR",
    status: "accepted", validUntil: ahead(5), sentAt: ago(8), respondedAt: ago(1),
    notes: "Revisi penawaran final — disetujui client via WhatsApp.",
  }});

  // ============ CHANGE REQUESTS (Fase 2 — Produksi) ============
  const projUms = await db.project.findUnique({ where: { code: "UMS-2025-007" } });
  const projUcs = await db.project.findUnique({ where: { code: "UCS-2025-014" } });
  if (projUms && projUcs) {
    // CR-2026-0001: sudah disetujui — kontrak naik + invoice tambahan draft terkait
    const cr1Tax = Math.round(12000000 * 0.11);
    const cr1Invoice = await db.invoice.create({ data: {
      number: "UMS-2025-INV-009", brandId: projUms.brandId, companyId: projUms.companyId,
      projectId: projUms.id, opportunityId: projUms.opportunityId,
      description: "Invoice tambahan — Change Request CR-2026-0001: Tambahan 3 episode subtitle bilingual",
      amount: 12000000, taxRate: 11, taxAmount: cr1Tax, total: 12000000 + cr1Tax,
      currency: "IDR", status: "sent", issueDate: ago(6), dueDate: ahead(8),
      notes: "Dibuat otomatis dari change request CR-2026-0001 (disetujui oleh Andri Saputro)",
    }});
    const cr1 = await db.changeRequest.create({ data: {
      number: "CR-2026-0001", projectId: projUms.id,
      title: "Tambahan 3 episode subtitle bilingual",
      description: "Klien meminta 3 episode tambahan subtitle bahasa Inggris + Spain untuk distribusi internasional. Menambah beban translation & QC 3 hari kerja.",
      additionalCost: 12000000, additionalDays: 5,
      status: "approved", requestedBy: "Yusi",
      decidedBy: "Andri Saputro", decidedAt: ago(6),
      decisionNote: "Disetujui via email klien (Kemdikbud). Invoice tambahan diterbitkan.",
      invoiceId: cr1Invoice.id,
    }});
    await db.project.update({ where: { id: projUms.id }, data: { contractValue: { increment: 12000000 }, dueDate: projUms.dueDate ? new Date(projUms.dueDate.getTime() + 5 * DAY) : null } });

    // CR-2026-0002: pending — menunggu persetujuan klien (tampil di Client Portal)
    await db.changeRequest.create({ data: {
      number: "CR-2026-0002", projectId: projUcs.id,
      title: "Tambahan versi bahasa Inggris video corporate",
      description: "PT Nusantara Digital Raya meminta narasi & grafis versi bahasa Inggris untuk pemirsa regional. Menambah voice over EN + 2 hari editing.",
      additionalCost: 18500000, additionalDays: 7,
      status: "pending", requestedBy: "Yusi",
    }});
  }

  // ============ FOLLOW-UP TEMPLATES ============
  await db.followUpTemplate.createMany({ data: [
    { name: "Follow-up 1 - Konfirmasi diterima", brandId: null, channel: "whatsapp", delayDays: 1, body: "Halo {{contact_name}}, saya {{marketing_name}} dari {{brand_name}}. Pesan Bapak/Ibu terkait {{service_name}} sudah kami terima. Apakah ada waktu 15 menit untuk konsultasi singkat minggu ini?", approved: true },
    { name: "Follow-up 2 - Tawarkan konsultasi", brandId: null, channel: "whatsapp", delayDays: 3, body: "Selamat siang {{contact_name}} dari {{company_name}}. Saya {{marketing_name}} dari {{brand_name}}. Apakah Bapak/Ibu berkenan diskusi kebutuhan {{service_name}} via {{meeting_link}}?", approved: true },
    { name: "Follow-up 3 - Kirim portfolio", brandId: null, channel: "email", delayDays: 7, body: "Yth. {{contact_name}},\n\nBersama email ini kami sampaikan portofolio {{brand_name}} yang relevan dengan kebutuhan {{service_name}} di {{company_name}}.\n\nHormat kami,\n{{marketing_name}}", approved: true },
    { name: "Follow-up 4 - Final follow-up", brandId: null, channel: "whatsapp", delayDays: 14, body: "Halo {{contact_name}}, ini follow-up terakhir saya terkait {{service_name}}. Jika saat ini belum sesuai prioritas, boleh saya hubungi kembali {{estimated_timeline}}?", approved: true },
    { name: "Nurture - Re-offer 30 hari", brandId: null, channel: "email", delayDays: 30, body: "Yth. {{contact_name}},\n\nSemoga {{company_name}} sehat selalu. Kami dari {{brand_name}} punya update paket {{service_name}} yang mungkin relevan untuk rencana {{estimated_timeline}}.\n\n{{marketing_name}}", approved: false },
  ]});

  // ============ AUDIT LOGS ============
  const auditSeeds = [
    { actor: "Andri Saputro", role: "director", action: "create", entity: "brand", label: "Unicam Studio", meta: "Konfigurasi brand baru dengan SLA 8 jam" },
    { actor: "Fadel", role: "marketing", action: "convert", entity: "opportunity", label: "Animasi edukasi literasi digital", meta: "Konversi dari lead website form" },
    { actor: "Andri Saputro", role: "director", action: "stage_change", entity: "opportunity", label: "Dokumentasi pabrik + drone", field: "stage", oldValue: "estimation", newValue: "negotiation" },
    { actor: "Sika", role: "finance", action: "create", entity: "invoice", label: "SGT-2025-INV-002", meta: "Termin 2 (40%) - Milestone Development" },
    { actor: "Fadel", role: "marketing", action: "update", entity: "opportunity", label: "Video AI onboarding karyawan", field: "estimatedValue", oldValue: "95000000", newValue: "88000000" },
    { actor: "Fadel", role: "marketing", action: "stage_change", entity: "opportunity", label: "Animasi campaign antikorupsi", field: "lostReason", oldValue: null, newValue: "Memilih kompetitor" },
    { actor: "Yusi", role: "production", action: "create", entity: "change_request", label: "CR-2026-0002 — Tambahan versi bahasa Inggris video corporate", meta: "Change request +Rp 18.500.000, +7 hari — menunggu persetujuan klien" },
  ];
  for (let i = 0; i < auditSeeds.length; i++) {
    const a = auditSeeds[i];
    await db.auditLog.create({ data: {
      actorName: a.actor, actorRole: a.role, action: a.action, entity: a.entity,
      entityId: `seed-${i}`, entityLabel: a.label, field: a.field ?? null,
      oldValue: a.oldValue ?? null, newValue: a.newValue ?? null, metadata: a.meta ?? null,
      ip: "103.45.11." + (10 + i), userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      createdAt: ago(i + 1),
    }});
  }

  const counts = {
    brands: 4, users: 9, companies: companies.length, contacts: contacts.length,
    opportunities: opps.length, projects: wonDefs.length, invoices: invDefs.length + 1,
    changeRequests: 2,
  };
  return { seeded: true, counts };
}
