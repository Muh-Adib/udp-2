"use client";

// ============ Preferensi Notifikasi per Pengguna (Fase 3) ============
// Persist di localStorage per persona (kunci = email) + sinkron antar komponen
// (NotificationCenter, widget dashboard) via CustomEvent "crm:notif-prefs".

import { useCallback, useEffect, useState } from "react";
import type { NotificationType } from "@/lib/crm/types";

export const NOTIF_PREFS_EVENT = "crm:notif-prefs";

export interface NotifPrefs {
  /** Tipe notifikasi yang di-mute (tidak tampil & tidak dihitung unread). */
  muted: NotificationType[];
  /** Sembunyikan item yang sudah dibaca dari daftar. */
  hideRead: boolean;
}

export const NOTIF_TYPES: { key: NotificationType; label: string; hint: string }[] = [
  { key: "sla", label: "SLA Lead", hint: "Lead melewati batas waktu respons" },
  { key: "approval", label: "Approval", hint: "Pengajuan estimasi & diskon" },
  { key: "cr", label: "Change Request", hint: "CR menunggu persetujuan klien" },
  { key: "task", label: "Task Overdue", hint: "Task follow-up lewat tenggat" },
  { key: "deadline", label: "Deadline Proyek", hint: "Milestone & proyek mendekati due" },
  { key: "invoice", label: "Invoice", hint: "Tagihan jatuh tempo & pembayaran" },
];

const STORAGE_PREFIX = "grupcrm-notif-prefs:";

const DEFAULT_PREFS: NotifPrefs = { muted: [], hideRead: false };

function storageKey(userEmail: string): string {
  return STORAGE_PREFIX + userEmail.toLowerCase();
}

export function loadNotifPrefs(userEmail?: string | null): NotifPrefs {
  if (typeof window === "undefined" || !userEmail) return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(storageKey(userEmail));
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotifPrefs>;
    const validTypes = new Set(NOTIF_TYPES.map((t) => t.key));
    return {
      muted: Array.isArray(parsed.muted) ? parsed.muted.filter((m): m is NotificationType => validTypes.has(m)) : [],
      hideRead: parsed.hideRead === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveNotifPrefs(userEmail: string, prefs: NotifPrefs): void {
  if (typeof window === "undefined" || !userEmail) return;
  try {
    window.localStorage.setItem(storageKey(userEmail), JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(NOTIF_PREFS_EVENT, { detail: { userEmail } }));
  } catch {
    // localStorage penuh / diblokir — abaikan senyap
  }
}

/** Hook reaktif: baca preferensi + re-render saat perubahan (dari panel mana pun). */
export function useNotifPrefs(userEmail?: string | null) {
  // Pola resmi React "adjust state when a prop changes": sinkronisasi email
  // dilakukan saat render (bukan di effect) agar tidak memicu cascading render.
  const [state, setState] = useState<{ email: string | null; prefs: NotifPrefs }>(() => ({
    email: userEmail ?? null,
    prefs: loadNotifPrefs(userEmail),
  }));

  const email = userEmail ?? null;
  if (state.email !== email) {
    setState({ email, prefs: loadNotifPrefs(userEmail) });
  }

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ userEmail?: string }>).detail;
      // Hanya reaksi jika event dari user yang sama (guard multi-persona satu browser)
      if (!detail?.userEmail || !state.email || detail.userEmail.toLowerCase() === state.email.toLowerCase()) {
        setState((prev) => ({ ...prev, prefs: loadNotifPrefs(prev.email) }));
      }
    };
    window.addEventListener(NOTIF_PREFS_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(NOTIF_PREFS_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [state.email]);

  const update = useCallback(
    (next: Partial<NotifPrefs>) => {
      if (!email) return;
      const merged: NotifPrefs = { ...loadNotifPrefs(email), ...next };
      setState({ email, prefs: merged });
      saveNotifPrefs(email, merged);
    },
    [email]
  );

  const toggleMuted = useCallback(
    (type: NotificationType) => {
      if (!email) return;
      const cur = loadNotifPrefs(email);
      const muted = cur.muted.includes(type) ? cur.muted.filter((m) => m !== type) : [...cur.muted, type];
      update({ muted });
    },
    [update, email]
  );

  return { prefs: state.prefs, update, toggleMuted };
}

/** Terapkan preferensi ke daftar notifikasi + hitung ulang unread. */
export function applyNotifPrefs<T extends { type: NotificationType; read: boolean }>(
  items: T[],
  prefs: NotifPrefs
): { items: T[]; unread: number } {
  const muted = new Set(prefs.muted);
  const filtered = items.filter((i) => !muted.has(i.type) && (!prefs.hideRead || !i.read));
  return { items: filtered, unread: filtered.filter((i) => !i.read).length };
}
