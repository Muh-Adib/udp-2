// Shared types between API and frontend modules

export interface Brand {
  id: string;
  name: string;
  slug: string;
  color: string;
  description?: string | null;
  website?: string | null;
  primaryCurrency: string;
  invoicePrefix: string;
  quotePrefix: string;
  slaHours: number;
  portalDomain?: string | null;
  active: boolean;
  // Ronde 29-b — identitas asli + integrasi per brand
  logoUrl?: string | null;
  tagline?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  instagramHandle?: string | null;
  threadsHandle?: string | null;
  email?: string | null;
  letterheadHeader?: string | null;
  letterheadFooter?: string | null;
  letterTemplate?: string | null;
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
  /** Media sosial terstruktur — lead kerap datang dari Instagram dkk. */
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
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
  /** Ronde 40 — approval menunggu keputusan (hanya di GET /api/opportunities/[id], take 5). */
  pendingApprovals?: {
    id: string;
    entityType: string;
    entityId: string;
    entityLabel?: string | null;
    amount?: number | null;
    requestedBy?: string | null;
    status: string;
  }[];
  _count?: { interactions: number; tasks: number };
  createdAt: string;
  updatedAt: string;
}

/** Ronde 40 — master pajak bebas (model Tax): nama + persentase. */
export interface TaxDTO {
  id: string;
  name: string;
  rate: number;
  active: boolean;
}

/** Ronde 34-b — lampiran pesan chat (dokumen/gambar) — data URL kecil (≤2 MB per file). */
export interface InteractionAttachment {
  name: string;
  /** Data URL (data:...;base64,...) — bisa langsung diunduh dari bubble chat. */
  url: string;
  /** Ukuran file dalam byte (opsional). */
  size?: number;
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
  /** Ronde 34-b — lampiran pesan (JSON di DB, diparse di API). */
  attachments?: InteractionAttachment[] | null;
}

export interface TaskDTO {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  priority: string;
  status: string;
  assigneeName?: string | null;
  /** Ronde 40 — multi-assignee: JSON string di DB, array setelah diparse (atau mentah dari API). */
  assignees?: string | string[];
  /** Ronde 40 — lampiran task: JSON string di DB atau array hasil parse. */
  attachments?: string | TaskAttachment[];
  dueDate?: string | null;
  opportunityId?: string | null;
  /** Ronde 34-b — contact ikut di-include API tasks agar task follow-up bisa loncat ke chat kontak. */
  opportunity?: { id: string; title: string; stage: string; brand?: Brand; contact?: ContactRef | null } | null;
  completedAt?: string | null;
  createdAt: string;
}

/** Ronde 40 — lampiran task: tautan atau file kecil (data URL ≤5MB). */
export interface TaskAttachment {
  type: "link" | "file";
  name: string;
  url: string;
  size?: number;
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

/** Ronde 24 — satu pesan dalam thread percakapan per kontak (inbound & outbound). */
export interface ThreadMessageDTO {
  id: string;
  channel: string;
  direction: string;
  subject?: string | null;
  content: string;
  /** Ronde 34-b — lampiran dokumen/gambar yang dikirim bersama pesan. */
  attachments?: InteractionAttachment[] | null;
  senderName?: string | null;
  recipientName?: string | null;
  respondedBy?: string | null;
  deliveryStatus?: string | null;
  externalId?: string | null;
  createdAt: string;
}

/** Ronde 24 — thread percakapan: semua pesan dari identitas pengirim yang sama lintas kanal. */
export interface ConversationThreadDTO {
  key: string;
  messageCount: number;
  channels: string[];
  lastMessageAt: string;
  messages: ThreadMessageDTO[];
}

/** Ronde 24 — lead inbox dengan thread percakapan terlampir. */
export type InboxLeadDTO = InteractionDTO & {
  slaHours: number;
  candidates: MatchCandidateDTO[];
  threadKey: string;
  thread: ConversationThreadDTO;
  /** Ronde 25 — kanal balasan legal (hanya kanal yang punya alamat tujuan di kontak/lead). */
  replyChannels: string[];
};

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
  /** Ronde 35 — apa yang dicapai/diserahkan pada milestone ini (opsional). */
  achievement?: string | null;
}

