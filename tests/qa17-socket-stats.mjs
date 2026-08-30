// QA 17-d: tes event "stats" notif-service — koneksi LANGSUNG ke ws://localhost:3005
// (khusus tes; client produksi tetap via gateway io("/?XTransformPort=3005")).
import { io } from "socket.io-client";

const url = process.argv[2] ?? "http://localhost:3005";
const socket = io(url, { path: "/", transports: ["websocket", "polling"], forceNew: true, reconnection: false, timeout: 5000 });

let ackStats = null;
let evtStats = null;

socket.on("connect", () => {
  console.log("connected id=", socket.id);
  socket.on("service:stats", (s) => {
    evtStats = s;
    check();
  });
  socket.emit("stats", (s) => {
    ackStats = s;
    check();
  });
});

socket.on("connect_error", (e) => {
  console.error("connect_error:", e?.message ?? e);
  process.exit(1);
});

setTimeout(() => {
  console.error("TIMEOUT — tidak ada respons stats");
  process.exit(1);
}, 6000);

function check() {
  if (!ackStats || !evtStats) return;
  console.log("ACK  stats:", JSON.stringify(ackStats));
  console.log("EVT  service:stats:", JSON.stringify(evtStats));
  const fields = ["startedAt", "uptimeMs", "activeRooms", "totalEmits", "pollCount", "pollErrorCount", "lastPollAt"];
  const a = ackStats; const e = evtStats;
  const okA = fields.every((f) => f in a);
  const okE = fields.every((f) => f in e);
  const typesOk = typeof a.uptimeMs === "number" && typeof a.activeRooms === "number" &&
    typeof a.totalEmits === "number" && typeof a.pollCount === "number" &&
    typeof a.pollErrorCount === "number" && typeof a.startedAt === "string";
  if (!okA || !okE || !typesOk) {
    console.error("GAGAL: field hilang / tipe salah", { okA, okE, typesOk });
    process.exit(1);
  }
  if (typeof e.lastPollAt !== "string" && e.lastPollAt !== null) {
    console.error("GAGAL: lastPollAt bukan string|null");
    process.exit(1);
  }
  console.log("PASS: field & tipe lengkap di ack DAN event service:stats");
  socket.close();
  process.exit(0);
}
