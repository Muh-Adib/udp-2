# Grup CRM — Multi-Brand Creative Agency

Sistem CRM (Customer Relationship Management) full-stack untuk grup agensi kreatif multi-brand: **Unimasi**, **Segia Tech**, **Erfo Multimedia**, dan **Unicam Studio**. Satu aplikasi untuk mengelola lead multi-kanal, pipeline penjualan, produksi project, keuangan, hingga portal klien ber-secure link.

![Stack](https://img.shields.io/badge/Next.js%2016-App%20Router-black) ![TS](https://img.shields.io/badge/TypeScript-5-323330) ![Prisma](https://img.shields.io/badge/Prisma-SQLite-16a34a) ![UI](https://img.shields.io/badge/shadcn%2Fui-Tailwind%204-f4f4f5)

---

## ✨ Fitur Utama

### 1. 📥 Unified Lead Inbox (Multi-Kanal)
- Semua lead masuk dari **Instagram, WhatsApp, Email, Website** dalam satu antrean.
- **Pengelompokan percakapan per kontak** — pesan dari pengirim yang sama (lintas kanal) dirangkai menjadi satu thread percakapan.
- Badge **SLA respons** (hijau ≤4 jam / amber ≤24 jam / merah >24 jam).
- **Identifikasi identitas otomatis**: skoring kandidat contact yang mirip (email, WhatsApp, handle sosial, nama) + peringatan duplikat.
- Kartu **Kelengkapan Identitas** (Nama/Perusahaan/Jabatan/Email/WhatsApp) + generator **Pesan Identifikasi** siap-tempel untuk follow-up awal.
- Konversi 1-klik: lead → Contact (+ Opportunity) baru atau gabung ke contact existing, otomatis buat task follow-up 24 jam.

### 2. 📇 Contacts & Companies
- Profil contact lengkap: **Jabatan di Perusahaan**, email, WhatsApp, alamat, dan **media sosial terstruktur (Instagram / Facebook / TikTok)** — penting karena lead banyak berasal dari Instagram.
- Import CSV dengan pemetaan kolom fleksibel + **deteksi duplikat berbobot** (email/WA sama, nama mirip, sosial media sama).
- Merge contact duplikat dengan pemindahan relasi aman.
- Riwayat interaksi & kaitan ke opportunity.

### 3. 📊 Sales Pipeline (Kanban 12 Stage)
- Kanban **drag-and-drop** 12 stage standar (New → Qualified → Proposal → Negotiation → Won/Lost → Nurture).
- Dua tampilan: Kanban & Tabel (sortable). Filter brand, owner, temperatur, prioritas.
- Detail drawer: **Ringkasan AI**, timeline chat, tugas, catatan internal, cross-sell antar brand.
- Stage **Won** otomatis membuat Project + Milestone + Invoice DP; stage **Lost** wajib alasan.

### 4. 🚀 Projects & Produksi
- Kartu project dengan progress, milestone (klik untuk menandai selesai → progress terhitung ulang otomatis), deadline, PM, nilai kontrak.
- Deliverable project dapat dikirim ke klien untuk **review**.

### 5. 💰 Finance
- Invoice otomatis (DP saat deal) + pencatatan pembayaran (transfer/cash/QRIS/kartu).
- **Aging report** 4 bucket (0 / 1–30 / 31–60 / >60 hari), status paid/partial/overdue.
- Ringkasan invoiced / paid / outstanding.

### 6. 🔗 Client Portal — Secure Link Tanpa Login
- Klien **tidak perlu akun/login** — akses via **secure URL token** (`/?portal=<token>`) khusus client.
- Staf membuat & mencabut secure link per perusahaan (bisa diberi label, dipantau jumlah & waktu akses).
- Isi portal: **MoU & dokumen** (tautan/file), **catatan rapat** (tanggal + peserta), **deliverable project** yang bisa klien **Setujui / Minta Revisi** langsung dari tautan.
- Halaman portal berdiri sendiri tanpa chrome CRM, dengan penanganan token invalid/dicabut/kedaluwarsa.

### 7. 📡 Channels & Setup Wizard
- Wizard koneksi kanal (WhatsApp / Instagram / Email) dengan **petunjuk langkah-demi-langkah** per penyedia, tanpa konfigurasi manual yang rumit.
- Status kanal per brand.

### 8. 📈 Dashboard & Reports
- Command center: KPI (pipeline value, weighted forecast, win rate, avg response SLA, outstanding invoice), funnel 12 stage, tren pipeline, performa marketing, alasan lost, audit terbaru.
- Laporan penjualan & aktivitas.

### 9. ⚙️ Lainnya
- **Follow-up Center** (task dengan prioritas, overdue, grup hari ini/mendatang).
- **Brand Configuration** (warna, SLA, prefix invoice, layanan per brand) + **Template follow-up** dengan versioning & approval Direktur.
- **User & Access** — 6 role (Super Admin, Direktur, Marketing, Finance, Production, Client) + matriks hak akses.
- **Audit Logs** — jejak semua perubahan (aktor, entitas, nilai lama→baru).
- **Notification center** & login multi-persona PIN.

---

## 🧱 Tech Stack

| Layer | Teknologi |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| UI | Tailwind CSS 4 + shadcn/ui (New York) + lucide-react + recharts |
| State | Zustand (client state), fetch helper terpusat |
| Database | Prisma ORM + SQLite (`db/custom.db`) |
| Drag & drop | @dnd-kit/core |
| Toast | sonner |
| AI | Ringkasan opportunity via z-ai-web-dev-sdk (backend) |

## 🐳 Deployment dengan Docker

Tersedia `Dockerfile` + `docker-compose.yml` (Next.js standalone + Bun, database SQLite persisten di volume `db-data`).

```bash
# Build & jalankan (pertama kali ±2–4 menit)
docker compose up -d --build

# Cek log & status
docker compose logs -f app
docker compose ps

# Matikan / hapus
docker compose down          # data tetap tersimpan di volume
docker compose down -v       # hati-hati: menghapus volume database
```

- Aplikasi berjalan di **http://localhost:3000** (ubah port lewat bagian `ports` di `docker-compose.yml`).
- Saat container pertama berjalan, database seed demo otomatis disalin ke volume — login demo langsung bisa dipakai.
- Schema Prisma di-sinkronkan otomatis setiap start (`prisma db push`, idempoten).
- Kunci layanan AI (opsional) dikirim via env: `ZAI_API_KEY=xxx docker compose up -d --build`.
- File dokumen portal (≤1,2 MB) tersimpan di SQLite — untuk backup cukup backup volume `db-data`.

## 🚀 Menjalankan Project (tanpa Docker)

```bash
# 1. Install dependencies
bun install        # atau npm install

# 2. Push schema Prisma ke database SQLite
bun run db:push

# 3. Jalankan dev server (port 3000)
bun run dev
```

Buka `http://localhost:3000`.

> Database `db/custom.db` sudah berisi **data seed demo** (4 brand, 10 perusahaan, 12 kontak, 21 opportunity, invoice, project, raw lead, dsb.). Jika ingin mulai dari nol, hapus file db lalu `bun run db:push`.

### 🔐 Login Demo

Pilih persona di layar login lalu masukkan PIN: **`1234`**

| Persona | Role |
|---|---|
| Sari Rahmawati | Direktur |
| … | Super Admin / Marketing / Finance / Production / Client |

### 🔗 Contoh Secure Link Portal Klien

```
/?portal=df1feac84985db516d58b0a5a029c71c4e040a564f993ca8
```
(Milik PT Nusantara Digital Raya — berisi MoU, catatan rapat, dan deliverable.)

## 🗂️ Struktur Kode

```
src/
├── app/
│   ├── page.tsx              # Single entry: login / app shell / portal token
│   └── api/                  # 30+ REST endpoint (contacts, inbox, opportunities, portal, …)
├── components/crm/           # 13 modul CRM + shell + portal publik
└── lib/crm/                  # types, api-client, store (zustand), constants, utils
prisma/schema.prisma          # 18+ model (Brand, Contact, Opportunity, Project, Invoice, ClientPortalToken, …)
db/custom.db                  # SQLite (seed demo included)
```

## 📡 Ringkasan API

| Endpoint | Fungsi |
|---|---|
| `POST /api/auth/login` | Login persona + PIN |
| `GET /api/dashboard` | KPI, funnel, tren, risiko |
| `GET/POST /api/inbox` | Lead multi-kanal + thread percakapan |
| `POST /api/inbox/convert` | Konversi lead → contact + opportunity |
| `POST /api/identify` | Skoring kandidat identitas |
| `GET/PATCH /api/contacts` | CRUD kontak + import CSV + merge |
| `GET/PATCH /api/opportunities` | Pipeline, stage change, AI summary |
| `GET/PATCH /api/projects` | Project + milestone + deliverable |
| `GET /api/invoices` | Invoice + aging + pembayaran |
| `GET/POST /api/portal/tokens` | Kelola secure link klien (staf) |
| `GET/POST /api/portal/documents` | MoU / catatan rapat / dokumen |
| `GET /api/portal/[token]` | **Publik** — payload portal klien |
| `POST /api/portal/[token]/review` | **Publik** — review deliverable oleh klien |

## ⚠️ Catatan

- Aplikasi ini demo/preview: koneksi kanal (WhatsApp/IG/Email) berjalan pada mode simulasi kecuali dikonfigurasi nyata.
- File dokumen portal (≤1,2 MB) disimpan sebagai base64 di SQLite — untuk produksi gunakan object storage.
- Token portal bersifat rahasia: jangan sebarkan URL di tempat publik.

---

Dibangun dengan ❤️ untuk grup agensi kreatif Unimasi · Segia Tech · Erfo Multimedia · Unicam Studio.