/** Deliverable project: tautan atau file kecil yang dikirim untuk ditinjau klien/manajemen. */
export interface ProjectDeliverableDTO {
  id: string;
  projectId: string;
  /** Ronde 35 — opsional: deliverable ini untuk milestone mana (timeline produksi). */
  milestoneId?: string | null;
  name: string;
  kind: "link" | "file";
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  note?: string | null;
  status: "pending" | "approved" | "revision";
  reviewComment?: string | null;
  reviewedBy?: string | null;
  /** Ronde 25 — production | director | super_admin | client. */
  reviewedRole?: string | null;
  reviewedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

/** Pasangan kontak terdeteksi duplikat (scanner multi-sumber). */
export interface DuplicatePairDTO {
  primaryId: string;
  primaryName: string;
  primaryEmail?: string | null;
  primaryWhatsapp?: string | null;
  primaryCompany?: string | null;
  duplicateId: string;
  duplicateName: string;
  duplicateEmail?: string | null;
  duplicateWhatsapp?: string | null;
  duplicateCompany?: string | null;
  score: number;
  reasons: string[];
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
  /** Ronde 40 — nama pajak bebas (PPN, PPh 21, dll); null = tanpa pajak. */
  taxName?: string | null;
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

/** Ronde 40 — rincian biaya per item pada estimasi (JSON string di DB). */
export interface EstimationCostItem {
  name: string;
  qty: number;
  days?: number | null;
  unitPrice: number;
  subtotal: number;
}

export interface EstimationDTO {
  id: string;
  opportunityId: string;
  laborInternal: number; vendorFreelance: number; equipment: number; transport: number;
  accommodation: number; talent: number; locationFee: number; softwareLicense: number; hostingDomain: number;
  /** Ronde 40 — rincian biaya per item; bila totalnya > 0, totalCost mengikuti item ini. */
  costItems?: string | EstimationCostItem[];
  contingencyPct: number; managementFeePct: number; discountPct: number; taxPct: number; targetMarginPct: number;
  /** Ronde 40 — nama pajak bebas (PPN, PPh 21, dll); null = tanpa pajak (taxPct 0). */
  taxName?: string | null;
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
  /** Ronde 40 — nama pajak bebas (PPN, PPh 21, dll); null = tanpa pajak. */
  taxName?: string | null;
  taxAmount: number;
  total: number;
  currency: string;
  status: string;
  /** Ronde 39 — riwayat revisi: quotation ini revisi ke-N dari quotation sumber. */
  revisionOfId?: string | null;
  revisionNo?: number;
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
  /** Ronde 31 — tampilan dashboard terpersonalisasi per role (data dihitung server-side). */
  roleView?: DashboardRoleView;
}

// ============ Ronde 31 — Dashboard per-role ============

/** Cockpit personal marketing (berdasar opportunity.ownerName = nama user sesi). */
export interface DashboardMineView {
  openLeads: number;
  pipelineValue: number;
  wonCount: number;
  wonValue: number;
  tasksOpen: number;
  tasksDueToday: number;
  tasksOverdue: number;
  topDeals: {
    id: string;
    title: string;
    stage: string;
    value: number | null;
    brandName: string;
    brandColor: string;
    companyName: string | null;
  }[];
  myTasks: { id: string; title: string; dueDate: string | null; priority: string; overdue: boolean; dueToday: boolean; opportunityTitle: string | null }[];
  funnel: { stage: string; count: number; value: number }[];
}

/** Cockpit finance — kesehatan arus kas & tagihan. */
export interface DashboardFinanceView {
  outstanding: number;
  overdueCount: number;
  collectedThisMonth: number;
  billedThisMonth: number;
  byStatus: { status: string; count: number; total: number }[];
  overdueList: { id: string; number: string; company: string; total: number; dueDate: string | null; status: string }[];
  byBrand: { name: string; color: string; outstanding: number; count: number }[];
}

/** Cockpit production — antrian produksi & deliverables. */
export interface DashboardProductionView {
  activeProjects: number;
  atRisk: number;
  inReview: number;
  pendingCRs: number;
  deliverablesPending: number;
  milestonesDueSoon: { projectCode: string; projectName: string; name: string; dueDate: string | null; status: string }[];
  queue: { code: string; name: string; brandName: string; brandColor: string; progress: number; status: string; dueDate: string | null; companyName: string }[];
}

/** Ikhtisar tim (HR & manager). */
export interface DashboardTeamView {
  totalUsers: number;
  activeUsers: number;
  usersByRole: { role: string; count: number; active: number }[];
  tasksOpen: number;
  tasksDueToday: number;
  tasksOverdue: number;
}

export interface DashboardRoleView {
  role: string;
  userName: string | null;
  mine?: DashboardMineView;
  finance?: DashboardFinanceView;
  production?: DashboardProductionView;
  team?: DashboardTeamView;
}

// ============ NOTIFIKASI (Fase 3) ============

/** Ronde 32 — tambah type "message": pesan baru dari lead (inbound belum direspons ≤24 jam). */
export type NotificationType = "sla" | "message" | "approval" | "cr" | "task" | "deadline" | "invoice";
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
  brand?: { id: string; name: string; slug: string; color: string };
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
  brand?: { id: string; name: string; slug: string; color: string } | null;
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

// ============ FASE 3: PORTAL KLIEN — SECURE LINK TOKEN ============

/** Token akses klien (secure URL, tanpa login). */
export interface PortalTokenDTO {
  id: string;
  token: string;
  companyId: string;
  company?: { id: string; name: string } | null;
  label?: string | null;
  active: boolean;
  createdByName?: string | null;
  lastAccessedAt?: string | null;
  accessCount: number;
  expiresAt?: string | null;
  createdAt: string;
}

/** Dokumen / MoU / catatan rapat yang tampil di secure link klien. */
export interface ClientDocumentDTO {
  id: string;
  companyId: string;
  kind: "mou" | "meeting_note" | "document" | string;
  title: string;
  content?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  meetingAt?: string | null;
  attendees?: string | null;
  createdByName?: string | null;
  createdAt: string;
  /** fileData (base64 data URL) hanya dikirim bila diminta (unduh). */
  fileData?: string | null;
}

/** Payload GET /api/portal/[token] — isi secure link klien. */
export interface PortalTokenPayload {
  company: { id: string; name: string; industry?: string | null; city?: string | null };
  token: { label?: string | null; createdAt: string };
  documents: ClientDocumentDTO[];
  projects: {
    id: string;
    code: string;
    name: string;
    status: string;
    progress: number;
    dueDate?: string | null;
    brandName?: string | null;
    deliverables: import("@/lib/crm/types").ProjectDeliverableDTO[];
  }[];
}

// ============ Ronde 29-b — Katalog layanan & workflow produksi per brand ============

export interface WorkflowStageDTO {
  id: string;
  phase: string;
  name: string;
  description?: string | null;
  isMilestone: boolean;
  order: number;
}

/** Satu butir rincian biaya template harga layanan (Ronde 29-b). */
export interface ServiceCostItem {
  name: string;
  amount: number;
  note?: string | null;
}

export interface ServiceDTO {
  id: string;
  categoryId?: string | null;
  name: string;
  description?: string | null;
  unit?: string | null;
  basePrice?: number | null;
  costItems?: ServiceCostItem[] | null;
  costTotal?: number | null;
  suggestedPrice?: number | null;
  targetMarginPct?: number | null;
  order: number;
  active: boolean;
  workflow: WorkflowStageDTO[];
}

export interface ServiceCategoryDTO {
  id: string;
  name: string;
  description?: string | null;
  order: number;
  active: boolean;
}

/** Payload GET /api/brands/[id]/services — katalog lengkap satu brand. */
export interface BrandServiceCatalog {
  brand: { id: string; name: string; slug: string };
  categories: ServiceCategoryDTO[];
  services: ServiceDTO[];
}

// ============ Ronde 29-b — Peta layanan × brand & cross-selling (owner) ============

/** Baris layanan utk matriks brand (peta layanan). */
export interface ServiceMapRow {
  id: string;
  name: string;
  categoryId?: string | null;
  categoryName?: string | null;
  brandId: string;
  brandName: string;
  brandColor: string;
  unit?: string | null;
  basePrice?: number | null;
  costTotal?: number | null;
  suggestedPrice?: number | null;
  active: boolean;
}

/** Riwayat belanja 1 perusahaan pada 1 brand. */
export interface CrossSellPurchase {
  brandId: string;
  brandName: string;
  brandColor: string;
  serviceCount: number;
  totalValue: number;
  /** Nilai invoice terealisasi (non-draft/cancelled) perusahaan tsb pada brand ini (R30). */
  billedValue?: number;
  services: string[];
}

/** Peluang cross-sell 1 perusahaan ke brand lain. */
export interface CrossSellSuggestion {
  brandId: string;
  brandName: string;
  brandColor: string;
  topService?: string | null;
  basePrice?: number | null;
}

export interface CrossSellCompany {
  companyId: string;
  companyName: string;
  purchases: CrossSellPurchase[];
  totalValue: number;
  /** Total invoice terealisasi seluruh brand (R30). */
  billedValue?: number;
  suggestions: CrossSellSuggestion[];
}

/** Payload GET /api/service-map. */
export interface ServiceMapData {
  brands: { id: string; name: string; slug: string; color: string; logoUrl?: string | null; tagline?: string | null }[];
  rows: ServiceMapRow[];
  crossSell: CrossSellCompany[];
  stats: { companies: number; coveredAll: number; avgBrandsPerCompany: number; activeServices: number };
}
