import { db } from "@/lib/db";
import { fail } from "@/lib/crm/server";
import type { ResolvedActor } from "@/lib/crm/auth";

// ============ HRIS — helper bersama untuk route handlers Fase 5 ============
// File ini BUKAN route (tidak diekspor sebagai endpoint) — hanya helper
// internal yang dipakai bersama seluruh route di folder hris/.

export const HR_ROLES = ["hr", "director", "super_admin"] as const;
export const MANAGER_PLUS_ROLES = ["hr", "manager", "director", "super_admin"] as const;
export const DIRECTOR_ROLES = ["director", "super_admin"] as const;
export const FINANCE_CLOSE_ROLES = ["finance", "director", "super_admin"] as const;

export function roleIn(role: string | null | undefined, allowed: readonly string[]): boolean {
  if (!role) return false;
  return (allowed as readonly string[]).includes(role);
}

/** Profil karyawan milik aktor (self-service) — null bila user belum terhubung Employee. */
export async function selfEmployee(actor: ResolvedActor) {
  if (actor.denied || !actor.id) return null;
  return db.employee.findUnique({ where: { userId: actor.id } });
}

/** Guard self-service: balas 404 "Profil karyawan tidak ditemukan" bila tidak ada. */
export async function requireSelfEmployee(actor: ResolvedActor) {
  const emp = await selfEmployee(actor);
  if (!emp) return { ok: false as const, res: fail("Profil karyawan tidak ditemukan", 404) };
  return { ok: true as const, employee: emp };
}

// ===== Tanggal bisnis (UTC) =====

/** String YYYY-MM-DD untuk hari ini (UTC). */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Validasi & normalisasi tanggal "YYYY-MM-DD" — null bila format salah. */
export function parseIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

/** Rentang [start, end] satu hari bisnis UTC dari string YYYY-MM-DD. */
export function utcDayRange(day: string): { start: Date; end: Date } {
  return {
    start: new Date(`${day}T00:00:00.000Z`),
    end: new Date(`${day}T23:59:59.999Z`),
  };
}

/** Rentang inklusif beberapa hari (YYYY-MM-DD) — utk riwayat 7 hari. */
export function utcRange(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00.000Z`),
    end: new Date(`${to}T23:59:59.999Z`),
  };
}

/** YYYY-MM-DD dari objek Date (di-UTC-kan). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Tanggal −n hari (UTC) dari hari ini, sebagai YYYY-MM-DD. */
export function daysAgoIso(n: number): string {
  return isoDay(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

// ===== Menit kerja =====

/** Menit sejak 00:00 → label "HH:MM"; >1440 ditandai "+1" (lintas tengah malam). */
export function minutesToLabel(min: number): string {
  const day = Math.floor(min / 1440);
  const rem = min % 1440;
  const hh = String(Math.floor(rem / 60)).padStart(2, "0");
  const mm = String(rem % 60).padStart(2, "0");
  return day > 0 ? `${hh}:${mm} +${day}` : `${hh}:${mm}`;
}

/** Utk UI: label lembur "09:00–13:00 (4j)". */
export function overtimeWindow(startMinute: number, endMinute: number): string {
  return `${minutesToLabel(startMinute)}–${minutesToLabel(endMinute)}`;
}

// ===== Hari kerja (Sen–Jum) =====

/** Tambah n hari KERJA (Sen–Jum) — aproksimasi tanpa kalender libur. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 = Minggu, 6 = Sabtu
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

// ===== Sanitasi umum =====

/** String aman dari body — trim, null bila kosong. */
export function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Angka ≥ 0 valid atau null (bukan NaN). */
export function nonNegNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Pesan ramah untuk pelanggaran unique Prisma (P2002). */
export function uniqueMessage(target: string[]): string {
  if (target.includes("employeeNumber")) return "Nomor karyawan sudah dipakai";
  if (target.includes("userId")) return "User sudah terhubung ke karyawan lain";
  if (target.includes("clientEventId")) return "Event absensi sudah tercatat (idempoten)";
  if (target.includes("date")) return "Tanggal libur sudah terdaftar";
  return "Data sudah ada (duplikat)";
}

/** Ambil target unique dari error Prisma P2002 (defensif). */
export function uniqueTargets(err: unknown): string[] {
  if (typeof err === "object" && err !== null) {
    const meta = (err as { meta?: { target?: unknown } }).meta;
    if (meta && Array.isArray(meta.target)) return meta.target.map(String);
  }
  return [];
}
