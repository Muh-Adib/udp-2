"use client";

// ============ Preferensi Notifikasi per Pengguna (Fase 3 + ronde 16-c) ============
// Sumber kebenaran lintas perangkat: tabel UserPreference via /api/notif-prefs.
// localStorage = cache instan + fallback offline (offline-first).
// Sinkronisasi:
//  - antar komponen satu tab  : CustomEvent "crm:notif-prefs" (tidak berubah)
//  - antar tab satu browser   : event "storage" (tidak berubah)
//  - antar perangkat          : GET/PUT /api/notif-prefs + push realtime socket —
//    push "notif:changed" (mini service) men-dispatch "crm:notif-changed"
//    app-wide di notification-center.tsx → hook refetch & mengadopsi nilai server.

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationType } from "@/lib/crm/types";
import { api } from "@/lib/crm/api-client";

export const NOTIF_PREFS_EVENT = "crm:notif-prefs";

/** Event push realtime app-wide (dipancarkan notification-center saat socket
 * "notif:changed") — didefinisikan di sini agar modul prefs bebas import-cycle;
 * notification-center me-re-export konstanta ini. */
export const NOTIF_CHANGED_EVENT = "crm:notif-changed";

export interface NotifPrefs {
  /** Tipe notifikasi yang di-mute (tidak tampil & tidak dihitung unread). */
  muted: NotificationType[];
  /** Sembunyikan item yang sudah dibaca dari daftar. */
  hideRead: boolean;
}

export const NOTIF_TYPES: { key: NotificationType; label: string; hint: string }[] = [
  { key: "sla", label: "SLA Lead", hint: "Lead melewati batas waktu respons" },
  { key: "message", label: "Pesan Baru", hint: "Balasan/lead baru masuk ke Inbox (Ronde 32)" },
  { key: "approval", label: "Approval", hint: "Pengajuan estimasi & diskon" },
  { key: "cr", label: "Change Request", hint: "CR menunggu persetujuan klien" },
  { key: "task", label: "Task Overdue", hint: "Task follow-up lewat tenggat" },
  { key: "deadline", label: "Deadline Proyek", hint: "Milestone & proyek mendekati due" },
  { key: "invoice", label: "Invoice", hint: "Tagihan jatuh tempo & pembayaran" },
];

const STORAGE_PREFIX = "grupcrm-notif-prefs:";
const PUT_DEBOUNCE_MS = 400; // debounced PUT — ketikan cepat jadi satu permintaan
const REFETCH_DEBOUNCE_MS = 500; // refetch saat push beruntun

const DEFAULT_PREFS: NotifPrefs = { muted: [], hideRead: false };

function storageKey(userEmail: string): string {
  return STORAGE_PREFIX + userEmail.toLowerCase();
}

/** Sanitasi prefs dari sumber tak terpercaya (localStorage / server) → bentuk valid. */
function sanitizePrefs(input: unknown): NotifPrefs {
  const src = (input ?? {}) as Partial<NotifPrefs> | null;
  const validTypes = new Set(NOTIF_TYPES.map((t) => t.key));
  return {
    muted: Array.isArray(src?.muted) ? src.muted.filter((m): m is NotificationType => validTypes.has(m)) : [],
    hideRead: src?.hideRead === true,
  };
}

/** Bandingkan isi prefs (urutan muted tidak signifikan — semantik himpunan). */
function samePrefs(a: NotifPrefs, b: NotifPrefs): boolean {
  if (a.hideRead !== b.hideRead) return false;
  if (a.muted.length !== b.muted.length) return false;
  const setB = new Set(b.muted);
  return a.muted.every((m) => setB.has(m));
}

