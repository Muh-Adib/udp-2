import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody } from "@/lib/crm/server";
import { extractDomain, normalizeEmail, normalizePhone } from "@/lib/crm/utils";
import { INDUSTRY_SUGGESTIONS, KNOW_FROM_SUGGESTIONS } from "@/lib/crm/constants";

/**
 * Ronde 57 — FORM INTAKE PUBLIK (tanpa login) untuk shareable link per brand.
 * URL: /?intake=<token> → GET metainfo + POST submit.
 *
 * POST otomatis (SATU transaksi):
 *  1. Company baru/reuse (dedupe nama case-insensitive / domain) — alamat tersimpan utk surat.
 *  2. Contact baru/reuse (dedupe email/whatsapp).
 *  3. Opportunity stage "new" — brand dari link, deadline = input, leadSource = "know brand from",
 *     expectedCloseDate = deadline − 3 minggu; bila mepet (<3 minggu) = besok.
 *  4. Draft ClientBrief — judul = judul project, tanpa layanan, timelineEnd = deadline − 1 hari,
 *     objective/audience/keywords/deliverables/budget/referensi/catatan dari form.
 *  5. Interaction timeline channel "website" + hitung submissionCount link + audit log.
 */

/** Rate limit sederhana in-memory per token (10 submit / 5 menit) — anti spam dasar. */
const submitHits = new Map<string, number[]>();
function submitRateLimited(key: string): boolean {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const hits = (submitHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= 10) return true;
  hits.push(now);
  submitHits.set(key, hits);
  if (submitHits.size > 500) submitHits.clear();
  return false;
}

