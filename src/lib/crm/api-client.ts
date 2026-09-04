"use client";

import type {
  OpportunityDTO, InteractionDTO, TaskDTO, ContactRef, CompanyRef,
  DashboardData, MatchCandidateDTO, ProjectDTO, InvoiceDTO, AuditLogDTO, Brand,
  InboxLeadDTO,
} from "@/lib/crm/types";

/** Satu entri hasil global search (ronde 26) — module = modul tujuan navigasi. */
export type SearchItemDTO = {
  id: string;
  module: "contacts" | "pipeline" | "projects" | "finance" | "inbox";
  label: string;
  title: string;
  subtitle: string;
  badge?: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin", // Ronde 27: cookie sesi selalu ikut utk request same-origin
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Entri user sesi (Ronde 27) — sama dgn bentuk login. */
export type SessionUserResponse = {
  id: string; name: string; email: string; role: string;
  avatarColor: string; brandAccess: string; companyName?: string | null;
};

export const api = {
  // Bootstrap
  bootstrap: () => request<{ ready: boolean }>("/api/bootstrap"),
  login: (email: string, pin: string) =>
    request<{ user: SessionUserResponse }>(
      "/api/auth/login", { method: "POST", body: JSON.stringify({ email, pin }) }
    ),
  // Ronde 27 — sesi nyata: introspeksi cookie + logout server-side
  session: () => request<{ user: SessionUserResponse | null }>("/api/auth/session"),
  logout: () => request<{ loggedOut: boolean }>("/api/auth/session", { method: "POST" }),
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
  quotations: (params?: { status?: string; brandId?: string; opportunityId?: string; companyId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    if (params?.opportunityId) sp.set("opportunityId", params.opportunityId);
    if (params?.companyId) sp.set("companyId", params.companyId);
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
  updateBrand: (id: string, payload: Record<string, unknown>) =>
    request<{ brand: import("@/lib/crm/types").Brand }>(`/api/brands/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  // Ronde 29-b — katalog layanan & workflow per brand
  brandServices: (id: string) =>
    request<import("@/lib/crm/types").BrandServiceCatalog>(`/api/brands/${id}/services`),
  brandServiceMutate: (
    id: string,
    payload: Record<string, unknown>,
    method: "POST" | "PATCH" | "DELETE"
  ) =>
    request<Record<string, unknown>>(
      method === "DELETE"
        ? `/api/brands/${id}/services?kind=${encodeURIComponent(String(payload.kind ?? ""))}&id=${encodeURIComponent(String(payload.id ?? ""))}`
        : `/api/brands/${id}/services`,
      method === "DELETE" ? { method } : { method, body: JSON.stringify(payload) }
    ),
  // Ronde 29-b — peta layanan × brand & peluang cross-selling (owner view)
  serviceMap: (init?: RequestInit) =>
    request<import("@/lib/crm/types").ServiceMapData>("/api/service-map", init),
  createTemplate: (payload: Record<string, unknown>) =>
    request<{ template: import("@/lib/crm/types").FollowUpTemplateDTO }>("/api/followup-templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTemplate: (id: string, payload: Record<string, unknown>) =>
    request<{ template: import("@/lib/crm/types").FollowUpTemplateDTO }>(`/api/followup-templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteTemplate: (id: string) =>
    request<{ ok: boolean }>(`/api/followup-templates/${id}`, { method: "DELETE" }),

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
  /** Scanner duplikat lintas sumber (WA/IG/email/import): pasangan kontak skor ≥ ambang. */
  scanDuplicates: () =>
    request<{ pairs: import("@/lib/crm/types").DuplicatePairDTO[] }>("/api/contacts/duplicates"),
  /** Import CSV massal: preview (commit=false) mengembalikan kandidat duplikat per baris; commit mengeksekusi keputusan. */
  importContacts: (payload: { rows: Record<string, string>[]; decisions?: Record<string, string>; commit: boolean; actorName: string; actorRole: string }) =>
    request<import("@/lib/crm/types").ImportPreviewResponseDTO | import("@/lib/crm/types").ImportCommitResponseDTO>(
      "/api/contacts/import", { method: "POST", body: JSON.stringify(payload) }
    ),
  /** Import CSV opportunity (round-trip dgn ekspor ronde 13): preview validasi+dedupe atau commit dgn keputusan per baris duplikat (16-b). */
  importOpportunities: (payload: {
    rows: Record<string, string>[];
    commit: boolean;
    actorName: string;
    actorRole: string;
    /** Keputusan per baris duplikat (keyed by row index): default duplikat = "skip". */
    rowActions?: Record<number, "skip" | "create" | "update">;
  }) =>
    request<import("@/lib/crm/types").ImportOpportunityPreviewResponseDTO | import("@/lib/crm/types").ImportOpportunityCommitResponseDTO>(
      "/api/opportunities/import", { method: "POST", body: JSON.stringify(payload) }
    ),
  identify: (identity: { email?: string; whatsapp?: string; fullName?: string; companyName?: string }) =>
    request<{ candidates: MatchCandidateDTO[] }>("/api/identify", { method: "POST", body: JSON.stringify(identity) }),

  // Inbox
  // Ronde 32 — view: "open" (default, belum dikonversi) | "all" (termasuk terkonversi)
  inbox: (params?: { channel?: string; brandId?: string; sweep?: boolean; view?: "open" | "all" }) => {
    const sp = new URLSearchParams();
    if (params?.channel && params.channel !== "all") sp.set("channel", params.channel);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    if (params?.sweep) sp.set("sweep", "1");
    if (params?.view === "all") sp.set("view", "all");
    return request<{ leads: InboxLeadDTO[]; autoEscalated?: number }>(`/api/inbox?${sp}`);
  },
  convertLead: (payload: Record<string, unknown>) =>
    request<{ opportunity: OpportunityDTO; unifiedCount?: number }>("/api/inbox/convert", { method: "POST", body: JSON.stringify(payload) }),
  // Ronde 33 — gabungkan identitas lead ke contact existing TANPA membuat opportunity
  // (aksi yang hilang di modal Identifikasi: dulu satu-satunya jalan adalah konversi).
  linkLead: (payload: { interactionId: string; contactId: string }) =>
    request<{ contactId: string; contactName: string | null; unifiedCount: number }>("/api/inbox/link", { method: "POST", body: JSON.stringify(payload) }),
  /** Respons & catat lead inbox (Fase 3): outbound reply + tandai respondedAt. */
  inboxRespond: (payload: { interactionId: string; channel?: string; content: string; subject?: string; contactId?: string; companyId?: string; actorName: string; actorRole: string }) =>
    request<{ reply: InteractionDTO; lead: InteractionDTO & { slaHours?: number } }>("/api/inbox/respond", { method: "POST", body: JSON.stringify(payload) }),

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
  createProject: (payload: Record<string, unknown>) =>
    request<{ project: ProjectDTO }>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  updateProject: (payload: Record<string, unknown>) =>
    request<{ project: ProjectDTO }>("/api/projects", { method: "PATCH", body: JSON.stringify(payload) }),
  /** Deliverable: daftar + kirim tautan/file kecil utk ditinjau; keputusan review via decideDeliverable. */
  projectDeliverables: (projectId: string) =>
    request<{ deliverables: import("@/lib/crm/types").ProjectDeliverableDTO[] }>(
      `/api/projects/${projectId}/deliverables`
    ),
  createDeliverable: (projectId: string, payload: Record<string, unknown>) =>
    request<{ deliverable: import("@/lib/crm/types").ProjectDeliverableDTO }>(
      `/api/projects/${projectId}/deliverables`,
      { method: "POST", body: JSON.stringify(payload) }
    ),
  decideDeliverable: (payload: { id: string; decision: "approved" | "revision"; reviewComment?: string; reviewedBy: string; reviewedRole?: string }) =>
    request<{ deliverable: import("@/lib/crm/types").ProjectDeliverableDTO }>(
      "/api/projects/deliverables",
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  deleteDeliverable: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/deliverables`, { method: "DELETE", body: JSON.stringify({ id }) }),
  /** Ronde 35 — tambah milestone baru (sheet project produksi). */
  createMilestone: (payload: { projectId: string; name: string; achievement?: string; dueDate?: string | null; actorName?: string; actorRole?: string }) =>
    request<{ milestone: import("@/lib/crm/types").MilestoneDTO }>("/api/projects/milestones", { method: "POST", body: JSON.stringify(payload) }),
  /** Update milestone (drag-reschedule kalender / status / capaian) — Fase 3 + Ronde 35. */
  updateMilestone: (payload: { milestoneId: string; dueDate?: string | null; status?: string; name?: string; achievement?: string | null; actorName?: string; actorRole?: string }) =>
    request<{ milestone: import("@/lib/crm/types").MilestoneDTO }>("/api/projects/milestones", { method: "PATCH", body: JSON.stringify(payload) }),

  // Change Requests (Fase 2 — Produksi): scope change → persetujuan klien → invoice tambahan
  changeRequests: (params?: { projectId?: string; companyId?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.projectId) sp.set("projectId", params.projectId);
    if (params?.companyId) sp.set("companyId", params.companyId);
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    return request<{ changeRequests: import("@/lib/crm/types").ChangeRequestDTO[] }>(`/api/change-requests?${sp}`);
  },
  createChangeRequest: (payload: Record<string, unknown>) =>
    request<{ changeRequest: import("@/lib/crm/types").ChangeRequestDTO }>("/api/change-requests", { method: "POST", body: JSON.stringify(payload) }),
  decideChangeRequest: (payload: { id: string; decision: "approve" | "reject" | "cancel"; decisionNote?: string; actorName: string; actorRole: string }) =>
    request<{ changeRequest: import("@/lib/crm/types").ChangeRequestDTO; invoice?: { id: string; number: string } | null }>(
      "/api/change-requests", { method: "PATCH", body: JSON.stringify(payload) }
    ),

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
  /** Ronde 35 — terbitkan invoice manual dari project (termin/milestone): alur Produksi → Keuangan. */
  createProjectInvoice: (payload: { projectId: string; description: string; amount: number; taxRate?: number; dueDate?: string; milestoneName?: string; actorName?: string; actorRole?: string }) =>
    request<{ invoice: InvoiceDTO }>("/api/invoices", { method: "POST", body: JSON.stringify({ action: "create_invoice", ...payload }) }),

  // SLA escalation (Fase 3)
  escalateLead: (payload: { interactionId: string; note?: string; actorName: string; actorRole: string }) =>
    request<{ task: TaskDTO }>("/api/inbox/escalate", { method: "POST", body: JSON.stringify(payload) }),

  // Notifikasi in-app (Fase 3) — komputasi server + state baca/dismiss per pengguna
  notifications: (user: string, brandId?: string) => {
    const sp = new URLSearchParams({ user });
    if (brandId && brandId !== "all") sp.set("brandId", brandId);
    return request<{ items: import("@/lib/crm/types").NotificationDTO[]; unread: number }>(`/api/notifications?${sp}`);
  },
  markNotifications: (payload: { user: string; action: "read" | "unread" | "dismiss"; keys: string[] }) =>
    request<{ ok: boolean; updated: number }>("/api/notifications", { method: "POST", body: JSON.stringify(payload) }),

  // Preferensi notifikasi (ronde 16-c) — tersinkron antar perangkat via tabel UserPreference
  getNotifPrefs: (email: string) =>
    request<{ prefs: { muted: import("@/lib/crm/types").NotificationType[]; hideRead: boolean }; updatedAt: string | null }>(
      `/api/notif-prefs?user=${encodeURIComponent(email)}`
    ),
  putNotifPrefs: (email: string, prefs: { muted: import("@/lib/crm/types").NotificationType[]; hideRead: boolean }) =>
    request<{ prefs: { muted: import("@/lib/crm/types").NotificationType[]; hideRead: boolean }; updatedAt: string | null }>(
      "/api/notif-prefs", { method: "PUT", body: JSON.stringify({ user: email, ...prefs }) }
    ),

  // Audit
  auditLogs: (params?: { limit?: number; entity?: string; action?: string }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.entity && params.entity !== "all") sp.set("entity", params.entity);
    if (params?.action && params.action !== "all") sp.set("action", params.action);
    return request<{ logs: AuditLogDTO[] }>(`/api/audit-logs?${sp}`);
  },

  // Monitoring kesehatan sistem (ronde 17-d) — probe server read-only tanpa data sensitif
  getSystemHealth: () =>
    request<{
      status: "ok" | "degraded";
      db: { status: "up" | "down"; ms: number | null };
      notifService: { status: "up" | "down"; detail: string };
      uptimeSec: number;
      rssMb: number;
    }>("/api/health"),

  // Global search antar modul (ronde 26 — ⌘K command palette); signal utk batal saat query berubah
  search: (q: string, signal?: AbortSignal) =>
    request<{ q: string; total: number; items: SearchItemDTO[] }>(
      `/api/search?q=${encodeURIComponent(q)}&limit=5`, { signal }
    ),
};

export type { DashboardData };

// ============ Laporan (ronde 17-b) ============

/** Laporan kinerja period-bounded lintas brand (revenue, win rate, SLA, aging, pipeline per owner). */
export function getReports(params?: { brandId?: string; days?: number }) {
  const sp = new URLSearchParams();
  if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
  if (params?.days) sp.set("days", String(params.days));
  return request<import("@/lib/crm/types").ReportsData>(`/api/reports?${sp}`);
}

// ============ Brief Builder (ronde 18 — Fase 2) ============

/** Payload create/update brief terstruktur (field opsional, sesuai kebutuhan). */
export interface ClientBriefPayload {
  opportunityId?: string;
  title?: string;
  serviceTypes?: string[];
  objectives?: string | null;
  targetAudience?: string | null;
  keyMessages?: string | null;
  deliverables?: import("@/lib/crm/types").BriefDeliverable[];
  timelineStart?: string | null;
  timelineEnd?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  references?: import("@/lib/crm/types").BriefReference[];
  attachmentsNote?: string | null;
  status?: import("@/lib/crm/types").BriefStatus;
  /** Aksi alur status: save | submit | approve | request_revision | reopen. */
  action?: "save" | "submit" | "approve" | "request_revision" | "reopen";
  revisionNote?: string | null;
  actorName?: string;
  actorRole?: string;
}

export const briefsApi = {
  list: (params?: { opportunityId?: string; brandId?: string; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.opportunityId) sp.set("opportunityId", params.opportunityId);
    if (params?.brandId && params.brandId !== "all") sp.set("brandId", params.brandId);
    if (params?.status && params.status !== "all") sp.set("status", params.status);
    return request<{ briefs: import("@/lib/crm/types").ClientBriefDTO[] }>(`/api/briefs?${sp}`);
  },
  create: (payload: ClientBriefPayload) =>
    request<{ brief: import("@/lib/crm/types").ClientBriefDTO }>("/api/briefs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: ClientBriefPayload) =>
    request<{ brief: import("@/lib/crm/types").ClientBriefDTO }>(`/api/briefs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/briefs/${id}`, { method: "DELETE" }),
};

// ============ Saluran & Integrasi (ronde 19 — Fase 3) ============

export const channelsApi = {
  list: () => request<import("@/lib/crm/types").ChannelsData>("/api/channels"),
  connect: (payload: {
    channel: string;
    brandId?: string | null;
    displayName: string;
    accountRef: string;
    credentials: Record<string, string>;
    isDemo?: boolean;
    skipVerification?: boolean;
    actorName?: string;
    actorRole?: string;
  }) =>
    request<{ config: import("@/lib/crm/types").ChannelConfigDTO; error?: string }>("/api/channels", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  emailSync: () =>
    request<{ created: number; skipped: number; scanned: number; since: string }>("/api/channels/email-sync", {
      method: "POST",
    }),
  demoConnect: (payload: { channel: string; brandId?: string | null; actorName?: string; actorRole?: string }) =>
    request<{ config: import("@/lib/crm/types").ChannelConfigDTO }>("/api/channels/demo", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: {
    action?: "update" | "test" | "disconnect" | "reconnect";
    displayName?: string;
    accountRef?: string;
    credentials?: Record<string, string | null>;
    actorName?: string;
    actorRole?: string;
  }) =>
    request<{ config: import("@/lib/crm/types").ChannelConfigDTO; test?: { ok: boolean; note: string } }>(
      `/api/channels/${id}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    ),
  remove: (id: string) => request<{ ok: boolean }>(`/api/channels/${id}`, { method: "DELETE" }),
};

// ============ PORTAL KLIEN — SECURE LINK TOKEN & DOKUMEN ============
export const portalApi = {
  /** Daftar token secure link (staf). */
  tokens: () =>
    request<{ tokens: import("@/lib/crm/types").PortalTokenDTO[] }>("/api/portal/tokens"),
  /** Buat token secure link utk perusahaan klien. */
  createToken: (payload: { companyId: string; label?: string; actorName?: string; actorRole?: string }) =>
    request<{ token: import("@/lib/crm/types").PortalTokenDTO }>("/api/portal/tokens", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** Aktifkan/cabut token. */
  updateToken: (id: string, payload: { active?: boolean; actorName?: string }) =>
    request<{ token: import("@/lib/crm/types").PortalTokenDTO }>(`/api/portal/tokens/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteToken: (id: string) =>
    request<{ ok: boolean }>(`/api/portal/tokens/${id}`, { method: "DELETE" }),

  /** Daftar dokumen/MoU/catatan rapat per perusahaan. */
  documents: (companyId: string) =>
    request<{ documents: import("@/lib/crm/types").ClientDocumentDTO[] }>(
      `/api/portal/documents?companyId=${encodeURIComponent(companyId)}`
    ),
  createDocument: (payload: {
    companyId: string;
    kind: string;
    title: string;
    content?: string;
    url?: string;
    fileName?: string;
    fileData?: string;
    mimeType?: string;
    sizeBytes?: number;
    meetingAt?: string;
    attendees?: string;
    actorName?: string;
  }) =>
    request<{ document: import("@/lib/crm/types").ClientDocumentDTO }>("/api/portal/documents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteDocument: (id: string) =>
    request<{ ok: boolean }>(`/api/portal/documents/${id}`, { method: "DELETE" }),

  /** (PUBLIK) Ambil isi secure link — tanpa login, kunci = token URL. */
  byToken: (token: string) =>
    request<import("@/lib/crm/types").PortalTokenPayload>(`/api/portal/${token}`),
  /** (PUBLIK) Review deliverable dari secure link. */
  review: (
    token: string,
    payload: { deliverableId: string; decision: "approved" | "revision"; comment?: string; reviewerName: string }
  ) =>
    request<{ deliverable: import("@/lib/crm/types").ProjectDeliverableDTO }>(`/api/portal/${token}/review`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
