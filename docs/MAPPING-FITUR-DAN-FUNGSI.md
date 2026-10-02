# UDP ERP — Pemetaan Fitur, Fungsi, Entitas & Relasi (Rancangan Ditinjau Ulang)

> Tujuan: peta lengkap satu-sumber untuk meninjau ulang (review) fitur, fungsi, entitas,
> dan relasi aplikasi — dasar perbaikan bertahap. Disusun pada Task 74 pasca
> **penataan ulang UI** (pemisahan Follow-up vs Tugas, pemecahan HRIS monolitik),
> **pembersihan env Coolify**, dan **penghapusan ketergantungan API chat Z**.
> Dokumen pendamping: `docs/ARSITEKTUR-DAN-BUSINESS-LOGIC.md` (arsitektur teknis) &
> `docs/ENV-COOLIFY.md` (variabel environment deployment).

---

## 1. Peta Navigasi Baru (Task 74 — penataan ulang agar mudah untuk setiap user)

| Section | Modul | Isi fokus | Siapa yang melihat |
|---|---|---|---|
| **Beranda** | Command Center | KPI eksekutif, funnel, SLA | Semua kecuali client penuh |
| **Komersial** | Lead Inbox | Lead baru lintas kanal → konversi | director/manager/marketing |
| | Contacts & Companies | Identitas klien global | + finance |
| | Sales Pipeline | Kanban 12 stage, quotation, estimasi | + finance |
| | Follow-up | **Hanya follow-up komersial** (type=follow_up) | director/manager/hr/marketing/production |
| | Laporan | Laporan kinerja + ekspor CSV | director/manager/finance/marketing |
| **Produksi** | Projects | Produksi pasca-deal, milestone, BASTP | director/manager/production/marketing |
| | **Tugas (baru)** | **Tugas produksi/rapat/internal (non-follow_up)** + task project/milestone | semua internal |
| | Workflows | Template workflow berversi, deliverable, periode kerja | semua internal |
| **Keuangan** | Finance | Invoice, pembayaran, aging, termin | director/finance |
| | Pembukuan | COA, jurnal balanced, periode tutup buku, kewajiban | director/finance |
| **SDM** | Kehadiran (baru) | Check-in/out saya, absensi tim, log harian | semua internal |
| | Pengajuan (baru) | Izin/lembur/dinas — ajukan + alur persetujuan | semua internal |
| | Kepegawaian (baru) | Data karyawan + kuota cuti tahunan | director/manager/hr/finance |
| | Payroll & Poin | Periode gaji, slip, poin, insentif, magang | director/hr/finance |
| **Eksternal** | Client Portal | Tampilan klien (project, invoice, dokumen) | client/director |
| **Sistem** | Saluran & Integrasi | WhatsApp/Instagram/Email kanal | director |
| | Brand Configuration | Konfigurasi brand tanpa ubah kode | director |
| | User & Access | User + matriks RBAC dinamis | director/hr |
| | Audit Logs | Jejak semua perubahan | director |

Prinsip pemisahan (permintaan owner): **follow-up ≠ tugas** — follow-up adalah aktivitas
komersial menjaga lead/opportunity; tugas adalah pekerjaan produksi/rapat/internal yang
menempel ke project/milestone. Keduanya kini modul, tampilan, dan filter API terpisah
(`?type=follow_up` vs `?excludeType=follow_up`). **HRIS ≠ satu layar padat** — dipecah
3 modul fokus sehingga staf hanya melihat yang relevan (kehadiran & pengajuan).

---

## 2. Mapping Fitur → Fungsi → Entitas per Domain

Format: **Fitur** → fungsi (endpoint) → entitas & relasi → status → gap/rekomendasi.

### 2.1 Beranda (Command Center)
- **KPI eksekutif** → `GET /api/dashboard` → agregat atas Opportunity, Task, Invoice, Interaction → ✅ stabil.
- **Funnel 12 stage, forecast 30/60/90, tren 6 minggu, performa marketing, alasan lost** → sama endpoint → ✅.
- **Peringatan SLA** → dari interaction SLA jam → ✅.
- Gap: KPI masih global per brand filter; belum ada **widget personal** (tugas saya, pengajuan saya).
  → *Rekomendasi: strip "Hari Ini Untuk Saya" (tugas due hari ini + status kehadiran + pengajuan pending).*

