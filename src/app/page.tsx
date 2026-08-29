"use client";

import { useEffect } from "react";
import { useCrmStore } from "@/lib/crm/store";
import { api } from "@/lib/crm/api-client";
import LoginScreen from "@/components/crm/login-screen";
import AppShell from "@/components/crm/app-shell";
import { Toaster } from "@/components/ui/sonner";

export default function Page() {
  const user = useCrmStore((s) => s.user);
  const setBrands = useCrmStore((s) => s.setBrands);

  useEffect(() => {
    (async () => {
      try {
        await api.bootstrap();
        const { brands } = await api.brands();
        setBrands(brands);
      } catch {
        // silent: sudah ditangani di login screen
      }
    })();
  }, [setBrands]);

  return (
    <>
      {user ? <AppShell /> : <LoginScreen />}
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
