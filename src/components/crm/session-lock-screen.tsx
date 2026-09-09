"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "@/lib/crm/api-client";
import { useCrmStore } from "@/lib/crm/store";
import { initials } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";
import { Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";

/**
 * Ronde 46 — LAYAR KUNCI SESI (PWA-style).
 * - Muncul saat sesi dikunci (tombol "Kunci Layar" di menu pengguna, atau
 *   otomatis bila API membalas 423 — event `crm:locked`).
 * - Membuka kunci memakai PIN (bukan password) — identitas sesi tetap hidup.
 * - Saat terkunci, middleware menolak semua mutasi API (423) → data aman.
 */
export default function SessionLockScreen() {
  const user = useCrmStore((s) => s.user);
  const setUser = useCrmStore((s) => s.setUser);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cek status kunci saat pertama dipasang + ikuti event global.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) return;
      try {
        const { locked: isLocked } = await api.session();
        if (alive) setLocked(isLocked);
      } catch { /* offline — biarkan state sekarang */ }
    })();
    const on = () => setLocked(true);
    window.addEventListener("crm:locked", on);
    return () => {
      alive = false;
      window.removeEventListener("crm:locked", on);
    };
  }, [user]);

  // Fokus otomatis tiap kali layar kunci muncul.
  useEffect(() => {
    if (locked) {
      setPin("");
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [locked]);

  const unlock = useCallback(async () => {
    if (!pin.trim() || busy) return;
    setBusy(true);
    try {
      await api.unlockSession(pin.trim());
      setLocked(false);
      toast.success("Sesi dibuka — selamat bekerja kembali");
    } catch (err) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      toast.error(err instanceof Error ? err.message : "PIN salah");
      setPin("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }, [pin, busy]);

  async function handleLogout() {
    try { await api.logout(); } catch { /* tetap keluar lokal */ }
    setLocked(false);
    setUser(null);
  }

  if (!user || !locked) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Layar terkunci — masukkan PIN untuk membuka"
    >
      <div
        className={cn(
          "w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl sm:p-8",
          shake && "animate-[shake_0.4s_ease-in-out]"
        )}
      >
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <span
              className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white"
              style={{ backgroundColor: user.avatarColor }}
              aria-hidden
            >
              {initials(user.name)}
            </span>
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 ring-2 ring-zinc-900">
              <LockKeyhole className="h-3.5 w-3.5 text-amber-400" aria-hidden />
            </span>
          </div>
          <p className="mt-3 text-sm font-semibold text-zinc-100">{user.name}</p>
          <p className="text-xs text-zinc-500">{user.email}</p>
          <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-amber-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Layar terkunci — sesi Anda aman
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void unlock(); }}
          className="mt-5 space-y-3"
        >
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="PIN kunci layar"
            aria-label="PIN kunci layar"
            className="h-12 bg-zinc-950 text-center text-lg tracking-[0.5em] text-zinc-100 placeholder:text-zinc-600"
            disabled={busy}
          />
          <Button type="submit" className="h-11 w-full" disabled={busy || !pin.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LockKeyhole className="h-4 w-4" aria-hidden />}
            Buka Kunci
          </Button>
        </form>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs text-zinc-500 transition-colors hover:text-rose-400"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Bukan Anda? Keluar &amp; ganti akun
        </button>
      </div>
    </div>
  );
}