### 2.2 Komersial
- **Lead multi-kanal** → `GET /api/inbox`, `POST /api/inbox/convert|link|respond|escalate` → Interaction→(Company→)Contact→Opportunity → ✅.
- **Identitas & dedup** → `POST /api/identify`, `POST /api/contacts/merge`, `/api/contacts/duplicates` → Contact, Company → ✅.
- **Pipeline** → `GET/POST/PATCH /api/opportunities(+[id], estimation, summary, import)` → Opportunity(relasi Brand, Contact, Company) → ✅. Transisi won otomatis buat Project+Milestone+Invoice DP (server-side, 9 langkah).
- **Ringkasan otomatis** → `GET /api/opportunities/[id]/summary` → **heuristik rule-based lokal (Task 74-c)** — tanpa API chat Z/eksternal → ✅ sesuai kebijakan "tidak pakai API chat Z".
- **Estimasi** → `POST /api/opportunities/[id]/estimation`, `/api/estimations/suggestions` → Estimation, Service, ServiceCategory → ✅.
- **Quotation** → `/api/quotations(+[id])`, share publik `?quote=` → Quotation, QuotationShareToken, termOfPayment (TOP engine) → ✅; konversi quotation→invoice mewarisi jadwal termin.
- **Follow-up** → `GET /api/tasks?type=follow_up` → Task(type=follow_up, relasi Opportunity) → ✅ **terpisah dari Tugas**.
- **Ekspor CSV** → `GET /api/exports/opportunities` → ✅.
- Gap/rekomendasi:
  - `validUntil` quotation belum ditegakkan (kelemahan terdokumentasi Bab 12) → *prioritas: warning kedaluwarsa + auto-turun stage.*
  - Nurture segment belum punya alur otomatis (campaign) → *fase lanjut: segment scheduler.*

### 2.3 Produksi
- **Projects & milestone** → `/api/projects(+milestones, deliverables, email-link)` → Project→Milestone, ProjectDeliverable → ✅.
- **Tugas produksi** → `GET /api/tasks?excludeType=follow_up` (+filter project/milestone) → Task(relasi Project, Milestone) → ✅ **modul baru (Task 74-b)**.
- **Workflow berversi** → `/api/erp/work/*` (templates+versions, instances, deliverables+versions, periods, overview) → WorkflowTemplate→WorkflowVersion→WorkflowStep; WorkflowInstance; DeliverableVersion; WorkPeriod → ✅.
  - **Catatan owner: "workflow bentuknya dinamis dan ada di dalam task?"** — Saat ini tahap workflow dimajukan manual di modul Workflows dan TIDAK otomatis membuat Task.
    → *Rekomendasi prioritas: saat instance maju ke stage tertentu, auto-generate Task (type=production) menempel instance+project dengan dueDate dari SLA stage; kartu workflow "Sedang: X" muncul di modul Tugas. Ini menjawab keinginan "workflow dinamis di dalam task".*
- **Change Request** → `/api/change-requests` → ChangeRequest → ✅ (invoice CR masih hardcode tax 11/IDR — lihat §4).
- **BASTP** → via document actions invoice → ✅.

### 2.4 Keuangan
- **Invoice & pembayaran** → `/api/invoices` + 8 action (issue, send, pay, dsb) → Invoice→Payment → ✅; TOP engine satu sumber kebenaran.
- **Pembukuan** → `/api/erp/finance/*` (accounts COA, journals balanced + post/reverse, periods close, expenses auto-jurnal, disbursements, obligations anti double-pay, summary) → Account, JournalEntry→JournalLine, AccountingPeriod, ExpenseClaim→ExpenseItem, FinancialObligation, CashDisbursement → ✅.
- **Ekspor CSV** → `/api/exports/invoices|expenses` → ✅.
- Gap/rekomendasi:
  - `add_payment` belum memvalidasi sisa (Bab 12) → *prioritas: tolak pembayaran > outstanding.*
  - Bank reconciliation belum ada → *fase lanjut.*
  - Invoice CR hardcode tax 11/IDR → *prioritas: pakai konfigurasi brand/tax (lihat §4 Tax).*

