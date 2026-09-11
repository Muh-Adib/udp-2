import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";

/**
 * Ronde 49 — saran autocomplete untuk editor RAB estimasi:
 * - categories: nama kategori yang pernah dipakai (+ frekuensi)
 * - items: nama item yang pernah dipakai
 * - units: satuan yang pernah dipakai
 * Sumber: costCategories (struktur baru) + costItems (legacy) di seluruh estimasi.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req, {});
  if (actor.denied) return fail(actor.reason, 401);

  const estimations = await db.estimation.findMany({
    select: { costCategories: true, costItems: true },
    take: 1000,
  });

  const catCount = new Map<string, number>();
  const itemCount = new Map<string, number>();
  const unitCount = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string) => {
    const k = key.trim();
    if (k.length < 2 || k.length > 120) return;
    map.set(k, (map.get(k) ?? 0) + 1);
  };

  const toList = (raw: string | null | undefined): unknown[] => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  for (const est of estimations) {
    for (const cat of toList(est.costCategories)) {
      const c = (cat ?? {}) as Record<string, unknown>;
      if (typeof c.name === "string") bump(catCount, c.name);
      if (Array.isArray(c.items)) {
        for (const item of c.items) {
          const it = (item ?? {}) as Record<string, unknown>;
          if (typeof it.name === "string") bump(itemCount, it.name);
          if (typeof it.unit === "string") bump(unitCount, it.unit);
        }
      }
    }
    for (const item of toList(est.costItems)) {
      const it = (item ?? {}) as Record<string, unknown>;
      if (typeof it.name === "string") bump(itemCount, it.name);
    }
  }

  const top = (map: Map<string, number>, n: number): string[] =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);

  return ok({
    categories: top(catCount, 100),
    items: top(itemCount, 200),
    units: top(unitCount, 60),
  });
}
