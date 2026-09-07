"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCrmStore, MODULE_META, type ModuleKey, canAccess } from "@/lib/crm/store";
import { api } from "@/lib/crm/api-client";
import LoginScreen from "@/components/crm/login-screen";
import AppShell from "@/components/crm/app-shell";
import ClientTokenPortal from "@/components/crm/client-token-portal";
import { Toaster } from "@/components/ui/sonner";

/**
 * Task 23-d — PortalGate: bila URL `/?portal=<token>` → render ClientTokenPortal
 * (akses publik tanpa login). Selain itu alur CRM normal (login/app-shell).
 * useSearchParams butuh Suspense boundary → Page membungkus PortalGate.
 */
function PortalGate() {
  const sp = useSearchParams();
  const portal = sp.get("portal");
  const user = useCrmStore((s) => s.user);
  const setUser = useCrmStore((s) => s.setUser);
  const setBrands = useCrmStore((s) => s.setBrands);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  // Ronde 27: sesi server = sumber kebenaran identitas. Tampilkan splash sampai
  // introspeksi selesai supaya tidak ada kedipan login-screen / sesi basi.
  const [sessionChecked, setSessionChecked] = useState(false);

  // Ronde 39 — deep-link modul dari Web Push: /?modul=projects → buka modul itu
  // (divalidasi terhadap akses role; URL lalu dibersihkan agar refresh tetap normal).
  useEffect(() => {
    if (portal || !user) return;
    const modul = sp.get("modul");
    if (!modul || !(modul in MODULE_META)) return;
    if (!canAccess(modul as ModuleKey, user.role)) return;
    setActiveModule(modul as ModuleKey);
    window.history.replaceState({}, "", "/");
  }, [portal, user, sp, setActiveModule]);

  useEffect(() => {
    if (portal) return; // mode portal klien — bootstrap CRM tidak diperlukan
    let alive = true;
    (async () => {
      try {
        await api.bootstrap();
        const { brands } = await api.brands();
        if (alive) setBrands(brands);
      } catch {
        // silent: sudah ditangani di login screen
      }
      try {
        const { user: sesi } = await api.session();
        if (alive) setUser(sesi ?? null); // null → login screen; bukan → identitas resmi dari DB
      } catch {
        // network gagal: pertahankan identitas store, jangan logout paksa
      }
      if (alive) setSessionChecked(true);
    })();
    return () => { alive = false; };
  }, [portal, setBrands, setUser]);

  if (portal) return <ClientTokenPortal token={portal} />;
  if (!sessionChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100" role="status" aria-label="Memuat aplikasi">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 text-base font-black text-white">G</div>
          <div className="h-1 w-28 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-orange-500" />
          </div>
          <p className="text-xs text-zinc-500">Memeriksa sesi…</p>
        </div>
      </div>
    );
  }
  return user ? <AppShell /> : <LoginScreen />;
}

export default function Page() {
  return (
    <>
      <Suspense fallback={<div className="min-h-screen bg-zinc-100" />}>
        <PortalGate />
      </Suspense>
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
