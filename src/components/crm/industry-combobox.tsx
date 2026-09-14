"use client";

/**
 * Ronde 57 — Autocomplete "Jenis Industri" BERSAMA untuk SEMUA form.
 * Saran = konstanta INDUSTRY_SUGGESTIONS + nilai nyata dari DB (GET /api/industries,
 * distinct Company.industry). Juga menerima prop `suggestions` (bila penelepon sudah
 * punya daftarnya — mis. form intake publik yang dapat daftar dari endpoint publik).
 * Filter case-insensitive + boleh teks bebas (nilai yang tidak ada di daftar tetap valid).
 */

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Shapes } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api } from "@/lib/crm/api-client";
import { INDUSTRY_SUGGESTIONS } from "@/lib/crm/constants";

interface IndustryComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Override daftar saran (mis. dari endpoint publik). Kosong → fetch /api/industries. */
  suggestions?: string[];
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function IndustryCombobox({
  value,
  onChange,
  suggestions,
  id,
  placeholder = "Pilih atau tulis industri…",
  disabled,
  className,
}: IndustryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [dbList, setDbList] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    // Daftar DB hanya diperlukan bila penelepon tidak menyediakan saran sendiri
    // (form publik memakai daftar dari /api/public/intake/<token>).
    if (suggestions) return;
    let alive = true;
    api.industries()
      .then((res) => { if (alive) setDbList(res.industries); })
      .catch(() => { /* fallback konstanta tetap dipakai */ });
    return () => { alive = false; };
  }, [suggestions]);

  const options = useMemo(() => {
    const base = suggestions && suggestions.length > 0 ? suggestions : dbList.length > 0 ? dbList : INDUSTRY_SUGGESTIONS;
    const list = Array.from(new Set([...base])).sort((a, b) => a.localeCompare(b));
    return list;
  }, [suggestions, dbList]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Jenis industri"
          disabled={disabled}
          className={cn(
            "w-full justify-between bg-white font-normal",
            !value && "text-zinc-500",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Shapes className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
            <span className="truncate">{value || placeholder}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Cari / tulis industri baru…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="crm-scroll max-h-56">
            {query.trim() && (
              <CommandGroup heading="Tulis sendiri">
                <CommandItem
                  value={`__free__${query}`}
                  onSelect={() => { onChange(query.trim()); setOpen(false); setQuery(""); }}
                >
                  <Check className={cn("mr-2 size-4", value.toLowerCase() === query.trim().toLowerCase() ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  Gunakan &ldquo;{query.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length === 0 && !query.trim() ? (
              <CommandEmpty>Tidak ada industri.</CommandEmpty>
            ) : filtered.length > 0 ? (
              <CommandGroup heading={query.trim() ? "Cocok" : "Saran industri"}>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => { onChange(opt); setOpen(false); setQuery(""); }}
                  >
                    <Check className={cn("mr-2 size-4", value === opt ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    {opt}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
