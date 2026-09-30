"use client";

/**
 * Task 2-d — Client helper Work Engine (pola clone src/lib/crm/api-client.ts).
 * - credentials "same-origin" (cookie sesi selalu ikut).
 * - throw Error(data.error) sesuai kontrak API ({ error: string }).
 * - dispatch event global "crm:locked" bila server membalas 423 (layar terkunci).
 * Semua tipe strict — tanpa any.
 */

// ============ Tipe data (mirror payload API) ============

export type BrandRefDTO = { id: string; name: string; color: string | null };

export type ProjectRefDTO = {
  id: string; code: string; name: string; brandId: string;
  brand?: BrandRefDTO | null;
};

export type WorkStepDTO = {
  id: string; versionId: string; position: number;
  name: string; kind: string; roleNeeded: string | null; slaHours: number | null;
};

export type WorkVersionDTO = {
  id: string; templateId: string; version: number;
  status: "draft" | "published" | "archived" | string;
  note: string | null; publishedAt: string | null; createdAt: string;
  steps?: WorkStepDTO[];
  template?: { id: string; name: string; brand?: BrandRefDTO | null };
  _count?: { steps: number; instances: number };
};

export type WorkTemplateDTO = {
  id: string; name: string; description: string | null;
  brandId: string | null; active: boolean; createdAt: string; updatedAt: string;
  brand?: BrandRefDTO | null;
  versions: WorkVersionDTO[];
  _count?: { versions: number; instances: number };
};

export type WorkInstanceDTO = {
  id: string; versionId: string; projectId: string | null; workPeriodId: string | null;
  title: string; contextType: string; status: string; currentPos: number;
  startedAt: string; completedAt: string | null; assigneeIds: string | null;
  version: WorkVersionDTO & { template?: { id: string; name: string; brand?: BrandRefDTO | null } };
  project?: (ProjectRefDTO & { brand?: BrandRefDTO | null }) | null;
  workPeriod?: { id: string; name: string; status: string; brandId: string; brand?: BrandRefDTO | null } | null;
};

export type WorkPeriodDTO = {
  id: string; brandId: string; projectId: string | null; name: string;
  periodStart: string; periodEnd: string; status: string; contractRef: string | null;
  createdAt: string;
  brand?: BrandRefDTO | null;
  project?: ProjectRefDTO | null;
  _count?: { instances: number };
};

export type DeliverableVersionDTO = {
  id: string; deliverableId: string; version: number;
  content: string | null; url: string | null; status: string;
  feedback: string | null; reviewedBy: string | null; clientReviewedBy: string | null;
  publishedAt: string | null; createdAt: string;
};

export type WorkDeliverableDTO = {
  id: string; projectId: string; milestoneId: string | null;
  name: string; kind: string; url: string | null;
  status: string; reviewComment: string | null;
  reviewedBy: string | null; reviewedAt: string | null; createdBy: string | null;
  createdAt: string;
  versions: DeliverableVersionDTO[];
  project?: (ProjectRefDTO & { brand?: BrandRefDTO | null }) | null;
};

export type WorkOverviewDTO = {
  templates: number;
  activeInstances: number;
  doneInstances: number;
  cancelledInstances?: number;
  activePeriods: number;
  pendingReviews: number;
  publishedThisMonth: number;
};

export type WorkStepInput = {
  name: string; kind: string; roleNeeded?: string | null; slaHours?: number | null;
};

// ============ Mekanisme request (clone api-client) ============

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin", // cookie sesi selalu ikut utk request same-origin
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Layar terkunci (423): event global agar shell menampilkan lock screen.
    if (res.status === 423 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("crm:locked"));
    }
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== "all") sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ============ Payload mutasi ============

