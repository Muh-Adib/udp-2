"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Hook notifikasi realtime (Fase 3) — satu koneksi socket.io per instance hook
 * (hanya dikonsumsi NotificationCenter) ke mini service notif-service di port 3005.
 *
 * Aturan gateway: browser WAJIB pakai URL relatif `io("/?XTransformPort=3005")`
 * dengan opsi { path: "/" } — JANGAN pernah menulis http://localhost:3005 di client.
 */

export interface UseNotifSocketOptions {
  /** Email pengguna aktif (null/undefined = belum login). */
  email?: string | null;
  /** Filter brand global ("all" atau brand id). */
  brandId?: string;
  /** Matikan hook sepenuhnya (belum login). */
  enabled?: boolean;
  /** Dipanggil saat server memberi tahu ada perubahan notifikasi. */
  onChanged: () => void;
}

export interface UseNotifSocketResult {
  /** true bila socket tersambung ke notif-service (mode realtime). */
  connected: boolean;
}

export function useNotifSocket({
  email,
  brandId,
  enabled = true,
  onChanged,
}: UseNotifSocketOptions): UseNotifSocketResult {
  const [connected, setConnected] = useState(false);

  // Ref agar closure segar tanpa memicu reconnect (args tidak masuk deps effect koneksi)
  const onChangedRef = useRef(onChanged);
  const emailRef = useRef(email);
  const brandRef = useRef(brandId);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    onChangedRef.current = onChanged;
    emailRef.current = email;
    brandRef.current = brandId;
  });

  // Satu koneksi lazy per instance hook — cleanup unsubscribe + disconnect
  useEffect(() => {
    if (!enabled) return;

    const socket = io("/?XTransformPort=3005", {
      path: "/",
      transports: ["polling", "websocket"],
    });
    socketRef.current = socket;

    const subscribe = () => {
      const em = emailRef.current;
      if (!em) return;
      socket.emit("subscribe", { email: em, brandId: brandRef.current });
      setConnected(true);
    };

    // connect terpicu ulang juga saat auto-reconnect — subscribe selalu pakai nilai ref terbaru
    socket.on("connect", subscribe);
    socket.io.on("reconnect", subscribe);
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("notif:changed", () => onChangedRef.current());

    return () => {
      const em = emailRef.current;
      if (em) socket.emit("unsubscribe", { email: em, brandId: brandRef.current });
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [enabled]);

  // Re-subscribe saat email/brandId berubah (unsubscribe room lama + subscribe baru)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !email || !enabled) return;
    socket.emit("unsubscribe", { email, brandId });
    socket.emit("subscribe", { email, brandId });
  }, [email, brandId, enabled]);

  return { connected };
}
