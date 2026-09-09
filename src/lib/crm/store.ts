"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/crm/api-client";
import type { SessionUser, Brand } from "@/lib/crm/types";

export type ModuleKey =
  | "dashboard" | "inbox" | "contacts" | "pipeline" | "followups"
  | "finance" | "reports" | "projects" | "portal" | "channels" | "brands" | "users" | "audit";

/** Ronde 47 — level akses RBAC dinamis (tersimpan di tabel ModulePermission). */
export type AccessLevel = "none" | "read" | "write" | "full";

export const MODULE_META: Record<ModuleKey, { label: string; description: string; roles: string[] }> = {
  dashboard: { label: "Command Center", description: "Dashboard eksekutif lintas brand", roles: ["super_admin", "director", "manager", "hr", "marketing", "finance", "production"] },
  inbox: { label: "Lead Inbox", description: "Semua lead baru lintas kanal", roles: ["super_admin", "director", "manager", "marketing"] },
  contacts: { label: "Contacts & Companies", description: "Identitas calon klien global", roles: ["super_admin", "director", "manager", "marketing", "finance"] },
  pipeline: { label: "Sales Pipeline", description: "Kanban & tabel opportunity", roles: ["super_admin", "director", "manager", "marketing", "finance"] },
  followups: { label: "Follow-up", description: "Task & jadwal follow-up", roles: ["super_admin", "director", "manager", "hr", "marketing", "production"] },
  finance: { label: "Finance", description: "Invoice, pembayaran, aging receivable", roles: ["super_admin", "director", "finance"] },
  reports: { label: "Laporan", description: "Laporan kinerja lintas brand & ekspor CSV", roles: ["super_admin", "director", "manager", "finance", "marketing"] },
  projects: { label: "Projects", description: "Produksi setelah deal berhasil", roles: ["super_admin", "director", "manager", "production", "marketing"] },
  portal: { label: "Client Portal", description: "Tampilan terbatas untuk klien", roles: ["super_admin", "director", "client"] },
  channels: { label: "Saluran & Integrasi", description: "Hubungkan WhatsApp, Instagram, & Email", roles: ["super_admin", "director"] },
  brands: { label: "Brand Configuration", description: "Konfigurasi brand tanpa ubah source code", roles: ["super_admin", "director"] },
  users: { label: "User & Access", description: "Role dan permission", roles: ["super_admin", "director", "hr"] },
  audit: { label: "Audit Logs", description: "Siapa mengubah apa, kapan, dari mana", roles: ["super_admin", "director"] },
};

/** Ronde 47 — matriks default (fallback statis bila matriks DB belum termuat). */
const STATIC_DEFAULT_MATRIX: Record<string, Record<string, AccessLevel>> = {
  super_admin: { dashboard: "full", inbox: "full", contacts: "full", pipeline: "full", followups: "full", finance: "full", reports: "full", projects: "full", portal: "full", channels: "full", brands: "full", users: "full", audit: "full" },
  director: { dashboard: "full", inbox: "full", contacts: "full", pipeline: "full", followups: "full", finance: "full", reports: "full", projects: "full", portal: "full", channels: "full", brands: "full", users: "full", audit: "full" },
  manager: { dashboard: "write", inbox: "write", contacts: "write", pipeline: "write", followups: "write", reports: "write", projects: "write" },
  hr: { dashboard: "read", followups: "write", users: "read" },
  marketing: { dashboard: "read", inbox: "write", contacts: "write", pipeline: "write", followups: "write", reports: "read", projects: "write" },
  finance: { dashboard: "read", contacts: "read", pipeline: "read", finance: "full", reports: "read" },
  production: { dashboard: "read", followups: "write", projects: "write" },
  client: { dashboard: "read", portal: "read" },
};

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2, full: 3 };

