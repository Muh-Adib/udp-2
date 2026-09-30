import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, logAudit } from "@/lib/crm/server";
import { resolveActor, type ResolvedActor } from "@/lib/crm/auth";
import { stageLabel } from "@/lib/crm/constants";

/**
 * Task 73-c — Ekspor CSV end-to-end.
 * GET /api/exports/{type} — type ∈ opportunities | invoices | expenses | attendance | leave.
 *
 * - WAJIB sesi (resolveActor) → 401 tanpa sesi.
 * - Role "client" → 403 untuk semua tipe (fitur internal).
 * - RBAC per tipe:
 *   · opportunities & invoices : semua role internal.
 *   · attendance & leave       : manager+/hr/director/super_admin → semua karyawan;
 *                                role lain → HANYA data sendiri (scope self otomatis).
 *   · expenses                 : hr/director/finance/super_admin/manager → semua;
 *                                role lain → klaim milik sendiri.
 * - Response CSV: BOM \ufeff, header kolom baris pertama, escape RFC-4180
 *   (nilai dgn koma/kutip/newline dibungkus kutip ganda, kutip digandakan),
 *   angka plain tanpa pemformatan, tanggal yyyy-mm-dd, datetime yyyy-mm-dd HH:mm,
 *   baris diakhiri \n. Setiap ekspor tercatat di audit log (entity "export").
 */

