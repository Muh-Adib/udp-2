# UDP CRM — Dokumentasi Arsitektur & Business Logic

| | |
|---|---|
| **Project** | UDP CRM — Multi-Brand CRM (Unimasi · Segia Tech · Erfo Multimedia · Unicam Studio) |
| **Versi dokumen** | 1.0 |
| **Disusun** | Otomatis dari source code (Task 70) — setiap klaim diverifikasi langsung ke berkas terkait |
| **Cakupan** | Arsitektur aplikasi, model data (34 model Prisma), keamanan & RBAC, seluruh business logic per modul, integrasi eksternal, deployment Docker/Coolify |
| **Basis kode** | Next.js 16.1 App Router · TypeScript strict · Prisma 6.19.2 (pinned) · SQLite · Bun runtime |

> **Cara membaca**: Bab 1–3 memberi gambaran besar; Bab 4–5 detail data & keamanan; Bab 6 adalah inti dokumen (business logic per modul, termasuk rumus KPI, bobot scoring, transisi status, dan efek samping setiap aksi); Bab 7–10 mencakup dokumen PDF, integrasi, notifikasi, dan deployment; Bab 11–12 merekam keputusan arsitektur dan kelemahan yang diketahui; Bab 13 adalah referensi cepat API.

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Tumpuan Teknologi](#2-tumpuan-teknologi)
3. [Arsitektur Sistem](#3-arsitektur-sistem)
4. [Model Data (Prisma)](#4-model-data-prisma)
5. [Keamanan, Autentikasi & Otorisasi](#5-keamanan-autentikasi--otorisasi)
6. [Business Logic per Modul](#6-business-logic-per-modul)
7. [Generator Dokumen PDF & Kop Surat](#7-generator-dokumen-pdf--kop-surat)
8. [Kanal Komunikasi & Integrasi Eksternal](#8-kanal-komunikasi--integrasi-eksternal)
9. [Notifikasi, Real-time & Web Push](#9-notifikasi-real-time--web-push)
10. [Deployment & Infrastruktur](#10-deployment--infrastruktur)
11. [Keputusan Arsitektur & Trade-off](#11-keputusan-arsitektur--trade-off)
12. [Kelemahan yang Diketahui & Rekomendasi](#12-kelemahan-yang-diketahui--rekomendasi)
13. [Referensi API](#13-referensi-api)
14. [Lampiran](#14-lampiran)

---

## 1. Ringkasan Eksekutif

UDP CRM adalah aplikasi **Customer Relationship Management multi-brand** untuk satu grup perusahaan yang menjalankan empat brand jasa kreatif-teknologi: **Unimasi** (animasi/video), **Segia Tech** (website/teknologi), **Erfo Multimedia** (immersive/event), dan **Unicam Studio** (produksi visual). Satu aplikasi, satu database — data dipisahkan secara logis lewat relasi `brandId`, bukan instans terpisah.

Aplikasi mencakup **siklus bisnis end-to-end**:

```
Lead masuk (Inbox multi-kanal / form intake publik / import CSV)
   → Identifikasi & dedupe (identity matching berbobot)
   → Pipeline 12 stage (kanban drag-and-drop + lead scoring 0–100)
   → Brief klien (ClientBrief, workflow approval)
   → Estimasi RAB (cost breakdown kategori → margin → approval Direktur)
   → Quotation (penawaran bernomor, secure link + e-sign klien)
   → WON (otomatis: Project + Milestones + Invoice DP 50% + Portal klien)
   → Produksi (milestone, task, deliverable, change request)
   → Invoice & Pembayaran (aging, TOP/termin, revisi faktur)
   → Client Portal (klien memantau tanpa login)
   → Audit trail penuh ("siapa mengubah apa, kapan, dari IP mana")
```

**Karakteristik arsitektural utama:**

1. **Single Page App** — pengguna hanya melihat satu route `/`. Navigasi 13 modul digerakkan state `activeModule` di Zustand, bukan route halaman. Terdapat gerbang publik pada route yang sama: `?portal=<token>`, `?quote=<token>&key=…`, `?intake=<token>`, `?modul=<key>` (deep-link dari push notification).
2. **Keamanan berlapis** — cookie sesi HMAC-SHA256 ditandatangani server, dijaga middleware `src/proxy.ts` untuk semua `/api/*`, ditegakkan lagi di route via `resolveActor()` (user selalu dicek ulang ke DB), plus RBAC dinamis `ModulePermission` (level `none → read → write → full`) dan audit log pada hampir semua mutasi.
3. **Efek samping otomatis yang ter-orkestrasi** — transisi stage Won, tanda tangan quotation, penerimaan PO, dan approval change request memicu pembuatan dokumen/tugas/notifikasi secara otomatis dalam satu transaksi database dengan guard idempoten.
4. **Real-time tanpa layanan berat** — mini-service socket.io terpisah (port 3005) yang polling API notifikasi tiap 15 detik, plus Web Push VAPID via service worker.
5. **Deployment ringan** — Docker multi-stage (base `oven/bun:1`), Next.js standalone, SQLite di volume persisten, provisioning one-shot `docker-migrate.sh`, runtime murni `bun server.js` **tanpa entrypoint shell**.

---

## 2. Tumpuan Teknologi

### 2.1 Dependensi inti

| Package | Versi | Peran |
|---|---|---|
| `next` | ^16.1.1 | Framework App Router; middleware = `src/proxy.ts`; `output: "standalone"` |
| `react` / `react-dom` | ^19 | Runtime UI |
| `prisma` + `@prisma/client` | **6.19.2 (exact, di-pin)** | ORM → SQLite; CLI dipanggil langsung dari `node_modules` di container |
| `zustand` | ^5 | State global (`useCrmStore`: user, brands, activeModule, brandFilter, permissionMatrix) |
| `socket.io-client` | ^4 | Klien realtime ke notif-service |
| `web-push` | ^3.6.7 | Web Push VAPID (server-side) |
| `z-ai-web-dev-sdk` | ^0.0.18 | AI summary opportunity (satu-satunya pemakaian AI) |
| `@dnd-kit/core` | ^6 | Drag-and-drop kanban pipeline |
| `recharts` | ^2.15.4 | Chart dashboard & laporan |
| `sonner` | ^2.0.6 | Toast notification |
| `nodemailer` / `imapflow` | ^9 / ^1.7 | Kirim email SMTP / sinkron inbox IMAP |
| `jspdf` | ^4.2.1 | Generator PDF server-side (quotation, invoice, brief) |
| Radix UI (25+ paket) | terbaru | Primitif komponen shadcn/ui |
| `lucide-react` | ^0.525 | Satu-satunya pustaka ikon |
| `tailwindcss` | 4 | Styling (design token oklch) |
| `node:crypto` | built-in | Hash scrypt password/PIN, HMAC cookie, random token |

### 2.2 Script & konfigurasi

- `bun run dev` — dev server port 3000 (log diarahkan ke `dev.log`)
- `bun run build` — `next build` + menyalin `.next/static` & `public/` ke `.next/standalone/`
- `bun run start` — `NODE_ENV=production bun .next/standalone/server.js`
- `bun run db:push` / `db:generate` / `db:reset` — utilitas Prisma
- `next.config.ts`: `output: "standalone"`, `reactStrictMode: false`
- `tsconfig.json`: strict, alias `@/* → ./src/*`

### 2.3 Konvensi desain yang diwajibkan (dari worklog, mengikat semua kontributor)

- Bahasa UI **Bahasa Indonesia**; font Geist; ikon lucide-react saja.
- **Dilarang warna indigo/blue** sebagai warna utama. Primer zinc-900; warna brand: Unimasi `#ea580c`, Segia `#059669`, Erfo `#e11d48`, Unicam `#7c3aed`. Semantik status: Won = emerald, Lost = red-600, Nurture = slate, Hot = red-600, Warm = amber-500, Cold = cyan-600.
- Kartu `rounded-xl border bg-white shadow-sm`, padding `p-4/p-6`, gap `gap-4/gap-6`; background halaman `bg-zinc-100`.
- List panjang wajib `max-h-96 overflow-y-auto` + scrollbar kustom `.crm-scroll`.
- Responsive mobile-first: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, tabel `overflow-x-auto`.
- Setiap modul = satu file komponen client di `src/components/crm/`; akses data hanya via `api-client` (`@/lib/crm/api-client`) dan store Zustand.

---

## 3. Arsitektur Sistem

### 3.1 Diagram lapisan

```
┌────────────────────────────────────────────────────────────────────────┐
│ BROWSER (PWA: manifest.ts, sw.js service worker, web-push VAPID)       │
│  Satu route halaman:  "/"  (src/app/page.tsx = PortalGate)             │
│   ├─ ?portal=<token>  → ClientTokenPortal  (klien, tanpa login)        │
│   ├─ ?quote=<token>   → QuotationShareView (approval & e-sign publik)  │
│   ├─ ?intake=<token>  → LeadIntakeForm     (form lead publik)          │
│   ├─ ?modul=<key>     → deep-link notifikasi (validasi canAccess)      │
│   └─ default: splash → GET /api/auth/session → AppShell | LoginScreen  │
└───────────────┬────────────────────────────────────────────────────────┘
                │ fetch() via api-client (credentials same-origin)
┌───────────────▼────────────────────────────────────────────────────────┐
│ src/proxy.ts — MIDDLEWARE Next.js 16 (matcher /api/:path*)             │
│  • Seswajikan cookie crm_session (HMAC) untuk route non-allowlist      │
│  • Blokir mutasi saat layar terkunci (cookie crm_lock) → 423           │
│  • Allowlist: auth/*, webhooks/*, bootstrap, health, portal publik,    │
│    public quotation/intake, users (minimal), notifications, notif-prefs│
└───────────────┬────────────────────────────────────────────────────────┘
┌───────────────▼────────────────────────────────────────────────────────┐
│ ROUTE HANDLERS src/app/api/** (~40 grup)                               │
│  auth · bootstrap · brands · users · permissions · dashboard ·         │
│  opportunities (+[id], summary AI, estimation, import) · inbox         │
│  (convert/respond/link/escalate) · identify · contacts (+import/       │
│  merge/duplicates) · companies · interactions (+attachments) · tasks · │
│  projects (+milestones/deliverables/email-link) · briefs · quotations  │
│  (+[id]) · invoices (8 action) · approvals · change-requests ·         │
│  portal (tokens/documents/[token]/review) · public (intake/quotation)  │
│  · channels (+email-sync/demo) · webhooks/whatsapp · push/* ·          │
│  notifications · notif-prefs · pipeline/intake-links · followup-       │
│  templates · taxes · industries · service-map · reports · search ·     │
│  audit-logs · health                                                   │
│                                                                        │
│  Helper lintas-route: resolveActor() · assertRole() · assertModule-    │
│  Level() · logAudit() · ok/fail() · numOrNull/dateOrNull/clampNum ·    │
│  unsafeAttachmentReason() · nextDocumentNumber() · findMatchCandidates │
└───────────────┬────────────────────────────────────────────────────────┘
┌───────────────▼────────────────────────────────────────────────────────┐
│ PRISMA CLIENT 6.19.2 (src/lib/db.ts, singleton)                        │
│  → SQLite: db/custom.db (dev) · /app/data/custom.db (produksi, volume) │
│  34 model — lihat Bab 4                                                │
└────────────────────────────────────────────────────────────────────────┘
     │                                │
     │ sidecar realtime               │ eksternal
┌────▼──────────────────┐   ┌─────────▼──────────────────────────────┐
│ mini-services/        │   │ Meta WhatsApp Cloud API (webhook +     │
│ notif-service         │   │ Graph API verifikasi)                  │
│ socket.io port 3005   │   │ SMTP kirim (nodemailer, per-kanal DB)  │
│ poll /api/notifications│  │ IMAP terima (imapflow, per-kanal DB)   │
│ + /api/notif-prefs    │   │ Web Push service (VAPID)               │
│ tiap 15 dtk → emit    │   │ z-ai-web-dev-sdk (LLM ringkasan deal)  │
│ notif:changed         │   └────────────────────────────────────────┘
└───────────────────────┘
```

### 3.2 Pola Single Page App + PortalGate

`src/app/page.tsx` adalah satu-satunya route halaman dan berperan sebagai **PortalGate**:

1. Memeriksa query string: token portal (`?portal=`), token quotation (`?quote=` + `?key=`/`?password=`), link intake (`?intake=`), atau deep-link modul (`?modul=<key>&id=…` dari push notification — divalidasi lewat `canAccess()` lalu URL dibersihkan).
2. Tanpa token: menampilkan splash "Memeriksa sesi…" → `GET /api/auth/session`.
   - Sesi valid → render `AppShell` (13 modul CRM).
   - Tidak valid → render `LoginScreen`.
3. Navigasi antar modul = state `activeModule` di `useCrmStore` (Zustand, persist key `udp-crm-session` — hanya `user` yang dipersist). Field `pendingFocus {module, id, nonce}` dipakai global search dan notifikasi untuk melompat ke entitas spesifik lintas modul.

**13 modul** (id navigasi): `dashboard, inbox, contacts, pipeline, followups, finance, reports, projects, portal, channels, brands, users, audit`.

### 3.3 Struktur direktori

```
/home/z/my-project
├── src/
│   ├── proxy.ts                    # Middleware Next 16 — gerbang sesi semua /api/*
│   ├── app/
│   │   ├── page.tsx                # PortalGate (satu-satunya route halaman)
│   │   ├── layout.tsx              # Metadata, font Geist, Toaster, viewport PWA
│   │   ├── manifest.ts             # PWA manifest (installable)
│   │   ├── globals.css             # Token tema oklch, .crm-scroll, print CSS A4
│   │   └── api/**                  # ~40 grup route handler (Bab 13)
│   ├── components/
│   │   ├── ui/**                   # Komponen shadcn/ui (button, dialog, table, dst.)
│   │   └── crm/**                  # ~40 file: app-shell, login-screen, 13 *-module.tsx,
│   │                               #   client-token-portal, quotation-share-view,
│   │                               #   lead-intake-form, global-search, notification-center,
│   │                               #   quotation-print, invoice-print, dst.
│   ├── lib/
│   │   ├── db.ts                   # Singleton PrismaClient
│   │   ├── utils.ts                # cn() (clsx + tailwind-merge)
│   │   └── crm/**                  # Inti domain — 30+ modul (lihat 3.4)
│   └── hooks/                      # use-toast, use-mobile
├── prisma/schema.prisma            # 34 model (Bab 4)
├── db/custom.db.seed               # Snapshot DB demo ~1.7 MB (first-boot container)
├── mini-services/notif-service/    # Sidecar socket.io (port 3005, package.json sendiri)
├── scripts/dev-smtp-sink.ts        # SMTP sink dev-only (127.0.0.1:3465) untuk QA
├── public/sw.js                    # Service worker: web push + offline fallback
├── Dockerfile                      # 3 stage (deps → builder → runner)
├── docker-compose.yml              # Service migrate (one-shot) + app
├── docker-migrate.sh               # Provisioning: SESSION_SECRET, seed, prisma db push
├── Caddyfile                       # Gateway sandbox: ?XTransformPort=<n> → localhost:<n>
└── worklog.md                      # Log tugas lintas agen (sumber riwayat pengembangan)
```

### 3.4 Modul `src/lib/crm/` — inti domain

| Berkas | Isi |
|---|---|
| `session.ts` | Token cookie sesi & lock (HMAC-SHA256, Web Crypto edge-safe), fail-closed `SESSION_SECRET` |
| `auth.ts` | `resolveActor()`, `assertRole()`, hash scrypt, rate-limit login |
| `permissions.ts` | RBAC dinamis: level, `DEFAULT_MATRIX`, cache 30 dtk, `assertModuleLevel()` |
| `server.ts` | Helper respons, sanitasi angka/tanggal, blocklist lampiran, `logAudit()`, `resolveContractValue()`, **`handleWonTransition()`**, `findMatchCandidates()` |
| `constants.ts` | 12 PIPELINE_STAGES, LOST_REASONS, NURTURE_SEGMENTS, CHANNELS, LEAD_SOURCES, ROLES, BRAND_SERVICES, SERVICE_CATEGORIES, PRIORITIES, TEMPERATURES, template workflow produksi, saran industri |
| `numbering.ts` + `numbering-core.ts` | Penomoran dokumen per brand (template token, counter, reset) |
| `scoring.ts` | `computeLeadScore()` 0–100 berbasis aturan |
| `sla-sweep.ts` | Sweep eskalasi otomatis lead melewati SLA |
| `thread.ts` | Threading pesan lintas kanal, inferensi brand, alamat balasan |
| `brief.ts` | Kelengkapan brief (9 bagian), meta status |
| `payment-terms.ts` | TOP terstruktur: preset, parsing, `describeDueEn`, format Unicam |
| `terbilang.ts` | Amount-in-words ID & EN |
| `doc-pdf.ts` | Generator PDF server-side: quotation, invoice, brief (kop surat brand) |
| `doc-send.ts` | Kirim dokumen via email + catat interaction + audit |
| `email-delivery.ts` | SMTP keluar sadar-brand, status jujur (sent/failed/simulated) |
| `email-sync.ts` | IMAP masuk → Interaction (dedupe Message-ID, auto-link) |
| `channels.ts` + `channel-verify.ts` | Katalog kredensial kanal, wizard, verifikasi nyata SMTP/IMAP/Graph API |
| `validate.ts`, `task-parse.ts` | Validasi email/telepon; parsing assignee & lampiran task |
| `notif-prefs.ts`, `push.ts`, `notif-socket.ts` | Preferensi notifikasi, Web Push, klien socket |
| `utils.ts` | Normalisasi phone/email/domain, `nameSimilarity` (Jaccard), format mata uang/tanggal |
| `countries.ts` | Negara (ISO 3166 + E.164 dial + ISO 4217 currency) |
| `types.ts` | ~60 DTO TypeScript (1206 baris) |
| `api-client.ts` | Klien HTTP terpusat (665 baris); 423 → event `crm:locked` |
| `store.ts` | Zustand global + helper RBAC (`canAccess/canWrite/canFull`) |
| `seed.ts` | Seed demo lengkap (4 brand, 9 user, 10 company, dst.) |

---

## 4. Model Data (Prisma)

`prisma/schema.prisma` (912 baris) mendefinisikan **34 model** di atas **SQLite**. Tidak ada blok `enum` Prisma — semua enumerasi adalah `String` yang divalidasi lewat konstanta TypeScript (`src/lib/crm/constants.ts`) dan allowlist di route handler. Field kompleks (items, terms, palette, kredensial) disimpan sebagai `String` berisi JSON.

### 4.1 Peta kelompok domain

**A. Organisasi & tenant**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `Brand` | Tenant multi-brand: identitas, kop surat, prefix dokumen, SLA | `slug` (unik), `color`, `primaryCurrency` (default IDR), `invoicePrefix`, `quotePrefix`, `slaHours` (default 4), `shortCode` (untuk token `{BRAND}` penomoran), `npwp`, `bankAccounts` (JSON, maks 6), `letterheadHeader/Footer` (gambar data URL ≤1.6 MB), `docAssets` (header/footer per jenis dokumen), `signerName/Closing`, `palette` |
| `User` | Pengguna internal & klien | `email` (unik), `role` (8 role), `password` (scrypt; null = legacy PIN), `pin` (scrypt, untuk buka kunci layar), `active`, `brandAccess` ("all" atau daftar slug) |
| `NumberingRule` | Counter penomoran per brand per jenis dokumen | `docType` (quotation\|invoice), `template` (default `{SEQ:3}/{DOC}-{BRAND}/{ROMAN}/{YY}`), `docCode`, `resetPeriod` (never\|yearly\|monthly), `seq`; unik `brandId+docType` |
| `LeadIntakeLink` | Link form lead publik `/?intake=<token>` | `token` (unik, 48 hex), `label`, `active`, `submissionCount`, `expiresAt` |
| `Tax` | Master pajak (auto-seed PPN 11, PPh21 5, PPh23 2) | `name`, `rate`, `active` |
| `ModulePermission` | RBAC dinamis | `role`, `module`, `level` (none\|read\|write\|full); unik `role+module` |

**B. Identitas klien**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `Company` | Perusahaan klien (company-centric) | `name`, `industry`, `website` + `websiteDomain` (ternormalisasi untuk matching), `country/city/address`, `size`, `taxId`, `defaultCurrency`, `lifetimeValue`, `tags`, `deletedAt` (soft delete) |
| `Contact` | Individu klien | `firstName/lastName/fullName`, `position`, `email` (lowercase), `whatsapp` (E.164), `currency` (ISO 4217, dari negara), `language`, `preferredChannel`, sosial media (instagram/facebook/tiktok/linkedin/socialProfile), `consentStatus`, `tags`, `companyId?`, `deletedAt` |

**C. Sales & komunikasi**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `Opportunity` | **Entitas inti pipeline** | `title`, `serviceCategory/Name`, `leadSource`, `brief`, `estimatedValue`, `currency`, `probability` (default 20), `stage` (12 nilai), `temperature`, `priority`, `ownerName`, `expectedCloseDate`, `targetDeadline`, `nextAction/Date`, `lostReason/Notes`, `nurtureSegment`, `followUpDate`, `lastOfferValue`, `reactivation`, `crossSellOfId`, `deletedAt`; relasi ke Brand (wajib), Contact (wajib), Company (opsional) |
| `Interaction` | Pesan/aktivitas lintas kanal (inbox + timeline) | `channel` (whatsapp/email/instagram/website/phone/meeting/portal), `direction` (inbound/outbound), `externalId` (Message-ID untuk dedupe), `senderName/recipientName`, `subject`, `content`, `attachments` (JSON data URL), `respondedBy/At` (penanda SLA terpenuhi), `deliveryStatus/Note`, `archivedAt` (soft delete = tab Arsip) |
| `Task` | Follow-up & tugas produksi | `type` (follow_up/meeting/production/revision/admin), `priority`, `status` (open/done/cancelled), `assignees` (JSON multi-tag, maks 10) + `assigneeName` (=assignees[0]), `attachments` (maks 5, file ≤5 MB), `dueDate`, `completedAt`; relasi Opportunity?/Project? (Cascade)/Milestone? (SetNull) |
| `Note` | Catatan internal / feedback direktur | `body`, `authorName`, `type` (internal\|director_feedback) |

**D. Keuangan**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `Invoice` | Faktur/termin gaya Unicam | `number` (unik), `amount`, `taxName` (null = tanpa pajak), `taxRate` (11), `taxMode` (add\|withhold\|grossup), `taxAmount`, `downPaymentPct`, `discountAmount`, `total`, `status` (draft/sent/partial/paid/overdue/cancelled), `items` (JSON), `terms` (jadwal TOP JSON), `purchaseNumber` (pemicu auto-Won), `projectName`, `attn`, `clientAddress`, `baseNumber/seqNo/revisionNo/revisionReason`, `revisionOfId` (self-relasi revisi), `issueDate`, `dueDate` |
| `Payment` | Pembayaran diterima | `amount`, `method` (transfer/cash/qris/credit_card), `reference`, `paidAt` → Invoice |

**E. Produksi**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `Project` | Produksi pasca-deal (1-1 dengan Opportunity) | `code` (unik, `{PREFIX}-{YYYY}-{NNN}`), `serviceCategory`, `status` (planning/in_progress/review/completed/cancelled), `progress`, `pmName`, `poNumber`, `startDate`, `dueDate`, `budgetInternal`, `contractValue` |
| `Milestone` | Tahap timeline produksi | `name`, `order`, `status` (pending/in_progress/done), `dueDate`, `achievement`, `picName`, `durationDays`, `parallel` → Project (Cascade) |
| `ProjectDeliverable` | File/tautan untuk review klien | `name`, `kind` (link\|file), `url`, `fileName/fileData` (data URL ≤1.2 MB), `status` (pending/approved/revision), `reviewComment/By/Role/At`, `createdBy` |
| `ChangeRequest` | Permintaan perubahan scope | `number` (unik `CR-YYYY-####`), `title/description`, `additionalCost`, `additionalDays`, `status` (pending/approved/rejected/cancelled), `requestedBy`, `decidedBy/At`, `decisionNote`, `invoiceId?` |

**F. Komersial & governance**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `ClientBrief` | Brief terstruktur per opportunity (1-1) | `code` (unik `BRF-YYYY-####`), `serviceTypes`, `objectives`, `targetAudience`, `keyMessages`, `keywords`, `deliverables` (JSON), `timelineStart/End`, `budgetMin/Max`, `references`, `status` (draft/in_review/approved/revision), `revisionNote`, `submittedAt`, `approvedAt/By`; juga 1-1 dengan Project setelah Won |
| `Estimation` | RAB per opportunity (1-1) | 9 kolom biaya legacy + `costCategories` (RAB bertingkat: maks 30 kategori × 50 item), `currency`, `fxRate/fxSource`, `contingencyPct` (5), `managementFeePct` (5), `discountPct`, `taxPct` (11), `targetMarginPct` (30), hasil kalkulasi (`totalCost…grandTotal, margin, marginPct`), `revenue` (nullable), `status` (draft/pending_approval/approved/rejected) |
| `Quotation` | Surat penawaran gaya Unicam | `number` (unik), `items`, `subtotal`, `discountPct/Amount`, `taxPct/taxName/taxAmount`, `total`, `status` (draft/sent/accepted/rejected/expired), e-sign (`signedAt/ByName/Title`, `signatureImage` ≤600 KB), field surat (`attachment/regarding/attn/clientAddress/letterBody/letterClosing/timeline/revisionNotes/termOfPayment`), `terms` (TOP JSON), `validUntil`, `revisionOfId/No`, `sentAt/respondedAt` |
| `QuotationShareToken` | Link aman tanda tangan klien | `token` (unik), `keySha` (SHA-256 magic key — asli tidak disimpan), `passwordSha`, `maxOpens` (3), `opens`, `revoked` |
| `ApprovalRequest` | Persetujuan estimasi/diskon/budget | `entityType`, `entityId/Label`, `amount`, `discountPct`, `status` (pending/approved/rejected), `decidedBy/At` |
| `FollowUpTemplate` | Template pesan follow-up | `name`, `channel` (whatsapp/instagram/email), `delayDays` (0–30), `body` (placeholder `{{contact_name}}` dll.), `version` (naik saat body berubah), `approved` |
| `AuditLog` | Jejak audit | `actorName/Role`, `action` (create/update/delete/stage_change/merge/login/convert/email_document/email_sync/sla_auto_escalation/quotation_sign/review/…), `entity/Id/Label`, `field`, `oldValue/newValue`, `metadata`, `ip`, `userAgent` |

**G. Notifikasi, portal, katalog, kanal**

| Model | Peran bisnis | Field kunci |
|---|---|---|
| `NotificationState` | State baca/dismiss per user (isi notifikasi dikomputasi) | unik `userKey+notifKey`, `readAt`, `dismissedAt` |
| `PushSubscription` | Langganan Web Push | `endpoint` (unik), `p256dh`, `auth`, `userAgent`, `userKey` |
| `UserPreference` | KV preferensi lintas perangkat | unik `userKey+key` (mis. `notif-prefs`) |
| `ClientPortalToken` | Secure link portal klien | `token` (unik 48 hex), `active`, `accessCount`, `lastAccessedAt`, `expiresAt` → Company (Cascade) |
| `ClientDocument` | MoU / notulen rapat / dokumen | `kind` (mou/meeting_note/document), `title`, `content/url`, `fileName/fileData` (≤1.2 MB), `meetingAt`, `attendees` |
| `ServiceCategory` / `Service` / `WorkflowStage` | Katalog layanan + RAB + workflow produksi per brand | Service: `unit`, `basePrice`, `costCategories`, `targetMarginPct`; WorkflowStage: `phase`, `isMilestone`, `order` |
| `ChannelConfig` | Koneksi kanal komunikasi | `channel` (whatsapp/instagram/threads/email), `accountRef`, `credentials` (JSON, dimasking API), `status` (connected/disconnected/error), `isDemo`, `lastEmailSyncAt` |

### 4.2 Diagram relasi (tekstual)

```
Brand 1──N Opportunity N──1 Contact N──1 Company
  │  │  │  │  │                │              │
  │  │  │  │  └ 1:1 Estimation │              ├── 1:N Contact
  │  │  │  └──── N Quotation   │              ├── 1:N Project
  │  │  └─────── N Invoice     └─ 1:1 Brief   ├── 1:N Invoice
  │  └────────── N Project                    ├── 1:N Quotation
  │              N ClientBrief                ├── 1:N ClientPortalToken (Cascade)
  ├─ 1:N Interaction (brandId?)               └── 1:N ClientDocument (Cascade)
  ├─ 1:N ChannelConfig (brandId nullable)
  ├─ 1:N ServiceCategory 1──N Service 1──N WorkflowStage
  ├─ 1:N NumberingRule (unik brand+docType, Cascade)
  └─ 1:N LeadIntakeLink

Opportunity 1──N Interaction / Task / Note / Quotation / Invoice / ApprovalRequest
Project 1──N Milestone 1──N ProjectDeliverable (milestoneId SetNull)
  ├─ 1:N Task (projectId Cascade)
  ├─ 1:N ChangeRequest ──1:1── Invoice (changeRequestId unik)
  └─ 1:1 ClientBrief (projectId unik)
Invoice 1──N Payment        Quotation 1──N QuotationShareToken (Cascade)
Invoice self-rel revisi (revisionOfId, SetNull) · Quotation self-rel revisi
NotificationState / PushSubscription / UserPreference → keyed by userKey (email)
User → direferensikan by name/email/role (Task.assignees, ModulePermission.role, AuditLog.actorName)
```

### 4.3 Narasi domain (bagaimana data mengalir)

1. **Identitas** — `Company` menampung banyak `Contact`. Pencocokan duplikat memakai `websiteDomain`, email/WhatsApp ternormalisasi (`utils.ts`), dan `nameSimilarity` (Jaccard token dengan stopword "pt/cv/tb/persero/the/…").
2. **Lead masuk** — lewat `Interaction` inbound (tanpa `opportunityId` = lead mentah di Lead Inbox) atau form intake publik (`LeadIntakeLink` → auto-create/dedupe Company+Contact+Opportunity+draft ClientBrief dalam satu transaksi).
3. **Pipeline** — Opportunity bergerak di 12 stage; owner = user sesi; SLA per brand (`Brand.slaHours`); Lost wajib alasan; Nurture wajib segmen.
4. **Komersial** — ClientBrief (draft→in_review→approved) → Estimation (RAB; submit → ApprovalRequest) → approval Direktur → quotation otomatis → quotation sent → accepted (atau e-sign via secure link) → convert ke Invoice (TOP diwarisi) → **Won** → Project.
5. **Won** — `handleWonTransition()` membuat Project + Milestones + draft Invoice DP 50% + portal token klien, semuanya dalam satu transaksi idempoten.
6. **Produksi** — Milestone done → progress project dihitung ulang (100% → status `review`); deliverable dikirim & direview (internal atau klien via portal); ChangeRequest disetujui → `contractValue` naik, deadline geser, invoice tambahan otomatis.
7. **Keuangan** — Invoice draft → sent (PDF via email) → partial → paid/overdue (sweep otomatis saat GET); status riil = hasil agregasi pembayaran.
8. **Governance** — setiap aksi penting → `AuditLog`; akses dikontrol `ModulePermission`; notifikasi dikomputasi on-the-fly dengan state baca di `NotificationState` + Web Push.

### 4.4 Enumerasi & konstanta bisnis (sumber kebenaran: `constants.ts`)

**12 Pipeline Stage** (`OPEN_STAGES` = 9 pertama):

| # | Key | Label | Arti / syarat | Warna |
|---|---|---|---|---|
| 1 | `new` | New | Lead baru; owner otomatis dari sesi; SLA follow-up ≤ SLA brand | zinc |
| 2 | `contact_attempted` | Contact Attempted | Interaksi outbound pertama tercatat | stone |
| 3 | `connected` | Connected | Kontak membalas / percakapan dua arah | amber-600 |
| 4 | `qualified` | Qualified | Kebutuhan jelas + brand & kontak valid + estimasi nilai awal | orange |
| 5 | `discovery` | Discovery | Brief klien dibuat & kebutuhan detail terkumpul | amber-500 |
| 6 | `estimation` | Estimation | Estimasi cost breakdown diajukan (pending_approval) — wajib peran finance | teal |
| 7 | `proposal_sent` | Proposal Sent | Quotation berstatus `sent` (sentAt terisi) | violet |
| 8 | `negotiation` | Negotiation | Estimasi disetujui Direktur / nego harga & diskon | purple |
| 9 | `verbal_agreement` | Verbal Agreement | Quotation diterima klien (accepted) | green-600 |
| 10 | `won` | Won | Kontrak + invoice DP + project otomatis | green-700 |
| 11 | `lost` | Lost | Alasan kalah WAJIB dipilih | red-600 |
| 12 | `nurture` | Nurture | Segmen nurture + tanggal follow-up wajib | slate |

**Konstanta lain:**

- **LOST_REASONS (12)**: Harga terlalu tinggi · Tidak ada budget · Memilih kompetitor · Timeline tidak sesuai · Kebutuhan berubah · Tidak mendapat respons · Scope tidak cocok · Ditunda internal klien · Kontak tidak valid · Duplikat · Tidak sesuai target pasar · Alasan lainnya.
- **NURTURE_SEGMENTS (6)**: `reoffer_30, reoffer_90, budget_season, cross_sell, smaller_package, alternative_service`.
- **CHANNELS (7)**: whatsapp, email, instagram, website, phone, meeting, portal.
- **LEAD_SOURCES (8)**: instagram, whatsapp, email, website, referral, event, cold_outreach, linkedin.
- **ROLES (8)**: `super_admin` (penuh), `director` (semua dashboard, revenue forecast, approval), `manager` (pantauan tim & SLA, tanpa keuangan), `hr` (user & beban kerja, tugas internal), `marketing` (inbox, contact, opportunity, komunikasi, follow-up, proposal), `finance` (estimasi, budget, quotation, pajak, invoice, pembayaran, profitability), `production` (brief, scope, resource planning, timeline, milestone, task, deliverable), `client` (hanya data miliknya).
- **SERVICE_CATEGORIES (5)**: animation, website, video, immersive, digital_marketing.
- **PRIORITIES (4)**: low, medium, high, urgent. **TEMPERATURES (3)**: hot, warm, cold.
- **Template workflow produksi** (`workflowFor(category)`): website = Discovery → Sitemap & Wireframe → UI/UX Design → Development → QA & Testing → Launch; video = Pre-Production → Shooting → Editing → Revision → Final Delivery; animation = Script → Storyboard → Asset Production → Animation → Sound Design → Revision → Final Render; immersive = Survey Lokasi → Technical Plan → Production → Setup & Install → Event/Go-Live → Archive.
- **DUE_EVENTS (TOP, 5)**: `invoice` (setelah invoice terbit), `down_payment` (setelah DP diterima), `bastp` (setelah BASTP ditandatangani — serah terima), `handover`, `delivery`.
- **TASK_TYPES (5)**: follow_up, meeting (pengingat 1 jam sebelum), production, revision, admin.

---

## 5. Keamanan, Autentikasi & Otorisasi

### 5.1 Sesi & cookie (`src/lib/crm/session.ts`)

| Aspek | Implementasi |
|---|---|
| Cookie sesi | `crm_session` |
| Cookie kunci layar | `crm_lock` |
| Format token | `<payload-b64url>.<hmac-b64url>`; payload JSON `{uid, email, name, role, exp, kind}`; tanda tangan **HMAC-SHA256** (Web Crypto, kompatibel edge runtime) |
| TTL | Sesi 7 hari; lock 12 jam |
| Atribut cookie | `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure` **adaptif** — hanya `Secure` bila `x-forwarded-proto: https` (fix bug 401 massal di balik proxy Coolify/Traefik; cookie Secure via HTTP murni akan ditolak browser → login 200 tapi semua API 401) |
| Verifikasi | Signature konstanta-waktu (`safeEqualStr`) + cek `exp`; `kind:"lock"` tidak pernah dianggap sesi |
| Secret | `SESSION_SECRET` env; **fail-closed di produksi** — kosong = modul throw saat dievaluasi (server menolak menyala). Dev fallback `grupcrm-dev-secret-ganti-di-produksi`. Produksi: env platform → file `/app/data/.session-secret` (dibaca via `bun --env-file`) |

### 5.2 Login (`POST /api/auth/login`)

- **Kredensial = email + password** (PIN bukan lagi kredensial login sejak Ronde 46). Akun demo: password `udp1234`; PIN `1234` hanya untuk lock/unlock.
- Rate limit in-memory: **8 percobaan/15 menit per IP+email** + **10/15 menit global per email**; reset saat sukses; semua percobaan di-audit (`login` / `login_failed`).
- Pesan error **diseragamkan** ("Email atau password salah") — anti email-enumeration.
- Password/PIN di-hash **scrypt+salt** (`scrypt$salt$hash`, verifikasi timing-safe). Akun legacy dengan PIN plaintext: bisa login via PIN sekali, lalu PIN otomatis di-migrasi ke scrypt; UI memunculkan peringatan "akun belum punya password".
- Role `client` → `companyName` di-resolve dari Contact dengan email sama.
- Sukses → set cookie `crm_session`; respons `{user, legacyPin}`.

### 5.3 Introspeksi, logout, lock/unlock

- `GET /api/auth/session` — validasi cookie → **user diambil ulang dari DB** (perubahan role/deaktivasi langsung berlaku) + flag `locked`.
- `POST /api/auth/session` — logout: hapus kedua cookie.
- `POST /api/auth/lock` — set cookie `crm_lock` (kind="lock", TTL 12 jam) **+ refresh sesi** agar tidak mati saat terkunci lama. Audit `session_lock`.
- `POST /api/auth/unlock` — PIN diverifikasi ke hash scrypt DB; rate limit terpisah (`unlock:<ip>:<uid>` 8/15 menit); audit sukses/gagal.

### 5.4 Middleware `src/proxy.ts` (Next.js 16 proxy)

Matcher `/api/:path*`. Aturan:

1. **Lock check lebih dulu** — mutasi (metode selain GET/HEAD/OPTIONS) dari sesi yang punya cookie `crm_lock` valid → **423 Locked**. Pengecualian: `/api/push/subscribe|unsubscribe`.
2. **Allowlist mutasi tanpa sesi**: `/api/auth/*`, `/api/webhooks/*` (HMAC diverifikasi di route), `/api/bootstrap`, `POST /api/portal/<token>/review`, `POST /api/public/quotation/<token>`, `POST /api/public/intake/<token>` (rate limit 10/5 menit di route).
3. **Allowlist GET tanpa sesi**: `/api/auth/*`, `/api/webhooks/*`, `/api/bootstrap`, `/api/health`, `/api/users` (chip persona login, field minimal — kompromi terdokumentasi), `/api/notifications` + `/api/notif-prefs` (dipoll notif-service tanpa cookie), `GET /api/portal/<token>` (1 segmen), public quotation & intake.
4. **Sisanya** → tanpa sesi valid: **401** `{"error":"Sesi tidak valid atau berakhir — silakan masuk kembali"}`.

### 5.5 Aktor & gerbang peran server

- `resolveActor(req, body)` (`auth.ts`) — sesi = sumber kebenaran; user dicek ulang ke DB (harus `active`); `actorName` di body **tidak dipercaya** (sejak Ronde 27); fallback body hanya untuk endpoint portal publik eksplisit.
- `assertRole(actor, allowed)` — gerbang role statis; role `null` (system/webhook) hanya lolos bila `"system"` ada di daftar.
- `assertModuleLevel(module, minLevel)` — gerbang RBAC dinamis dari tabel `ModulePermission`.

### 5.6 Matriks RBAC (sumber: tabel `ModulePermission`; seed default di `permissions.ts`)

Level bertingkat: **none → read → write → full**. Cache server 30 detik, di-invalidasi setelah PUT. Diedit via UI "User & Access" oleh super_admin/director (PUT `/api/permissions` dijaga dua lapis: `assertRole` + `assertModuleLevel("users","full")`).

| Modul | super_admin | director | manager | hr | marketing | finance | production | client |
|---|---|---|---|---|---|---|---|---|
| dashboard | full | full | write | read | read | read | read | read |
| inbox | full | full | write | — | write | — | — | — |
| contacts | full | full | write | — | write | read | — | — |
| pipeline | full | full | write | — | write | read | — | — |
| followups | full | full | write | write | write | — | write | — |
| finance | full | full | — | — | — | full | — | — |
| reports | full | full | write | — | read | read | — | — |
| projects | full | full | write | — | write | — | write | — |
| portal | full | full | — | — | — | — | — | read |
| channels | full | full | — | — | — | — | — | — |
| brands | full | full | — | — | — | — | — | — |
| users | full | full | — | read | — | — | — | — |
| audit | full | full | — | — | — | — | — | — |

(— = tidak ada entri = none/tersembunyi.) Penegakan di UI: `moduleLevel()`, `canAccess()` (nav/search/guard shell), `canWrite()`, `canFull()` (menyembunyikan tombol tulis/kritis).

Aturan otorisasi penting di level route:

- **Opportunity**: edit hanya pemilik (`ownerName === actor.name`) atau pimpinan; ganti owner/brand/kontak hanya pimpinan; hapus (soft delete) hanya pimpinan.
- **Finance**: `add_payment`, kirim/batalkan/ubah/revisi invoice → role `super_admin|director|finance` **dan** modul finance level `write`; `delete_payment` butuh level `full`.
- **Approvals & Change Request (approve/reject)** → hanya `director|super_admin`.
- **Users, Brands, Channels, Permissions** → hanya `super_admin|director`.
- **Audit logs** → hanya `super_admin|director`.
- **Task/deliverable delete** → pembuat atau manajemen.

### 5.7 Audit trail

Hampir semua mutasi memanggil `logAudit()` → tabel `AuditLog`: `actorName, actorRole, action, entity, entityId, entityLabel, field, oldValue→newValue, metadata, ip (x-forwarded-for), userAgent`. Pola khusus: perubahan per-field dicatat satu per satu; transisi stage memakai action `stage_change`; aktor sistem memakai nama khusus ("SLA Bot", "Formulir Intake (publik)", "Sistem (Auto-unify)", "WhatsApp Cloud API") dengan role `system`.

---

## 6. Business Logic per Modul

### 6.1 Command Center / Dashboard (`GET /api/dashboard`)

Dashboard menghitung semua KPI on-the-fly (tanpa tabel agregat). Data sumber dibatasi (opportunities 2000, interactions 500 terbaru, tasks/invoices/projects 2000). Dipoll UI tiap 60 detik; setiap request memicu `runSlaSweep()` (throttle 5 menit).

**KPI utama (rumus eksplisit):**

| KPI | Rumus |
|---|---|
| `totalLeads` | Semua opportunity non-deleted |
| `openLeads` | Stage ∈ 9 OPEN_STAGES |
| `pipelineValue` | Σ `estimatedValue` untuk open deals |
| `weightedPipeline` | Σ (`estimatedValue × probability / 100`) untuk open deals |
| `winRate` | `round(100 × won / (won + lost))`; 0 bila tidak ada |
| `wonValue` | Σ `estimatedValue` stage `won` |
| `avgResponseHours` | Per opportunity: pasangkan tiap **inbound** dengan **outbound berikutnya yang punya `respondedBy`**; hanya pasangan dengan durasi **< 72 jam** yang dihitung; rata-rata 1 desimal |
| `overdueTasks` | Task `open` dengan `dueDate < now` |
| `unassignedLeads` | Opportunity `stage="new"` tanpa `ownerName` |
| `outstandingInvoices` | Σ (`total − Σ payments`) untuk status {sent, partial, overdue} |
| `slaBreaches` | Lead inbound belum direspons & belum terkonversi dengan usia > `brand.slaHours` |

**Breakdown:** `funnel` (per 12 stage: count + value), `byBrand` (leads/won/value open), `byChannel` (group `leadSource`), `byCountry` (company.country → contact → "Tidak diketahui"), `forecast` 3 bucket berbobot 0-30/31-60/61-90 hari berdasar `expectedCloseDate` (deal overdue masuk bucket pertama), `lostReasons` (count per alasan), `marketingPerf` (per owner: leads/won/avgResponse), `pipelineTrend` 6 minggu (`created` = createdAt; `won-date` resmi sistem = `updatedAt`), `projectsAtRisk` (dueDate < +7 hari, belum completed), `productionCapacity` (project planning/in_progress), `pendingChangeRequests`, `pendingApprovals`, `recentAudit` (8 terakhir).

**Role View (data scoping per peran, dari sesi):**

- `mine` (marketing/manager/dll.) — milik `ownerName === user`: openLeads, pipelineValue, won, task (mendukung multi-assignee JSON), topDeals (5), myTasks, funnel personal.
- `finance` — invoice live (bukan draft/cancelled): outstanding, overdueCount, collected/billed bulan ini, byStatus, overdueList (5), outstanding per brand.
- `production` — project aktif, atRisk, inReview, pendingCRs, deliverablesPending, milestonesDueSoon (≤7 hari), queue 6 terdekat.
- `team` (hr/manager) — totalUsers/activeUsers, usersByRole, task agregat tim.

> Catatan desain: KPI global tidak terfilter brand; pemisahan data per peran hanya terjadi di lapisan roleView. Parameter `brandId` tidak ada di endpoint ini.

### 6.2 Lead Inbox & SLA (`GET /api/inbox`, convert/respond/link/escalate)

**GET /api/inbox** — lead = Interaction `inbound`. Param: `channel`, `brandId`, `view` (`open` default = belum dikonversi | `all` | `archived`), `contactId` (fokus follow-up), `sweep=1`.

- Enrichment per lead: **`slaHours`** = jam tunggu sejak masuk (dibandingkan UI dengan `brand.slaHours`); **`candidates`** = kandidat identitas (`findMatchCandidates`, difilter skor ≥ 40, pool 500 kontak dimuat sekali per request); **thread** = riwayat 2 arah 120 hari terakhir per `threadKey` (`c:<contactId>` / `e:<email>` / `w:<9 digit terakhir>` / `s:<handle>` / `n:<nama>` / `raw:<id>`), maks 60 pesan; `replyChannels` = kanal yang benar-benar punya alamat tujuan.
- Efek samping bila `sweep=1`:
  1. **SLA sweep** (lihat 6.3) — eskalasi otomatis.
  2. **Auto-unify** — lead tanpa contactId dengan kandidat terbaik **skor ≥ 80** → otomatis tertaut ke contact + audit aktor "Sistem (Auto-unify)".
  3. **Inferensi brand** — `brandId` kosong diisi dari `ChannelConfig.accountRef` yang cocok dengan penerima/pengirim (kanal sama lebih dulu; kanal disconnected diabaikan).
  4. **Sync IMAP di latar belakang** via `after()` (throttle 30 detik) — respons tetap cepat.

**POST /api/inbox/convert** — konversi lead → contact (+company) + opportunity, **transaksi atomik** dengan cek-ulang di dalam transaksi (anti race dua konversi bersamaan → 404/400/rollback penuh, tidak ada opportunity ganda):

- `action: "link"` → pakai contact existing; `action: "new"` → dedupe contact by WhatsApp **atau** email sama (handle IG disimpan ke sosial media, bukan email); company find-or-create; mata uang: body → contact (turunan negara) → brand → IDR.
- Opportunity hasil: title default `Lead baru dari {channel}`, `leadSource` = kanal lead, `brief` = isi pesan, owner = user sesi, stage `new`.
- Efek samping dalam transaksi: lead di-tautkan (opportunityId+contactId+companyId); **auto task "Follow-up 1" H+24 jam priority high**; **draft ClientBrief** kode `BRF-{tahun}-{seq}` (objectives = isi pesan lead).
- Setelah commit: **thread unify** — semua pesan inbound lain (120 hari) dengan identitas cocok ikut tertaut ke contact+opportunity yang sama (`unifiedCount`); audit `convert`.

**POST /api/inbox/respond** — balas lead (mode `interactionId`) atau mulai chat ke kontak (mode `contactId`). Aturan:

- Hanya inbound yang bisa dibalas; thread terkonversi **tetap boleh** dibalas (balasan ikut tertaut opportunity → muncul di Timeline pipeline).
- Kanal balasan hanya `whatsapp|email|instagram|phone` dan hanya bila `reachableAddress` tersedia (email→contact.email, WA→nomor, IG→handle, phone→telepon); kanal asal lead diutamakan.
- Lampiran maks 3/pesan, data URL, ≤2 MB/file, MIME/ekstensi berbahaya ditolak.
- **Email dikirim NYATA via SMTP** sadar-brand; status jujur (`sent|failed|simulated` + note). Kanal non-email tercatat di CRM.
- Efek samping: interaction outbound dibuat + lead ditandai `respondedAt` (SLA countdown berhenti, sweep berhenti men-eskalasi) + audit.

**POST /api/inbox/link** — gabung identitas ke contact **tanpa** konversi (lead tetap tampil di "Perlu Tindakan"); best-effort unify pesan se-identitas.

**POST /api/inbox/escalate** — eskalasi manual: task `internal/urgent` "Eskalasi SLA: respons {pengirim}", dueDate +2 jam, assignee default Direktur (bisa dioverride); **dedupe 409** bila lead sudah punya task eskalasi open; task juga di-link ke opportunity aktif milik kontak bila ada.

**DELETE /api/inbox/[id]** — `mode=archive` (default, soft delete, bisa dipulihkan via PATCH) atau `mode=permanent` (hanya untuk pesan yang sudah di Arsip — dua langkah). Guard: hanya inbound; **pesan tertaut opportunity tidak boleh dihapus** (menjaga riwayat chat deal).

### 6.3 Lead Scoring & Identity Matching

**`computeLeadScore(opp, counts)` — rule-based 0–100** (dihitung on-the-fly, tidak disimpan; ditampilkan di kanban/tabel/detail):

| Sinyal | Bobot |
|---|---|
| Basis | **+30** |
| Stage: won / lost | **100 / 0** (terminal) |
| Stage: new → verbal_agreement | 0 / +4 / +8 / +12 / +14 / +16 / +18 / +20 / +25 |
| Temperatur | hot +12, warm +6, cold +0 (**cold tanpa interaksi −4**) |
| Prioritas | urgent +8, high +5, medium +2, low 0 |
| Nilai estimasi | ≥500 jt +12 · ≥200 jt +8 · ≥50 jt +5 · >0 +2 |
| Interaksi | ≥6 +10 · 3–5 +6 · 1–2 +3 · **0 −6** |
| Expected close | terlewat −5 · ≤7 hari +8 · ≤30 hari +5 |
| Aktivitas terakhir | >30 hari **−8** (stagnan) · ≤3 hari +6 · ≤7 hari +3 |
| `nextAction` terisi | +4 |
| Stage `nurture` | **skor di-cap maksimal 40** |

Tier visual: ≥70 Hot (merah), ≥45 Warm (amber), <45 Cold (cyan). Setiap komponen menghasilkan `reasons[]` berbahasa Indonesia.

**`findMatchCandidates(input, pool)` — identity matching** (dipakai: konversi lead, scan duplikat, preview import, form contact):

| Sinyal kecocokan | Bobot | Threshold |
|---|---|---|
| Email sama (ternormalisasi) | **+90** | persis |
| WhatsApp sama (E.164) | **+85** | persis |
| Telepon sama | **+70** | persis |
| Domain perusahaan sama | **+60** | domain email/website persis |
| Nama perusahaan mirip | **+ round(sim × 0.4)** | sim ≥ 60% (Jaccard + stopword) |
| Nama kontak mirip | **+ round(sim × 0.3)** | sim ≥ 70% |

Skor di-cap 99; top 5 kandidat; tiap kandidat membawa `reasons[]`. Konsumen: Inbox tampilkan ≥ 40; auto-unify ≥ 80; scanner duplikat kontak "kuat" ≥ 75; suggest-link import ≥ 85.

**Scanner duplikat kontak (`GET /api/contacts/duplicates`)** — membandingkan semua pasangan kontak aktif (maks 500): email +90, WA +85, telepon +70, sosial media sama +80, domain perusahaan `max(score,60)`, nama mirip (≥80 dengan sinyal lain, ≥95 mandiri). `primaryId` = kontak lebih tua.

### 6.4 SLA Sweep & Eskalasi Otomatis (`sla-sweep.ts`)

- **Dipantau**: Interaction inbound **tanpa opportunity**, belum direspons (`respondedAt: null`), usia > SLA brand + **grace 4 jam**.
- **Pemicu**: `GET /api/dashboard` dan `GET /api/inbox?sweep=1`; **throttle in-memory 1×/5 menit per proses** (tidak ada cron eksternal).
- **Aksi** (maks 10 task per sweep, anti-ledakan backlog): task `internal/urgent` "Eskalasi Otomatis: respons {pengirim}", deskripsi ber-marker **`[lead:<interactionId>]`** untuk dedupe, **assignee = direktur aktif pertama dari DB** (bukan hardcode), dueDate +2 jam. Audit aktor **"SLA Bot"** role `system`, field `sla_auto_escalation`.

### 6.5 Sales Pipeline — Opportunity (GET/POST `/api/opportunities`, GET/PATCH/DELETE `[id]`)

**GET list** — filter `stage/brandId/q/owner`; pencarian `q` pada title/serviceName/nama contact/nama company; include brand+contact(+company)+company+counts; sort `updatedAt desc`; **batas 300**; tiap baris di-enrich `score` + `scoreReasons`.

**POST create** — wajib `title`, `brandId`, `contactId` (→ 400/404); `probability` default 20, stage `new`, temperatur `warm`, prioritas `medium`; mata uang: body → contact → brand → IDR. **Efek samping**: satu transaksi — create + (bila stage `new`) **auto task "Follow-up 1" H+24 jam high**; audit.

**GET detail** — include interaksi (asc), task (dueDate asc), notes, projects(+milestones), invoices(+payments), estimation, quotations, pendingApprovals (take 5), **related opportunities** (same company, take 10, di-enrich skor).

**PATCH — transisi stage (inti pipeline, divalidasi server-side):**

1. **Otorisasi**: edit hanya pemilik atau pimpinan (403); ganti `ownerName`/`brandId`/`contactId` hanya pimpinan; ganti brand → mata uang mengikuti brand baru bila masih default; ganti kontak → companyId ikut.
2. **Allowlist stage** — di luar 12 stage standar → 400 `Stage "x" tidak dikenal — gunakan standar pipeline perusahaan`.
3. **`→ lost`**: `lostReason` **wajib** (400 bila kosong).
4. **`→ nurture`**: `nurtureSegment` **wajib**.
5. **Dari lost/nurture** ke stage lain → `reactivation = true` otomatis.
6. Audit: `stage_change` khusus stage; `update` per-field lainnya (oldValue→newValue).

**Efek samping `stage=won` → `handleWonTransition(id)`** (detail 6.6).

**DELETE** — hanya pimpinan; **soft delete** (`deletedAt`); audit.

### 6.6 Transisi WON — `handleWonTransition()` (inti otomatisasi bisnis)

Dipicu oleh: (a) PATCH opportunity stage=won, (b) e-sign quotation via secure link, (c) pencatatan `purchaseNumber` (PO klien) pada invoice (`maybeWinByPO`). Semua penulisan dalam **satu transaksi** + **guard idempoten** (re-check project dengan `opportunityId` sama di dalam transaksi — menutup race dua konversi Won bersamaan):

1. Nomor invoice DP dibuat **sebelum** transaksi (`nextDocumentNumber` — counter di koneksi lain agar tidak ikut rollback; gagal → fallback di dalam transaksi).
2. **Nilai kontrak — precedence**: ① Quotation `accepted` (total > 0) → ② Estimation `approved` (`grandTotal`) → ③ `estimatedValue` → ④ 0. Sumber nilai dicatat (`valueSource`) untuk deskripsi invoice & audit.
3. **Project baru**: kode `{3 huruf slug brand uppercase}-{tahun}-{counter pad3}` (loop anti-tabrakan); status `planning`; `pmName` = manajer aktif pertama di DB (fallback direktur); `startDate` = now; `dueDate` = targetDeadline ?? +60 hari; `contractValue` dari langkah 2; **`budgetInternal = 62% × contractValue`**.
4. **Milestones otomatis**: bila Estimation punya `costCategories` (RAB bertingkat) → **satu milestone per kategori RAB** (achievement = daftar item ×qty); else → template `workflowFor(serviceCategory)` dengan `achievementFor(name)`. Milestone pertama `in_progress`; dueDate dibagi rata sepanjang span.
5. **Task produksi** yang masih menempel opportunity (tanpa project) dipindah ke project.
6. **ClientBrief** opp ter-link ke project (`projectId`) — produksi membaca brief dari detail project.
7. **Portal token klien auto-create** bila perusahaan belum punya token aktif (48-hex, label "Portal {code}").
8. **Draft Invoice DP 50%** (representasi Unicam): `amount` = nilai kontrak **penuh**, `downPaymentPct = 50`, `taxMode: add`, PPN 11% dari dasar DP, `total = DP + PPN`, status `draft`, jatuh tempo +14 hari, items 1 baris.
9. Setelah transaksi: audit `create` entity project + **Web Push ke role `director, super_admin, manager, production, finance`** (exclude aktor): "Deal Won 🎉" + project code, url `/?modul=projects`.

### 6.7 Workflow Brief → Estimasi → Quotation

#### 6.7.1 ClientBrief (`/api/briefs`)

- 1-1 per opportunity (sudah ada → **409**); kode `BRF-YYYY-####` (retry 5×).
- Transisi status **whitelist**: `draft→in_review`; `revision→[in_review, draft]`; `in_review→[approved, revision]`; `approved→draft`. Transisi ilegal → **422**.
- Aksi: `submit` (draft→in_review; push ke director/super_admin/finance), `approve` (push ke pembuat — "lanjut ke penawaran"), `request_revision` (**`revisionNote` wajib**), `reopen` (approved→draft; kosongkan approval fields).
- `save` ditolak bila status `approved` (422 "buka ulang dulu"); hapus hanya draft.
- **Kelengkapan brief** dihitung 9 bagian (Judul, Layanan, Tujuan, Audiens, Pesan kunci, Deliverables, Timeline, Budget, Referensi) → persentase + daftar yang kurang.
- Setiap transisi men-*bump* `opportunity.updatedAt` (urutan aktivitas pipeline tetap segar).

#### 6.7.2 Estimation / RAB (`GET/PUT /api/opportunities/[id]/estimation`, `GET /api/estimations/suggestions`)

- GET belum ada → **auto-create draft kosong** (`revenue = estimatedValue ?? null`).
- PUT: **status lock** — selain `draft|rejected` → 400 (terkunci setelah diajukan/disetujui).
- **RAB kategori→item** (`costCategories`): maks 30 kategori × 50 item, nama kategori unik case-insensitive, qty/price ≥ 0, **subtotal dihitung ulang server**; bila aktif → 9 kolom biaya legacy dinolkan (anti dobel hitung).
- Pajak: `taxName` null = tanpa pajak (taxPct dipaksa 0); `currency` allowlist 9 kode; `fxRate` hanya untuk non-IDR.
- `submit=true` menuntut `revenue > 0` (400), lalu status → `pending_approval` + **create ApprovalRequest** (amount = grandTotal, note "Margin X% · Cost Y").
- **Rumus kalkulasi (server-side)**:

```
totalCost      = categoriesTotal | itemsTotal | Σ 9 kolom legacy (pilihan pertama yang > 0)
contingency    = round(totalCost × contingencyPct/100)         (default 5%)
managementFee  = round(totalCost × managementFeePct/100)       (default 5%)
costWithFees   = totalCost + contingency + managementFee
netRevenue     = revenue − round(revenue × discountPct/100)
taxAmount      = round(netRevenue × taxPct/100)
grandTotal     = netRevenue + taxAmount
margin         = netRevenue − costWithFees
marginPct      = round(margin/netRevenue × 1000)/10
```

- `revenue > 0` → **`opportunity.estimatedValue = revenue`** (kanban konsisten); audit "Revenue X CUR · Margin Y%".
- **Autocomplete RAB** (`/api/estimations/suggestions`): memindai maks 1000 estimasi → top 100 kategori / 200 item / 60 satuan berdasar frekuensi.

#### 6.7.3 Approval (`GET/PATCH /api/approvals`)

- Keputusan hanya `director|super_admin`; hanya `pending` yang bisa diputuskan.
- **entityType `estimation` + approve** → estimation `approved` + **auto-create quotation dari estimasi** (`autoCreateQuotationFromEstimation`):
  - Idempoten via marker `auto-est:<id>` di `quotation.notes`.
  - Item = **harga per kategori RAB** (rincian item disembunyikan dari klien), **diskalakan proporsional** agar Σ kategori = revenue (pembulatan IDR ke puluhan; kategori terakhir menyerap sisa).
  - discountPct/tax dari estimasi; total = grandTotal estimasi; `validUntil` +14 hari; penomoran via rule brand.
  - **Auto-move pipeline**: opportunity pada 6 stage awal (new…estimation) → **`negotiation`** + audit.
- reject → estimation `rejected`.

#### 6.7.4 Quotation (`/api/quotations`, `[id]`)

**Struktur**: minimal 1 item; `discountPct` clamp 0–100; pajak bebas (`taxName` null = tanpa pajak); total = afterDiscount + taxAmount; field surat gaya Unicam (attachment/regarding/attn/clientAddress/letterBody/letterClosing/timeline/revisionNotes/termOfPayment); `terms` = jadwal TOP terstruktur — bila terisi, `termOfPayment` teks **auto-generate** format EN standar.

**Lifecycle**:

```
draft ──send──► sent ──accept/e-sign──► accepted ──convert_invoice──► Invoice draft
                     └──reject──► rejected   (revisi: POST dengan revisionOfId → sufiks nomor 012-1)
```

- **`send` (email)**: penerima = body.email atau email kontak opp; tanpa penerima → 422; `confirmLegal` wajib → 422 (pengakuan kirim dokumen resmi). Membuat **QuotationShareToken** (magic key, `keySha`=SHA-256, `maxOpens` 3) → build PDF (EN, kop brand) → kirim via SMTP brand dengan secure link. Gagal kirim → **502, tetap draft**. Sukses → `sent` + **opportunity stage `estimation` → `proposal_sent`** + push.
- **`send` non-email** (whatsapp/instagram): langsung `sent` + interaction outbound tercatat.
- **`create_share`**: cabut semua token lama, buat token+magicKey baru, **password opsional** (`passwordSha`), `maxOpens` 3; return magicUrl.
- **`accept`** → opportunity `verbal_agreement`; **`reject`** → sinyal revisi.
- **`convert_invoice`**: hanya `accepted`; **dedupe** invoice by description contains quotation.number + cek-ulang dalam transaksi (double-click aman); invoice `amount=subtotal`, diskon/pajak/total **identik quotation**, **`terms` (TOP) diwarisi penuh**, `dueDate` = now + dueDays termin pertama `dueEvent:"invoice"` (fallback +14 hari); status `draft`.
- Revisi: `revisionOfId` → `revisionNo+1`, nomor `012/QT-UDP/I/26 → 012-1/QT-UDP/I/26`.

**Approval publik + e-sign (`/api/public/quotation/[token]`)** — tanpa login:

- GET: autentikasi = **magic key ATAU password** (SHA-256, timing-safe); kuota buka `opens < maxOpens(3)` (habis → 403 `needsNewCode` → klien klik "Request New Code"); `?pdf=1` mengunduh PDF (tidak menambah counter buka); payload publik: data quotation + brand + company + status tanda tangan.
- POST `sign`: sudah ditandatangani → 409; `name` wajib; `signature` wajib PNG base64 ≤ ~650 KB (422); efek → `accepted` + e-sign tersimpan + **opportunity otomatis `stage:"won"`** (ketentuan: dokumen ditandatangani ⇒ WON) + interaction inbound tercatat + audit `quotation_sign` role client.
- POST `request_new_code`: rate limit 3/jam per quotation (429); email tujuan **divalidasi ke kontak opportunity** (bukan bebas); cabut token lama → kirim magic link baru.

### 6.8 Invoice & Pembayaran (`/api/invoices` — satu endpoint, 8 action)

**GET** — filter status/brand/company; **sweep overdue otomatis** (`sent` + dueDate lewat → `overdue`, idempoten tiap load); include brand+payments+project+company.contacts (3 kontak untuk aksi "Hubungi Klien"). **Aging** (hanya sent/partial/overdue): `remaining = total − paid`; `overdueDays = floor((now − dueDate)/hari)`; bucket `current (≤0) / d30 / d60 / d90+` (count + amount).

**Struktur total faktur (`computeInvoiceTotals`)**:

```
discount      = min(amount, discountAmount)          → afterDiscount = amount − discount
dpAmount      = afterDiscount × downPaymentPct%      (dasar tagihan; 0% = penuh)
taxAmount     = taxName ? dpAmount × taxRate% : 0
taxMode add      → total = dpAmount + taxAmount      (PPN ditambah)
taxMode withhold → total = dpAmount − taxAmount      (PPh dipotong)
taxMode grossup  → pajak ditampilkan "Gross-Up … Less …", Total Payment = dpAmount
```

Item baris: filter baris ber-deskripsi; qty ≥ 0; unitPrice ≥ 0; `total = round(qty × unitPrice)`.

**Action:**

| Action | Aturan bisnis |
|---|---|
| `add_payment` | amount > 0; invoice `cancelled/paid` ditolak; **satu transaksi**: create Payment → recompute Σ → `paid` bila paid ≥ total, `partial` bila > 0; audit. (Catatan: tidak ada validasi amount ≤ sisa — overpay langsung jadi `paid`.) |
| `send_invoice` | hanya `draft`; email wajib; `confirmLegal` wajib; build PDF invoice (EN) → kirim SMTP brand; gagal → **502 tetap draft**; sukses → `sent`, `issueDate=now`, `dueDate` default +14 hari; push director/super_admin/finance; interaction + audit `email_document` |
| `cancel_invoice` | ditolak bila `paid/partial` atau sudah cancelled |
| `update_invoice` | hanya `draft`; recompute total; **`maybeWinByPO`** — bila terhubung opportunity & `purchaseNumber` terisi → opportunity otomatis **`won`** + audit "Otomatis WON — nomor PO klien diterima" + push |
| `delete_payment` | butuh modul finance level **full**; recompute status (bisa kembali ke `overdue` bila dueDate lewat) |
| `create_standalone_invoice` | invoice manual tanpa project; brand+company wajib; penomoran rule brand (retry 3× → 409); currency brand |
| `create_invoice` | dari project/termin; taxRate default 11; ter-link projectId+opportunityId |
| `revise_invoice` | salin semua field dari sumber (yang tak dikirim); nomor revisi via `revisionDocumentNumber` (`004-1/…`); `revisionOfId/No/Reason`; status revisi `draft`; sumber tak berubah |

### 6.9 Payment Terms / TOP (`payment-terms.ts`)

- **`PaymentTerm {label, pct, dueDays, dueEvent}`** — jadwal TOP terstruktur yang **dipakai bersama Quotation & Invoice** (JSON kolom `terms`) agar jatuh tempo selalu sinkron: sales mengisi di quotation → teks `termOfPayment` auto-generate → konversi quotation → invoice mewarisi jadwal penuh tanpa input ulang.
- **DUE_EVENTS**: `invoice`, `down_payment`, `bastp` (setelah BASTP ditandatangani — serah terima), `handover`, `delivery`.
- Sanitasi: maks 6 baris; pct 0–100; dueDays 0–365; dueEvent whitelist; `termPctSum()` untuk validasi total 100% di UI.
- `describeDueEn(event, days)` — deskripsi EN dokumen: "upon invoice issuance", "3 days after BASTP signed — project handover", dst.
- **Preset default**: DP 50% upon invoice + Final 50% H+3 after BASTP.

### 6.10 Laporan (`GET /api/reports`)

Param: `brandId`, `days ∈ {30, 90, 365}` (selain itu 400). Query dibatasi take 500.

| Laporan | Perhitungan |
|---|---|
| `revenuePerBrand` | opp **won dalam periode** (won-date = `updatedAt`) per brand → count + Σ estimatedValue |
| `winRatePerService` | kohort opp **dibuat dalam periode**, per `serviceCategory` → created/won/lost, `winRatePct` |
| `slaCompliance` | per brand: total lead, responded%, avgResponseHours, **`breachPct`** = (terlambat dari SLA ATAU belum direspons lewat SLA) / total |
| `invoiceAging` | invoice outstanding: hanya yang jatuh tempo lewat → bucket 0-30/31-60/61-90/90+ hari |
| `pipelinePerOwner` | opp open per owner → count, value, **weighted = Σ (value × probability)/100** |
| `totals` | wonValue/wonCount/lostCount/winRatePct/outstanding/avgResponseHours |

### 6.11 Projects, Milestones, Deliverables, Change Request

**POST /api/projects** (pembuatan manual): `name/brandId/companyId` wajib; kode `PREFIX-YYYY-###` (counter + anti-tabrakan); dari opportunity → **satu opportunity satu project** (409); **milestone breakdown**: body `milestones[]` maks 30 dengan `durationDays/parallel/picName` — **due date dihitung berantai** (tahap paralel mulai di posisi kursor; non-paralel menggeser kursor); tanpa breakdown → template `workflowFor(serviceCategory)`; semua (project + milestones + pemindahan task opp → project) dalam **satu transaksi**.

**PATCH /api/projects**: progress clamp 0–100; perubahan `dueDate` di-audit eksplisit (old→new ISO); **`milestoneId` di body** → set status milestone (default `done`) → **recompute progress = round(done/total × 100)**; progress 100 → project `review`; push "Milestone selesai ✅".

**Milestones** (`/api/projects/milestones`): CRUD; `order` otomatis; `durationDays` 0–3650; push saat done.

**Deliverables**: `kind link|file` (file data URL **≤1.2 MB**, dihitung dari base64 nyata, berbahaya diblokir); `milestoneId` wajib milik project sama; status `pending → approved | revision` (review internal via PATCH dengan `reviewedBy` dari sesi; **review klien via portal** dengan `reviewedRole:"client"`); hapus hanya pembuat atau manajemen.

**Change Requests** (`/api/change-requests`):

- POST: `projectId/title/description/additionalCost` wajib; project `completed/cancelled` ditolak; nomor `CR-YYYY-####`; push ke director/super_admin.
- PATCH: `approve/reject` hanya director/super_admin; `cancel` boleh siapa pun (terautentikasi); **approve pakai guard race** (`updateMany where status:"pending"`; count 0 → 409 — mencegah dua direktur dobel efek):
  1. `project.contractValue += additionalCost`; `project.dueDate += additionalDays`.
  2. `additionalCost > 0` → **auto-create invoice tambahan draft** (PPN 11%, total = cost + PPN, dueDate +14 hari); CR di-link `invoiceId` (unik — 1 CR maks 1 invoice).

### 6.12 Client Portal & Dokumen

**Portal tokens** (`/api/portal/tokens`) — role super_admin/director/finance (GET), super_admin/director (mutasi): token 48-hex per perusahaan; URL klien `{origin}/?portal=<token>`; PATCH `active` (revoke) / DELETE (hard — URL mati permanen).

**GET /api/portal/[token]** (publik): guard `active` + `expiresAt`; `accessCount++`. Payload publik **tanpa field internal**: company, semua `ClientDocument` (termasuk fileData untuk unduh), semua project + deliverables + milestones (termasuk `achievement`), **invoices hanya status non-draft/non-cancelled** — ringkasan diperkaya (items, terms, taxName/Rate/Mode, DP, diskon, `totalInWords` EN).

**POST /api/portal/[token]/review** (publik): `decision ∈ {approved, revision}`; `reviewerName` wajib; **deliverable wajib milik company yang sama dengan tautan** (403 "di luar cakupan tautan Anda"); efek → status + `reviewedRole:"client"` + audit + push ke production/director/super_admin.

**Dokumen portal** (`/api/portal/documents`): kind `mou|meeting_note|document`; file data URL ≤1.2 MB; MIME berbahaya ditolak; audit.

### 6.13 Kontak & Perusahaan

- **Contact create/patch**: normalisasi email/WA/telepon; company find-or-create; **`duplicateCandidates`** dikembalikan di respons create (skor ≥ 50) — dedupe proaktif.
- **Import CSV** (`/api/contacts/import`, maks 200 baris): dua fase — `commit=false` **preview** (deteksi duplikat intra-batch prioritas email > WA > telepon; kandidat ≥ 50 top 3; status per baris `invalid | review | auto_create`; suggested `skip | link:<id> (skor teratas ≥ 85) | create`) → `commit=true` eksekusi keputusan: **`link` memperkaya contact existing hanya field kosong (tidak menimpa data lama)**; `create` menandai tags `["import-csv"]`; audit batch ringkasan.
- **Merge** (`/api/contacts/merge`): satu transaksi — pindahkan opportunity & interaction dari dup ke primary → enrich primary dengan field dup yang lebih lengkap (hanya bila primary kosong) → soft-delete dup; audit `merge`.
- **Company PATCH**: **nama unik case-insensitive**; perubahan website → `websiteDomain` dihitung ulang; audit per-field.

### 6.14 Global Search & Notifikasi In-App

**GET /api/search** (`q` min 2 char, limit 5–10): mencari 7 entitas — Contact, Company, Opportunity, Project, Invoice, Quotation, Lead inbox (belum terkonversi) — tiap item membawa `module` tujuan untuk lompatan ⌘K.

**GET /api/notifications?user=<email>** — notifikasi **dikomputasi on-the-fly** dari data operasional (maks 60, sort severity lalu waktu; state baca di `NotificationState`):

| Tipe | Penerima | Sumber |
|---|---|---|
| `sla` | marketing/director/super_admin | Lead inbound menunggu > SLA brand (danger) |
| `message` | idem | Pesan inbound belum direspons ≤ 24 jam |
| `approval` | director/super_admin/finance | ApprovalRequest pending |
| `cr` | ops | ChangeRequest pending |
| `task` | pemilik task | Task open overdue (sendiri; decider lihat semua; ≥3 hari = danger) |
| `meeting` | semua assignee | Task meeting mulai ≤ 60 men / baru lewat ≤ 30 men |
| `deadline` | ops | Project aktif due ≤ 7 hari / terlewat |
| `invoice` | finance | Invoice lewat due; ≥ 14 hari = danger |
| `activity` | semua | AuditLog 24 jam — aksi orang lain (noise login/logout disaring) |

POST `/api/notifications` — `action: read|unread|dismiss` (maks 200 keys) → upsert `NotificationState`. Perubahan state mengubah hash yang dipoll notif-service → memicu `notif:changed` ke perangkat lain.

**Preferensi** (`GET/PUT /api/notif-prefs` → `UserPreference`): `muted[]` (server menerima 6 tipe operasional; client mengenal 9) + `hideRead`; offline-first: localStorage instan + PUT debounced 400 ms + sinkron antar-tab (event `storage`) + antar-perangkat (socket).

### 6.15 Tasks & Follow-up Templates

- **Task**: multi-assignee (maks 10, dedupe; assignee utama = assignees[0]); lampiran maks 5 (link wajib http(s); file data URL ≤ 5 MB; berbahaya ditolak); milestone wajib milik project yang sama; **push VAPID ke semua assignee** (exclude pembuat) saat create.
- **Task otomatis dibuat dari**: (1) opportunity baru stage `new` → "Follow-up 1" H+24; (2) konversi lead → task yang sama; (3) SLA sweep → "Eskalasi Otomatis" urgent; (4) eskalasi manual; (5) Won → task opp dipindah ke project.
- **Follow-up Template**: channel wajib `whatsapp|instagram|email`; `delayDays` 0–30; **version +1 otomatis saat body berubah**; diurut delayDays asc; dipakai frontend untuk mengisi balasan inbox.

### 6.16 Brand Configuration & Katalog Layanan

- **Brand CRUD** (super_admin/director): validasi ketat — hex warna, `slaHours` 1–72, logo data URL ≤ ~3.5 MB, `palette` 4 warna, `shortCode` `[A-Z0-9-]` maks 10 (token `{BRAND}`), **`bankAccounts` maks 6**, `docAssets` header/footer per dokumen, `npwp`, `signerName/Closing`. Nonaktifkan via `active:false` (tanpa DELETE).
- **Katalog** (`/api/brands/[id]/services`): tree kategori → layanan → workflow stages; tiap layanan: `costTotal` & **`suggestedPrice = round(costTotal × (1+margin%), 100.000 terdekat)`** (margin default 30%); **migrasi lazy** `costItems` legacy → `costCategories` kategori "Biaya Umum"; anti dobel hitung.
- **Penomoran** (`PUT /api/brands/[id]/numbering`): builder rule per docType dengan preview nomor berikutnya + contoh revisi (detail Bab 6.17).

### 6.17 Penomoran Dokumen (`numbering.ts` + `numbering-core.ts`)

- **Template token (whitelist)**: `{SEQ:n}` (zero-pad; revisi → `012-1`), `{SEQ}`, `{DOC}` (kode jenis, default QT/INV), `{BRAND}` (shortCode brand), `{ROMAN}/{roman}` (bulan Romawi), `{MM}`, `{YY}`, `{YYYY}`.
- **Contoh resmi**: template `{SEQ:3}/{DOC}-{BRAND}/{ROMAN}/{YY}` → **`002/QT-UDP/I/26`**; revisi ke-1 dari seq 12 → **`012-1/QT-UDP/I/26`**.
- **`nextDocumentNumber(brandId, docType)`**: ambil rule unik (brandId+docType); tanpa rule → fallback legacy quotation `{quotePrefix}-{YYYY}-{SEQ:4}`, invoice `{invoicePrefix}-{YYYY}-INV-{SEQ:3}`; counter `seq` di-increment & persist dengan `resetKey` (`never | yearly ("2026") | monthly ("2026-01")`); kandidat dicek unik ke tabel dokumen; tabrakan → seq+1 (maks 10 percobaan).
- Nomor dibuat **di luar transaksi utama** (counter tidak ikut rollback) — pola konsisten di Won transition & convert_invoice.
- Kode lain: Project `{PREFIX}-{YYYY}-{NNN}`; ClientBrief `BRF-YYYY-####`; ChangeRequest `CR-YYYY-####`.

### 6.18 Users & Access

- GET `/api/users` tanpa sesi → hanya persona aktif minimal (untuk layar login); dengan sesi → lengkap + `hasPassword`/`legacyPin` (hash **tidak pernah** dikirim).
- POST/PATCH (super_admin/director): password min 8; PIN 4–8 digit; keduanya scrypt; **proteksi diri sendiri** — tidak bisa menurunkan role sendiri atau menonaktifkan akun sendiri; efek deaktivasi langsung (resolveActor & session selalu cek `active` dari DB); audit berisi daftar perubahan.

### 6.19 Public Intake Form (`/api/public/intake/[token]`)

Form lead publik tanpa login (`/?intake=<token>`):

- **GET meta**: brand (logo, warna, tagline), label, expiry (mati → 410), industries (konstanta ∪ distinct DB), knowFrom (12 opsi, "other" hanya tampil bila pernah dipakai), submissionCount.
- **POST submit** — anti-spam **rate limit 10 submit/5 menit per token** (429). Validasi wajib: fullName, email valid, **WhatsApp** (dinormalisasi E.164, 8–15 digit), companyName, **companyAddress** ("dipakai untuk surat"), city, country, projectTitle, deadline, **knowFrom** (→ `leadSource`). `lang` en|id menentukan bahasa email.
- **Estimasi close otomatis**: deadline ≥ 3 minggu lagi → `expectedCloseDate = deadline − 21 hari`; mepet → besok (H+1). `timelineEnd` brief = deadline − 1 hari.
- **Satu transaksi**: Company (reuse by domain → nama → buat baru; alamat lama yang kosong diisi) → Contact (reuse by email/WA) → Opportunity stage `new` (`ownerName = link.createdByName` — pemilik link bertanggung jawab) → **draft ClientBrief** (`BRF-…`, deliverables maks 20, budget, references) → Interaction timeline kanal "website" → `submissionCount++` → audit aktor "Formulir Intake (publik)" role system.
- **Email otomatis (best-effort)**: PDF **"Initial Brief"** (kop brand) + **portal token klien** (pakai existing atau auto-create) → email bilingual berisi salinan form + link portal + lampiran PDF; kegagalan SMTP tidak menggagalkan submit. Respons `{opportunity, briefCode, expectedCloseDate, emailStatus}`.
- Catatan: submit intake **tidak** membuat task follow-up otomatis (berbeda dari convert & create opportunity).

### 6.20 AI Integration (`POST /api/opportunities/[id]/summary`)

Satu-satunya pemakaian AI (`z-ai-web-dev-sdk`, backend-only):

- Konteks: opportunity + brand + contact/company + **40 interaksi terakhir** + **10 notes terakhir**.
- Prompt Bahasa Indonesia, output terstruktur 4 bagian: **RINGKASAN / SENTIMEN / NEXT-BEST-ACTION / RISIKO**.
- Param: temperature 0.4, max_tokens 600. Error → 500. **Tidak ada penyimpanan** — hasil hanya respons.

### 6.21 Health & Bootstrap

- **GET /api/health** (tanpa auth, dipakai Docker HEALTHCHECK): probe DB (`SELECT 1` + latensi) + notif-service (`localhost:3005`, timeout 2 s); `status: ok | degraded` (DB down / latensi > 500 ms / notif-service down); **anonim hanya melihat `{status}`** (detail hanya untuk sesi sah — anti-recon).
- **GET /api/bootstrap**: bila `brand.count() === 0` → `seedDatabase()` (idempoten, guard anti seed ganda) → `{ready:true}`. **POST force reseed**: butuh sesi Super Admin **dan** env gate (`NODE_ENV !== "production"` atau `ALLOW_RESEED=1`) — wipe + reseed penuh.

---

## 7. Generator Dokumen PDF & Kop Surat

`src/lib/crm/doc-pdf.ts` (~1021 baris) — PDF dibangun **server-side dengan jsPDF**, ukuran A4, **bahasa Inggris** (untuk klien internasional), nilai mata uang lokal.

**Kop surat**: bila `brand.docAssets[docType].header` / `letterheadHeader` berisi PNG/JPEG → dirender **full-bleed** di atas (footer di dasar halaman); ukuran gambar diukur dari header bytes tanpa dependency. Tanpa gambar → kop komposisi: logo + nama brand (warna aksen) + alamat/kota/telepon/email + garis aksen.

| Builder | Isi |
|---|---|
| `buildQuotationPdf` | Meta Number/Date/Attachment/Regarding → blok To/Attn./Address → paragraf pembuka → tabel item (header berwarna aksen brand) → blok total → **3 kolom gaya Unimasi: Timeline \| Revision \| Term of Payment** → valid-until → tanda tangan: **e-sign klien bila ada** ("Electronically signed via secure link"), else signer brand |
| `buildInvoicePdf` | Judul INVOICE + kotak No./Date → blok Project/Purchase Number + klien → tabel item → matematika gaya Unicam (discount → sub total → gross-up/less sesuai taxMode → Total Payment) → **blok terbilang 2 baris** "Terbilang: … (ID)" + "Amount in Words: … (EN)" → **Term of Payment** (jadwal termin + % nominal + due EN) → **Payment Method** (rekening bank brand, maks 3) → ttd "For and on behalf of {brand}" |
| `buildBriefPdf` | "INITIAL PROJECT BRIEF": kop → kotak Ref/Date → blok klien → meta project → TARGET AUDIENCE / KEY MESSAGE / PROJECT GOALS → tabel DELIVERABLES → BUDGET RANGE → REFERENCES → penutup. Dilampirkan pada email konfirmasi form intake publik |

**Terbilang** (`terbilang.ts` + internal `amountInWords`): Bahasa Indonesia ("Lima Belas Juta Empat Ratus Tiga Puluh Lima Ribu Rupiah") + EN (mendukung 10 mata uang: IDR/USD/SGD/MYR/EUR/GBP/JPY/AUD/CNY/HKD).

**Pengiriman dokumen** (`doc-send.ts`): `sendDocumentEmail()` = kirim SMTP (via kanal email brand) → **selalu create Interaction outbound** (terlink opportunity/contact/company → tampil di timeline & thread Inbox) → audit `email_document`. Status jujur: `sent | failed | simulated` — dokumen hanya ditandai "sent" bila benar-benar terkirim (atau mode demo). Ini menutup akar masalah lama "action send hanya menandai status tanpa mengirim email".

**Print A4**: selain PDF server-side, tersedia print CSS A4 (`#print-area` di globals.css) untuk quotation/invoice dari browser (`quotation-print.tsx`, `invoice-print.tsx`).

---

## 8. Kanal Komunikasi & Integrasi Eksternal

### 8.1 ChannelConfig (per kanal, per brand)

| Kanal | Kredensial wajib | Verifikasi nyata |
|---|---|---|
| WhatsApp Cloud API | phoneNumberId, accessToken, verifyToken (+appSecret opsional) | Graph API v21.0 `GET /{phoneNumberId}` (verified_name, quality_rating) |
| Instagram | accountId, accessToken | Graph API `GET /{igUserId}` |
| Threads | accountId, accessToken | — (belum ada verifier; hanya mode demo/skip) |
| Email | provider, smtpHost, smtpUser, smtpPassword (+IMAP opsional) | SMTP handshake+auth (nodemailer verify; 465 implicit TLS / 587 STARTTLS) + IMAP login bila diisi |

- Kredensial selalu **dimasking** di respons API (`••••1234`); secret kosong saat update tidak menimpa nilai lama; **satu koneksi per kanal+brand** (409).
- **Verifikasi nyata sebelum status `connected`** (kecuali `skipVerification` → mode demo). `isDemo` dipaksa false bila kredensial diganti.
- **Demo 1-klik** (`/api/channels/demo`): preset akun asli brand (WA/IG/Threads/email) dengan kredensial buatan — alur penuh bisa didemokan tanpa kredensial nyata; pengiriman berstatus `simulated`.
- Wizard setup (`channel-setup-wizard.tsx`): panduan langkah per kanal, checklist, callback URL & verify token copyable, preset Zoho/Gmail/Mailgun.

### 8.2 Email keluar (SMTP) — `email-delivery.ts`

- Pemilihan kanal **sadar-brand**: ① kanal email `connected` non-demo milik brand interaksi → ② non-demo lain → ③ demo → ④ tanpa kanal (`simulated`).
- Lampiran data URL → attachment SMTP, maks 5 file (~10 MB).
- Status jujur disimpan ke `Interaction.deliveryStatus/deliveryNote` — tidak ada tick palsu.

### 8.3 Email masuk (IMAP) — `email-sync.ts`

- Hanya kanal email non-demo; **throttle 30 detik** berbasis `lastEmailSyncAt` (tombol manual = tanpa throttle); background fire-and-forget via `after()` dengan guard anti-paralel.
- Per email baru (dedupe `externalId` = Message-ID): konten text/plain (fallback HTML→teks), **lampiran diunduh → data URL** (maks 5 × 2 MB; berbahaya diblokir; catatan `[Lampiran: …]`/`[Blokir lampiran: …]`).
- **Auto-link**: bila pengirim = contact existing dengan opportunity TERBUKA (bukan won/lost) → interaction langsung tertaut ke contact/company/opportunity; else → lead mentah di Inbox.
- Trigger manual: `POST /api/channels/email-sync` (super_admin/director). Audit `email_sync`.

### 8.4 WhatsApp Cloud API webhook (`/api/webhooks/whatsapp`)

- **GET handshake Meta**: verifikasi `hub.verify_token` — prioritas env `WHATSAPP_VERIFY_TOKEN` → verifyToken ChannelConfig → token demo (hanya dev); echo `hub.challenge`.
- **POST status kirim**: verifikasi HMAC `X-Hub-Signature-256` (env `WHATSAPP_APP_SECRET` → appSecret ChannelConfig; **produksi tanpa secret apa pun = 401 fail-closed**); payload `statuses[]` (sent/delivered/read/failed) → update `deliveryStatus` Interaction outbound yang cocok by `externalId`; selalu balas 200 (konvensi retry Meta); audit batch aktor "WhatsApp Cloud API".

### 8.5 Lain-lain

- **SMTP sink dev-only** (`scripts/dev-smtp-sink.ts`): listener `127.0.0.1:3465` untuk QA pengiriman email di sandbox — bukan bagian aplikasi.
- **Tidak ada env SMTP global** — semua kredensial email dikelola per-kanal via UI (tabel `ChannelConfig`).

---

## 9. Notifikasi, Real-time & Web Push

### 9.1 Mini-service `notif-service` (socket.io, port 3005)

- Proses Bun terpisah (`mini-services/notif-service/`, package.json sendiri, dijalankan `bun --hot`), path socket `/` (konvensi gateway Caddy `?XTransformPort=3005`).
- **Room**: `subscribe {email, brandId?}` → join `${email}::${brandId ?? "all"}`.
- **Poll loop 15 detik** per room: `GET /api/notifications?user=…&brandId=…` + `GET /api/notif-prefs?user=…` → hash SHA-1 dari `unread | daftar-key | prefsUpdatedAt` → berubah → emit **`notif:changed`** ke room. Observasi pertama = baseline (tanpa emit).
- Event `stats`: uptime, activeRooms, totalEmits, pollCount (monitoring).
- Catatan: service ini **tidak ikut** image Docker CRM (dijalankan di sandbox/dev); `/api/health` akan melaporkan `notifService: "down"` (status `degraded`) bila tidak jalan — perlu diputuskan apakah dideploy sebagai container terpisah di Coolify.

### 9.2 Web Push VAPID (`push.ts` + `public/sw.js`)

- Env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; **tanpa key → fail-closed** (tidak kirim, tidak error).
- `sendPushToRoles(roles, payload, excludeUserKey?)` — resolusi email dari tabel User aktif; `sendPushToUserKeys(emails, payload)`. TTL 3600; subscription 404/410 dihapus otomatis.
- Subscription disimpan di `PushSubscription` (upsert by endpoint; email dari **sesi**, bukan body); di-exempt dari blok 423 lock screen.
- **Service worker**: tampilkan notifikasi (icon, tag) → `notificationclick` fokus/navigasi ke `data.url`; fetch network-first + halaman offline (syarat installability PWA).
- Dipakai di: Deal Won, task baru (per assignee), invoice terbit/kirim/bayar, approval pending/decided, CR pending/decided, milestone done, portal review klien, quotation sent/signed, brief approval.

---

## 10. Deployment & Infrastruktur

### 10.1 Dockerfile — 3 stage (semua base `oven/bun:1`)

| Stage | Isi |
|---|---|
| **1. deps** | COPY package.json, bun.lock, prisma/ → `bun install` → `bunx prisma generate` |
| **2. builder** | COPY source + node_modules; ENV dummy `DATABASE_URL=file:/app/db/custom.db` & `SESSION_SECRET="build-time-dummy-secret-not-used-at-runtime"` (guard fail-closed dievaluasi saat build — tanpa ini build gagal); `bun run build`; **validasi schema**: `prisma db push` ke db buangan `/tmp/schema-check.db` — schema rusak = build gagal |
| **3. runner** | `COPY --from=builder /app/.next/standalone ./` → **diratakan ke `/app` (server di `/app/server.js`)**; salin node_modules `.prisma`+`@prisma`+`prisma` CLI + **27 package closure** (effect, c12, chokidar, dst.); salin `prisma/`, `db/` (seed), `docker-migrate.sh`; `VOLUME /app/data`; `EXPOSE 3000` |

- **HEALTHCHECK**: tiap 30 s, timeout 5 s, start-period 20 s, retries 3 → `fetch http://127.0.0.1:3000/api/health`.
- **CMD**: `["bun", "--env-file=/app/data/.session-secret", "server.js"]` — **runtime murni tanpa entrypoint/shell** (redesign Task 69; `docker-entrypoint.sh` dihapus dari repo). `--env-file`: file hilang diabaikan diam; env platform (Coolify) tidak tertimpa; secret tersedia sebelum modul apa pun dievaluasi (termasuk proxy).

### 10.2 Provisioning one-shot: `docker-migrate.sh` + `docker-compose.yml`

- Compose mendefinisikan **service `migrate`** (one-shot, `restart: "no"`, command `sh /app/docker-migrate.sh`) dan **service `app`** (`depends_on: migrate: condition: service_completed_successfully` — **gagal migrasi = deploy gagal jelas di log**).
- Urutan `docker-migrate.sh` (idempoten, dieksekusi tiap deploy):
  1. **SESSION_SECRET** — prioritas: env platform → file `/app/data/.session-secret` (format dotenv, chmod 600) → generate random 32-byte. Persisten antar deploy → sesi user tidak gugur saat redeploy.
  2. **First-boot seed** — bila `/app/data/custom.db` tidak ada/0 byte → salin `/app/db/custom.db.seed`.
  3. **`prisma db push --accept-data-loss --skip-generate`** via **CLI lokal terkunci** `/app/node_modules/prisma/build/index.js` (PENTING: `bunx prisma` di container mengunduh Prisma v7 dari npm — UNKNOWN_COMMAND).
- Service `app`: **tanpa `ports:`** — hanya `expose: "3000"` + env `SERVICE_FQDN_APP_3000` (pola Coolify Generated Stack Values — domain otomatis + proxy internal); volume `db-data` → `/app/data` (database SQLite + file secret); `restart: unless-stopped`; healthcheck sama dengan Dockerfile.

### 10.3 Environment variables

| Variabel | Fungsi |
|---|---|
| `DATABASE_URL` | Lokasi file SQLite (`file:/app/data/custom.db` di produksi) |
| `SESSION_SECRET` | Kunci HMAC cookie sesi & lock; fail-closed di produksi |
| `SESSION_SECRET_FILE` | Override path file secret (default `/app/data/.session-secret`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push; kosong = push nonaktif diam-diam |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | Verifikasi webhook Meta (fallback ke ChannelConfig) |
| `ZAI_API_KEY` / `Z_AI_API_KEY` | Kunci layanan AI (opsional) |
| `ALLOW_RESEED` | `=1` mengizinkan POST bootstrap force di produksi (tetap wajib sesi Super Admin) |
| `NODE_ENV`, `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED` | Runtime standar |
| `SERVICE_FQDN_APP_3000` | Generated value Coolify (tidak dibaca kode aplikasi) |

### 10.4 Caddyfile (gateway sandbox/dev)

`:81` → query `?XTransformPort=<n>` → `reverse_proxy localhost:<n>`; default → `localhost:3000`. Header `X-Forwarded-For/Proto/Real-IP` diteruskan — dasar deteksi HTTPS untuk cookie `Secure` adaptif.

### 10.5 `.dockerignore`

Exclude: `node_modules`, `.next`, `.git`, `.env*`, `qa*.png`, `worklog.md`, folder non-runtime (skills/examples), dan **`db/custom.db` + `-journal`** (data user asli tidak boleh masuk image; `db/custom.db.seed` tetap ikut untuk first-boot).

---

## 11. Keputusan Arsitektur & Trade-off

| # | Keputusan | Alasan | Konsekuensi diterima |
|---|---|---|---|
| 1 | **Single page app** — 13 modul via state, bukan route | Shell konsisten, navigasi instan, deep-link via query param | Tidak ada SSR per modul; bundle awal lebih besar |
| 2 | **SQLite file** di volume, bukan server DB | Zero-ops untuk deployment kecil; backup = copy file | Tidak cocok multi-instance; write serial |
| 3 | **RBAC dinamis di DB** (`ModulePermission`) | Admin bisa edit matriks tanpa deploy | Butuh cache 30 dtk; fallback statis untuk resilience |
| 4 | **Cookie sesi HMAC buatan sendiri**, bukan NextAuth | Edge-safe (Web Crypto), payload ringan, kontrol penuh atribut cookie | Implementasi keamanan sendiri (sudah: timing-safe compare, fail-closed secret, scrypt) |
| 5 | **Cookie `Secure` adaptif** (x-forwarded-proto) | Kompatibel HTTP dev & HTTPS Coolify | Harus memastikan proxy meneruskan header proto |
| 6 | **Notifikasi dikomputasi on-the-fly** + state baca terpisah | Tanpa tabel notifikasi yang menumpuk; selalu segar | Query lebih berat tiap poll (dimitigasi limit 60 item) |
| 7 | **Socket sidecar polling** (bukan event bus) | App utama tidak perlu diubah; socket.io terisolasi | Latensi notif maks 15 dtk; service terpisah harus jalan |
| 8 | **Rate limit & throttle in-memory** | Tanpa Redis; cukup untuk single-instance | Perilaku bisa berbeda bila multi-instance |
| 9 | **Provisioning one-shot service `migrate`** + runtime tanpa entrypoint | Runtime bersih; gagal migrasi = deploy gagal jelas; secret persisten | Butuh depends_on condition di compose |
| 10 | **Efek samping Won dalam satu transaksi** + nomor dokumen dibuat di luar transaksi | Atomicity; counter tidak ikut rollback | Nomor bisa "terlewat" bila transaksi gagal (diterima) |
| 11 | **Lampiran disimpan sebagai data URL di kolom JSON** | Tanpa object storage; konsisten dengan SQLite | Batas ukuran 1.2–5 MB; DB membengkak jika banyak |
| 12 | **Dokumen PDF berbahasa Inggris**, UI Bahasa Indonesia | Klien internasional; dokumen formal | Kop surat & termin pakai format EN standar |
| 13 | **GET read tertentu tanpa sesi** (users minimal, notifications, portal publik, service-map) | Kebutuhan layar login & poll notif-service; klien tanpa login | Permukaan baca terbuka — kompromi terdokumentasi (Ronde 30/36) |
| 14 | **won-date resmi = `updatedAt`** opportunity | Tanpa kolom tambahan | Mengandalkan disiplin bahwa perubahan stage menyentuh updatedAt |

---

## 12. Kelemahan yang Diketahui & Rekomendasi

Temuan dari audit source code (per dokumen ini disusun):

1. **Beberapa GET read-sensitive tidak memvalidasi sesi di layer route** (opportunities, inbox, dashboard, reports, search, interactions, tasks, quotations, projects, service-map) — saat ini ditutup oleh middleware `proxy.ts`, tetapi tidak ada defense-in-depth di route. *Rekomendasi: tambahkan `resolveActor()` di GET sensitif secara bertahap.*
2. **`add_payment` tidak memvalidasi `amount ≤ sisa tagihan`** — overpay langsung menjadikan status `paid`. *Rekomendasi: validasi sisa atau peringatan eksplisit.*
3. **`validUntil` quotation tidak ditegakkan server** — status `expired` ada di skema tetapi tidak pernah di-set. *Rekomendasi: sweep kedaluwarsa atau validasi saat aksi.*
4. **Invoice dari ChangeRequest memakai taxRate 11 & currency IDR hardcode** — tidak mengikuti master pajak/brand. *Rekomendasi: pakai `Tax` aktif & `brand.primaryCurrency`.*
5. **Rate limit/throttle in-memory** — tidak bekerja lintas instance. *Rekomendasi: tetap single-instance, atau pindahkan ke penyimpanan bersama bila scale-out.*
6. **Notif-service membaca `/api/notifications?user=<email>` tanpa auth** — siapa pun yang menjangkau port dapat menghitung notifikasi user lain. *Rekomendasi: token internal sederhana untuk poll service.*
7. **Kredensial kanal disimpan plaintext JSON** di `ChannelConfig` (dimasking hanya di API). *Rekomendasi: enkripsi at-rest bila diproduksi serius.*
8. **Komentar Dockerfile/compose masih menyebut `src/instrumentation.ts`** yang sudah dihapus (eksperimen gagal Task 69). *Rekomendasi: rapikan komentar.*
9. **Threads channel belum punya verifier nyata** — koneksi realistis hanya via demo/skip. *Rekomendasi: tambahkan verifier Threads API.*
10. **Root `/api` masih placeholder "Hello, world!"**. *Rekomendasi: hapus atau isi health-info.*
11. **notif-service tidak dideploy di produksi Coolify** → health selalu `degraded`. *Rekomendasi: tambahkan sebagai service kedua di compose + shared network.*
12. **Tidak ada backup otomatis SQLite** di volume. *Rekomendasi: cron backup sederhana (copy + compres ke volume/path lain).*

---

## 13. Referensi API

Konvensi: error selalu `{"error": "<pesan>"}` · 400 validasi · 401 sesi · 403 role/level · 404 tidak ada · 409 konflik unik/race · 422 unproses (lampiran berbahaya, tanpa penerima, transisi ilegal) · 429 rate limit · 423 locked · 502 gagal kirim email.

| Method & Path | Ringkasan | Sesi? |
|---|---|---|
| POST `/api/auth/login` | Login email+password (rate limit; scrypt; migrasi legacy PIN) | Publik |
| GET/POST `/api/auth/session` | Introspeksi (+`locked`) / logout | Publik/opsional |
| POST `/api/auth/lock` · `/api/auth/unlock` | Kunci layar / buka dengan PIN | Sesi |
| GET `/api/bootstrap` | Seed otomatis bila DB kosong → `{ready:true}` | Publik |
| POST `/api/bootstrap` | Force reseed (Super Admin + env gate) | Sesi |
| GET `/api/brands` | Brand aktif | Proxy-guard |
| POST/PATCH `/api/brands(/[id])` | CRUD brand + kop + bank + docAssets | Sesi (super_admin/director) |
| GET/POST/PATCH/DELETE `/api/brands/[id]/services` | Katalog kategori/layanan/workflow + RAB + suggestedPrice | Sesi |
| PUT `/api/brands/[id]/numbering` | Builder rule penomoran + preview | Sesi |
| GET `/api/users` | Persona minimal (publik) / lengkap (sesi) | Campuran |
| POST/PATCH `/api/users(/[id])` | CRUD user (scrypt; proteksi diri sendiri) | Sesi |
| GET/PUT `/api/permissions` | Matriks RBAC / simpan massal (2-lapis gate) | Sesi |
| GET `/api/dashboard` | Semua KPI + roleView + trigger SLA sweep | Proxy-guard |
| GET/POST `/api/opportunities` | List (scoring on-the-fly) / create (+auto follow-up task) | Proxy-guard |
| GET/PATCH/DELETE `/api/opportunities/[id]` | Detail / transisi stage (+Won orchestration) / soft delete | Proxy-guard |
| POST `/api/opportunities/[id]/summary` | AI summary (RINGKASAN/SENTIMEN/NBA/RISIKO) | Proxy-guard |
| GET/PUT `/api/opportunities/[id]/estimation` | RAB: read auto-create / save+submit (+ApprovalRequest) | Proxy-guard |
| GET `/api/estimations/suggestions` | Autocomplete kategori/item/satuan RAB | Sesi |
| POST `/api/opportunities/import` | Import CSV preview/commit + dedupe | Sesi |
| GET `/api/inbox` | Lead list + SLA + candidates + thread (+sweep, IMAP bg) | Proxy-guard |
| POST `/api/inbox/convert` | Konversi lead → contact+opportunity (transaksi atomik) | Sesi |
| POST `/api/inbox/respond` | Balas lead/kontak (SMTP nyata utk email) | Sesi |
| POST `/api/inbox/link` · `/escalate` | Gabung identitas / eskalasi manual (dedupe 409) | Sesi |
| PATCH/DELETE `/api/inbox/[id]` | Pulihkan arsip / arsip / hapus permanen 2-langkah | Sesi |
| POST `/api/identify` | Identity matching (top 5 + reasons) | Proxy-guard |
| GET/POST `/api/interactions` | Timeline / catat pesan (SMTP utk email; bump updatedAt) | Proxy-guard/Sesi |
| GET `/api/interactions/[id]/attachments` | Unduh lampiran aman (attachment, nosniff) | Sesi |
| GET/POST/PATCH `/api/tasks(/[id])` | Task CRUD (multi-assignee; push ke assignee) | Proxy-guard/Sesi |
| GET/POST `/api/projects` + PATCH | Project CRUD + milestone breakdown berantai + recompute | Proxy-guard/Sesi |
| POST/PATCH `/api/projects/milestones` | Milestone CRUD (push saat done) | Sesi |
| GET/POST `/api/projects/[id]/deliverables` + PATCH/DELETE `/api/projects/deliverables` | Deliverable kirim/review/hapus | Sesi |
| POST `/api/projects/[id]/email-link` | Kirim link portal via email (auto-token) | Sesi |
| GET/POST/PATCH `/api/briefs(/[id])` | Brief CRUD + workflow transisi whitelist | Proxy-guard/Sesi |
| GET/POST `/api/quotations` + PATCH `[id]` | Quotation CRUD + lifecycle (send/share/accept/reject/convert/revisi) | Sesi |
| GET `/api/public/quotation/[token]` | Halaman approval publik (+`?pdf=1`) | Publik (key/password) |
| POST `/api/public/quotation/[token]` | `sign` (e-sign → Won) / `request_new_code` | Publik (rate limit) |
| GET `/api/invoices` | List + sweep overdue + aging buckets | Proxy-guard |
| POST `/api/invoices` | 8 action: add_payment, send, cancel, update, delete_payment, create_standalone, create, revise | Sesi (finance gate) |
| GET/PATCH `/api/approvals` | Approval list/decision (+auto quotation + auto negotiation) | Sesi (director) |
| GET/POST/PATCH `/api/change-requests` | CR ajukan/putuskan (+auto invoice, guard race) | Sesi |
| GET `/api/service-map` | Matriks layanan × brand + cross-sell per perusahaan | Proxy-guard |
| GET/POST/PATCH `/api/portal/tokens(/[id])` | Token portal CRUD (revoke) | Sesi (super_admin/director) |
| GET `/api/portal/[token]` | Data portal klien (projects/deliverables/invoices/dokumen) | Publik (token) |
| POST `/api/portal/[token]/review` | Review deliverable oleh klien | Publik (token) |
| GET/POST `/api/portal/documents` + DELETE `[id]` | Dokumen MoU/notulen/dokumen | Sesi |
| GET/POST `/api/public/intake/[token]` | Meta form / submit intake publik (+brief PDF+email) | Publik (rate limit) |
| GET/POST/PATCH/DELETE `/api/pipeline/intake-links(/[id])` | Kelola link intake | Sesi |
| GET/POST `/api/contacts` + PATCH/DELETE `[id]` | Kontak CRUD (+duplicateCandidates) | Proxy-guard/Sesi |
| POST `/api/contacts/import` · `/merge` · GET `/duplicates` | Import CSV 2-fase / merge transaksional / scanner | Sesi |
| GET/POST/PATCH `/api/companies(/[id])` | Perusahaan CRUD (nama unik) | Proxy-guard/Sesi |
| GET/POST/PATCH/DELETE `/api/channels(/[id])` + `/demo` + `/email-sync` | Kanal: verifikasi nyata, demo 1-klik, sync IMAP | Sesi (super_admin/director) |
| GET/POST `/api/webhooks/whatsapp` | Handshake Meta / status kirim (HMAC) | Publik (signature) |
| GET/POST `/api/notifications` | Notifikasi komputasi / mark read-dismiss | Publik (user param) |
| GET/PUT `/api/notif-prefs` | Preferensi notifikasi (UserPreference) | Publik (user param) |
| GET `/api/push/public-key` · POST `subscribe|unsubscribe` | Web Push VAPID | Sesi |
| GET/POST/PATCH/DELETE `/api/followup-templates(/[id])` | Template follow-up (versioning) | Proxy-guard/Sesi |
| GET/POST/PATCH `/api/taxes` | Master pajak (auto-seed) | Sesi (finance gate) |
| GET `/api/industries` | Autocomplete industri | Sesi |
| GET `/api/audit-logs` | Audit trail (filter entity/action/limit) | Sesi (super_admin/director) |
| GET `/api/search` | Global search 7 entitas (⌘K) | Proxy-guard |
| GET `/api/reports` | 6 laporan periode (days 30/90/365) | Proxy-guard |
| GET `/api/health` | Health probe (anonim hanya `{status}`) | Publik |

---

## 14. Lampiran

### 14.1 Data seed demo (`src/lib/crm/seed.ts`, 825 baris; dipicu GET /api/bootstrap atau first-boot container)

- **4 Brand** dengan data asli: Unimasi (UMS, SLA 4 jam), Segia Tech (SGT, SLA 2 jam), Erfo Multimedia (EFM, SLA 6 jam), Unicam Studio (UCS, SLA 8 jam) — lengkap logo, tagline, alamat, WA/IG/Threads/email, prefix dokumen.
- **Katalog layanan** per brand: ServiceCategory → Service (unit, basePrice, RAB, margin 30%) → WorkflowStage.
- **16 ChannelConfig demo** (4 brand × 4 kanal), `isDemo: true`.
- **9 User** (direktur Andri, manajer Budi, 4 produksi, finance Sika, HR Latifa, marketing Fadel) — password `udp1234`, PIN `1234` (scrypt).
- **10 Company** (termasuk sektor government & klien Singapore/USD), **12 Contact** (termasuk pasangan duplikat "Ibu Ratna" untuk demo matching).
- **20 Opportunity** menutup semua stage (3 won, 2 lost + alasan, 2 nurture, 1 cross-sell, 1 USD).
- **3 ClientBrief**, ±15 Interaction + 6 raw inbox lead (termasuk 1 duplikat identitas), **17 Task** multi-assignee, 6 Note.
- **3 Project** + milestones dari template, **5 Invoice + Payment** (paid/partial/overdue), **2 Estimation** (draft & pending_approval + ApprovalRequest), **2 Quotation** (sent & accepted), **2 ChangeRequest** (approved → invoice tambahan; pending), **5 FollowUpTemplate**, **7 AuditLog**, reset `ModulePermission` ke default matrix.
- `db/custom.db.seed` (~1.7 MB) = snapshot DB yang disalin saat first-boot container.

### 14.2 Akun & kredensial demo

| Keterangan | Nilai |
|---|---|
| Login (email + password) | Semua `@udp.co.id`, password **`udp1234`** (mis. `andri@udp.co.id` = director) |
| PIN kunci layar | **`1234`** (semua user) |
| Layar login | Chip persona mengisi form dari `GET /api/users` (tanpa PIN) |

### 14.3 Glosarium singkat

| Istilah | Arti |
|---|---|
| **Lead mentah** | Interaction inbound yang belum tertaut opportunity (masih di Inbox "Perlu Tindakan") |
| **Won transition** | Orkestrasi otomatis saat deal dimenangkan (project+milestone+invoice DP+portal) |
| **TOP** | Term Of Payment — jadwal termin terstruktur (label/pct/dueDays/dueEvent) |
| **BASTP** | Berita Acara Serah Terima Pekerjaan — momen jatuh tempo termin (`dueEvent: "bastp"`) |
| **RAB** | Rencana Anggaran Biaya — cost breakdown kategori→item di Estimation |
| **Magic key** | Kunci satu-permintaan untuk secure link quotation (hanya SHA-256-nya disimpan) |
| **SLA sweep** | Pemindaian berkala lead yang melewati SLA respons brand → eskalasi otomatis |
| **Thread unify** | Penggabungan pesan lintas kanal ke satu contact/opportunity berdasar identitas |
| **roleView** | Blok data dashboard yang di-scope per peran (mine/finance/production/team) |

---

*Dokumen ini dihasilkan dari pembacaan menyeluruh source code (5 agen eksplorasi paralel) dan diverifikasi silang terhadap worklog proyek. Perubahan perilaku di masa depan sebaiknya memperbarui dokumen ini agar tetap menjadi sumber kebenaran arsitektur.*