interface CrmState {
  user: SessionUser | null;
  brands: Brand[];
  activeModule: ModuleKey;
  activeBrandFilter: string; // "all" | brandId
  /** Ronde 47 — matriks hak akses dinamis role→module→level dari DB (null = belum termuat). */
  permissionMatrix: Record<string, Record<string, AccessLevel>> | null;
  /** Target fokus lintas modul dari global search (ronde 26) — nonce utk guard idempoten; TIDAK dipersist.
   * Ronde 34-b: `kind` opsional — "lead" (default: id interaksi/opportunity, global search & Buka Percakapan)
   * atau "contact" (id kontak → thread terbaru kontak tsb, pencocokan identitas fallback). */
  pendingFocus: { module: ModuleKey; id: string; nonce: number; kind?: string } | null;
  setUser: (u: SessionUser | null) => void;
  setBrands: (b: Brand[]) => void;
  setActiveModule: (m: ModuleKey) => void;
  setActiveBrandFilter: (b: string) => void;
  setPendingFocus: (f: { module: ModuleKey; id: string; kind?: string }) => void;
  clearPendingFocus: (nonce?: number) => void;
  /** Ronde 47 — muat matriks hak akses dari server (dipanggil saat mount setelah sesi diketahui). */
  loadPermissions: () => Promise<void>;
  /** Ronde 40-C — muat ulang daftar brand dari server (form/dialog tidak lagi
   * menampilkan daftar brand basi setelah brand dibuat/diubah; brand hanya
   * dimuat sekali di page mount). Aman dipanggil kapan saja; gagal = diamkan. */
  refreshBrands: () => Promise<void>;
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set) => ({
      user: null,
      brands: [],
      activeModule: "dashboard",
      activeBrandFilter: "all",
      permissionMatrix: null,
      pendingFocus: null,
      setUser: (user) => set({ user, activeModule: user ? "dashboard" : "dashboard" }),
      setBrands: (brands) => set({ brands }),
      setActiveModule: (activeModule) => set({ activeModule }),
      setActiveBrandFilter: (activeBrandFilter) => set({ activeBrandFilter }),
      setPendingFocus: (f) => set({ pendingFocus: { ...f, nonce: Date.now() } }),
      clearPendingFocus: () => set({ pendingFocus: null }),
      loadPermissions: async () => {
        try {
          const res = await api.permissions();
          set({ permissionMatrix: res.permissions as Record<string, Record<string, AccessLevel>> });
        } catch {
          // diamkan — fallback statis tetap dipakai sampai muat berhasil
        }
      },
      refreshBrands: async () => {
        try {
          const { brands } = await api.brands();
          set({ brands });
        } catch {
          // diamkan — daftar brand lama tetap terpakai sampai refresh berhasil
        }
      },
    }),
    { name: "udp-crm-session", partialize: (s) => ({ user: s.user }) }
  )
);

/** Ronde 47 — level akses efektif (role, module): matriks DB dulu, fallback statis. */
export function moduleLevel(module: ModuleKey, role?: string | null): AccessLevel {
  if (!role) return "none";
  const matrix = useCrmStore.getState().permissionMatrix ?? STATIC_DEFAULT_MATRIX;
  return matrix[role]?.[module] ?? "none";
}

/** Cek apakah user punya akses ke module (level > none) — dipakai nav, search, guard. */
export function canAccess(module: ModuleKey, role?: string | null): boolean {
  return moduleLevel(module, role) !== "none";
}

/** Ronde 47 — boleh MENGUBAH data di modul (write/full)? Untuk menyembunyikan tombol tulis. */
export function canWrite(module: ModuleKey, role?: string | null): boolean {
  return LEVEL_RANK[moduleLevel(module, role)] >= LEVEL_RANK.write;
}

/** Ronde 47 — akses penuh modul (termasuk aksi kritis/konfigurasi). */
export function canFull(module: ModuleKey, role?: string | null): boolean {
  return moduleLevel(module, role) === "full";
}

/** Label level utk UI editor matriks. */
export const ACCESS_LEVEL_META: Record<AccessLevel, { label: string; cls: string; description: string }> = {
  none: { label: "Tidak Ada", cls: "bg-zinc-100 text-zinc-500", description: "Modul tersembunyi" },
  read: { label: "Lihat", cls: "bg-sky-50 text-sky-700 border-sky-200", description: "Hanya melihat data" },
  write: { label: "Tulis", cls: "bg-amber-50 text-amber-700 border-amber-200", description: "Lihat + buat/ubah data" },
  full: { label: "Penuh", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", description: "Tulis + hapus/konfigurasi" },
};

export { LEVEL_RANK };
