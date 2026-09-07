"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/crm/api-client";
import { useCrmStore, type ModuleKey, MODULE_META, canAccess } from "@/lib/crm/store";
import { ROLES } from "@/lib/crm/constants";
import { initials } from "@/lib/crm/utils";
import { toast } from "sonner";
import { LogIn, Lock, Loader2, Sparkles, ShieldCheck } from "lucide-react";

const DEMO_USERS = [
  { email: "rian@grup.co.id", role: "super_admin" },
  { email: "sari@grup.co.id", role: "director" },
  { email: "dewi@grup.co.id", role: "marketing" },
  { email: "andi@grup.co.id", role: "marketing" },
  { email: "maya@grup.co.id", role: "finance" },
  { email: "budi@grup.co.id", role: "production" },
  { email: "hendra@nusantaranet.com", role: "client" },
];

function roleLabel(role: string) {
  return ROLES.find((r) => r.key === role)?.label ?? role;
}

export default function LoginScreen() {
  const setUser = useCrmStore((s) => s.setUser);
  const [users, setUsers] = useState<{ id: string; name: string; email: string; role: string; avatarColor: string }[]>([]);
  const [email, setEmail] = useState("sari@grup.co.id");
  const [pin, setPin] = useState("1234");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await api.bootstrap();
        const { users } = await api.users();
        setUsers(users);
      } catch {
        toast.error("Gagal menyiapkan sistem");
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      const { user } = await api.login(email, pin);
      setUser(user);
      toast.success(`Selamat datang, ${user.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  const firstModule = (role: string): ModuleKey =>
    (Object.keys(MODULE_META) as ModuleKey[]).find((m) => canAccess(m, role)) ?? "dashboard";

  return (
    <div className="min-h-screen bg-zinc-100 flex flex-col lg:flex-row">
      {/* Panel kiri: identitas grup */}
      <div className="lg:w-[46%] bg-zinc-950 text-zinc-50 p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-orange-600/20 blur-3xl" aria-hidden />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center font-black text-lg">G</div>
            <div>
              <p className="font-bold text-lg leading-tight">Grup CRM</p>
              <p className="text-xs text-zinc-400">Multi-Brand Creative Agency Platform</p>
            </div>
          </div>
          <h1 className="mt-10 text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight tracking-tight">
            Satu sistem untuk<br />empat brand, satu<br />basis data pelanggan.
          </h1>
          <p className="mt-4 text-sm text-zinc-400 max-w-md leading-relaxed">
            Company-centric & contact-centric: setiap orang yang menghubungi lewat Instagram,
            email, atau WhatsApp tetap satu contact dengan satu timeline komunikasi.
          </p>
          <div className="mt-8 grid gap-3 max-w-md">
            {[
              { name: "Unimasi", desc: "Animasi & konten pembelajaran", color: "#ea580c" },
              { name: "Segia Tech", desc: "Website, SEO & UI/UX", color: "#059669" },
              { name: "Erfo Multimedia", desc: "Foto/video, live & drone", color: "#e11d48" },
              { name: "Unicam Studio", desc: "Immersive & corporate media", color: "#7c3aed" },
            ].map((b) => (
              <div key={b.name} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{b.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative mt-10 text-xs text-zinc-600">
          © 2026 Grup Agensi Kreatif · Data komunikasi & keuangan dilindungi audit log immutable
        </p>
      </div>

      {/* Panel kanan: form login (safe-area bawah utk perangkat mobile) */}
      <div
        className="flex-1 flex items-center justify-center p-6 lg:p-10"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="w-full max-w-md space-y-5">
          <Card className="border-zinc-200 shadow-lg shadow-zinc-200/50">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden /> Masuk ke CRM
              </CardTitle>
              <CardDescription>Pilih persona demo atau masukkan email & PIN Anda.</CardDescription>
            </CardHeader>
            <CardContent>
              {booting ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@grup.co.id" required autoComplete="username" className="h-12" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pin">PIN</Label>
                    <Input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" required autoComplete="current-password" className="h-12" />
                    <p className="text-xs text-zinc-500">PIN demo semua akun: <Badge variant="secondary">1234</Badge></p>
                  </div>
                  <Button type="submit" className="h-12 w-full" disabled={loading} aria-label="Tombol masuk">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
                    Masuk
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {!booting && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-500" aria-hidden /> Akun demo (pilih untuk mengisi form)
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto crm-scroll">
                {users
                  .filter((u) => DEMO_USERS.some((d) => d.email === u.email))
                  .map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { setEmail(u.email); setPin("1234"); }}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 ${email === u.email ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
                      aria-label={`Pilih akun ${u.name} sebagai ${roleLabel(u.role)}`}
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: u.avatarColor }}
                        aria-hidden
                      >
                        {initials(u.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate">{u.name}</span>
                        <span className="block text-xs text-zinc-500 truncate">{roleLabel(u.role)}</span>
                      </span>
                      {email === u.email && <Lock className="h-3.5 w-3.5 text-zinc-400" aria-hidden />}
                    </button>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