### 2.5 SDM (hasil pemecahan Task 74-a)
- **Kehadiran** → `/api/erp/hris/attendance` (idempoten clientEventId, GPS verdict), `/dailylogs`, `/holidays` → AttendanceEvent, DailyLog, HolidayCalendar; Employee sebagai pusat → ✅.
- **Pengajuan** → `/leave` (+approve/reject/cancel, no-self-approve), `/overtime` (+consent + complianceFlag + verify), `/travel` (state machine + settlement 3 hari kerja) → LeaveRequest, OvertimeRequest, TravelOrder → ✅.
- **Kepegawaian** → `/employees` (ACL bank hr/director), `/leave-balances` (kuota tahunan; terpakai = hari kerja approved cuti minus libur nasional) → Employee, LeaveBalanceLedger → ✅.
- **Payroll & Poin** → `/api/erp/payroll/*` (periods cutoff-21/payDate-25 dimajukan, runs calculate→approve→finalize dengan inputHash, poin kelipatan-10 anti double-pay, insentif no-self-approve, uang saku magang accrual+settlement, UMK) → PayrollPeriod, PayrollRun, Payslip(+Item) immutable, PointAccount/PointLedgerEntry/PointReservation, IncentiveProposal, InternAccrual/InternSettlement, UmkReference → ✅.
- Gap/rekomendasi:
  - Kuota cuti default 12 hari dikode (bisa dioverride per karyawan) → *opsi: jadikan setting per brand/kebijakan via UI.*
  - Geofence radius & offline queue absensi belum ditegakkan → *fase lanjut.*
  - BPJS/PPh21 belum dihitung resmi (potongan flat 5% demo) → *fase lanjut: adapter perhitungan.*

### 2.6 Eksternal & Sistem
- **Client Portal** → `?portal=` token → ClientPortalToken, ClientDocument → ✅; **gap: review deliverable oleh klien belum utuh di portal** (DeliverableVersion client_review sudah ada di API) → *prioritas berikutnya.*
- **Intake publik** → `?intake=` token → LeadIntakeLink → auto company+contact+opportunity+brief → ✅.
- **Saluran** → `/api/channels(+[id], demo, email-sync)`, webhook `/api/webhooks/whatsapp` → ChannelConfig → ✅; kredensial kanal plaintext (Bab 12) → *prioritas: enkripsi at-rest.*
- **Brand** → `/api/brands(+[id], services, numbering)` → Brand, Service, ServiceCategory, NumberingRule, Tax → ✅ konfigurasi penuh via UI (bukan env).
- **Notifikasi** → `/api/notifications`, `/api/notif-prefs`, push `/api/push/*` → NotificationState, PushSubscription, UserPreference → ✅; notif-service mini-service berjalan di dev, produksi menyusul.
- **Approval** → `/api/approvals` → ApprovalRequest → ✅ (belum dipakai lintas modul — *rekomendasi: satukan inbox persetujuan*).
- **Audit** → `/api/audit-logs` → AuditLog (semua mutasi log) → ✅.

---

## 3. Entitas & Relasi — 67 Model (tinjauan)

Kelompok & relasi kunci:
1. **Identitas**: User(role) —1:0..1— Employee; Company —1:N— Contact; Interaction → Brand, Contact.
2. **Komersial**: Opportunity → Brand, Contact, Company; Quotation → Opportunity; Invoice → Opportunity/Project; Payment → Invoice; Task → Opportunity / Project / Milestone (polimorf lewat FK opsional).
3. **Produksi**: Project → Company, Opportunity; Milestone → Project; ProjectDeliverable; WorkflowTemplate → Version → Step; WorkflowInstance → Template+Version; DeliverableVersion → ProjectDeliverable; WorkPeriod.
4. **SDM**: Employee (pusat) → AttendanceEvent, LeaveRequest, OvertimeRequest, TravelOrder, DailyLog, LeaveBalanceLedger (unik per tahun), Payslip, PointAccount.
5. **Payroll**: PayrollPeriod → PayrollRun → Payslip(+Item); InternAccrual/InternSettlement → Employee; UmkReference (wilayah+tahun unik).
6. **Keuangan**: Account (COA); JournalEntry → JournalLine (balanced); AccountingPeriod (close menolak posting); ExpenseClaim → ExpenseItem; FinancialObligation (sumber unik); CashDisbursement.
7. **Sistem**: AuditLog; ModulePermission(role×module×level) — matriks RBAC dinamis; NumberingRule; Tax; ChannelConfig; NotificationState; PushSubscription; ApprovalRequest.

