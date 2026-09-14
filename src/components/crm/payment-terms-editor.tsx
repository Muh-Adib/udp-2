"use client";

/**
 * Ronde 57 — Editor Term of Payment (TOP) terstruktur yang DIPAKAI BERSAMA
 * dialog quotation & form invoice (finance) — satu komponen, satu format hasil,
 * satu validasi (total % wajib 100) agar jatuh tempo selalu sinkron.
 *
 * Baris termin: label, persentase, offset hari (H+N), momen jatuh tempo (dueEvent).
 * Preview di bawah menampilkan FORMAT HASIL persis seperti yang akan tercetak di
 * dokumen penawaran/invoice (bahasa Inggris) — user langsung lihat hasilnya.
 */

import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DUE_EVENTS, describeDueEn, formatTermOfPaymentText, termPctSum, type PaymentTerm } from "@/lib/crm/payment-terms";
import { cn } from "@/lib/utils";
import { formatCurrencyFull } from "@/lib/crm/utils";

/** Baris UI: angka disimpan sbg string agar input kosong tidak melompat-lompat. */
export interface PaymentTermRowUI {
  label: string;
  pct: string;
  dueDays: string;
  dueEvent: string;
}

/** Baris default (mengikuti contoh Unicam): DP 50% setelah invoice + Final 50% H+3 setelah BASTP. */
export function defaultTermRowsUI(): PaymentTermRowUI[] {
  return [
    { label: "Down Payment", pct: "50", dueDays: "0", dueEvent: "invoice" },
    { label: "Final Payment", pct: "50", dueDays: "3", dueEvent: "bastp" },
  ];
}

/** Baris tersimpan (JSON terms) → baris UI (prefill edit/revisi). */
export function termRowsFromTerms(terms: PaymentTerm[] | null | undefined): PaymentTermRowUI[] {
  if (!terms || terms.length === 0) return defaultTermRowsUI();
  return terms.map((t) => ({
    label: t.label,
    pct: String(Math.round(t.pct)),
    dueDays: String(Math.round(t.dueDays)),
    dueEvent: t.dueEvent,
  }));
}

/** Baris UI → payload terms: buang baris tanpa label; pct 0–100, dueDays ≥ 0. */
export function termRowsToPayload(rows: PaymentTermRowUI[]): PaymentTerm[] {
  return rows
    .filter((r) => r.label.trim() !== "")
    .map((r) => ({
      label: r.label.trim(),
      pct: Math.min(100, Math.max(0, Number(r.pct) || 0)),
      dueDays: Math.max(0, Math.round(Number(r.dueDays) || 0)),
      dueEvent: DUE_EVENTS.some((e) => e.value === r.dueEvent) ? r.dueEvent : "invoice",
    }));
}

export function PaymentTermsEditor({
  rows,
  onChange,
  idPrefix,
  disabled,
  currency = "IDR",
  amountBase = 0,
}: {
  rows: PaymentTermRowUI[];
  onChange: (rows: PaymentTermRowUI[]) => void;
  idPrefix: string;
  disabled?: boolean;
  /** Mata uang utk estimasi nominal per termin. */
  currency?: string;
  /** Basis nominal per termin (nilai setelah diskon) — 0 = sembunyikan estimasi nominal. */
  amountBase?: number;
}) {
  const payload = termRowsToPayload(rows);
  const sum = termPctSum(payload);
  const sumOk = payload.length > 0 && Math.round(sum) === 100;

  function updateRow(idx: number, patch: Partial<PaymentTermRowUI>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="rounded-lg border bg-zinc-50/50 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${idPrefix}-term-label-${idx}`}
              value={row.label}
              onChange={(e) => updateRow(idx, { label: e.target.value })}
              placeholder={`Label termin ${idx + 1} (mis. Down Payment)`}
              aria-label={`Label termin ${idx + 1}`}
              className="h-8 min-w-[150px] flex-1 text-sm"
              disabled={disabled}
            />
            <div className="flex items-center gap-1">
              <Input
                id={`${idPrefix}-term-pct-${idx}`} type="number" min={0} max={100}
                value={row.pct}
                onChange={(e) => updateRow(idx, { pct: e.target.value })}
                aria-label={`Persentase termin ${idx + 1}`}
                className="h-8 w-16 text-sm" disabled={disabled}
              />
              <span className="text-xs text-zinc-400">%</span>
            </div>
            <div className="flex items-center gap-1">
              <Input
                id={`${idPrefix}-term-days-${idx}`} type="number" min={0} max={365}
                value={row.dueDays}
                onChange={(e) => updateRow(idx, { dueDays: e.target.value })}
                aria-label={`Hari jatuh tempo termin ${idx + 1}`}
                className="h-8 w-16 text-sm" disabled={disabled}
              />
              <span className="text-xs text-zinc-400">hari</span>
            </div>
            <Button
              type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-rose-600"
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}
              disabled={disabled}
              aria-label={`Hapus termin ${idx + 1}`}
              title="Hapus termin"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select
              value={row.dueEvent}
              onValueChange={(v) => updateRow(idx, { dueEvent: v })}
            >
              <SelectTrigger className="h-8 min-w-[210px] flex-1 text-sm" aria-label={`Momen jatuh tempo termin ${idx + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUE_EVENTS.map((ev) => (
                  <SelectItem key={ev.value} value={ev.value}>{ev.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {amountBase > 0 && Number(row.pct) > 0 ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                ≈ {formatCurrencyFull(Math.round((amountBase * Math.min(100, Math.max(0, Number(row.pct) || 0))) / 100), currency)}
              </span>
            ) : null}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => onChange([...rows, { label: "", pct: "0", dueDays: "0", dueEvent: "invoice" }])}
          disabled={disabled || rows.length >= 6}
          aria-label="Tambah termin"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Tambah termin
        </Button>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            sumOk ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
          )}
          role="status"
        >
          {sumOk ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
          Total termin: {Math.round(sum)}% {sumOk ? "— pas" : "— wajib 100%"}
        </span>
      </div>

      {payload.length > 0 ? (
        <div className="rounded-lg border border-dashed bg-zinc-50 px-3 py-2" aria-live="polite">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Format hasil di dokumen (EN)</p>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700">
            {formatTermOfPaymentText(payload)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
