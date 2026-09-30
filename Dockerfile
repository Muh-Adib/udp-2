# syntax=docker/dockerfile:1
# =============================================================
# Multi-Brand CRM — image produksi (Next.js standalone + Bun)
# Build:  docker compose build
# Jalankan: docker compose up -d   → http://localhost:3000
# =============================================================

# ---------- 1) deps: install + generate prisma client ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
COPY prisma ./prisma
RUN bun install
RUN bunx prisma generate

# ---------- 2) builder: next build (output standalone) ----------
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL hanya dummy utk build — database tidak diakses saat build.
ENV DATABASE_URL="file:/app/db/custom.db"
# SESSION_SECRET dummy utk build — guard fail-closed Ronde 36 di session.ts melempar
# error saat modul dievaluasi "Collecting page data" jika kosong di produksi.
# Runtime memakai secret nyata: env compose/Coolify, atau file di volume yang
# digenerate docker-migrate.sh (dibaca src/instrumentation.ts saat app start).
ENV SESSION_SECRET="build-time-dummy-secret-not-used-at-runtime"
RUN bun run build

# Validasi schema di tahap BUILD (permintaan Ronde 63: migrasi/validasi di build,
# bukan runtime) — schema.prisma yang salah/ruptak membuat BUILD GAGAL sekarang,
# bukan crash saat container nyala. Dipush ke db buangan sementara.
RUN DATABASE_URL="file:/tmp/schema-check.db" \
    bun /app/node_modules/prisma/build/index.js db push \
    --skip-generate --schema=/app/prisma/schema.prisma

# ---------- 3) runner: server standalone ringan ----------
FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/app/data/custom.db"

# Server standalone (sudah berisi .next/static & public hasil script build)
COPY --from=builder /app/.next/standalone ./
# Prisma client + engine + CLI + SELURUH closure dependensinya.
# CLI prisma memuat @prisma/config → effect/c12/dst; bila tidak disalin utuh,
# runtime gagal: "Cannot find package 'effect'" (closure divalidasi via simulasi
# layout yang sama — db push sukses). Daftar = hasil walk rekursif deps prisma 6.19.2.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/@standard-schema ./node_modules/@standard-schema
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/c12 ./node_modules/c12
COPY --from=builder /app/node_modules/deepmerge-ts ./node_modules/deepmerge-ts
COPY --from=builder /app/node_modules/effect ./node_modules/effect
COPY --from=builder /app/node_modules/empathic ./node_modules/empathic
COPY --from=builder /app/node_modules/chokidar ./node_modules/chokidar
COPY --from=builder /app/node_modules/confbox ./node_modules/confbox
COPY --from=builder /app/node_modules/defu ./node_modules/defu
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/node_modules/exsolve ./node_modules/exsolve
COPY --from=builder /app/node_modules/giget ./node_modules/giget
COPY --from=builder /app/node_modules/jiti ./node_modules/jiti
COPY --from=builder /app/node_modules/ohash ./node_modules/ohash
COPY --from=builder /app/node_modules/pathe ./node_modules/pathe
COPY --from=builder /app/node_modules/perfect-debounce ./node_modules/perfect-debounce
COPY --from=builder /app/node_modules/pkg-types ./node_modules/pkg-types
COPY --from=builder /app/node_modules/rc9 ./node_modules/rc9
COPY --from=builder /app/node_modules/fast-check ./node_modules/fast-check
COPY --from=builder /app/node_modules/readdirp ./node_modules/readdirp
COPY --from=builder /app/node_modules/citty ./node_modules/citty
COPY --from=builder /app/node_modules/consola ./node_modules/consola
COPY --from=builder /app/node_modules/node-fetch-native ./node_modules/node-fetch-native
COPY --from=builder /app/node_modules/nypm ./node_modules/nypm
COPY --from=builder /app/node_modules/destr ./node_modules/destr
COPY --from=builder /app/node_modules/pure-rand ./node_modules/pure-rand
COPY --from=builder /app/node_modules/tinyexec ./node_modules/tinyexec
# Schema prisma + db seed demo bawaan repo (dipakai service migrate utk first-boot)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/db ./db
# Script one-shot migrate (HANYA dipakai service `migrate` di compose —
# container app tidak pernah menjalankannya; CMD-nya murni `bun server.js`)
COPY docker-migrate.sh ./docker-migrate.sh
RUN chmod +x ./docker-migrate.sh && mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(200<=r.status&&r.status<400?0:1)).catch(()=>process.exit(1))"

# Runtime bersih — TANPA entrypoint, TANPA shell (permintaan Ronde 63).
# Seed + migrasi schema + secret sudah dijamin oleh service one-shot `migrate`
# (docker-migrate.sh) yang selesai dulu (depends_on di docker-compose.yml).
# --env-file memuat secret dari volume SEBELUM modul apa pun dievaluasi:
#  - file hilang → diabaikan diam (fail-closed session.ts tetap berlaku bila
#    secret benar-benar tidak ada di mana pun),
#  - env platform (Coolify) TIDAK tertimpa oleh file.
CMD ["bun", "--env-file=/app/data/.session-secret", "server.js"]
