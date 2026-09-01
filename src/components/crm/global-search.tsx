"use client";

/**
 * Global Search (ronde 26) — ⌘K / Ctrl+K command palette antar modul.
 * Dipasang SEKALI di app-shell: merender tombol trigger di header + Dialog palette.
 * Memilih hasil → pindah modul tujuan (setActiveModule) + setPendingFocus agar
 * modul membuka detail entitasnya (dikonsumsi tiap modul via useEffect).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCrmStore, canAccess, type ModuleKey } from "@/lib/crm/store";
import { api, type SearchItemDTO } from "@/lib/crm/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Search, X, User, Building2, FolderKanban, Hammer, Receipt, Inbox, SearchX,
} from "lucide-react";

/** Modul yang jadi sasaran hasil search — dipakai juga utk gate tombol/shortcut per role. */
const SEARCHABLE_MODULES: ModuleKey[] = ["contacts", "pipeline", "projects", "finance", "inbox"];

/** Urutan grup sesuai konvensi produk. */
const LABEL_ORDER = ["Kontak", "Perusahaan", "Opportunity", "Project", "Invoice", "Penawaran", "Lead Inbox"];

/** Ikon per module tujuan (pipeline → FolderKanban, projects → Hammer, finance → Receipt, inbox → Inbox, kontak → User). */
const MODULE_ICON: Record<SearchItemDTO["module"], ComponentType<{ className?: string }>> = {
  contacts: User,
  pipeline: FolderKanban,
  projects: Hammer,
  finance: Receipt,
  inbox: Inbox,
};
/** Override per label: Perusahaan beda ikon dari Kontak walau satu modul. */
const LABEL_ICON_OVERRIDE: Record<string, ComponentType<{ className?: string }>> = {
  Perusahaan: Building2,
};

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const OPTION_PREFIX = "global-search-option";

export function GlobalSearch() {
  const user = useCrmStore((s) => s.user);
  // Role tanpa akses ke modul manapun yg dicari (mis. client) → palette tak berguna, sembunyikan.
  const canSearch = SEARCHABLE_MODULES.some((m) => canAccess(m, user?.role));
  if (!canSearch) return null;
  return <GlobalSearchInner />;
}

