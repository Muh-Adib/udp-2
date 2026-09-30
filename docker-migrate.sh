#!/bin/sh
# =============================================================
# One-shot migration & provisioning — dijalankan oleh SERVICE `migrate`
# (docker compose) SEBELUM service app menyala. Container ini EXIT setelah
# selesai (bukan server!) — runtime app murni `CMD bun server.js` TANPA
# entrypoint (permintaan redesign Ronde 63: migrasi di tahap deploy/build,
# runtime bersih).
#
# Urutan (idempoten, aman diulang tiap deploy):
#   1. SESSION_SECRET: env platform (Coolify) dipakai apa adanya; bila kosong
#      dan file di volume belum ada → generate sekali & simpan PERSISTEN
#      (dibaca src/instrumentation.ts saat app start — secret sama antar
#      deploy, sesi user tidak gugur).
#   2. First-boot: volume tanpa database → salin seed demo (9 user siap login).
#   3. Sinkronisasi schema Prisma (db push).
# Exit != 0 pada langkah mana pun = deploy gagal JELAS (app tidak akan nyala
# dengan schema/secret yang tidak valid) — error migrasi tampil di log deploy.
# =============================================================
set -e

DATA_DIR="/app/data"
DB_FILE="$DATA_DIR/custom.db"
# Seed demo yang di-track git (db/custom.db TIDAK di-track — hanya .seed).
SEED_DB="/app/db/custom.db.seed"
SECRET_FILE="${SESSION_SECRET_FILE:-$DATA_DIR/.session-secret}"
# CLI Prisma versi terkunci bun.lock — JANGAN pakai bunx (mengunduh v7 dari npm).
PRISMA_CLI="/app/node_modules/prisma/build/index.js"

mkdir -p "$DATA_DIR"

# --- 1) SESSION_SECRET file (env platform tetap prioritas) ---
# Format dotenv ("SESSION_SECRET=<hex>") — dibaca runtime via
# `bun --env-file=/app/data/.session-secret` (CMD image): env platform TIDAK
# tertimpa, file hilang tidak masalah, dan secret tersedia SEBELUM modul apa
# pun dievaluasi (termasuk proxy/middleware).
if [ -n "$SESSION_SECRET" ]; then
  echo "[migrate] SESSION_SECRET tersedia dari env platform"
elif [ -s "$SECRET_FILE" ]; then
  echo "[migrate] SESSION_SECRET sudah ada di volume (persisten)"
else
  printf 'SESSION_SECRET=%s\n' \
    "$(bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")" \
    > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE" 2>/dev/null || true
  echo "[migrate] SESSION_SECRET baru digenerate → $SECRET_FILE (persisten antar deploy)"
fi

# --- 2) Seed demo DB (first boot; ! -s = tidak ada ATAU 0 byte) ---
if [ ! -s "$DB_FILE" ]; then
  if [ -f "$SEED_DB" ]; then
    echo "[migrate] Menyalin database seed demo → $DB_FILE"
    cp "$SEED_DB" "$DB_FILE"
  else
    echo "[migrate] Database kosong — akan dibuat oleh prisma db push"
  fi
fi

# --- 3) Sinkronisasi schema ---
echo "[migrate] Sinkronisasi schema Prisma..."
bun "$PRISMA_CLI" db push --accept-data-loss --skip-generate --schema=/app/prisma/schema.prisma

echo "[migrate] Selesai — schema sinkron & secret tersedia. Service app menyala berikutnya."
