/**
 * notif-service — mini service socket.io untuk push realtime notifikasi (Fase 3).
 *
 * Kontrak (Task 15-b):
 *  - Listen hardcoded PORT 3005 (gateway Caddy/XTransform meneruskan `/?XTransformPort=3005`).
 *  - path "/" WAJIB (dipakai gateway utk routing, lihat examples/websocket/server.ts).
 *  - "subscribe" {email, brandId?}  → join room `${email}::${brandId ?? "all"}`, emit "subscribed" {room}
 *  - "unsubscribe"                  → leave room socket tsb
 *  - "ping"                         → "pong" {at}
 *  - Poll loop 15 dtk: utk tiap room aktif → GET http://localhost:3000/api/notifications?user=... (+brandId)
 *    → hash sha1(`${unread}|${items.map(i=>i.key).join(",")}`) → berubah? emit "notif:changed".
 *    Observasi pertama per room = baseline saja (tanpa emit).
 */
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { createHash } from "crypto";

const PORT = 3005; // hardcoded — JANGAN process.env.PORT (konvensi gateway)
const POLL_MS = 15_000;
const APP_ORIGIN = "http://localhost:3000";

function log(msg: string) {
  console.log(`[notif-service ${new Date().toISOString()}] ${msg}`);
}

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

/** room key = `${email}::${brandId ?? "all"}` → Set<socketId>. Room kosong dihapus. */
const rooms = new Map<string, Set<string>>();
/** room key → hash observasi terakhir (baseline saat pertama dilihat). */
const baselines = new Map<string, string>();

function roomKey(email: string, brandId?: string | null): string {
  return `${email}::${brandId && brandId !== "all" ? brandId : "all"}`;
}

function currentRoom(socket: Socket): string | null {
  const v = socket.data.room;
  return typeof v === "string" ? v : null;
}

function joinRoom(socket: Socket, key: string) {
  let set = rooms.get(key);
  if (!set) {
    set = new Set<string>();
    rooms.set(key, set);
  }
  set.add(socket.id);
  socket.data.room = key;
  void socket.join(key);
}

function leaveRoom(socket: Socket, key: string) {
  const set = rooms.get(key);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) {
      rooms.delete(key);
      baselines.delete(key);
    }
  }
  if (socket.data.room === key) socket.data.room = null;
  void socket.leave(key);
}

io.on("connection", (socket) => {
  log(`connect socket=${socket.id} — rooms aktif: ${rooms.size}, klien: ${io.engine.clientsCount}`);

  socket.on("subscribe", (payload: { email?: unknown; brandId?: unknown } | undefined) => {
    const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) {
      socket.emit("subscribed", { room: null, error: "email wajib" });
      return;
    }
    const brandId = typeof payload?.brandId === "string" ? payload.brandId : "all";
    const key = roomKey(email, brandId);
    const prev = currentRoom(socket);
    if (prev === key) return; // idempoten — hindari dobel join
    if (prev) leaveRoom(socket, prev);
    joinRoom(socket, key);
    socket.emit("subscribed", { room: key });
    log(`subscribe room=${key} socket=${socket.id} — rooms aktif: ${rooms.size}`);
  });

  socket.on("unsubscribe", (payload: { email?: unknown; brandId?: unknown } | undefined) => {
    let key = currentRoom(socket);
    if (!key && typeof payload?.email === "string") {
      key = roomKey(payload.email.trim().toLowerCase(), typeof payload.brandId === "string" ? payload.brandId : "all");
    }
    if (key) {
      leaveRoom(socket, key);
      log(`unsubscribe room=${key} socket=${socket.id} — rooms aktif: ${rooms.size}`);
    }
  });

  socket.on("ping", () => socket.emit("pong", { at: new Date().toISOString() }));

  socket.on("disconnect", () => {
    const key = currentRoom(socket);
    if (key) leaveRoom(socket, key);
    log(`disconnect socket=${socket.id} room=${key ?? "-"} — rooms aktif: ${rooms.size}, klien: ${io.engine.clientsCount}`);
  });

  socket.on("error", (err) => {
    console.error(`[notif-service] socket error (${socket.id}):`, err instanceof Error ? err.message : err);
  });
});

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

let fetchFailLogged = false;

async function pollOnce(): Promise<void> {
  for (const key of [...rooms.keys()]) {
    const sep = key.indexOf("::");
    const email = key.slice(0, sep);
    const brandId = key.slice(sep + 2);
    const url =
      `${APP_ORIGIN}/api/notifications?user=${encodeURIComponent(email)}` +
      (brandId !== "all" ? `&brandId=${encodeURIComponent(brandId)}` : "");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { unread?: number; items?: Array<{ key?: string }> } };
      const data = json?.data ?? (json as { unread?: number; items?: Array<{ key?: string }> });
      const unread = Number(data?.unread ?? 0);
      const items = Array.isArray(data?.items) ? data.items : [];
      const keyList = items.map((i) => String(i.key ?? "")).join(",");
      const hash = sha1(`${unread}|${keyList}`);
      const prev = baselines.get(key);
      baselines.set(key, hash);
      fetchFailLogged = false;
      if (prev === undefined) continue; // observasi pertama = baseline saja
      if (prev !== hash) {
        io.to(key).emit("notif:changed", {
          email,
          brandId,
          unread,
          at: new Date().toISOString(),
        });
        log(`notif:changed → room=${key} unread=${unread}`);
      }
    } catch (err) {
      if (!fetchFailLogged) {
        console.error(`[notif-service] fetch notifikasi gagal (${key}):`, err instanceof Error ? err.message : err);
        fetchFailLogged = true;
      }
    }
  }
}

const pollTimer = setInterval(() => {
  void pollOnce();
}, POLL_MS);

httpServer.listen(PORT, () => {
  log(`notif-service listening di :${PORT} (path "/", poll ${POLL_MS / 1000} dtk)`);
});

function shutdown(signal: string) {
  log(`menerima ${signal} — mematikan server...`);
  clearInterval(pollTimer);
  io.close();
  httpServer.close(() => {
    log("server ditutup");
    process.exit(0);
  });
  // Failsafe: jangan menggantung bila ada koneksi membandel
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
