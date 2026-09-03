import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/crm/server";
import { resolveActor } from "@/lib/crm/auth";
import type { CrossSellCompany, CrossSellPurchase, CrossSellSuggestion, ServiceCostItem, ServiceMapRow } from "@/lib/crm/types";

/**
 * Ronde 29-b — Peta Layanan × Brand & Peluang Cross-Selling (owner view).
 *
 * GET /api/service-map →
 *  - brands: ringkas (id, nama, warna, logo, tagline)
 *  - rows: seluruh layanan per brand (matriks layanan × brand, dgn harga acuan,
 *    total biaya template, dan saran harga = biaya × (1 + margin))
 *  - crossSell: per perusahaan → layanan apa yang sudah dibeli di brand mana,
 *    + saran layanan brand lain yang BELUM digarap (strategi cross-selling)
 *  - stats: sebaran (perusahaan aktif, perusahaan yang pakai semua brand, rata-rata brand)
 *
 * Cross-sell dihitung dari opportunity non-lost (won + aktif) per perusahaan × brand.
 */
function costTotalOf(costItemsJson: string | null): number | null {
  if (!costItemsJson) return null;
  try {
    const arr = JSON.parse(costItemsJson) as ServiceCostItem[];
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  } catch {
    return null;
  }
}

function suggestedOf(costTotal: number | null, marginPct: number | null, basePrice: number | null): number | null {
  if (costTotal !== null) {
    const margin = marginPct ?? 30;
    return Math.round((costTotal * (1 + margin / 100)) / 100_000) * 100_000;
  }
  return basePrice ?? null;
}

export async function GET(req: NextRequest) {
  // Read-only agregat — aktor diverifikasi (401 bila sesi rusak) tanpa gate role;
  // penyaringan tampilan dilakukan di UI (section hanya untuk super_admin/director).
  const actor = await resolveActor(req, {});
  if (actor.denied) {
    return ok({ brands: [], rows: [], crossSell: [], stats: { companies: 0, coveredAll: 0, avgBrandsPerCompany: 0, activeServices: 0 } });
  }

  const [brands, categories, services, opportunities] = await Promise.all([
    db.brand.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true, color: true, logoUrl: true, tagline: true },
    }),
    db.serviceCategory.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    db.service.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, name: true, categoryId: true, brandId: true, unit: true,
        basePrice: true, costItems: true, targetMarginPct: true, active: true,
      },
    }),
    db.opportunity.findMany({
      where: { deletedAt: null, companyId: { not: null } },
      select: { companyId: true, brandId: true, serviceName: true, estimatedValue: true, stage: true },
    }),
  ]);

  const brandById = new Map(brands.map((b) => [b.id, b]));
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  const rows: ServiceMapRow[] = services
    .filter((s) => brandById.has(s.brandId))
    .map((s) => {
      const brand = brandById.get(s.brandId)!;
      const costTotal = costTotalOf(s.costItems);
      return {
        id: s.id,
        name: s.name,
        categoryId: s.categoryId,
        categoryName: s.categoryId ? (catById.get(s.categoryId) ?? null) : null,
        brandId: s.brandId,
        brandName: brand.name,
        brandColor: brand.color,
        unit: s.unit,
        basePrice: s.basePrice,
        costTotal,
        suggestedPrice: suggestedOf(costTotal, s.targetMarginPct, s.basePrice),
        active: s.active,
      };
    });

  // ==== Cross-sell: grup opportunity per perusahaan × brand ====
  interface Purchase { brandId: string; serviceCount: number; totalValue: number; services: Set<string> }
  const byCompany = new Map<string, Map<string, Purchase>>();
  for (const o of opportunities) {
    if (!o.companyId || !brandById.has(o.brandId)) continue;
    let perBrand = byCompany.get(o.companyId);
    if (!perBrand) {
      perBrand = new Map();
      byCompany.set(o.companyId, perBrand);
    }
    let p = perBrand.get(o.brandId);
    if (!p) {
      p = { brandId: o.brandId, serviceCount: 0, totalValue: 0, services: new Set() };
      perBrand.set(o.brandId, p);
    }
    p.serviceCount += 1;
    p.totalValue += o.estimatedValue ?? 0;
    if (o.serviceName) p.services.add(o.serviceName);
  }

  const companyIds = [...byCompany.keys()];
  const companies = companyIds.length
    ? await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    : [];
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  // Layanan unggulan per brand = layanan aktif pertama (urutan editor) dgn nama.
  const topServiceByBrand = new Map<string, { name: string; basePrice: number | null }>();
  for (const s of rows) {
    if (!s.active || topServiceByBrand.has(s.brandId)) continue;
    topServiceByBrand.set(s.brandId, { name: s.name, basePrice: s.basePrice ?? null });
  }

  const crossSell: CrossSellCompany[] = [];
  for (const [companyId, perBrand] of byCompany) {
    const purchases: CrossSellPurchase[] = [...perBrand.values()]
      .map((p) => {
        const brand = brandById.get(p.brandId)!;
        return {
          brandId: p.brandId,
          brandName: brand.name,
          brandColor: brand.color,
          serviceCount: p.serviceCount,
          totalValue: p.totalValue,
          services: [...p.services],
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);

    const suggestions: CrossSellSuggestion[] = brands
      .filter((b) => !perBrand.has(b.id))
      .map((b) => {
        const top = topServiceByBrand.get(b.id);
        return {
          brandId: b.id,
          brandName: b.name,
          brandColor: b.color,
          topService: top?.name ?? null,
          basePrice: top?.basePrice ?? null,
        };
      });

    crossSell.push({
      companyId,
      companyName: companyName.get(companyId) ?? "Perusahaan",
      purchases,
      totalValue: purchases.reduce((sum, p) => sum + p.totalValue, 0),
      suggestions,
    });
  }
  crossSell.sort((a, b) => b.totalValue - a.totalValue);

  const avg = crossSell.length
    ? crossSell.reduce((sum, c) => sum + c.purchases.length, 0) / crossSell.length
    : 0;

  return ok({
    brands: brands.map((b) => ({ ...b })),
    rows,
    crossSell,
    stats: {
      companies: crossSell.length,
      coveredAll: crossSell.filter((c) => c.suggestions.length === 0).length,
      avgBrandsPerCompany: Math.round(avg * 10) / 10,
      activeServices: rows.filter((r) => r.active).length,
    },
  });
}
