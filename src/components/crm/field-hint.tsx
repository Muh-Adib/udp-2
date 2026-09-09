"use client";

/**
 * Ronde 42 — FieldHint: ikon info kecil dengan tooltip penjelasan.
 *
 * Dipasang di samping label input pada form-form utama (tugas, peluang, kontak,
 * estimasi, dsb.) sesuai permintaan user: "di setiap input tolong berikan tooltip
 * info dengan icon kecil untuk menjelaskan ini apa dan untuk apa kerjanya bagaimana".
 *
 * - Fokus keyboard: ikon adalah <button> (bukan div) sehingga bisa di-Tab, tooltip
 *   tampil saat focus/ hover — aksesibel tanpa mouse.
 * - `asChild` label: pakai <FieldHintInLabel tip="…" /> bila berada di dalam <Label>.
 */

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function FieldHint({ tip, className }: { tip: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={0}
          aria-label={`Penjelasan: ${tip}`}
          className={cn(
            "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-zinc-400 outline-none transition-colors hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1",
            className
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed" role="tooltip">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Varian untuk dipasang DI DALAM <Label> (inline, tanpa button di dalam label). */
export function FieldHintInLabel({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={`Penjelasan: ${tip}`}
          className="inline-flex size-4 cursor-help items-center justify-center rounded-full text-zinc-400 outline-none transition-colors hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-1"
        >
          <Info className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed" role="tooltip">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
