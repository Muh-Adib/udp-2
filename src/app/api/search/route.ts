import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, pageLimit } from "@/lib/crm/server";

/**
 * Ronde 26 — GLOBAL SEARCH antar modul (⌘K command palette).
 * GET /api/search?q=<min 2 karakter>&limit=5
 * Mencari lintas entitas: kontak, perusahaan, opportunity, project, invoice,
 * penawaran, dan lead inbox (belum dikonversi). Tiap item membawa module tujuan
 * sehingga palette bisa memindahkan user langsung ke modul + entitasnya.
 */

type SearchItem = {
  id: string;
  module: "contacts" | "pipeline" | "projects" | "finance" | "inbox";
  label: string; // nama grup utk frontend (Kontak, Perusahaan, dst)
  title: string;
  subtitle: string;
  badge?: string;
};

const GROUP_TAKE = 5;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const limit = pageLimit(sp.get("limit"), GROUP_TAKE, 10);
  if (q.length < 2) return ok({ q, groups: [] });

  const like = q; // SQLite LIKE via Prisma `contains` (ASCII case-insensitive)
  const items: SearchItem[] = [];

  const [contacts, companies, opportunities, projects, invoices, quotations, leads] = await Promise.all([
    db.contact.findMany({
      where: {
        deletedAt: null,
        OR: [
          { fullName: { contains: like } },
          { email: { contains: like } },
          { whatsapp: { contains: like } },
          { instagram: { contains: like } },
          { position: { contains: like } },
        ],
      },
      include: { company: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    db.company.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: { contains: like } }, { website: { contains: like } }, { city: { contains: like } }],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    db.opportunity.findMany({
      where: {
        deletedAt: null,
        OR: [
          { title: { contains: like } },
          { serviceName: { contains: like } },
          { ownerName: { contains: like } },
        ],
      },
      include: { company: true, contact: true, brand: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    db.project.findMany({
      where: { OR: [{ code: { contains: like } }, { name: { contains: like } }, { pmName: { contains: like } }] },
      include: { company: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    db.invoice.findMany({
      where: { OR: [{ number: { contains: like } }, { description: { contains: like } }] },
      include: { company: true },
      orderBy: { issueDate: "desc" },
      take: limit,
    }),
    db.quotation.findMany({
      where: { OR: [{ number: { contains: like } }, { notes: { contains: like } }] },
      include: { company: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    db.interaction.findMany({
      where: {
        direction: "inbound",
        opportunityId: null,
        OR: [{ senderName: { contains: like } }, { content: { contains: like } }, { subject: { contains: like } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  for (const c of contacts) {
    items.push({
      id: c.id, module: "contacts", label: "Kontak",
      title: c.fullName,
      subtitle: [c.position, c.company?.name, c.email ?? c.whatsapp].filter(Boolean).join(" · ") || "Kontak",
      badge: "Kontak",
    });
  }
  for (const co of companies) {
    items.push({
      id: co.id, module: "contacts", label: "Perusahaan",
      title: co.name,
      subtitle: [co.industry, co.city, co.website].filter(Boolean).join(" · ") || "Perusahaan",
      badge: "Perusahaan",
    });
  }
  for (const o of opportunities) {
    items.push({
      id: o.id, module: "pipeline", label: "Opportunity",
      title: o.title,
      subtitle: [o.company?.name ?? o.contact.fullName, o.serviceName].filter(Boolean).join(" · "),
      badge: o.brand?.name,
    });
  }
  for (const p of projects) {
    items.push({
      id: p.id, module: "projects", label: "Project",
      title: `${p.code} — ${p.name}`,
      subtitle: [p.company.name, p.pmName].filter(Boolean).join(" · "),
      badge: p.status === "completed" ? "Selesai" : p.status === "in_progress" ? "Produksi" : p.status,
    });
  }
  for (const inv of invoices) {
    items.push({
      id: inv.id, module: "finance", label: "Invoice",
      title: inv.number,
      subtitle: [inv.company.name, inv.description].filter(Boolean).join(" · "),
      badge: inv.status,
    });
  }
  for (const q2 of quotations) {
    items.push({
      id: q2.id, module: "pipeline", label: "Penawaran",
      title: q2.number,
      subtitle: q2.company?.name ?? "",
      badge: q2.status,
    });
  }
  for (const l of leads) {
    items.push({
      id: l.id, module: "inbox", label: "Lead Inbox",
      title: l.senderName ?? l.subject ?? "Lead baru",
      subtitle: (l.subject ? `${l.subject} — ` : "") + l.content.slice(0, 80),
      badge: l.channel,
    });
  }

  return ok({ q, total: items.length, items });
}