function GlobalSearchInner() {
  const user = useCrmStore((s) => s.user);
  const setActiveModule = useCrmStore((s) => s.setActiveModule);
  const setPendingFocus = useCrmStore((s) => s.setPendingFocus);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ q: string; total: number; items: SearchItemDTO[] } | null>(null);
  const [error, setError] = useState<{ q: string; message: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryNonce, setRetryNonce] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef(result); // mirror utk cache-check tanpa masuk deps effect
  resultRef.current = result;
  const openRef = useRef(open);
  openRef.current = open;

  const trimmed = query.trim();
  // "stale" = query sekarang belum punya hasil (baru diketik / belum termuat) → tampil skeleton.
  const stale = trimmed.length >= MIN_QUERY && (!result || result.q !== trimmed);

  const runSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    try {
      const res = await api.search(q, controller.signal);
      if (controller.signal.aborted) return;
      setResult(res);
      setActiveIndex(res.items.length > 0 ? 0 : -1);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      if (controller.signal.aborted) return;
      setError({ q, message: e instanceof Error ? e.message : "Pencarian gagal" });
    }
  }, []);

  // Debounced fetch 250ms (AbortSignal membatalkan request sebelumnya). Hasil utk query
  // yang sama di-cache → buka ulang palette instan tanpa refetch.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    if (resultRef.current?.q === q) return; // cache hit
    const t = setTimeout(() => void runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open, retryNonce, runSearch]);

  // Bersihkan controller saat unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Item yang bisa diakses role, dikelompokkan per label sesuai LABEL_ORDER.
  const groups = useMemo(() => {
    const items = result && result.q === trimmed ? result.items : [];
    const map = new Map<string, SearchItemDTO[]>();
    for (const it of items) {
      if (!canAccess(it.module, user?.role)) continue;
      const arr = map.get(it.label) ?? [];
      arr.push(it);
      map.set(it.label, arr);
    }
    const ordered: [string, SearchItemDTO[]][] = [];
    for (const label of LABEL_ORDER) {
      const arr = map.get(label);
      if (arr && arr.length > 0) {
        ordered.push([label, arr]);
        map.delete(label);
      }
    }
    for (const [label, arr] of map) ordered.push([label, arr]); // label tak dikenal (defensif)
    return ordered;
  }, [result, trimmed, user?.role]);

  const flat = useMemo(() => groups.map(([, items]) => items).flat(), [groups]);

  // Highlight keyboard ikut scroll ke viewport list.
  const flatLen = flat.length;
  useEffect(() => {
    if (!open || activeIndex < 0 || flatLen === 0) return;
    document.getElementById(`${OPTION_PREFIX}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, flatLen]);

  const openPalette = useCallback(() => {
    setOpen(true);
    setActiveIndex(0);
  }, []);

  // Tutup: query & hasil terakhir DIPERTAHANKAN (buka ulang instan), highlight dibersihkan.
  const closePalette = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  // Shortcut global Ctrl/Cmd+K — "/" sengaja TIDAK dipakai (bentrok dgn input).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) closePalette();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, closePalette]);

  function choose(item: SearchItemDTO) {
    setActiveModule(item.module);
    setPendingFocus({ module: item.module, id: item.id });
    closePalette();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatLen === 0) return;
      setActiveIndex((i) => (i + 1) % flatLen);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatLen === 0) return;
      setActiveIndex((i) => (i - 1 + flatLen) % flatLen);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) choose(item);
    }
  }

  function retry() {
    setResult(null); // buang cache bermasalah → effect langsung refetch
    setRetryNonce((n) => n + 1);
  }

  const activeDescendant = flatLen > 0 && activeIndex >= 0 ? `${OPTION_PREFIX}-${activeIndex}` : undefined;
  const errorForQuery = error !== null && error.q === trimmed;
  const isEmptyResult = !stale && !errorForQuery && flatLen === 0 && trimmed.length >= MIN_QUERY;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        aria-label="Cari di semua modul"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Cari (Ctrl+K)"
        onClick={openPalette}
      >
        <Search className="h-4 w-4" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? openPalette() : closePalette())}>
        <DialogContent
          className="top-[12%] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"
          showCloseButton={false}
          onKeyDown={handleKeyDown}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Cari di semua modul</DialogTitle>
            <DialogDescription>Cari kontak, opportunity, project, invoice, dan lead lintas modul.</DialogDescription>
          </DialogHeader>

          {/* Baris input */}
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kontak, opportunity, project, invoice…"
              aria-label="Kata kunci pencarian"
              aria-controls="global-search-listbox"
              className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-sm"
            />
            {query.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-zinc-400 hover:text-zinc-600"
                aria-label="Hapus pencarian"
                onMouseDown={(e) => e.preventDefault()} // jangan cabut fokus dari input
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>

          {/* Isi: hint / error / skeleton / kosong / hasil grouped */}
          <div className="min-h-0">
            {trimmed.length < MIN_QUERY ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">Ketik minimal 2 karakter…</p>
            ) : errorForQuery ? (
              <div className="px-4 py-8 text-center" role="alert">
                <p className="text-sm text-rose-600">{error.message}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={retry}>
                  Coba lagi
                </Button>
              </div>
            ) : stale ? (
              <div className="space-y-2 p-2" role="status" aria-live="polite">
                <span className="sr-only">Memuat hasil pencarian…</span>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-zinc-100" aria-hidden />
                ))}
              </div>
            ) : isEmptyResult ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <SearchX className="h-8 w-8 text-zinc-300" aria-hidden />
                <p className="text-sm text-zinc-500">
                  Tidak ada hasil untuk &ldquo;{trimmed}&rdquo;
                </p>
              </div>
            ) : (
              <div
                id="global-search-listbox"
                role="listbox"
                aria-label="Hasil pencarian"
                aria-activedescendant={activeDescendant}
                className="max-h-96 overflow-y-auto p-2 crm-scroll"
              >
                {renderGroups()}
              </div>
            )}
          </div>

          {/* Footer hint keyboard */}
          <div className="border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-400">
            ↑↓ navigasi · ↵ buka · esc tutup
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  /** Render grup hasil; offset berjalan = posisi item dlm flat list utk keyboard nav. */
  function renderGroups() {
    let offset = 0;
    return groups.map(([label, items]) => {
      const groupStart = offset;
      offset += items.length;
      return (
        <div key={label} role="group" aria-label={label}>
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 first:pt-1">
            {label}
          </p>
          {items.map((item, j) => {
            const idx = groupStart + j;
            const ItemIcon = LABEL_ICON_OVERRIDE[item.label] ?? MODULE_ICON[item.module] ?? Search;
            const active = idx === activeIndex;
            return (
              <button
                key={item.id}
                id={`${OPTION_PREFIX}-${idx}`}
                type="button"
                role="option"
                aria-selected={active}
                onMouseMove={() => setActiveIndex(idx)}
                onClick={() => choose(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  active ? "bg-zinc-100" : "hover:bg-zinc-100"
                )}
              >
                <ItemIcon className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">{item.title}</span>
                  {item.subtitle && (
                    <span className="block truncate text-xs text-zinc-500">{item.subtitle}</span>
                  )}
                </span>
                {item.badge && (
                  <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-zinc-500">
                    {item.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      );
    });
  }
}
