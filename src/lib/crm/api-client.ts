"use client";

import type {
  OpportunityDTO, InteractionDTO, TaskDTO, ContactRef, CompanyRef,
  DashboardData, MatchCandidateDTO, ProjectDTO, InvoiceDTO, AuditLogDTO, Brand,
} from "@/lib/crm/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  // Bootstrap
  bootstrap: () => request<{ ready: boolean }>("/api/bootstrap"),
  login: (email: string, pin: string) =>
    request<{ user: { id: string; name: string; email: string; role: string; avatarColor: string; brandAccess: string; companyName?: string | null } }>(
      "/api/auth/login", { method: "POST", body: JSON.stringify({ email, pin }) }
    ),
  users: () => request<{ users: { id: string; name: string; email: string; role: string; avatarColor: string; active: boolean }[] }>("/api/users"),

  // Brands
  brands: () => request<{ brands: Brand[] }>("/api/brands"),

  // Dashboard
  dashboard: () => request<DashboardData>("/api/dashboard"),

  // Opportunities
  opportunities: (params?: { stage?: string; brandId?: string; q?: string; owner?: string }) => {
    const sp = new URLSearchParams();
    if (params?.stage) sp.set("stage", params.stage);
    if (params?.brandId) sp.set("brandId", params.brandId);
    if (params?.q) sp.set("q", params.q);
    if (params?.owner) sp.set("owner", params.owner);
    return request<{ opportunities: OpportunityDTO[] }>(`/api/opportunities?${sp}`);
  },
  opportunity: (id: string) => request<{ opportunity: OpportunityDTO & {
    interactions: InteractionDTO[]; tasks: TaskDTO[]; notes: { id: string; body: string; authorName: string; type: string; createdAt: string }[];
    projects: { id: string; code: string; name: string; status: string; progress: number; milestones: { id: string; name: string; order: number; status: string; dueDate?: string | null }[] }[];
    invoices: InvoiceDTO[];
  }; related: OpportunityDTO[] }>(`/api/opportunities/${id}`),
  createOpportunity: (payload: Record<string, unknown>) =>
    request<{ opportunity: OpportunityDTO }>("/api/opportunities", { method: "POST", body: JSON.stringify(payload) }),
  updateOpportunity: (id: string, payload: Record<string, unknown>) =>
    request<{ opportunity: OpportunityDTO; createdProject?: { code: string } | null }>(`/api/opportunities/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  aiSummary: (id: string) =>
    request<{ summary: string }>(`/api/opportunities/${id}/summary`, { method: "POST" }),

  // Estimation (Fase 2)
  getEstimation: (id: string) =>
    request<{ estimation: import("@/lib/crm/types").EstimationDTO }>(`/api/opportunities/${id}/estimation`),
  saveEstimation: (id: string, payload: Record<string, unknown>) =>
    request<{ estimation: import("@/lib/crm/types").EstimationDTO; approval?: import("@/lib/crm/types").ApprovalRequestDTO }>(
      `/api/opportunities/${id}/estimation`, { method: "PUT", body: JSON.stringify(payload) }
    ),

  // Quotations (Fase 2)
  quotations: (params?: { status?: string; brandId?: string; opportunityId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    if (params?.opportunityId) sp.set("opportunityId", params.opportunityId);
    return request<{ quotations: import("@/lib/crm/types").QuotationDTO[] }>(`/api/quotations?${sp}`);
  },
  createQuotation: (payload: Record<string, unknown>) =>
    request<{ quotation: import("@/lib/crm/types").QuotationDTO }>("/api/quotations", { method: "POST", body: JSON.stringify(payload) }),
  quotationAction: (id: string, payload: Record<string, unknown>) =>
    request<{ quotation?: import("@/lib/crm/types").QuotationDTO; invoice?: { number: string } }>(`/api/quotations/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // Approvals (Fase 2)
  approvals: (status?: string) =>
    request<{ approvals: import("@/lib/crm/types").ApprovalRequestDTO[]; pendingCount: number }>(
      `/api/approvals${status && status !== "all" ? `?status=${status}` : ""}`
    ),
  decideApproval: (payload: { id: string; decision: "approve" | "reject"; decisionNote?: string; actorName: string; actorRole: string }) =>
    request<{ approval: import("@/lib/crm/types").ApprovalRequestDTO }>("/api/approvals", { method: "PATCH", body: JSON.stringify(payload) }),

  // Brands & templates
  createBrand: (payload: Record<string, unknown>) =>
    request<{ brand: import("@/lib/crm/types").Brand }>("/api/brands", { method: "POST", body: JSON.stringify(payload) }),
  followUpTemplates: (brandId?: string) =>
    request<{ templates: import("@/lib/crm/types").FollowUpTemplateDTO[] }>(
      `/api/followup-templates${brandId && brandId !== "all" ? `?brandId=${brandId}` : ""}`
    ),

  // Contacts & companies
  contacts: (q?: string) => request<{ contacts: (ContactRef & { company?: CompanyRef | null; _count?: { opportunities: number; interactions: number } })[] }>(`/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  companies: (q?: string) => request<{ companies: (CompanyRef & { contacts?: ContactRef[]; _count?: { opportunities: number; projects: number; invoices: number } })[] }>(`/api/companies${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createContact: (payload: Record<string, unknown>) =>
    request<{ contact: ContactRef; duplicateCandidates: MatchCandidateDTO[] }>("/api/contacts", { method: "POST", body: JSON.stringify(payload) }),
  updateContact: (id: string, payload: Record<string, unknown>) =>
    request<{ contact: ContactRef }>(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  createCompany: (payload: Record<string, unknown>) =>
    request<{ company: CompanyRef }>("/api/companies", { method: "POST", body: JSON.stringify(payload) }),
  mergeContacts: (primaryId: string, duplicateId: string, actorName: string) =>
    request<{ merged: boolean }>("/api/contacts/merge", { method: "POST", body: JSON.stringify({ primaryId, duplicateId, actorName }) }),
  identify: (identity: { email?: string; whatsapp?: string; fullName?: string; companyName?: string }) =>
    request<{ candidates: MatchCandidateDTO[] }>("/api/identify", { method: "POST", body: JSON.stringify(identity) }),

  // Inbox
  inbox: (params?: { channel?: string; brandId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.channel && params.channel !== "all") sp.set("channel", params.channel);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    return request<{ leads: (InteractionDTO & { slaHours: number; candidates: MatchCandidateDTO[] })[] }>(`/api/inbox?${sp}`);
  },
  convertLead: (payload: Record<string, unknown>) =>
    request<{ opportunity: OpportunityDTO }>("/api/inbox/convert", { method: "POST", body: JSON.stringify(payload) }),

  // Interactions
  interactions: (params?: { opportunityId?: string; contactId?: string; channel?: string; companyId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.opportunityId) sp.set("opportunityId", params.opportunityId);
    if (params?.contactId) sp.set("contactId", params.contactId);
    if (params?.companyId) sp.set("companyId", params.companyId);
    if (params?.channel && params.channel !== "all") sp.set("channel", params.channel);
    return request<{ interactions: InteractionDTO[] }>(`/api/interactions?${sp}`);
  },
  createInteraction: (payload: Record<string, unknown>) =>
    request<{ interaction: InteractionDTO }>("/api/interactions", { method: "POST", body: JSON.stringify(payload) }),

  // Tasks
  tasks: (params?: { status?: string; assignee?: string; overdue?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.assignee) sp.set("assignee", params.assignee);
    if (params?.overdue) sp.set("overdue", params.overdue);
    return request<{ tasks: TaskDTO[] }>(`/api/tasks?${sp}`);
  },
  createTask: (payload: Record<string, unknown>) =>
    request<{ task: TaskDTO }>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (id: string, payload: Record<string, unknown>) =>
    request<{ task: TaskDTO }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // Projects
  projects: (params?: { status?: string; companyId?: string; brandId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.companyId) sp.set("companyId", params.companyId);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    return request<{ projects: ProjectDTO[] }>(`/api/projects?${sp}`);
  },
  updateProject: (payload: Record<string, unknown>) =>
    request<{ project: ProjectDTO }>("/api/projects", { method: "PATCH", body: JSON.stringify(payload) }),

  // Invoices
  invoices: (params?: { status?: string; brandId?: string; companyId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    if (params?.companyId) sp.set("companyId", params.companyId);
    return request<{ invoices: InvoiceDTO[]; aging: { current: number; d30: number; d60: number; d90: number } }>(`/api/invoices?${sp}`);
  },
  addPayment: (payload: { invoiceId: string; amount: number; method?: string; reference?: string; actorName?: string }) =>
    request<{ invoice: InvoiceDTO }>("/api/invoices", { method: "POST", body: JSON.stringify({ action: "add_payment", ...payload }) }),
  /** Kirim (draft→sent) atau batalkan invoice — Fase 2/3 lifecycle. */
  invoiceAction: (payload: { invoiceId: string; action: "send_invoice" | "cancel_invoice"; actorName?: string; actorRole?: string }) =>
    request<{ invoice: InvoiceDTO }>("/api/invoices", { method: "POST", body: JSON.stringify(payload) }),

  // SLA escalation (Fase 3)
  escalateLead: (payload: { interactionId: string; note?: string; actorName: string; actorRole: string }) =>
    request<{ task: TaskDTO }>("/api/inbox/escalate", { method: "POST", body: JSON.stringify(payload) }),

  // Audit
  auditLogs: (params?: { limit?: number; entity?: string; action?: string }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.entity && params.entity !== "all") sp.set("entity", params.entity);
    if (params?.action && params.action !== "all") sp.set("action", params.action);
    return request<{ logs: AuditLogDTO[] }>(`/api/audit-logs?${sp}`);
  },
};

export type { DashboardData };
