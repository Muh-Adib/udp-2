import { db } from "@/lib/db";
import { fail, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole, type ResolvedActor } from "@/lib/crm/auth";
import type { NextRequest, NextResponse } from "next/server";

// ============ FASE 7 — Pembukuan: helper bersama route finance/** ============
// File ini BUKAN route (tidak diekspor sebagai endpoint) — hanya helper
// internal aturan bisnis Bab 31 blueprint yang dipakai bersama seluruh
// route di folder finance agar validasi tidak terduplikasi.

/** Role pembaca modul pembukuan (mirror ModulePermission "accounting"). */
export const FINANCE_READ_ROLES = ["finance", "director", "super_admin"] as const;
/** Role penulis transaksi pembukuan (blueprint: "finance/director"). */
export const FINANCE_WRITE_ROLES = ["finance", "director"] as const;
/** Role penutupan buku (blueprint: "director/super_admin" — finance tidak menutup buku). */
export const PERIOD_CLOSE_ROLES = ["director", "super_admin"] as const;

/** Tipe akun COA yang valid. */
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Kategori item reimbursement yang valid. */
export const EXPENSE_CATEGORIES = ["transport", "meals", "accommodation", "material", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Metode pencairan yang valid. */
export const DISBURSEMENT_METHODS = ["transfer", "cash"] as const;

/**
 * Mapping kategori reimbursement → kode akun beban (blueprint Bab 31):
 * transport/meals/accommodation/material/other → "5-2000" Beban Operasional.
 */
export const EXPENSE_CATEGORY_ACCOUNT: Record<ExpenseCategory, string> = {
  transport: "5-2000",
  meals: "5-2000",
  accommodation: "5-2000",
  material: "5-2000",
  other: "5-2000",
};

/** Akun kas & bank lawan (kredit) untuk reimbursement. */
export const CASH_ACCOUNT_CODE = "1-1000";

/** Toleransi keseimbangan jurnal (Rp 0,01) sesuai blueprint. */
export const BALANCE_TOLERANCE = 0.01;

// ===== Type guard ketat (hindari cast `as never` di route) =====

export function isAccountType(v: string): v is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(v);
}

export function isExpenseCategory(v: string): v is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

export function isDisbursementMethod(v: string): v is (typeof DISBURSEMENT_METHODS)[number] {
  return (DISBURSEMENT_METHODS as readonly string[]).includes(v);
}

/** Kode akun beban utk kategori reimbursement (fallback: other → 5-2000). */
export function accountForCategory(category: string): string {
  return isExpenseCategory(category)
    ? EXPENSE_CATEGORY_ACCOUNT[category]
    : EXPENSE_CATEGORY_ACCOUNT.other;
}

/** Format rupiah utk pesan error server-side. */
export function rupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

/** String bersih dari body, atau null bila kosong. */
export function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/** Actor sesi yang sudah terkonfirmasi (bukan denied). */
export type ResolvedActorOk = Extract<ResolvedActor, { denied: false }>;

/** Autentikasi sesi + gerbang peran sekali jalan; balas Response gagal bila ditolak. */
export async function gate(
  req: NextRequest,
  roles: readonly string[],
  body: Record<string, unknown> = {},
): Promise<{ actor: ResolvedActorOk; res?: undefined } | { actor?: undefined; res: NextResponse }> {
  const actor = await resolveActor(req, body);
  if (actor.denied) return { res: fail(actor.reason, 401) };
  const role = assertRole(actor, roles);
  if (!role.ok) return { res: fail(role.reason, 403) };
  return { actor };
}

