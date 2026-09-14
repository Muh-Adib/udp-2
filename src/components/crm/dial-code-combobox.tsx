"use client";

/**
 * Ronde 58 — combobox kode dial negara (E.164) DIPECAH ke file sendiri agar bisa
 * dipakai lintas konteks: form kontak internal (contact-company-forms) DAN form
 * intake publik (lead-intake-form) — validasi nomor WhatsApp selalu "sesuai sistem".
 * (Sebelumnya didefinisikan di contact-company-forms.tsx lalu diimpor balik.)
 */

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES } from "@/lib/crm/countries";
import { cn } from "@/lib/utils";

/** Combobox kode negara (dial) utk nomor WhatsApp/Telepon. Value = "+62" | "" (tanpa kode). */
export function DialCodeCombobox({
  value,
  onSelect,
  disabled,
}: {
  value: string;
  onSelect: (dial: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Kode negara nomor telepon"
          disabled={disabled}
          className={cn("w-full justify-between px-2.5 font-normal", !value && "text-zinc-400")}
        >
          <span className="min-w-0 truncate text-left">{value || "Kode"}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(18rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari kode/negara…" />
          <CommandList className="crm-scroll max-h-64">
            <CommandEmpty>Tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="tanpa kode negara"
                onSelect={() => {
                  onSelect("");
                  setOpen(false);
                }}
              >
                <Check className={cn("size-4 shrink-0", !value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                <span className="text-zinc-500">Tanpa kode negara</span>
              </CommandItem>
              {COUNTRIES.map((c) => (
                <CommandItem
                  key={c.iso2}
                  value={`${c.name} ${c.dial} ${c.currency}`}
                  onSelect={() => {
                    onSelect(c.dial);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4 shrink-0", value === c.dial ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="w-12 shrink-0 font-medium tabular-nums">{c.dial}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default DialCodeCombobox;