const EXPORT_TYPES = ["opportunities", "invoices", "expenses", "attendance", "leave"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

/** Semua role internal boleh mengekspor opportunity & invoice. */
const INTERNAL_EXPORT_ROLES = ["super_admin", "director", "marketing", "finance", "production", "hr", "manager"] as const;
/** Role yang melihat data seluruh karyawan pada ekspor HRIS. */
const HRIS_ALL_ROLES = ["manager", "hr", "director", "super_admin"] as const;
/** Role yang melihat semua klaim reimbursement (pola erp/finance/expenses). */
const EXPENSE_ALL_ROLES = ["hr", "director", "finance", "super_admin", "manager"] as const;

class CsvExportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Actor = Extract<ResolvedActor, { denied: false }>;

// ============ Helper format CSV ============

/** Escape sel CSV (RFC-4180): koma/kutip/newline → dibungkus kutip, kutip digandakan. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Angka plain tanpa pemformatan ribuan (pembulatan 2 desimal utk artifact float). */
function csvNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Tanggal → ISO yyyy-mm-dd (UTC). */
function csvDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** Datetime → yyyy-mm-dd HH:mm (UTC). */
function csvDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** yyyyMMdd (UTC) untuk nama file. */
function utcStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/** Susun body CSV: BOM + baris header + baris data, tiap baris diakhiri \n. */
function buildCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

function roleIn(role: string | null, allowed: readonly string[]): boolean {
  return role !== null && (allowed as readonly string[]).includes(role);
}

/** Tanggal "YYYY-MM-DD" valid → string; selain itu null. */
function parseIsoDate(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
  const d = new Date(`${v.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : v.trim();
}

/** Profil karyawan milik aktor (self-service) — null bila user belum ter-link Employee. */
async function selfEmployeeId(actor: Actor): Promise<string | null> {
  if (!actor.id) return null;
  const emp = await db.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
  return emp?.id ?? null;
}

function employeeLabel(emp: { employeeNumber: string; preferredName: string } | null): string {
  return emp ? `${emp.employeeNumber} — ${emp.preferredName}` : "";
}

// ============ Builder per tipe ============

async function buildOpportunitiesCsv(req: NextRequest): Promise<{ headers: string[]; rows: string[][] }> {
  const sp = req.nextUrl.searchParams;
  const stage = sp.get("stage");
  const brandId = sp.get("brandId");
  const q = sp.get("q");
  const owner = sp.get("owner");

  // Filter ringan — pola GET /api/opportunities ("all" = tanpa filter).
  const where: Prisma.OpportunityWhereInput = { deletedAt: null };
  if (stage && stage !== "all") where.stage = stage;
  if (brandId && brandId !== "all") where.brandId = brandId;
  if (owner && owner !== "all") where.ownerName = owner === "__unassigned" ? null : owner;
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { serviceName: { contains: q } },
      { contact: { is: { fullName: { contains: q } } } },
      { company: { is: { name: { contains: q } } } },
    ];
  }

  const opportunities = await db.opportunity.findMany({
    where,
    include: { brand: true, contact: { include: { company: true } }, company: true },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });

  const headers = ["Kode", "Judul", "Perusahaan", "Kontak", "Brand", "Stage", "Nilai", "Probabilitas(%)", "Owner", "ExpectedClose", "Dibuat"];
  const rows = opportunities.map((o) => [
    o.id,
    o.title,
    o.company?.name ?? o.contact?.company?.name ?? "",
    o.contact?.fullName ?? "",
    o.brand?.name ?? "",
    stageLabel(o.stage),
    o.estimatedValue != null ? csvNumber(o.estimatedValue) : "",
    String(o.probability),
    o.ownerName ?? "",
    csvDate(o.expectedCloseDate),
    csvDate(o.createdAt),
  ]);
  return { headers, rows };
}

async function buildInvoicesCsv(req: NextRequest): Promise<{ headers: string[]; rows: string[][] }> {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const brandId = sp.get("brandId");

  // Sweep idempoten (mirror GET /api/invoices): "sent" yang lewat jatuh tempo →
  // "overdue", agar ekspor dgn filter status konsisten dgn modul finance.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  await db.invoice.updateMany({
    where: { status: "sent", dueDate: { lt: startOfToday } },
    data: { status: "overdue" },
  });

  const where: Prisma.InvoiceWhereInput = {};
  if (status && status !== "all") where.status = status;
  if (brandId && brandId !== "all") where.brandId = brandId;

  const invoices = await db.invoice.findMany({
    where,
    include: { brand: true, company: true, payments: { select: { amount: true } } },
    orderBy: { issueDate: "desc" },
    take: 1000,
  });

  const headers = ["Nomor", "Perusahaan", "Brand", "Status", "Total", "Dibayar", "Outstanding", "JatuhTempo", "Terbit"];
  const rows = invoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    return [
      inv.number,
      inv.company?.name ?? "",
      inv.brand?.name ?? "",
      inv.status,
      csvNumber(inv.total),
      csvNumber(paid),
      csvNumber(Math.max(0, inv.total - paid)),
      csvDate(inv.dueDate),
      csvDate(inv.issueDate),
    ];
  });
  return { headers, rows };
}

const EXPENSE_HEADERS = ["Tanggal", "Karyawan", "Kategori", "Total", "Status", "ReferensiJurnal"];

async function buildExpensesCsv(req: NextRequest, actor: Actor): Promise<{ headers: string[]; rows: string[][] }> {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");

  const where: Prisma.ExpenseClaimWhereInput = {};
  if (status && status !== "all") where.status = status;

  // RBAC: hr/director/finance/super_admin/manager → semua klaim;
  // role lain → hanya klaim milik sendiri (scope self, TANPA 403).
  if (!roleIn(actor.role, EXPENSE_ALL_ROLES)) {
    const selfId = await selfEmployeeId(actor);
    if (!selfId) return { headers: EXPENSE_HEADERS, rows: [] };
    where.employeeId = selfId;
  }

  const claims = await db.expenseClaim.findMany({
    where,
    include: {
      items: true,
      employee: { select: { employeeNumber: true, preferredName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  // ReferensiJurnal: jurnal posting per klaim (sourceType "expense") — satu query.
  const journal = claims.length
    ? await db.journalEntry.findMany({
        where: { sourceType: "expense", sourceId: { in: claims.map((c) => c.id) } },
        select: { id: true, sourceId: true },
      })
    : [];
  const journalByClaim = new Map<string, string>();
  for (const j of journal) {
    if (j.sourceId && !journalByClaim.has(j.sourceId)) journalByClaim.set(j.sourceId, j.id);
  }

  const rows = claims.map((c) => [
    csvDate(c.createdAt),
    employeeLabel(c.employee),
    [...new Set(c.items.map((i) => i.category))].join(", "),
    csvNumber(c.totalAmount),
    c.status,
    journalByClaim.get(c.id) ?? "",
  ]);
  return { headers: EXPENSE_HEADERS, rows };
}

const ATTENDANCE_HEADERS = ["Tanggal", "Karyawan", "CheckIn", "CheckOut", "Verdict", "Validation"];

async function buildAttendanceCsv(req: NextRequest, actor: Actor): Promise<{ headers: string[]; rows: string[][] }> {
  const sp = req.nextUrl.searchParams;
  const from = parseIsoDate(sp.get("from"));
  const to = parseIsoDate(sp.get("to"));
  if (from && to && from > to) throw new CsvExportError("Tanggal 'from' harus <= 'to'");

  const where: Prisma.AttendanceEventWhereInput = {};
  const employeeIdParam = sp.get("employeeId")?.trim() || null;

  // RBAC: manager+/hr/director/super_admin → semua karyawan (employeeId opsional);
  // role lain → scope self otomatis (param employeeId diabaikan).
  if (roleIn(actor.role, HRIS_ALL_ROLES)) {
    if (employeeIdParam) where.employeeId = employeeIdParam;
  } else {
    const selfId = await selfEmployeeId(actor);
    if (!selfId) return { headers: ATTENDANCE_HEADERS, rows: [] };
    where.employeeId = selfId;
  }

  if (from && to) {
    where.businessDate = { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T23:59:59.999Z`) };
  } else if (from) {
    where.businessDate = { gte: new Date(`${from}T00:00:00.000Z`) };
  } else if (to) {
    where.businessDate = { lte: new Date(`${to}T23:59:59.999Z`) };
  }
  // Tanpa from/to → seluruh riwayat (ekspor, bukan tampilan harian).

  const events = await db.attendanceEvent.findMany({
    where,
    include: { employee: { select: { employeeNumber: true, preferredName: true } } },
    orderBy: [{ businessDate: "asc" }, { receivedAt: "asc" }],
    take: 5000,
  });

  // Satu baris per (karyawan, tanggal bisnis): CheckIn = check_in terawal,
  // CheckOut = check_out terakhir; verdict/validation mengikuti event check-in.
  const grouped = new Map<string, { day: string; employee: string; checkIn: Date | null; checkOut: Date | null; verdict: string; validation: string }>();
  for (const ev of events) {
    const day = ev.businessDate.toISOString().slice(0, 10);
    const key = `${ev.employeeId}|${day}`;
    let g = grouped.get(key);
    if (!g) {
      g = { day, employee: employeeLabel(ev.employee), checkIn: null, checkOut: null, verdict: ev.locationVerdict, validation: ev.validationStatus };
      grouped.set(key, g);
    }
    if (ev.kind === "check_in") {
      if (!g.checkIn || ev.receivedAt < g.checkIn) {
        g.checkIn = ev.receivedAt;
        g.verdict = ev.locationVerdict;
        g.validation = ev.validationStatus;
      }
    } else if (ev.kind === "check_out") {
      if (!g.checkOut || ev.receivedAt > g.checkOut) g.checkOut = ev.receivedAt;
    }
  }

  const rows = [...grouped.values()]
    .sort((a, b) => (a.day === b.day ? a.employee.localeCompare(b.employee) : a.day.localeCompare(b.day)))
    .map((g) => [g.day, g.employee, csvDateTime(g.checkIn), csvDateTime(g.checkOut), g.verdict, g.validation]);
  return { headers: ATTENDANCE_HEADERS, rows };
}

