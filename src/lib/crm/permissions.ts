import { db } from "@/lib/db";

/**
 * Ronde 47 — RBAC DINAMIS (sumber kebenaran: tabel ModulePermission).
 *
 * Sebelumnya matriks hak akses per modul HARDCODE di MODULE_META (store.ts) —
 * sekarang admin dapat mengubahnya dari UI (User & Access → Matriks Hak Akses)
 * dan server menegakkan level akses pada route sensitif.
 *
 * Level akses (bertingkat):
 *   none  → modul tidak bisa dibuka
 *   read  → hanya melihat data
 *   write → read + membuat/mengubah data operasional
 *   full  → write + aksi kritis (hapus/koreksi, konfigurasi modul)
 *
 * MODULE_META tetap ada sebagai FALLBACK bila tabel kosong (mis. instalasi baru
 * sebelum ensureDefaultPermissions dijalankan) dan sebagai sumber label/deskripsi UI.
 */

export const ACCESS_LEVELS = ["none", "read", "write", "full"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, full: 3 };

export function levelRank(level: string): number {
  return LEVEL_RANK[(level as AccessLevel) ?? "none"] ?? 0;
}

export function isAccessLevel(v: unknown): v is AccessLevel {
  return typeof v === "string" && (ACCESS_LEVELS as readonly string[]).includes(v);
}

/** Daftar modul — sinkron dengan ModuleKey di lib/crm/store.ts (copy defensif server-side). */
export const MODULE_KEYS = [
  "dashboard", "inbox", "contacts", "pipeline", "followups", "tasks",
  "finance", "reports", "projects", "portal", "channels", "brands", "users", "audit",
  "attendance", "requests", "employees", "payroll", "accounting", "work",
] as const;

/**
 * Matriks default (dari konfigurasi MODULE_META sebelumnya) — dipakai saat
 * tabel ModulePermission kosong. Direktur/Super Admin = full; HR→users read;
 * role lain = write utk modul operasionalnya, read utk modul pantauan.
 */
export const DEFAULT_MATRIX: Record<string, Record<string, AccessLevel>> = {
  super_admin: { dashboard: "full", inbox: "full", contacts: "full", pipeline: "full", followups: "full", tasks: "full", finance: "full", reports: "full", projects: "full", portal: "full", channels: "full", brands: "full", users: "full", audit: "full", attendance: "full", requests: "full", employees: "full", payroll: "full", accounting: "full", work: "full" },
  director: { dashboard: "full", inbox: "full", contacts: "full", pipeline: "full", followups: "full", tasks: "full", finance: "full", reports: "full", projects: "full", portal: "full", channels: "full", brands: "full", users: "full", audit: "full", attendance: "full", requests: "full", employees: "full", payroll: "full", accounting: "full", work: "full" },
  manager: { dashboard: "write", inbox: "write", contacts: "write", pipeline: "write", followups: "write", tasks: "write", reports: "write", projects: "write", attendance: "write", requests: "write", employees: "write", work: "full" },
  hr: { dashboard: "read", followups: "write", tasks: "write", users: "read", attendance: "write", requests: "write", employees: "full", payroll: "full", work: "read" },
  marketing: { dashboard: "read", inbox: "write", contacts: "write", pipeline: "write", followups: "write", tasks: "write", reports: "read", projects: "write", attendance: "write", requests: "write", employees: "read", work: "write" },
  finance: { dashboard: "read", contacts: "read", pipeline: "read", tasks: "write", finance: "full", reports: "read", attendance: "write", requests: "write", employees: "read", payroll: "write", accounting: "full", work: "read" },
  production: { dashboard: "read", followups: "write", tasks: "write", projects: "write", attendance: "write", requests: "write", employees: "read", work: "write" },
  client: { dashboard: "read", portal: "read" },
};

