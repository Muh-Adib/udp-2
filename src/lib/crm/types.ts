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
}

export interface MilestoneDTO {
  id: string;
  projectId: string;
  name: string;
  order: number;
  status: string;
  dueDate?: string | null;
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
}
