"use client";

import { useEffect, useState } from "react";
import { useCrmStore, MODULE_META, canAccess, type ModuleKey } from "@/lib/crm/store";
import { api } from "@/lib/crm/api-client";
import { ROLES } from "@/lib/crm/constants";
import { initials } from "@/lib/crm/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DashboardModule from "@/components/crm/dashboard-module";
import { GlobalSearch } from "@/components/crm/global-search";
import NotificationCenter from "@/components/crm/notification-center";
import PipelineModule from "@/components/crm/pipeline-module";
import InboxModule from "@/components/crm/inbox-module";
import ContactsModule from "@/components/crm/contacts-module";
import FollowupsModule from "@/components/crm/followups-module";
import FinanceModule from "@/components/crm/finance-module";
import ReportsModule from "@/components/crm/reports-module";
import ProjectsModule from "@/components/crm/projects-module";
import PortalModule from "@/components/crm/portal-module";
import BrandsModule from "@/components/crm/brands-module";
import ChannelsModule from "@/components/crm/channels-module";
import UsersModule from "@/components/crm/users-module";
import AuditModule from "@/components/crm/audit-module";
import {
  LayoutDashboard, Inbox, Users2, KanbanSquare, BellRing, Wallet, BarChart3,
  FolderKanban, Globe2, Building2, UserCog, ScrollText, LogOut, Menu, PlugZap,
  ChevronDown, CircleUser, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";

const MODULE_ICONS: Record<ModuleKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  inbox: Inbox,
  contacts: Users2,
  pipeline: KanbanSquare,
  followups: BellRing,
  finance: Wallet,
  reports: BarChart3,
  projects: FolderKanban,
  portal: Globe2,
  channels: PlugZap,
  brands: Building2,
  users: UserCog,
  audit: ScrollText,
};

const NAV_SECTIONS: { label: string; modules: ModuleKey[] }[] = [
  { label: "Operasional", modules: ["dashboard", "inbox", "contacts", "pipeline"] },
  { label: "Komersial & Produksi", modules: ["followups", "finance", "reports", "projects"] },
  { label: "Eksternal", modules: ["portal"] },
  { label: "Sistem", modules: ["channels", "brands", "users", "audit"] },
];

// 4 slot modul bottom-nav mobile + 1 tombol "Menu" (membuka Sheet hamburger).
// Item difilter canAccess agar role terbatas (mis. client) tidak melihat tombol mati.
const MOBILE_NAV: { key: ModuleKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "inbox", label: "Inbox" },
  { key: "contacts", label: "Kontak" },
  { key: "pipeline", label: "Pipeline" },
];

function roleLabel(role: string) {
  return ROLES.find((r) => r.key === role)?.label ?? role;
}

function SidebarNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { user, activeModule, setActiveModule } = useCrmStore();
  if (!user) return null;
  return (
    <nav aria-label="Navigasi utama CRM" className="flex-1 space-y-5 overflow-y-auto px-3 py-4 crm-scroll">
      {NAV_SECTIONS.map((section) => {
        const items = section.modules.filter((m) => canAccess(m, user.role));
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <p className={cn("mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500", collapsed && "hidden")}>{section.label}</p>
            <ul className="space-y-0.5">
              {items.map((m) => {
                const Icon = MODULE_ICONS[m];
                const active = activeModule === m;
                const hasUnread = m === "inbox" && activeModule !== "inbox";
                const itemButton = (
                  <button
                    type="button"
                    onClick={() => { setActiveModule(m); onNavigate?.(); }}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? MODULE_META[m].label : undefined}
                    className={cn(
                      "group flex items-center rounded-lg text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
                      collapsed ? "relative mx-auto h-9 w-9 justify-center" : "w-full gap-2.5 px-3 py-2",
                      active ? "bg-zinc-800 text-white font-medium" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-amber-400" : "text-zinc-500 group-hover:text-zinc-300")} aria-hidden />
                    <span className={cn("truncate", collapsed && "hidden")}>{MODULE_META[m].label}</span>
                    {hasUnread && !collapsed && (
                      <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white" title="Lead baru menunggu respons" aria-label="Ada lead baru di inbox">
                        ●
                      </span>
                    )}
                    {hasUnread && collapsed && (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-600" title="Lead baru menunggu respons" aria-label="Ada lead baru di inbox" />
                    )}
                  </button>
                );
                return (
                  <li key={m}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{itemButton}</TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {MODULE_META[m].label}
                          {hasUnread ? " — ada pesan baru" : ""}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      itemButton
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function MobileNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, activeModule, setActiveModule } = useCrmStore();
  if (!user) return null;
  const items = MOBILE_NAV.filter((m) => canAccess(m.key, user.role));
  return (
    <nav
      aria-label="Navigasi bawah"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      {items.map((m) => {
        const Icon = MODULE_ICONS[m.key];
        const active = activeModule === m.key;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => setActiveModule(m.key)}
            aria-current={active ? "page" : undefined}
            aria-label={`Modul ${m.label}`}
            className={cn(
              "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors",
              active ? "font-semibold text-zinc-900" : "text-zinc-500"
            )}
          >
            {active && <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-zinc-900" aria-hidden />}
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {m.key === "inbox" && activeModule !== "inbox" && (
                <span
                  className="absolute -right-1.5 -top-1 size-2 rounded-full bg-rose-600"
                  title="Ada lead baru menunggu respons"
                  aria-label="Ada lead baru di inbox"
                />
              )}
            </span>
            <span>{m.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Buka menu navigasi"
        className="flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] text-zinc-500 transition-colors"
      >
        <Menu className="size-5" aria-hidden />
        <span>Menu</span>
      </button>
    </nav>
  );
}

function BrandStrip() {
  const brands = useCrmStore((s) => s.brands);
  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-zinc-800 px-3 py-3" aria-label="Brand aktif">
      {brands.map((b) => (
        <span key={b.id} className="h-1.5 w-8 rounded-full" style={{ backgroundColor: b.color }} title={b.name} aria-label={b.name} />
      ))}
    </div>
  );
}

export default function AppShell() {
  const user = useCrmStore((s) => s.user);
  const activeModule = useCrmStore((s) => s.activeModule);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  const activeBrandFilter = useCrmStore((s) => s.activeBrandFilter);
  const setActiveBrandFilter = useCrmStore((s) => s.setActiveBrandFilter);
  const brands = useCrmStore((s) => s.brands);
  const setUser = useCrmStore((s) => s.setUser);
  const refreshBrands = useCrmStore((s) => s.refreshBrands);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Ronde 40-D: minify sidebar desktop — state lokal (bukan store), persist di localStorage.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("crm-sidebar-collapsed") === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("crm-sidebar-collapsed", next ? "1" : "0"); } catch { /* abaikan */ }
      return next;
    });
  };

  // Gate modul berdasarkan role: jika role tidak punya akses, paksa ke modul pertama yang diizinkan
  useEffect(() => {
    if (!user) return;
    if (!canAccess(activeModule, user.role)) {
      const first = (Object.keys(MODULE_META) as ModuleKey[]).find((m) => canAccess(m, user.role));
      if (first) setActiveModule(first);
    }
  }, [user, activeModule, setActiveModule]);

  // Ronde 40-D: muat ulang daftar brand saat shell terpasang (action dari 40-C —
  // referensi action zustand stabil, efek berjalan sekali). Gagal = diamkan di dalam action.
  useEffect(() => {
    void refreshBrands();
  }, [refreshBrands]);

  if (!user) return null;
  const meta = MODULE_META[activeModule];

  const collapseToggle = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleCollapsed}
      aria-label={collapsed ? "Perluas sidebar" : "Minify sidebar"}
      aria-expanded={!collapsed}
      className="h-8 w-8 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
    >
      {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
    </Button>
  );

  return (
    <div className="flex min-h-screen bg-zinc-100">
      {/* Sidebar desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col bg-zinc-950 transition-all duration-200 lg:flex",
          collapsed ? "w-16" : "w-64"
        )}
        aria-label="Sidebar"
      >
        <div className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "justify-center px-2")}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 text-sm font-black text-white" aria-hidden>G</div>
          <div className={cn("min-w-0", collapsed && "hidden")}>
            <p className="truncate text-sm font-bold text-zinc-50">Grup CRM</p>
            <p className="truncate text-[10px] text-zinc-500">Multi-Brand Platform</p>
          </div>
        </div>
        <SidebarNav collapsed={collapsed} />
        <div className={cn("flex border-t border-zinc-800 px-3 py-2.5", collapsed ? "justify-center" : "justify-end")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{collapseToggle}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Perluas sidebar</TooltipContent>
            </Tooltip>
          ) : (
            collapseToggle
          )}
        </div>
        {!collapsed && <BrandStrip />}
      </aside>

      {/* Konten (pb-16 agar footer tidak tertutup bottom-nav mobile) */}
      <div className={cn("flex min-h-screen w-full flex-col pb-16 transition-all duration-200 lg:pb-0", collapsed ? "lg:pl-16" : "lg:pl-64")}>
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
          <div className="flex h-14 items-center gap-2 px-4 sm:gap-3 lg:px-6">
            {/* Hamburger mobile */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Buka menu navigasi">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-zinc-950 p-0 text-zinc-50 [&>button]:text-zinc-400">
                <SheetHeader className="border-b border-zinc-800 px-4 py-4 text-left">
                  <SheetTitle className="text-sm text-zinc-50">Grup CRM</SheetTitle>
                </SheetHeader>
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
                <BrandStrip />
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-bold text-zinc-900 sm:text-base">{meta?.label}</h1>
              <p className="hidden truncate text-xs text-zinc-500 sm:block">{meta?.description}</p>
            </div>

            {/* Global search (Ctrl+K) — tombol + palette; terpasang sekali di sini */}
            <GlobalSearch />

            {/* Filter brand global */}
            <Select value={activeBrandFilter} onValueChange={setActiveBrandFilter}>
              <SelectTrigger className="w-[110px] shrink-0 sm:w-[170px]" aria-label="Filter brand global">
                <SelectValue placeholder="Semua Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Brand</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Pusat notifikasi (bell) */}
            <NotificationCenter />

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Menu pengguna">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: user.avatarColor }}
                    aria-hidden
                  >
                    {initials(user.name)}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-xs font-semibold leading-tight">{user.name}</span>
                    <span className="block text-[10px] text-zinc-500 leading-tight">{roleLabel(user.role)}</span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex items-center gap-2">
                    <CircleUser className="h-4 w-4 text-zinc-400" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <p className="truncate text-xs font-normal text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-zinc-500">
                  Role: <Badge variant="secondary" className="ml-1">{roleLabel(user.role)}</Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    // Ronde 27: logout server-side (cookie sesi dihapus) lalu bersihkan store.
                    try { await api.logout(); } catch { /* tetap keluar lokal */ }
                    setUser(null);
                  }}
                  className="text-rose-600 focus:text-rose-600"
                  aria-label="Keluar dari aplikasi"
                >
                  <LogOut className="h-4 w-4" aria-hidden /> Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Modul aktif (hanya jika role berhak) */}
        <main className="flex-1 px-4 py-5 lg:px-6" aria-label={`Konten ${meta?.label}`}>
          {user && canAccess(activeModule, user.role) && (
            <>
              {activeModule === "dashboard" && <DashboardModule />}
              {activeModule === "inbox" && <InboxModule />}
              {activeModule === "contacts" && <ContactsModule />}
              {activeModule === "pipeline" && <PipelineModule />}
              {activeModule === "followups" && <FollowupsModule />}
              {activeModule === "finance" && <FinanceModule />}
              {activeModule === "reports" && <ReportsModule />}
              {activeModule === "projects" && <ProjectsModule />}
              {activeModule === "portal" && <PortalModule />}
              {activeModule === "channels" && <ChannelsModule />}
              {activeModule === "brands" && <BrandsModule />}
              {activeModule === "users" && <UsersModule />}
              {activeModule === "audit" && <AuditModule />}
            </>
          )}
        </main>

        {/* Footer sticky */}
        <footer className="mt-auto border-t border-zinc-200 bg-white">
          <div className="flex flex-col items-center justify-between gap-1.5 px-4 py-3 text-center sm:flex-row sm:text-left lg:px-6" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <p className="text-xs text-zinc-500">
              © 2026 Grup Agensi Kreatif — <span className="font-medium text-zinc-700">Unimasi</span> · <span className="font-medium text-zinc-700">Segia Tech</span> · <span className="font-medium text-zinc-700">Erfo Multimedia</span> · <span className="font-medium text-zinc-700">Unicam Studio</span>
            </p>
            <p className="text-[11px] text-zinc-400">Multi-Brand CRM v1.0 · Audit log aktif</p>
          </div>
        </footer>
      </div>

      {/* Navigasi bawah khusus mobile */}
      <MobileNav onOpenMenu={() => setMobileOpen(true)} />
    </div>
  );
}