const LEAVE_HEADERS = ["Karyawan", "Tipe", "Mulai", "Selesai", "Status", "DisetujuiOleh"];

async function buildLeaveCsv(req: NextRequest, actor: Actor): Promise<{ headers: string[]; rows: string[][] }> {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const year = sp.get("year");

  const where: Prisma.LeaveRequestWhereInput = {};
  if (status && status !== "all") where.status = status;
  if (year && /^\d{4}$/.test(year.trim())) {
    const y = Number(year.trim());
    where.startDate = { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)) };
  }

  // RBAC sama dgn attendance: manager+ → semua; role lain → scope self.
  if (!roleIn(actor.role, HRIS_ALL_ROLES)) {
    const selfId = await selfEmployeeId(actor);
    if (!selfId) return { headers: LEAVE_HEADERS, rows: [] };
    where.employeeId = selfId;
  }

  const requests = await db.leaveRequest.findMany({
    where,
    include: { employee: { select: { employeeNumber: true, preferredName: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const rows = requests.map((r) => [
    employeeLabel(r.employee),
    r.type,
    csvDate(r.startDate),
    csvDate(r.endDate),
    r.status,
    r.approvedBy ?? "",
  ]);
  return { headers: LEAVE_HEADERS, rows };
}

// ============ Route handler (GET saja) ============

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;

  const actor = await resolveActor(req);
  if (actor.denied) return fail(actor.reason, 401);
  if (actor.role === "client") return fail("Ekspor data hanya tersedia untuk pengguna internal", 403);
  if (!(EXPORT_TYPES as readonly string[]).includes(type)) {
    return fail("Tipe ekspor tidak dikenal (opportunities/invoices/expenses/attendance/leave)", 404);
  }
  const exportType = type as ExportType;

  // opportunities & invoices: semua role internal (client sudah ditolak di atas).
  if (
    (exportType === "opportunities" || exportType === "invoices") &&
    !roleIn(actor.role, INTERNAL_EXPORT_ROLES)
  ) {
    return fail("Peran Anda tidak berhak mengekspor data ini", 403);
  }

  let csv: { headers: string[]; rows: string[][] };
  try {
    if (exportType === "opportunities") csv = await buildOpportunitiesCsv(req);
    else if (exportType === "invoices") csv = await buildInvoicesCsv(req);
    else if (exportType === "expenses") csv = await buildExpensesCsv(req, actor);
    else if (exportType === "attendance") csv = await buildAttendanceCsv(req, actor);
    else csv = await buildLeaveCsv(req, actor);
  } catch (err) {
    if (err instanceof CsvExportError) return fail(err.message, err.status);
    throw err;
  }

  // Audit eksportasi — praktik baik: siapa mengekspor apa & seberapa besar.
  await logAudit({
    actorName: actor.name,
    actorRole: actor.role,
    action: "export",
    entity: "export",
    entityId: exportType,
    entityLabel: `Ekspor CSV ${exportType}`,
    metadata: JSON.stringify({ type: exportType, rows: csv.rows.length }),
    req,
  });

  return new NextResponse(buildCsv(csv.headers, csv.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="udp-${exportType}-${utcStamp()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
