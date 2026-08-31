"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionUser, Brand } from "@/lib/crm/types";

export type ModuleKey =
  | "dashboard" | "inbox" | "contacts" | "pipeline" | "followups"
  | "finance" | "reports" | "projects" | "portal" | "channels" | "brands" | "users" | "audit";

export const MODULE_META: Record<ModuleKey, { label: string; description: string; roles: string[] }> = {
  dashboard: { label: "Command Center", description: "Dashboard eksekutif lintas brand", roles: ["super_admin", "director", "marketing", "finance", "production"] },
  inbox: { label: "Lead Inbox", description: "Semua lead baru lintas kanal", roles: ["super_admin", "director", "marketing"] },
  contacts: { label: "Contacts & Companies", description: "Identitas calon klien global", roles: ["super_admin", "director", "marketing", "finance"] },
  pipeline: { label: "Sales Pipeline", description: "Kanban & tabel opportunity", roles: ["super_admin", "director", "marketing", "finance"] },
  followups: { label: "Follow-up", description: "Task & jadwal follow-up", roles: ["super_admin", "director", "marketing", "production"] },
  finance: { label: "Finance", description: "Invoice, pembayaran, aging receivable", roles: ["super_admin", "director", "finance"] },
  reports: { label: "Laporan", description: "Laporan kinerja lintas brand & ekspor CSV", roles: ["super_admin", "director", "finance", "marketing"] },
  projects: { label: "Projects", description: "Produksi setelah deal berhasil", roles: ["super_admin", "director", "production", "marketing"] },
  portal: { label: "Client Portal", description: "Tampilan terbatas untuk klien", roles: ["super_admin", "director", "client"] },
  channels: { label: "Saluran & Integrasi", description: "Hubungkan WhatsApp, Instagram, & Email", roles: ["super_admin", "director"] },
  brands: { label: "Brand Configuration", description: "Konfigurasi brand tanpa ubah source code", roles: ["super_admin", "director"] },
  users: { label: "User & Access", description: "Role dan permission", roles: ["super_admin", "director"] },
  audit: { label: "Audit Logs", description: "Siapa mengubah apa, kapan, dari mana", roles: ["super_admin", "director"] },
};

interface CrmState {
  user: SessionUser | null;
  brands: Brand[];
  activeModule: ModuleKey;
  activeBrandFilter: string; // "all" | brandId
  /** Target fokus lintas modul dari global search (ronde 26) — nonce utk guard idempoten; TIDAK dipersist. */
  pendingFocus: { module: ModuleKey; id: string; nonce: number } | null;
  setUser: (u: SessionUser | null) => void;
  setBrands: (b: Brand[]) => void;
  setActiveModule: (m: ModuleKey) => void;
  setActiveBrandFilter: (b: string) => void;
  setPendingFocus: (f: { module: ModuleKey; id: string }) => void;
  clearPendingFocus: () => void;
}

export const useCrmStore = create<CrmState>()(
  persist(
    (set) => ({
      user: null,
      brands: [],
      activeModule: "dashboard",
      activeBrandFilter: "all",
      pendingFocus: null,
      setUser: (user) => set({ user, activeModule: user ? "dashboard" : "dashboard" }),
      setBrands: (brands) => set({ brands }),
      setActiveModule: (activeModule) => set({ activeModule }),
      setActiveBrandFilter: (activeBrandFilter) => set({ activeBrandFilter }),
      setPendingFocus: (f) => set({ pendingFocus: { ...f, nonce: Date.now() } }),
      clearPendingFocus: () => set({ pendingFocus: null }),
    }),
    { name: "grupcrm-session", partialize: (s) => ({ user: s.user }) }
  )
);

/** Cek apakah user punya akses ke module */
export function canAccess(module: ModuleKey, role?: string | null): boolean {
  if (!role) return false;
  return MODULE_META[module]?.roles.includes(role) ?? false;
}