Temuan desain & rekomendasi (untuk diperbaiki bertahap):
| # | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| 1 | `Task.type`, status, dan banyak enum tersimpan string bebas | Kerentanan data kotor | Tambah CHECK-level validasi di layer API (sudah sebagian) + normalisasi konstanta tunggal `TASK_TYPES` |
| 2 | Task punya 3 relasi opsional (opportunity/project/milestone) sekaligus | ambigu untuk UI | Validasi: maksimal satu konteks utama; milestone mewarisi project (sudah) |
| 3 | Workflow stage belum memicu Task | Owner ingin workflow dinamis dalam task | Auto-create Task per stage (lihat §2.3) — prioritas tinggi |
| 4 | `Payment` tanpa validasi sisa (Bab 12) | overpayment | Guard di add_payment |
| 5 | `Tax` model ada tapi CR invoice masih hardcode 11/IDR | inkonsistensi | Pakai Tax/brand currency pada CR |
| 6 | `Employee` 1:1 User opsional — user tanpa employee profile tidak bisa absen | pengalaman | Wizard tautkan otomatis saat user dibuat |
| 7 | Baris ModulePermission modul usang ("hris") tersisa | kosmetik | Skip; tidak dirujuk nav |
| 8 | Kredensial kanal plaintext | keamanan | Enkripsi at-rest + ACL |
| 9 | Belum ada backup otomatis SQLite | keamanan data | Cron VACUUM INTO ke volume kedua |

---

## 4. Env & Deployment Coolify (Task 74-c)

Prinsip: **tidak ada nilai yang dikunci di image** — semua lewat Environment Variables Coolify
(pola `${VAR:-}` di docker-compose), kosong = default aman. Prioritas SESSION_SECRET:
env Coolify → file `/app/data/.session-secret` di volume (generate otomatis oleh service
migrate) — runtime `bun --env-file=... server.js` (tanpa entrypoint).

Daftar variabel (rincian: `docs/ENV-COOLIFY.md`, contoh: `.env.example`):
`NODE_ENV, DATABASE_URL, SESSION_SECRET, ALLOW_RESEED, WHATSAPP_VERIFY_TOKEN,
WHATSAPP_APP_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
NEXT_TELEMETRY_DISABLED` — **ZAI_API_KEY dihapus** (aplikasi tidak memakai API chat Z).
Konfigurasi bisnis (brand, tax, layanan, numbering, RBAC) sengaja BUKAN env —
dikelola user lewat UI (Brand Configuration, User & Access) agar tidak "locked variable".

---

## 5. Keputusan Task 74 & Backlog Prioritas

Dikerjakan sesi ini:
1. Nav 7 section fokus (Beranda/Komersial/Produksi/Keuangan/SDM/Eksternal/Sistem).
2. HRIS monolitik (7 tab, 1.853 baris) → 3 modul: Kehadiran, Pengajuan, Kepegawaian.
3. Follow-up (komersial) ↔ Tugas (produksi/internal) terpisah tampilan + fungsi + API filter.
4. RBAC: 4 ModuleKey baru + **upgrade path otomatis** matriks permission untuk DB lama/produksi.
5. Ringkasan otomatis rule-based lokal (tanpa API chat Z), label UI menyesuaikan.
6. Env Coolify: bersih, semuanya bisa diisi user, `.env.example` + `docs/ENV-COOLIFY.md`.

Backlog prioritas berikutnya (urutan saran):
1. **Workflow → auto-generate Tugas per stage** (menjawab "workflow dinamis dalam task").
2. Guard `add_payment` sisa + validUntil quotation ditegakkan.
3. Portal klien: alur review deliverable (approve/revision) end-to-end.
4. CR invoice pakai Tax/brand (hapus hardcode 11/IDR).
5. Enkripsi kredensial kanal + backup SQLite otomatis (cron VACUUM INTO).
6. Widget personal "Hari Ini Untuk Saya" di Beranda.
7. Bank reconciliation + laporan konsolidasi lintas brand.