/** Nama periode pembukuan (YYYY-MM) untuk sebuah tanggal — basis UTC agar konsisten. */
export function periodNameFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Rentang [start, end) periode "YYYY-MM", atau null bila format salah. */
export function periodRange(name: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(name.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

/**
 * Cek periode pembukuan utk tanggal entry (aturan #1 & #5):
 * - Periode tidak ada → "Periode pembukuan belum dibuat" (TIDAK auto-create).
 * - Periode ditutup   → "Periode pembukuan {name} sudah ditutup".
 * Sukses → period utk di-link ke entry (periodId).
 */
export async function checkPeriodForDate(
  date: Date,
): Promise<{ ok: true; period: { id: string; name: string; status: string } } | { ok: false; error: string }> {
  const name = periodNameFor(date);
  const period = await db.accountingPeriod.findUnique({ where: { name } });
  if (!period) return { ok: false, error: "Periode pembukuan belum dibuat" };
  if (period.status !== "open") {
    return { ok: false, error: `Periode pembukuan ${name} sudah ditutup — posting tidak diizinkan` };
  }
  return { ok: true, period };
}

/** Satu baris jurnal yang sudah tervalidasi. */
export type ParsedJournalLine = { accountId: string; debit: number; credit: number };

/**
 * Validasi baris jurnal (aturan #1): debit>=0 / kredit>=0, HANYA salah satu
 * > 0 per baris, total debit === total kredit dgn toleransi 0.01.
 */
export function parseJournalLines(
  raw: unknown,
): { ok: true; lines: ParsedJournalLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Jurnal minimal memiliki satu baris debit/kredit" };
  }
  const lines: ParsedJournalLine[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const accountId = strOrNull(o.accountId);
    if (!accountId) return { ok: false, error: "Setiap baris jurnal wajib memilih akun" };
    const debit = numOrNull(o.debit) ?? 0;
    const credit = numOrNull(o.credit) ?? 0;
    if (debit < 0 || credit < 0) return { ok: false, error: "Nilai debit/kredit tidak boleh negatif" };
    if (debit > 0 && credit > 0) {
      return { ok: false, error: "Satu baris jurnal hanya boleh debit ATAU kredit (bukan keduanya)" };
    }
    if (debit === 0 && credit === 0) {
      return { ok: false, error: "Ada baris bernilai nol — isi debit atau kredit" };
    }
    lines.push({ accountId, debit, credit });
  }
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    return {
      ok: false,
      error: `Jurnal tidak seimbang — total debit ${rupiah(totalDebit)} vs total kredit ${rupiah(totalCredit)}`,
    };
  }
  return { ok: true, lines };
}

/** Pastikan semua akun pada baris jurnal ada & aktif; balas pesan error bila gagal. */
export async function ensureAccountsUsable(lines: ParsedJournalLine[]): Promise<string | null> {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await db.account.findMany({ where: { id: { in: ids } } });
  for (const id of ids) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return "Ada akun yang tidak ditemukan — muat ulang bagan akun";
    if (!acc.active) return `Akun ${acc.code} — ${acc.name} berstatus nonaktif dan tidak bisa dipakai`;
  }
  return null;
}

/** Tanggal dari body (ISO string) — Invalid Date → null agar tidak 500. */
export function rawDateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Satu item reimbursement yang sudah tervalidasi. */
export type ParsedExpenseItem = {
  purchaseDate: Date;
  description: string;
  category: ExpenseCategory;
  amount: number;
  receiptRef: string | null;
};

export function parseExpenseItem(
  raw: unknown,
): { ok: true; item: ParsedExpenseItem } | { ok: false; error: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const purchaseDate = rawDateOrNull(o.purchaseDate);
  if (!purchaseDate) return { ok: false, error: "Tanggal pembelian item wajib diisi" };
  const description = strOrNull(o.description);
  if (!description) return { ok: false, error: "Deskripsi item wajib diisi" };
  const category = String(o.category ?? "") as ExpenseCategory;
  if (!EXPENSE_CATEGORIES.includes(category)) {
    return { ok: false, error: "Kategori item tidak valid (transport/meals/accommodation/material/other)" };
  }
  const amount = numOrNull(o.amount);
  if (amount === null || amount <= 0) return { ok: false, error: "Jumlah item wajib angka lebih besar dari nol" };
  const receiptRef = strOrNull(o.receiptRef);
  return {
    ok: true,
    item: {
      purchaseDate,
      description: description.slice(0, 200),
      category,
      amount,
      receiptRef: receiptRef ? receiptRef.slice(0, 120) : null,
    },
  };
}

/** Profil karyawan milik aktor (self-service) — null bila user belum terhubung Employee. */
export async function selfEmployee(actor: ResolvedActor) {
  if (actor.denied || !actor.id) return null;
  return db.employee.findUnique({ where: { userId: actor.id } });
}
