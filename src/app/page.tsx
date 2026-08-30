"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useCrmStore } from "@/lib/crm/store";
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
  const setBrands = useCrmStore((s) => s.setBrands);

  useEffect(() => {
    if (portal) return; // mode portal klien — bootstrap CRM tidak diperlukan
    (async () => {
      try {
        await api.bootstrap();
        const { brands } = await api.brands();
        setBrands(brands);
      } catch {
        // silent: sudah ditangani di login screen
      }
    })();
  }, [portal, setBrands]);

  if (portal) return <ClientTokenPortal token={portal} />;
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
