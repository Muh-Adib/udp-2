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
SEED_DB="/app/db/custom.db"

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