export function loadNotifPrefs(userEmail?: string | null): NotifPrefs {
  if (typeof window === "undefined" || !userEmail) return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(storageKey(userEmail));
    if (!raw) return { ...DEFAULT_PREFS };
    return sanitizePrefs(JSON.parse(raw));
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

/** Hook reaktif: baca preferensi + re-render saat perubahan (panel lain, tab lain, perangkat lain). */
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

  // --- refs sinkronisasi server (ronde 16-c) ---
  const putTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPutRef = useRef<{ email: string; prefs: NotifPrefs } | null>(null);
  const putInFlightRef = useRef(false);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Kirim PUT sekarang (fire-and-forget, offline-first: gagal → tetap lokal). */
  const flushPendingPut = useCallback(() => {
    if (putTimerRef.current) {
      clearTimeout(putTimerRef.current);
      putTimerRef.current = null;
    }
    const payload = pendingPutRef.current;
    pendingPutRef.current = null;
    if (!payload) return;
    putInFlightRef.current = true;
    api
      .putNotifPrefs(payload.email, payload.prefs)
      .catch(() => {
        // offline-first — local tetap sumber tampilan; server teradopsi via refetch berikutnya
      })
      .finally(() => {
        putInFlightRef.current = false;
      });
  }, []);

  /** Jadwalkan PUT debounced; PUT utk email lain yang tertunda dikirim dulu (jangan tertukar persona). */
  const schedulePut = useCallback(
    (targetEmail: string, prefs: NotifPrefs) => {
      if (pendingPutRef.current && pendingPutRef.current.email !== targetEmail) flushPendingPut();
      pendingPutRef.current = { email: targetEmail, prefs };
      if (putTimerRef.current) clearTimeout(putTimerRef.current);
      putTimerRef.current = setTimeout(() => {
        putTimerRef.current = null;
        flushPendingPut();
      }, PUT_DEBOUNCE_MS);
    },
    [flushPendingPut]
  );

  // Ambil prefs server saat mount / email berubah. Server menang pada load awal
  // bila berbeda dgn cache lokal; PUT lokal yang masih tertunda dipprioritaskan.
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    api
      .getNotifPrefs(email)
      .then((res) => {
        if (cancelled) return;
        const serverPrefs = sanitizePrefs(res.prefs);
        const local = loadNotifPrefs(email);
        const hasPendingLocalEdit =
          putInFlightRef.current || (pendingPutRef.current && pendingPutRef.current.email === email);
        if (!hasPendingLocalEdit && !samePrefs(serverPrefs, local)) {
          setState((prev) => (prev.email === email ? { ...prev, prefs: serverPrefs } : prev));
          saveNotifPrefs(email, serverPrefs); // cache + beri tahu komponen lain
        }
      })
      .catch(() => {
        // offline — cache localStorage dipakai
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  // Cross-device realtime: push "crm:notif-changed" (socket) → refetch prefs;
  // bila nilai server beda dgn state saat ini → adopsi + sebarkan via event lama.
  useEffect(() => {
    if (!email) return;
    const onNotifChanged = () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        if (putInFlightRef.current || pendingPutRef.current) return; // edit lokal belum terkirim — tunggu push berikutnya
        api
          .getNotifPrefs(email)
          .then((res) => {
            const serverPrefs = sanitizePrefs(res.prefs);
            const local = loadNotifPrefs(email);
            if (!samePrefs(serverPrefs, local)) {
              setState((prev) => (prev.email === email ? { ...prev, prefs: serverPrefs } : prev));
              saveNotifPrefs(email, serverPrefs);
            }
          })
          .catch(() => {});
      }, REFETCH_DEBOUNCE_MS);
    };
    window.addEventListener(NOTIF_CHANGED_EVENT, onNotifChanged);
    return () => {
      window.removeEventListener(NOTIF_CHANGED_EVENT, onNotifChanged);
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [email]);

  // Sinkron antar komponen/tab (perilaku lama — tidak berubah)
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

  // Flush PUT tertunda saat unmount agar perubahan terakhir tidak hilang
  useEffect(() => {
    return () => {
      flushPendingPut();
    };
  }, [flushPendingPut]);

  const update = useCallback(
    (next: Partial<NotifPrefs>) => {
      if (!email) return;
      const merged: NotifPrefs = { ...loadNotifPrefs(email), ...next };
      setState({ email, prefs: merged });
      saveNotifPrefs(email, merged); // localStorage instan + event antar komponen
      schedulePut(email, merged); // debounced ke server (sumber kebenaran lintas perangkat)
    },
    [email, schedulePut]
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
