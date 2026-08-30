// Shared types between API and frontend modules

export interface Brand {
  id: string;
  name: string;
  slug: string;
  color: string;
  logoEmoji: string;
  description?: string | null;
  website?: string | null;
  primaryCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  slaHours: number;
  portalDomain?: string | null;
  active: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string; // RoleKey
  avatarColor: string;
  brandAccess: string;
  companyName?: string | null; // for client role
}

export interface CompanyRef {
  id: string;
  name: string;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  website?: string | null;
  size?: string | null;
  defaultCurrency: string;
  lifetimeValue?: number;
  tags?: string | null;
}

export interface ContactRef {
  id: string;
  fullName: string;
  position?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  preferredChannel: string;
  language: string;
  consentStatus: string;
  tags?: string | null;
  companyId?: string | null;
  company?: CompanyRef | null;
}

export interface OpportunityDTO {
  id: string;
  title: string;
  brandId: string;
  brand?: Brand;
  companyId?: string | null;
  company?: CompanyRef | null;
  contactId: string;
  contact?: ContactRef;
  serviceCategory?: string | null;
  serviceName?: string | null;
  leadSource?: string | null;
  campaign?: string | null;
  brief?: string | null;
  requirements?: string | null;
  targetAudience?: string | null;
  deliverables?: string | null;
  targetDeadline?: string | null;
  estimatedValue?: number | null;
  currency: string;
  probability: number;
  expectedCloseDate?: string | null;
  ownerName?: string | null;
  priority: string;
  stage: string;
  temperature: string;
  competitor?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  lostReason?: string | null;
  lostNotes?: string | null;
  lastOfferValue?: number | null;
  reactivation?: boolean;
  followUpDate?: string | null;
  nurtureSegment?: string | null;
  crossSellOfId?: string | null;
  /** Lead score hasil rule-based scoring (dihitung server, Fase 4). */
  score?: number;
  /** Alasan/faktor penambah & pengurang skor. */
  scoreReasons?: string[];
  _count?: { interactions: number; tasks: number };
  createdAt: string;
  updatedAt: string;
}

export interface InteractionDTO {
  id: string;
  channel: string;
  direction: string;
  brandId?: string | null;
  externalId?: string | null;
  senderName?: string | null;
  recipientName?: string | null;
  subject?: string | null;
  content: string;
  respondedBy?: string | null;
  respondedAt?: string | null;
  deliveryStatus?: string | null;
  deliveryNote?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  createdAt: string;
  contact?: ContactRef | null;
  opportunity?: { id: string; title: string; stage: string } | null;
  brand?: Brand | null;
}

