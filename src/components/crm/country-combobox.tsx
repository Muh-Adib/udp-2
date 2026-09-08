"use client";

// ============================================================
// Ronde 41 — combobox negara yang dibagikan lintas modul.
// Dipindah dari contacts-module agar modal konversi lead (Inbox)
// memakai UI negara yang sama: daftar lengkap + pencarian (auto text)
// + tampilan kode telepon & badge mata uang.
// ============================================================

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES, findCountry, type Country } from "@/lib/crm/countries";

/** Combobox negara searchable: tampil kode telepon + badge mata uang; onSelect memberi objek negara. */
export function CountryCombobox({
  value,
  onSelect,
  disabled,
  placeholder = "Pilih negara…",
  ariaLabel = "Pilih negara",
}: {
  value: string;
  onSelect: (country: Country) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => (value ? (COUNTRIES.find((c) => c.name === value) ?? findCountry(value)) : undefined),
    [value]
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className="w-full justify-between px-3 font-normal"
        >
          <span className={cn("min-w-0 truncate text-left", !selected && !value && "text-zinc-400")}>
            {selected ? selected.name : value || placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari negara…" />
          <CommandList className="crm-scroll max-h-64">
            <CommandEmpty>Negara tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => (
                <CommandItem
                  key={c.iso2}
                  value={`${c.name} ${c.dial} ${c.currency}`}
                  onSelect={() => {
                    onSelect(c);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4 shrink-0", selected?.iso2 === c.iso2 ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-400">{c.dial}</span>
                  <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                    {c.currency}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Ronde 41 — Select mata uang untuk kontak.
 * Opsi = daftar umum + mata uang aktif (mis. JPY dari pilihan negara Japan) selalu ikut,
 * agar nilai yang disarankan combobox negara tetap tampil walau bukan mata uang umum.
 */
export function CurrencySelect({
  value,
  onValueChange,
  disabled,
  ariaLabel = "Pilih mata uang",
}: {
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const options = useMemo(() => {
    const base = [...CURRENCY_SELECT_OPTIONS];
    if (value && !base.some((o) => o.value === value)) {
      base.unshift({ value, label: `${value} — (mata uang negara terpilih)` });
    }
    return base;
  }, [value]);
  return (
    <Select value={value || "none"} onValueChange={(v) => onValueChange(v === "none" ? "" : v)} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}>
        <SelectValue placeholder="Pilih mata uang" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Belum ditentukan</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Mata uang umum — daftar pendek; mata uang spesifik negara tetap ditambahkan dinamis di CurrencySelect. */
const CURRENCY_SELECT_OPTIONS = [
  { value: "IDR", label: "IDR — Rupiah" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "SGD", label: "SGD — Dollar Singapura" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — Pound Sterling" },
  { value: "JPY", label: "JPY — Yen Jepang" },
  { value: "AUD", label: "AUD — Dollar Australia" },
  { value: "MYR", label: "MYR — Ringgit Malaysia" },
];
