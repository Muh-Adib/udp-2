import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { getSessionUser } from "@/lib/crm/auth";

/**
 * GET /api/health — monitoring kesehatan sistem (ronde 17-d).
 *
 * Probe server-side read-only, tanpa data sensitif & tanpa auth:
 *  - db.latency: `SELECT 1` diukur via performance.now()
 *  - notifService: probe HTTP http://localhost:3005/ (socket.io path "/" mencegat semua
 *    HTTP → respons APAPUN termasuk 400 berarti proses hidup; fetch error = down)
 *  - uptime proses Next.js + RSS memori
 *
 * status "degraded" bila db lambat (>500ms) atau notif-service down.
 * Cache: no-store (di header) agar panel "Status sistem" selalu mendapat angka segar.
 */

const DB_SLOW_MS = 500;
const NOTIF_TIMEOUT_MS = 2000;

export async function GET(req: NextRequest) {
  // 1) Probe database + latency
  let dbMs: number | null = null;
  let dbUp = true;
  try {
    const t0 = performance.now();
    await db.$queryRaw`SELECT 1`;
    dbMs = Math.round((performance.now() - t0) * 10) / 10;
  } catch {
    dbUp = false;
  }

  // 2) Probe mini service notif (socket.io port 3005) — respons HTTP apapun = hidup
  let notifStatus: "up" | "down" = "down";
  let notifDetail = "";
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NOTIF_TIMEOUT_MS);
    const res = await fetch("http://localhost:3005/", {
      signal: ctl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    notifStatus = "up";
    notifDetail = `HTTP ${res.status} (socket.io path "/")`;
  } catch (err) {
    notifStatus = "down";
    notifDetail = err instanceof Error ? `tidak merespons: ${err.message}` : "tidak merespons";
  }

  const degraded = !dbUp || dbMs === null || dbMs > DB_SLOW_MS || notifStatus === "down";
  const mem = process.memoryUsage();

  // Ronde 36 (audit): detail internal (uptime/RSS/latency/port) hanya utk sesi
  // sah — pemanggil anonim cukup melihat status ringkas (recon surface diperkecil).
  const viewer = await getSessionUser(req);
  const res = ok(
    viewer
      ? {
          status: degraded ? "degraded" : "ok",
          db: { status: dbUp ? "up" : "down", ms: dbMs },
          notifService: { status: notifStatus, detail: notifDetail },
          uptimeSec: Math.round(process.uptime()),
          rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        }
      : { status: degraded ? "degraded" : "ok" },
    200,
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