/** Pastikan kode brief unik (loop 5x — pola Ronde 36). */
async function uniqueBriefCode(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await tx.clientBrief.count();
    const candidate = `BRF-${year}-${String(count + attempt + 1).padStart(4, "0")}`;
    const exists = await tx.clientBrief.findUnique({ where: { code: candidate } });
    if (!exists) return candidate;
  }
  throw new Error("BRIEF_CODE_FAIL");
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Parse budget seperti form brief internal: ambil digit saja ("50 jt" → 50). */
function parseBudget(v: unknown): number | null {
  const digits = String(v ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface DelivInput { name: string; qty: number }
interface RefInput { label: string; url: string }

/**
 * Deliverables: array [{name, qty}] dari form brief-style ATAU teks per baris
 * (fallback backward-compat form lama). Maks 20 item.
 */
function parseDeliverables(body: Record<string, unknown>): DelivInput[] {
  const raw = body.deliverables;
  if (Array.isArray(raw)) {
    return raw
      .slice(0, 20)
      .map((d) => {
        const row = (d ?? {}) as Record<string, unknown>;
        const name = String(row.name ?? "").trim().slice(0, 160);
        const qtyNum = Number(row.qty);
        const qty = Number.isFinite(qtyNum) && qtyNum >= 1 ? Math.min(999, Math.floor(qtyNum)) : 1;
        return { name, qty };
      })
      .filter((d) => d.name);
  }
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((name) => ({ name: name.slice(0, 160), qty: 1 }));
}

/** Referensi: array [{label, url}] ATAU teks per baris (fallback). Maks 10 item. */
function parseReferences(body: Record<string, unknown>): RefInput[] {
  const raw = body.references;
  if (Array.isArray(raw)) {
    return raw
      .slice(0, 10)
      .map((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const url = String(row.url ?? "").trim().slice(0, 500);
        const label = (String(row.label ?? "").trim() || url.replace(/^https?:\/\//, "")).slice(0, 80);
        return { label, url };
      })
      .filter((r) => r.url);
  }
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((url) => ({ label: url.replace(/^https?:\/\//, "").slice(0, 80), url: url.slice(0, 500) }));
}

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const link = await db.leadIntakeLink.findUnique({
    where: { token },
    include: {
      brand: {
        select: { id: true, name: true, slug: true, color: true, logoUrl: true, tagline: true, website: true, primaryCurrency: true },
      },
    },
  });
  if (!link) return fail("Link tidak ditemukan", 404);
  if (!link.active) return fail("Link ini sudah dimatikan — hubungi tim kami", 410);
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return fail("Link ini sudah kedaluwarsa — hubungi tim kami", 410);
  }

  // Saran autocomplete: konstanta + data nyata di DB (industri perusahaan, sumber lead).
  const [industriesDb, knowFromDb] = await Promise.all([
    db.company.findMany({ where: { deletedAt: null, industry: { not: null } }, select: { industry: true }, distinct: ["industry"] }),
    db.opportunity.findMany({ where: { leadSource: { not: null } }, select: { leadSource: true }, distinct: ["leadSource"] }),
  ]);
  const industries = Array.from(new Set([...INDUSTRY_SUGGESTIONS, ...industriesDb.map((r) => r.industry ?? "").filter(Boolean)])).sort((a, b) => a.localeCompare(b));
  const knowFromKeys = knowFromDb.map((r) => r.leadSource ?? "").filter(Boolean);
  const knowFrom = KNOW_FROM_SUGGESTIONS.filter((s) => s.key !== "other" || knowFromKeys.length === 0 || knowFromKeys.includes("other"));

  // Update lastAccessedAt best-effort (tanpa menunggu).
  void db.leadIntakeLink.update({ where: { id: link.id }, data: { lastAccessedAt: new Date() } }).catch(() => undefined);

  return ok({
    intake: {
      brand: link.brand,
      label: link.label,
      expiresAt: link.expiresAt,
      industries,
      knowFrom,
      submissionCount: link.submissionCount,
    },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  if (submitRateLimited(token)) return fail("Terlalu banyak percobaan — coba lagi beberapa menit lagi", 429);

  const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
  const link = await db.leadIntakeLink.findUnique({ where: { token }, include: { brand: true } });
  if (!link) return fail("Link tidak ditemukan", 404);
  if (!link.active) return fail("Link ini sudah dimatikan — hubungi tim kami", 410);
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return fail("Link ini sudah kedaluwarsa — hubungi tim kami", 410);
  }

  // ===== Validasi (Ronde 58: email & WA WAJIB + alamat/kota/negara wajib) =====
  const fullName = String(body.fullName ?? "").trim();
  if (!fullName) return fail("Nama lengkap wajib diisi");
  const email = normalizeEmail(String(body.email ?? ""));
  if (!email) return fail("Email wajib diisi dengan format valid — contoh: nama@perusahaan.co.id");
  // WhatsApp wajib — dinormalisasi dgn aturan sistem (08xx → 628xx, +62 → 62).
  const whatsappRaw = String(body.whatsapp ?? "").trim();
  if (!whatsappRaw) return fail("Nomor WhatsApp wajib diisi");
  const waDigits = normalizePhone(whatsappRaw) ?? "";
  if (!waDigits) return fail("Nomor WhatsApp tidak valid");
  if (waDigits.length < 8 || waDigits.length > 15) {
    return fail("Nomor WhatsApp tidak valid — harus 8–15 digit (standar E.164, cth. 628123456789)");
  }

  const companyName = String(body.companyName ?? "").trim();
  if (!companyName) return fail("Nama perusahaan wajib diisi");
  const companyAddress = String(body.companyAddress ?? "").trim();
  if (!companyAddress) return fail("Alamat perusahaan wajib diisi (dipakai untuk surat)");
  const companyCity = String(body.companyCity ?? "").trim();
  if (!companyCity) return fail("Kota wajib diisi");
  const companyCountry = String(body.companyCountry ?? "").trim();
  if (!companyCountry) return fail("Negara wajib diisi");
  const companyIndustry = String(body.industry ?? "").trim() || null;
  const companyWebsite = String(body.companyWebsite ?? "").trim() || null;

  const title = String(body.projectTitle ?? "").trim();
  if (!title) return fail("Judul project wajib diisi");
  const deadlineRaw = String(body.deadline ?? "").trim();
  if (!deadlineRaw) return fail("Target deadline wajib diisi");
  const deadline = new Date(deadlineRaw);
  if (Number.isNaN(deadline.getTime())) return fail("Format deadline tidak valid");

  const knowFrom = String(body.knowFrom ?? "").trim() || null; // → opportunity.leadSource

  // ===== Aturan estimasi close =====
  // Deadline ≥ 3 minggu lagi → expected close = deadline − 21 hari.
  // Mepet (< 3 minggu) → expected close = besok (H+1).
  const now = new Date();
  const threeWeeksMs = 21 * 24 * 60 * 60 * 1000;
  const untilDeadline = deadline.getTime() - now.getTime();
  const expectedCloseDate = untilDeadline >= threeWeeksMs
    ? new Date(deadline.getTime() - threeWeeksMs)
    : new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // ===== Brief fields =====
  const objectives = String(body.objectives ?? "").trim() || null;
  const targetAudience = String(body.targetAudience ?? "").trim() || null;
  const keywords = String(body.keywords ?? "").trim() || null;
  const deliverables = parseDeliverables(body);
  const budgetMin = parseBudget(body.budgetMin);
  const budgetMax = parseBudget(body.budgetMax);
  const references = parseReferences(body);
  const catatan = String(body.catatan ?? "").trim() || null;
  // Timeline pengerjaan: bagian tim produksi (bukan form) — end otomatis = deadline − 1 hari.
  const timelineEnd = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);

  const splitName = fullName.split(/\s+/);
  const firstName = splitName[0].slice(0, 80);
  const lastName = splitName.slice(1).join(" ").slice(0, 80) || null;
  const brand = link.brand;

  try {
    const result = await db.$transaction(async (tx) => {
      // ===== 1. Company: reuse by domain, lalu nama (case-insensitive) =====
      const domain = extractDomain(companyWebsite);
      let company = domain
        ? await tx.company.findFirst({ where: { deletedAt: null, websiteDomain: domain } })
        : null;
      if (!company) {
        const candidates = await tx.company.findMany({
          where: { deletedAt: null, name: { contains: companyName } },
          take: 20,
        });
        company = candidates.find((c) => c.name.toLowerCase() === companyName.toLowerCase()) ?? null;
      }
      if (!company) {
        company = await tx.company.create({
          data: {
            name: companyName.slice(0, 160),
            industry: companyIndustry,
            website: companyWebsite,
            websiteDomain: domain,
            country: companyCountry,
            city: companyCity,
            address: companyAddress, // alamat tersimpan utk dokumen surat
            defaultCurrency: brand.primaryCurrency,
          },
        });
      } else if (companyAddress && !company.address) {
        // Perusahaan lama belum punya alamat → isi dari form (jangan menimpa data ada).
        company = await tx.company.update({ where: { id: company.id }, data: { address: companyAddress } });
      }

      // ===== 2. Contact: dedupe email/whatsapp (pola konversi inbox) =====
      let contact = await tx.contact.findFirst({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(waDigits ? [{ whatsapp: waDigits }] : []),
          ],
        },
      });
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            firstName,
            lastName,
            fullName: fullName.slice(0, 160),
            email: email || null,
            whatsapp: waDigits || null,
            country: companyCountry,
            city: companyCity,
            currency: brand.primaryCurrency,
            companyId: company.id,
            language: "id",
          },
        });
      } else if (!contact.companyId) {
        contact = await tx.contact.update({ where: { id: contact.id }, data: { companyId: company.id } });
      }

      // ===== 3. Opportunity =====
      const opportunity = await tx.opportunity.create({
        data: {
          title: title.slice(0, 200),
          brandId: brand.id,
          companyId: company.id,
          contactId: contact.id,
          leadSource: knowFrom,
          targetDeadline: deadline,
          expectedCloseDate,
          stage: "new",
          currency: brand.primaryCurrency,
          ownerName: link.createdByName, // pemilik link bertanggung jawab atas lead
        },
      });

      // ===== 4. Draft ClientBrief =====
      const code = await uniqueBriefCode(tx);
      const brief = await tx.clientBrief.create({
        data: {
          code,
          opportunityId: opportunity.id,
          brandId: brand.id,
          title: title.slice(0, 200), // nama brief = judul project (tidak diminta ke user)
          serviceTypes: "[]", // layanan disembunyikan di form intake
          objectives,
          targetAudience,
          keywords,
          deliverables: JSON.stringify(deliverables),
          timelineStart: now, // timeline pengerjaan diatur tim produksi — start = hari ini
          timelineEnd,
          budgetMin,
          budgetMax,
          currency: brand.primaryCurrency,
          references: JSON.stringify(references),
          attachmentsNote: catatan,
          status: "draft",
          createdBy: "Formulir Intake",
          submittedAt: now,
        },
      });

      // ===== 5. Interaction timeline (channel website — masuk ke histori opportunity) =====
      const ringkasan = [
        objectives ? `Tujuan: ${objectives}` : "",
        deliverables.length ? `Deliverables: ${deliverables.map((d) => d.name).join(", ")}` : "",
        budgetMin || budgetMax ? `Budget: ${budgetMin ?? "?"} – ${budgetMax ?? "?"} ${brand.primaryCurrency}` : "",
        catatan ? `Catatan: ${catatan}` : "",
      ].filter(Boolean).join("\n");
      await tx.interaction.create({
        data: {
          opportunityId: opportunity.id,
          contactId: contact.id,
          companyId: company.id,
          brandId: brand.id,
          channel: "website",
          direction: "inbound",
          subject: "Formulir request via link intake",
          content: ringkasan || "Lead masuk dari formulir intake publik.",
          deliveryStatus: "delivered",
        },
      });

      await tx.leadIntakeLink.update({
        where: { id: link.id },
        data: { submissionCount: { increment: 1 }, lastSubmissionAt: now },
      });

      return { opportunity, company, contact, brief };
    });

    await db.auditLog.create({
      data: {
        actorName: "Formulir Intake (publik)",
        actorRole: "system",
        action: "create",
        entity: "opportunity",
        entityId: result.opportunity.id,
        entityLabel: `lead intake: ${result.opportunity.title} (${result.company.name})`,
        metadata: JSON.stringify({ via: "intake_link", brand: brand.name, linkId: link.id }),
      },
    }).catch(() => undefined);

    return ok({
      submitted: true,
      opportunity: { id: result.opportunity.id, title: result.opportunity.title },
      briefCode: result.brief.code,
      expectedCloseDate: result.opportunity.expectedCloseDate,
    }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "BRIEF_CODE_FAIL") {
      return fail("Gagal menyusun kode brief — coba sekali lagi", 409);
    }
    console.error("[public-intake] gagal:", err);
    return fail("Terjadi kesalahan saat memproses formulir — coba lagi", 500);
  }
}