export interface TaskDTO {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  priority: string;
  status: string;
  assigneeName?: string | null;
  dueDate?: string | null;
  opportunityId?: string | null;
  opportunity?: { id: string; title: string; stage: string; brand?: Brand } | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface NoteDTO {
  id: string;
  body: string;
  authorName: string;
  type: string;
  opportunityId: string;
  createdAt: string;
}

export interface MatchCandidateDTO {
  contactId: string;
  score: number;
  reasons: string[];
  contact?: ContactRef;
}

export interface ProjectDTO {
  id: string;
  code: string;
  name: string;
  brandId: string;
  brand?: Brand;
  companyId: string;
  company?: CompanyRef;
  opportunityId?: string | null;
  serviceCategory?: string | null;
  status: string;
  progress: number;
  pmName?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  budgetInternal?: number;
  contractValue?: number;
  milestones?: MilestoneDTO[];
  /** Daftar change request project (ringkas) — Produksi Fase 2. */
  changeRequests?: ChangeRequestDTO[];
}

export interface MilestoneDTO {
  id: string;
  projectId: string;
  name: string;
  order: number;
  status: string;
  dueDate?: string | null;
}

/** Scope change request (Fase 2 Produksi) — persetujuan klien → invoice tambahan. */
export interface ChangeRequestDTO {
  id: string;
  number: string;
  projectId: string;
  project?: { id: string; code: string; name: string; status: string; dueDate?: string | null; brand?: Brand; company?: CompanyRef } | null;
  title: string;
  description: string;
  additionalCost: number;
  additionalDays: number;
  status: string; // pending, approved, rejected, cancelled
  requestedBy: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  invoiceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDTO {
  id: string;
  number: string;
  brandId: string;
  brand?: Brand;
  companyId: string;
  company?: CompanyRef;
  projectId?: string | null;
  opportunityId?: string | null;
  description?: string | null;
  amount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  notes?: string | null;
  payments?: PaymentDTO[];
}

export interface PaymentDTO {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  reference?: string | null;
  paidAt: string;
}

export interface AuditLogDTO {
  id: string;
  actorName: string;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId: string;
  entityLabel?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface EstimationDTO {
  id: string;
  opportunityId: string;
  laborInternal: number; vendorFreelance: number; equipment: number; transport: number;
  accommodation: number; talent: number; locationFee: number; softwareLicense: number; hostingDomain: number;
  contingencyPct: number; managementFeePct: number; discountPct: number; taxPct: number; targetMarginPct: number;
  totalCost: number; contingency: number; managementFee: number;
  revenue: number; discountAmount: number; netRevenue: number; taxAmount: number; grandTotal: number;
  margin: number; marginPct: number;
  notes?: string | null;
  status: string;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationItemDTO { description: string; qty: number; unitPrice: number; subtotal: number }

export interface QuotationDTO {
  id: string;
  number: string;
  brandId: string;
  brand?: Brand;
  opportunityId: string;
  opportunity?: { id: string; title: string; stage: string };
  companyId: string;
  company?: CompanyRef;
  items: string | QuotationItemDTO[];
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  taxPct: number;
  taxAmount: number;
  total: number;
  currency: string;
  status: string;
  validUntil?: string | null;
  notes?: string | null;
  sentAt?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestDTO {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  opportunityId?: string | null;
  opportunity?: OpportunityDTO | null;
  requestedBy: string;
  amount?: number | null;
  discountPct?: number | null;
  note?: string | null;
  status: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdAt: string;
}

export interface FollowUpTemplateDTO {
  id: string;
  name: string;
  brandId?: string | null;
  channel: string;
  language: string;
  stage?: string | null;
  delayDays: number;
  body: string;
  version: number;
  approved: boolean;
}

// ============ IMPORT CSV (dedupe identity matching) ============

export interface ImportCandidateDTO {
  contactId: string;
  score: number;
  reasons: string[];
  name?: string | null;
  company?: string | null;
}

export interface ImportPreviewRowDTO {
  index: number;
  fullName: string;
  company?: string | null;
  status: "valid" | "invalid";
  errors: string[];
  action: "auto_create" | "review" | "invalid";
  suggested: string; // "skip" | "create" | "link:<contactId>"
  candidates: ImportCandidateDTO[];
  intraBatch?: string;
}

export interface ImportPreviewResponseDTO {
  preview: ImportPreviewRowDTO[];
  summary: { total: number; valid: number; invalid: number; review: number };
}

export interface ImportCommitResultRowDTO {
  index: number;
  action: "create" | "link" | "skip" | "invalid";
  contactId?: string;
  label?: string;
  error?: string;
}

export interface ImportCommitResponseDTO {
  summary: { created: number; linked: number; skipped: number; invalid: number; companiesCreated: number };
  results: ImportCommitResultRowDTO[];
}

// ============ IMPORT CSV OPPORTUNITY (round-trip dgn ekspor ronde 13) ============

/** Opportunity existing yang dicocokkan sebagai duplikat saat impor (16-b). */
export interface ImportDuplicateOfDTO {
  id: string;
  title: string;
  createdAt: string;
}

/** Baris preview impor opportunity — status valid/review/invalid + alasan validasi + deteksi duplikat. */
export interface ImportOpportunityRowDTO {
  index: number;
  judul: string;
  brand: string;
  kontak: string;
  /** Nilai tahap mentah dari CSV. */
  tahap: string;
  /** Stage slug hasil resolusi (default "new" bila tidak dikenali). */
  tahapResolved: string;
  /** Nilai estimasi mentah dari CSV. */
  nilai: string;
  status: "valid" | "review" | "invalid";
  errors: string[];
  /** Terisi bila baris valid cocok dengan opportunity existing (judul+brand+perusahaan sama). */
  duplicateOf: ImportDuplicateOfDTO | null;
}

export interface ImportOpportunityPreviewResponseDTO {
  preview: ImportOpportunityRowDTO[];
  summary: { total: number; valid: number; invalid: number; review: number; duplicateCount: number };
}

export interface ImportOpportunityCommitResultRowDTO {
  index: number;
  action: "create" | "skip" | "invalid" | "update";
  opportunityId?: string;
  label?: string;
  error?: string;
  duplicateOf?: ImportDuplicateOfDTO | null;
  /** Rincian field yang berubah (hanya untuk action "update"). */
  changed?: string[];
}

export interface ImportOpportunityCommitResponseDTO {
  summary: { created: number; skipped: number; invalid: number; updated: number };
  results: ImportOpportunityCommitResultRowDTO[];
}

export interface DashboardData {
  kpi: {
    totalLeads: number;
    openLeads: number;
    pipelineValue: number;
    weightedPipeline: number;
    winRate: number;
    wonValue: number;
    avgResponseHours: number;
    overdueTasks: number;
    unassignedLeads: number;
    outstandingInvoices: number;
  };
  funnel: { stage: string; count: number; value: number }[];
  byBrand: { brandId: string; name: string; color: string; leads: number; won: number; value: number }[];
  byChannel: { channel: string; count: number }[];
  byCountry: { country: string; count: number }[];
  forecast: { bucket: string; value: number }[];
  lostReasons: { reason: string; count: number }[];
  marketingPerf: { name: string; leads: number; won: number; avgResponseHours: number }[];
  recentAudit: AuditLogDTO[];
  pipelineTrend: { label: string; created: number; won: number }[];
  projectsAtRisk?: number;
  productionCapacity?: number;
  pendingApprovals?: ApprovalRequestDTO[];
  /** Jumlah lead inbound belum direspons melewati SLA brand (Fase 3). */
  slaBreaches?: number;
  /** Jumlah change request menunggu persetujuan klien (Fase 2 Produksi). */
  pendingChangeRequests?: number;
  /** Jumlah task eskalasi otomatis yang dibuat sweep SLA pada fetch ini (Fase 3). */
  autoEscalated?: number;
}

// ============ NOTIFIKASI (Fase 3) ============

export type NotificationType = "sla" | "approval" | "cr" | "task" | "deadline" | "invoice";
export type NotificationSeverity = "info" | "warning" | "danger";

/** Notifikasi komputasi: isi dibangun dari data operasional, state baca/dismiss persist di NotificationState. */
export interface NotificationDTO {
  /** Kunci unik stabil, mis. "sla:<interactionId>", "cr:<id>", "approval:<id>". */
  key: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  /** ModuleKey tujuan saat notifikasi diklik (dashboard/inbox/pipeline/followups/finance/projects). */
  module: string;
  brandName?: string | null;
  brandColor?: string | null;
  /** Kode/label entitas, mis. "SEG-2026-0007", "CR-2026-0002", "UMS-2026-INV-003". */
  entityLabel?: string | null;
  /** Timestamp acuan (ISO) untuk urutan & umur. */
  at: string;
  /** Umur dalam jam (dari `at` saat dihitung server). */
  ageHours: number;
  read: boolean;
}

// ============ LAPORAN (ronde 17-b) ============

/** Periode laporan: window [since, until] berdasarkan jumlah hari ke belakang. */
export interface ReportPeriod {
  days: number;
  since: string; // ISO
  until: string; // ISO
}

/** KPI ringkas periode untuk strip atas modul Laporan. */
export interface ReportTotals {
  wonValue: number;
  wonCount: number;
  lostCount: number;
  winRatePct: number;
  outstanding: number;
  avgResponseHours: number;
}

/** Revenue per brand: opportunity won pada periode (won-date = updatedAt). */
export interface ReportRevenueBrandRow {
  brandId: string;
  name: string;
  color: string;
  count: number;
  value: number;
}

/** Win rate per layanan: kohort opportunity dibuat pada periode, per serviceCategory. */
export interface ReportWinRateServiceRow {
  category: string;
  created: number;
  won: number;
  lost: number;
  winRatePct: number;
  valueWon: number;
}

/** SLA compliance per brand: lead inbound pada periode vs slaHours brand. */
export interface ReportSlaRow {
  brandId: string;
  name: string;
  color: string;
  slaHours: number;
  total: number;
  responded: number;
  respondedPct: number;
  avgResponseHours: number;
  /** % lead terlambat melewati slaHours (sudah direspons telat ATAU belum direspons melewati SLA). */
  breachPct: number;
}

/** Invoice aging: outstanding invoice (sent/partial/overdue) yang sudah lewat jatuh tempo, per bucket hari. */
export interface ReportInvoiceAgingRow {
  bucket: string;
  count: number;
  amount: number;
}

/** Pipeline per owner: opportunity open (bukan won/lost) + weighted (value × probability). */
export interface ReportPipelineOwnerRow {
  owner: string;
  count: number;
  value: number;
  weighted: number;
}

/** Response GET /api/reports?brandId&days — seluruh seksi laporan dalam satu route. */
export interface ReportsData {
  period: ReportPeriod;
  totals: ReportTotals;
  revenuePerBrand: ReportRevenueBrandRow[];
  winRatePerService: ReportWinRateServiceRow[];
  slaCompliance: ReportSlaRow[];
  invoiceAging: ReportInvoiceAgingRow[];
  pipelinePerOwner: ReportPipelineOwnerRow[];
}

// ============ FASE 2: BRIEF BUILDER ============

/** Satu deliverable di dalam brief terstruktur. */
export interface BriefDeliverable {
  name: string;
  qty: number;
  notes?: string;
}

/** Satu referensi/link inspirasi di dalam brief. */
export interface BriefReference {
  label: string;
  url: string;
}

/** Status alur brief: draft → in_review → approved / revision. */
export type BriefStatus = "draft" | "in_review" | "approved" | "revision";

/** Brief terstruktur (Fase 2) — DTO dari /api/briefs. */
export interface ClientBriefDTO {
  id: string;
  code: string;
  opportunityId: string;
  brandId: string;
  brand?: { id: string; name: string; slug: string; color: string; logoEmoji: string };
  title: string;
  serviceTypes: string[];
  objectives?: string | null;
  targetAudience?: string | null;
  keyMessages?: string | null;
  deliverables: BriefDeliverable[];
  timelineStart?: string | null;
  timelineEnd?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency: string;
  references: BriefReference[];
  attachmentsNote?: string | null;
  status: BriefStatus;
  revisionNote?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============ FASE 3: SALURAN & INTEGRASI ============

/** Kredensial termask utk respons API ("••••1234"). */
export type MaskedCredentials = Record<string, string>;

/** Satu koneksi kanal (WhatsApp/Instagram/Email). */
export interface ChannelConfigDTO {
  id: string;
  channel: string;
  brandId?: string | null;
  brand?: { id: string; name: string; slug: string; color: string; logoEmoji: string } | null;
  displayName: string;
  accountRef?: string | null;
  credentials: MaskedCredentials;
  status: "connected" | "disconnected" | "error";
  statusNote?: string | null;
  isDemo?: boolean;
  connectedAt?: string | null;
  lastTestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Info webhook WhatsApp utk panduan setup Meta. */
export interface ChannelWebhookInfo {
  path: string;
  envVerifyToken: boolean;
  envAppSecret: boolean;
  effectiveVerifyToken: string;
  dbTokenCount: number;
  dbSecretCount: number;
}

/** Respons GET /api/channels. */
export interface ChannelActivityStats {
  inbound7d: number;
  outbound7d: number;
  inboundTotal: number;
}

export interface ChannelsData {
  configs: ChannelConfigDTO[];
  webhook: { whatsapp: ChannelWebhookInfo };
  stats: Record<string, ChannelActivityStats>;
  types: Record<string, import("@/lib/crm/channels").ChannelTypeMeta>;
}
