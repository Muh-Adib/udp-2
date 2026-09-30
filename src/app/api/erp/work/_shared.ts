import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/crm/server";
import { resolveActor, assertRole, type ResolvedActor } from "@/lib/crm/auth";
import { assertModuleLevel } from "@/lib/crm/permissions";

/**
 * Task 2-d — Work Engine (Fase 3 blueprint): helper bersama utk guard API.
 *
 * RBAC modul "work" (ModulePermission, sudah di-seed):
 *   super_admin/director/manager = full, production/marketing = write,
 *   finance/hr = read, client = none.
 * Semua endpoint butuh sesi; GET minimal level "read", mutasi minimal "write",
 * aksi terbatas (manager+) dijaga tambahan dgn assertRole.
 */

export const MANAGER_ROLES = ["manager", "director", "super_admin"] as const;
export const ADVANCE_ROLES = ["manager", "director", "super_admin", "production", "marketing"] as const;
export const PUBLISH_ROLES = ["production", "manager", "director", "super_admin"] as const;
export const APPROVE_INTERNAL_ROLES = ["manager", "director", "super_admin", "production"] as const;

export const STEP_KINDS = ["task", "review", "approval", "publish"] as const;
export const CONTEXT_TYPES = ["project", "retainer", "rnd", "standalone"] as const;

type WorkActor = Extract<ResolvedActor, { denied: false }>;
type AuthOk = { ok: true; actor: WorkActor };
type AuthErr = { ok: false; err: NextResponse };

/** Guard gabungan: sesi wajib + level akses modul "work" (read/write). */
export async function authWork(
  req: NextRequest,
  body: Record<string, unknown> = {},
  min: "read" | "write" = "read",
): Promise<AuthOk | AuthErr> {
  const actor = await resolveActor(req, body);
  if (actor.denied) return { ok: false, err: fail(actor.reason, 401) };
  const gate = await assertModuleLevel(actor, "work", min);
  if (!gate.ok) return { ok: false, err: fail(gate.reason, 403) };
  return { ok: true, actor };
}

/** Guard peran tambahan utk aksi terbatas → NextResponse 403 bila ditolak. */
export function requireRole(actor: ResolvedActor, allowed: readonly string[]): NextResponse | null {
  const gate = assertRole(actor, allowed);
  return gate.ok ? null : fail(gate.reason, 403);
}

/** Normalisasi assigneeIds: terima string[] ATAU comma-separated → "id1,id2" | null. */
export function normalizeAssigneeIds(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const parts = Array.isArray(raw)
    ? raw.map((v) => String(v).trim())
    : String(raw).split(",");
  const ids = parts.map((s) => s.trim()).filter(Boolean);
  const unique = [...new Set(ids)];
  return unique.length > 0 ? unique.join(",") : null;
}

/** Validasi daftar step workflow dari body → array siap create, atau pesan error. */
export interface StepInput {
  name: string;
  kind: string;
  roleNeeded: string | null;
  slaHours: number | null;
}

export function parseSteps(raw: unknown): { steps: StepInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Minimal satu tahapan (steps) wajib diisi" };
  if (raw.length > 30) return { error: "Maksimal 30 tahapan per versi" };
  const steps: StepInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = (raw[i] ?? {}) as Record<string, unknown>;
    const name = String(s.name ?? "").trim();
    if (!name) return { error: `Nama tahapan #${i + 1} wajib diisi` };
    const kind = String(s.kind ?? "task").trim();
    if (!(STEP_KINDS as readonly string[]).includes(kind)) {
      return { error: `Jenis tahapan #${i + 1} tidak valid (task/review/approval/publish)` };
    }
    const roleNeeded = s.roleNeeded ? String(s.roleNeeded).trim().slice(0, 60) : null;
    let slaHours: number | null = null;
    if (s.slaHours !== undefined && s.slaHours !== null && String(s.slaHours).trim() !== "") {
      const n = Number(s.slaHours);
      if (!Number.isFinite(n) || n < 0 || n > 2000) return { error: `SLA jam tahapan #${i + 1} tidak valid (0–2000)` };
      slaHours = Math.round(n);
    }
    steps.push({ name: name.slice(0, 160), kind, roleNeeded, slaHours });
  }
  return { steps };
}

/** Ambil brand ref aman utk join ringan. */
export const BRAND_SELECT = { select: { id: true, name: true, color: true } } as const;