export type CreateTemplatePayload = { name: string; description?: string | null; brandId?: string | null };
export type UpdateTemplatePayload = { name?: string; description?: string | null; active?: boolean };
export type CreateVersionPayload = { steps: WorkStepInput[]; note?: string | null };
export type UpdateVersionPayload = { steps?: WorkStepInput[]; note?: string | null };
export type CreateInstancePayload = {
  versionId: string; title: string;
  projectId?: string | null; workPeriodId?: string | null;
  contextType?: string | null; assigneeIds?: string[] | string | null;
};
export type UpdateInstancePayload = { action?: "advance" | "cancel"; assigneeIds?: string[] | string | null };
export type CreatePeriodPayload = {
  brandId: string; name: string; periodStart: string; periodEnd: string;
  projectId?: string | null; contractRef?: string | null;
};
export type UpdatePeriodPayload = { action?: "activate" | "close"; contractRef?: string | null };
export type CreateDeliverableVersionPayload = { content?: string | null; url?: string | null };
export type UpdateDeliverableVersionPayload = {
  action: "submit_internal" | "approve_internal" | "request_revision" | "approve_client" | "publish";
  feedback?: string | null; clientName?: string | null;
};

// ============ API Work Engine ============

export const workApi = {
  // Ringkasan
  overview: () => request<WorkOverviewDTO>("/api/erp/work/overview"),

  // Template & versi
  templates: (params?: { brandId?: string; active?: string }) =>
    request<{ templates: WorkTemplateDTO[] }>(`/api/erp/work/templates${qs({ brandId: params?.brandId, active: params?.active })}`),
  createTemplate: (payload: CreateTemplatePayload) =>
    request<{ template: WorkTemplateDTO }>("/api/erp/work/templates", { method: "POST", body: JSON.stringify(payload) }),
  updateTemplate: (id: string, payload: UpdateTemplatePayload) =>
    request<{ template: WorkTemplateDTO }>(`/api/erp/work/templates/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  createVersion: (templateId: string, payload: CreateVersionPayload) =>
    request<{ version: WorkVersionDTO }>(`/api/erp/work/templates/${templateId}/versions`, { method: "POST", body: JSON.stringify(payload) }),
  version: (id: string) =>
    request<{ version: WorkVersionDTO }>(`/api/erp/work/versions/${id}`),
  updateVersion: (id: string, payload: UpdateVersionPayload) =>
    request<{ version: WorkVersionDTO }>(`/api/erp/work/versions/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  publishVersion: (id: string) =>
    request<{ version: WorkVersionDTO; alreadyPublished?: boolean }>(`/api/erp/work/versions/${id}/publish`, { method: "POST", body: JSON.stringify({}) }),

  // Instance workflow
  instances: (params?: { status?: string; projectId?: string; workPeriodId?: string; contextType?: string }) =>
    request<{ instances: WorkInstanceDTO[] }>(
      `/api/erp/work/instances${qs({
        status: params?.status, projectId: params?.projectId,
        workPeriodId: params?.workPeriodId, contextType: params?.contextType,
      })}`,
    ),
  createInstance: (payload: CreateInstancePayload) =>
    request<{ instance: WorkInstanceDTO }>("/api/erp/work/instances", { method: "POST", body: JSON.stringify(payload) }),
  updateInstance: (id: string, payload: UpdateInstancePayload) =>
    request<{ instance: WorkInstanceDTO; done?: boolean }>(`/api/erp/work/instances/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // Periode kerja
  periods: (params?: { status?: string; brandId?: string }) =>
    request<{ periods: WorkPeriodDTO[] }>(`/api/erp/work/periods${qs({ status: params?.status, brandId: params?.brandId })}`),
  createPeriod: (payload: CreatePeriodPayload) =>
    request<{ period: WorkPeriodDTO }>("/api/erp/work/periods", { method: "POST", body: JSON.stringify(payload) }),
  updatePeriod: (id: string, payload: UpdatePeriodPayload) =>
    request<{ period: WorkPeriodDTO }>(`/api/erp/work/periods/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // Deliverable & versi review
  deliverables: (params?: { projectId?: string; status?: string }) =>
    request<{ deliverables: WorkDeliverableDTO[] }>(`/api/erp/work/deliverables${qs({ projectId: params?.projectId, status: params?.status })}`),
  createDeliverableVersion: (deliverableId: string, payload: CreateDeliverableVersionPayload) =>
    request<{ version: DeliverableVersionDTO }>(`/api/erp/work/deliverables/${deliverableId}/versions`, { method: "POST", body: JSON.stringify(payload) }),
  updateDeliverableVersion: (deliverableId: string, versionId: string, payload: UpdateDeliverableVersionPayload) =>
    request<{ version: DeliverableVersionDTO; alreadyPublished?: boolean }>(
      `/api/erp/work/deliverables/${deliverableId}/versions/${versionId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
};
