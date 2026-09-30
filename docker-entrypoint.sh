#!/bin/sh
# =============================================================
# Entrypoint Multi-Brand CRM
# 1. Siapkan direktori data + salin db seed demo saat pertama kali jalan
# 2. Pastikan SESSION_SECRET tersedia (fail-closed guard Ronde 36 — server menolak
#    menyala di produksi tanpa ini). Prioritas: env platform (Coolify/compose) >
#    secret tersimpan di volume (persisten antar restart) > generate baru.
# 3. Sinkronkan schema Prisma (idempoten, aman diulang)
# 4. Jalankan server Next.js standalone
# =============================================================
set -e

DATA_DIR="/app/data"
DB_FILE="$DATA_DIR/custom.db"
# Seed demo yang di-track git (db/custom.db TIDAK di-track — hanya .seed).
SEED_DB="/app/db/custom.db.seed"
# CLI Prisma dari node_modules citra (versi terkunci di bun.lock) — JANGAN pakai
# `bunx prisma`: node_modules/.bin tidak ikut disalin di image runner, sehingga
# bunx mengunduh Prisma TERBARU dari npm (v7 — perintah `db push` sudah tidak ada,
# gagal: CLI.UNKNOWN_COMMAND "No command registered for `push`").
PRISMA_CLI="/app/node_modules/prisma/build/index.js"

mkdir -p "$DATA_DIR"

# --- SESSION_SECRET (Ronde 36: fail-closed di produksi) ---
if [ -z "$SESSION_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/.session-secret"
  if [ -f "$SECRET_FILE" ]; then
    SESSION_SECRET="$(cat "$SECRET_FILE")"
    echo "[entrypoint] SESSION_SECRET dimuat dari volume (persisten)"
  else
    SESSION_SECRET="$(bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
    printf '%s' "$SESSION_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE" 2>/dev/null || true
    echo "[entrypoint] SESSION_SECRET baru digenerate & disimpan di volume — antar restart tetap sama (sesi user tidak gugur)"
  fi
  export SESSION_SECRET
fi

# ! -s = file tidak ada ATAU berukuran 0 — keduanya dianggap perlu seed.
if [ ! -s "$DB_FILE" ]; then
  if [ -f "$SEED_DB" ]; then
    echo "[entrypoint] Menyalin database seed demo → $DB_FILE"
    cp "$SEED_DB" "$DB_FILE"
  else
    echo "[entrypoint] Database kosong — akan dibuat oleh prisma db push"
  fi
fi

echo "[entrypoint] Sinkronisasi schema Prisma..."
bun "$PRISMA_CLI" db push --accept-data-loss --skip-generate --schema=/app/prisma/schema.prisma

# --- Lokasi server standalone ---
# Dockerfile runner menyalin ISI .next/standalone ke /app (pola resmi Next.js
# Docker: COPY --from=builder /app/.next/standalone ./) → server berada di
# /app/server.js — BUKAN /app/.next/standalone/server.js (layout bersarang hanya
# ada di repo host / `bun start`). Fallback kedua utk kompatibilitas layout lama.
# Tanpa ini container crash-loop: "Module not found .next/standalone/server.js".
if [ -f "/app/server.js" ]; then
  SERVER_JS="/app/server.js"
elif [ -f "/app/.next/standalone/server.js" ]; then
  SERVER_JS="/app/.next/standalone/server.js"
else
  echo "[entrypoint] FATAL: server.js standalone tidak ditemukan di image (cari /app/server.js & /app/.next/standalone/server.js)" >&2
  exit 1
fi

echo "[entrypoint] Menjalankan server di port ${PORT:-3000} (${SERVER_JS})..."
exec bun "$SERVER_JS"
