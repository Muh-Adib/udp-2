#!/bin/sh
# =============================================================
# Entrypoint Multi-Brand CRM
# 1. Siapkan direktori data + salin db seed demo saat pertama kali jalan
# 2. Sinkronkan schema Prisma (idempoten, aman diulang)
# 3. Jalankan server Next.js standalone
# =============================================================
set -e

DATA_DIR="/app/data"
DB_FILE="$DATA_DIR/custom.db"
SEED_DB="/app/db/custom.db"

mkdir -p "$DATA_DIR"

if [ ! -f "$DB_FILE" ]; then
  if [ -f "$SEED_DB" ]; then
    echo "[entrypoint] Menyalin database seed demo → $DB_FILE"
    cp "$SEED_DB" "$DB_FILE"
  else
    echo "[entrypoint] Database kosong — akan dibuat oleh prisma db push"
  fi
fi

echo "[entrypoint] Sinkronisasi schema Prisma..."
bunx --bun prisma db push --accept-data-loss --skip-generate --schema=/app/prisma/schema.prisma

echo "[entrypoint] Menjalankan server di port ${PORT:-3000}..."
exec bun .next/standalone/server.js