/** Pastikan tabel terisi default — idempoten, aman dipanggil tiap GET.
 * Upgrade path (Task 74): bila modul BARU (mis. hasil pemisahan HRIS →
 * attendance/requests/employees atau tasks) belum punya baris utk suatu role,
 * baris default-nya ditambahkan — DB lama (termasuk volume produksi) ikut
 * terisi tanpa seed ulang. Baris modul usang (mis. "hris") dibiarkan —
 * tidak dirujuk nav lagi. */
export async function ensureDefaultPermissions(): Promise<void> {
  const count = await db.modulePermission.count();
  if (count === 0) {
    const rows: { role: string; module: string; level: AccessLevel }[] = [];
    for (const [role, modules] of Object.entries(DEFAULT_MATRIX)) {
      for (const [module, level] of Object.entries(modules)) {
        rows.push({ role, module, level });
      }
    }
    // SQLite createMany tanpa skipDuplicates — dua proses bersamaan tetap aman:
    // pelanggaran unik (P2002) diabaikan karena isinya sama-sama default.
    try {
      await db.modulePermission.createMany({ data: rows });
    } catch {
      // tabel mungkin sudah terisi oleh proses lain — aman diabaikan
    }
    invalidatePermissionCache();
    return;
  }
  // Upgrade inkremental: isi pasangan (role, module) default yang belum ada.
  const existing = await db.modulePermission.findMany({
    select: { role: true, module: true },
  });
  const seen = new Set(existing.map((r) => `${r.role}:${r.module}`));
  const missing: { role: string; module: string; level: AccessLevel }[] = [];
  for (const [role, modules] of Object.entries(DEFAULT_MATRIX)) {
    for (const [module, level] of Object.entries(modules)) {
      if (!seen.has(`${role}:${module}`)) missing.push({ role, module, level });
    }
  }
  if (missing.length === 0) return;
  try {
    await db.modulePermission.createMany({ data: missing });
  } catch {
    // proses lain mungkin sudah mengisi — aman diabaikan
  }
  invalidatePermissionCache();
}

type Matrix = Record<string, Record<string, AccessLevel>>;

let cache: { matrix: Matrix; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30 * 1000;

/** Muat matriks role→module→level dari DB (cache 30 detik per proses). */
export async function loadPermissionMatrix(): Promise<Matrix> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.matrix;
  await ensureDefaultPermissions();
  const rows = await db.modulePermission.findMany();
  const matrix: Matrix = {};
  for (const row of rows) {
    if (!isAccessLevel(row.level)) continue;
    const roleMap: Record<string, AccessLevel> = matrix[row.role] ?? {};
    roleMap[row.module] = row.level;
    matrix[row.role] = roleMap;
  }
  cache = { matrix, loadedAt: Date.now() };
  return matrix;
}

/** Invalidasi cache — dipanggil setelah PUT permissions agar perubahan langsung efektif. */
export function invalidatePermissionCache(): void {
  cache = null;
}

/** Level akses efektif utk (role, module); role/module tak terdaftar = none. */
export async function moduleLevelFor(role: string | null | undefined, module: string): Promise<AccessLevel> {
  if (!role) return "none";
  const matrix = await loadPermissionMatrix();
  return matrix[role]?.[module] ?? "none";
}

export interface ModuleGateInput {
  denied: boolean;
  reason?: string;
  role: string | null;
}

/**
 * Gerbang level modul sisi server: minimal `min` (read/write/full).
 * Dipakai bersama assertRole sebagai lapisan RBAC dinamis.
 */
export async function assertModuleLevel(
  actor: ModuleGateInput,
  module: string,
  min: Exclude<AccessLevel, "none">,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (actor.denied) return { ok: false, reason: actor.reason ?? "Tidak diizinkan" };
  const level = await moduleLevelFor(actor.role, module);
  if (levelRank(level) >= levelRank(min)) return { ok: true };
  return {
    ok: false,
    reason: `Hak akses modul "${module}" untuk peran Anda hanya "${level}" — minimal "${min}" diperlukan (minta admin menaikkan di Matriks Hak Akses)`,
  };
}
