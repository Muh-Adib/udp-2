# Panduan Environment Variables — Deploy Coolify

Dokumen ini merangkum **semua** environment variable aplikasi UDP ERP saat deploy
via Coolify (docker compose + SQLite). Referensi teknis: `docker-compose.yml`,
`Dockerfile`, `docker-migrate.sh`, contoh lengkap di `.env.example`.

> **Prinsip utama:** tidak ada nilai yang dikunci (hardcode) di dalam image.
> Semua variabel bersifat **opsional dengan default aman** — mengisinya atau tidak
> keduanya menghasilkan deploy yang sehat. Fitur opsional aktif hanya bila
> variabelnya diisi.

---

## 1. Daftar variabel

| Variabel | Wajib/Opsional | Default bila kosong | Efek bila diisi |
|---|---|---|---|
| `NODE_ENV` | Otomatis | `production` (di-set compose/Dockerfile) | Jangan diubah di Coolify; `development` mematikan sejumlah guard produksi. |
| `DATABASE_URL` | Otomatis | `file:/app/data/custom.db` (path volume persisten) | Jangan diubah — mengarah ke volume `db-data` agar data tersimpan antar deploy. |
| `SESSION_SECRET` | Opsional | Digenerate otomatis (lihat §3) | Dipakai sebagai kunci tanda-tangan cookie sesi; sama antar deploy bila diisi sendiri. |
| `ALLOW_RESEED` | Opsional | Reseed paksa **nonaktif** di produksi | Isi `1` untuk mengizinkan reseed database via `POST /api/bootstrap` (butuh sesi Super Admin + flag `force`). |
| `WHATSAPP_VERIFY_TOKEN` | Opsional | Fallback ke verifyToken kanal di DB (UI Saluran & Integrasi) | Token handshake webhook WhatsApp (`GET ?hub.verify_token=...`). Token demo repo hanya berlaku di development. |
| `WHATSAPP_APP_SECRET` | Opsional (disarankan utk produksi) | Fallback ke appSecret kanal di DB | Secret validasi tanda-tangan `X-Hub-Signature-256` webhook. Produksi **tanpa** secret (env & DB) menolak webhook (fail-closed). |
| `VAPID_PUBLIC_KEY` | Opsional | Web push **nonaktif** | Kunci publik VAPID; UI otomatis menyembunyikan toggle push bila kosong. |
| `VAPID_PRIVATE_KEY` | Opsional | Web push **nonaktif** | Kunci privat VAPID (pasangan dgn kunci publik). Generate: `bunx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT` | Opsional | `mailto:dev@udp.co.id` | Kontak pemilik kunci push (format `mailto:` atau `https:`). |
| `NEXT_TELEMETRY_DISABLED` | Otomatis | `1` (di-set compose) | Menonaktifkan telemetri Next.js. |
| `SERVICE_FQDN_APP_3000` | Otomatis (Coolify) | — | Generated stack value: Coolify membuat domain & mem-proxynya ke port 3000 container. Jangan dihapus. |

### Yang TIDAK ada lagi

- `ZAI_API_KEY` / `Z_AI_API_KEY` — **dihapus**. Aplikasi tidak memanggil API
  chat/AI pihak ketiga sama sekali: fitur "Ringkasan Otomatis" pada opportunity
  dihitung dengan heuristik lokal (rule-based Bahasa Indonesia) langsung dari data
  database, **tanpa panggilan jaringan eksternal** dan **tanpa biaya**.

---

## 2. Cara mengisi di Coolify

1. Buka project/aplikasi **UDP ERP** di dashboard Coolify.
2. Masuk ke tab **Environment Variables**.
3. Tambahkan variabel yang diperlukan (lihat tabel §1), mis. `WHATSAPP_APP_SECRET`
   lalu nilainya di kolom Value. Variabel yang tidak dipakai cukup **tidak diisi** —
   compose memakai pola `${VAR:-}` sehingga kosong = string kosong = fitur off.
4. Klik **Save**, lalu **Redeploy** agar container menyerap env baru.
5. Verifikasi setelah deploy: status container `app` sehat (healthcheck hijau) dan
   `GET /api/health` mengembalikan `{"status":"ok"}` lewat domain Coolify.

> Catatan: variabel `DATABASE_URL`, `NODE_ENV`, `NEXT_TELEMETRY_DISABLED`, dan
> `SERVICE_FQDN_APP_3000` sudah ditangani compose/Dockerfile/Coolify — cukup
> biarkan seperti adanya.

---

## 3. Catatan SESSION_SECRET

`SESSION_SECRET` menandatangani cookie sesi (`crm_session`, HMAC — fail-closed
sejak Ronde 36). Prioritas pembacaannya:

1. **Env Coolify** — bila diisi di tab Environment Variables, nilainya dipakai apa adanya.
2. **File `/app/data/.session-secret` di volume** — dimuat otomatis oleh
   `bun --env-file=/app/data/.session-secret` pada CMD Dockerfile, SEBELUM modul
   aplikasi apa pun dievaluasi. Env Coolify tidak tertimpa oleh file ini.
3. **Generate otomatis** — bila env kosong dan file belum ada, service one-shot
   `migrate` (yang berjalan sebelum `app` tiap deploy) mengenerate secret sekali dan
   menyimpannya persisten di volume, sehingga **sesi user tidak gugur antar redeploy**.

Opsi pengguna:

- **Biarkan kosong (direkomendasikan)** → otomatis, aman, persisten di volume.
- **Isi sendiri** → `openssl rand -hex 32`, tempel hasilnya ke
  `SESSION_SECRET` di Coolify. Berguna bila ingin secret yang identik di beberapa
  replika/deployment terpisah.

---

## 4. Healthcheck

Compose memasang healthcheck pada service `app`:

```
GET http://127.0.0.1:3000/api/health  →  200 {"status":"ok"}
```

Interval 30s, timeout 5s, start period 20s, retries 3. Endpoint ini TIDAK butuh
sesi (allowlist `proxy.ts`). Container `app` baru dianggap sehat setelah service
`migrate` selesai sukses (seed first-boot + `prisma db push` + persiapan secret).

---

## 5. Tanpa API pihak ketiga berbayar

Aplikasi berjalan **sepenuhnya mandiri**:

- Ringkasan opportunity ("Ringkasan Otomatis") = heuristik lokal dari data
  opportunity/interaksi/task/invoice — tanpa panggilan jaringan eksternal.
- Kredensial kanal komunikasi (WhatsApp/e-mail/Instagram) dikelola per kanal dari
  UI **Saluran & Integrasi** (tersimpan di database), bukan lewat env global.
- Satu-satunya layanan eksternal opsional adalah **Web Push browser** (gratis,
  butuh pasangan kunci VAPID di atas) dan webhook WhatsApp Meta bila kanalnya
  diaktifkan.
