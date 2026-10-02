# Task 74-A — Pecah HRIS monolitik → 3 modul UI

Agent: full-stack-developer (Task ID: 74-a)
Status: SELESAI — tsc 0 error (file saya), lint bersih seluruh repo, QA curl 8 endpoint 200/401, dev server tetap hidup.

## File dibuat (kepemilikan 74-a)
- `src/components/erp/attendance-module.tsx` — "Kehadiran — Check-in & Absensi": kartu aksi cepat pribadi DI ATAS (check-in/out GPS + clientEventId, status hari ini, jam in/out), 4 MiniStat (Hadir/Izin/Belum/Exception), tabel event hari ini, riwayat 7 hari (non-manager+), form + daftar + dialog edit Log Harian. Layout satu kolom.
- `src/components/erp/requests-module.tsx` — "Pengajuan — Izin, Lembur, & Dinas": Tabs 3 tab (Izin/Sakit/Cuti, Lembur, Dinas) + badge pending di header (manager+ = stats pending approvals; staf = pengajuan saya). Semua dialog/aksi lama utuh: ajukan izin, ajukan lembur (consent, compliance preview, on-behalf manager+), verifikasi realisasi (hr/director), travel order state machine (Ajukan/Setujui/Mulai/Settlement/Tutup) + badge settlementStatus.
- `src/components/erp/employees-module.tsx` — "Kepegawaian — Karyawan & Kuota Cuti": Tabs 2 tab. Karyawan: search/filter/tabel + ACL bank field (canSeeBank) + dialog tambah/edit (blok magang kondisional, switch aktif=offboarding). Kuota Cuti (Task 73-b): Select tahun, tabel kuota + LeaveBalanceBar + dialog edit HR+, kartu "Kuota Cuti Saya" utk staf.

## File dihapus
- `src/components/erp/hris-module.tsx` (1.853 baris) — setelah 3 file jadi & tsc bersih; tidak ada referensi tersisa di src.

## Tidak disentuh
app-shell.tsx, store.ts, permissions.ts, hris-client.ts, page.tsx, layout.tsx, globals.css, schema.prisma, semua route API, file CRM lain.

## Catatan teknis utk agent lain
- Helper/badge kecil diduplikasi per modul (self-contained sesuai arahan pemisahan UI). `hrisApi` tidak berubah — tiap modul fetch sendiri sesuai kebutuhan (Promise.allSettled pola lama).
- Muat awal memakai `setTimeout(0)` + cleanup (bukan setState sinkron di effect) karena eslint-plugin-react-hooks v6 (`react-hooks/set-state-in-effect`) menolak setState sinkron dalam effect body. employees sengaja deps `[]` agar ganti tahun kuota tidak memicu loadAll penuh.
- ⚠️ DATA: `db/custom.db` kehilangan seluruh data ERP demo (Employee 11→0 dst; User 9 tetap) pada 06:56 UTC saat task paralel berjalan — BUKAN akibat 74-a (tidak sentuh DB/API). Snapshot `db/custom.db.seed` masih lengkap; perlu restore oleh main agent.
