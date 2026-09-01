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
RUN bun run build

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
# Prisma client + engine (dibutuhkan runtime & db push on-start)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
# Schema prisma + db seed demo bawaan repo (disalin ke volume saat pertama jalan)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/db ./db
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(200<=r.status&&r.status<400?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
