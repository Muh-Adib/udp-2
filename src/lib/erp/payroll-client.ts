"use client";

/**
 * Fase 6 — Client helper modul Payroll & Poin (pola sama dengan @/lib/crm/api-client):
 * credentials same-origin, throw Error(data.error), dispatch "crm:locked" bila 423.
 * Semua tipe strict (tanpa any); tanggal datang sebagai ISO string dari JSON.
 */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 423 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("crm:locked"));
    }
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// ===== Tipe data payroll =====

export type EmployeeLiteDTO = {
  id: string;
  employeeNumber: string;
  preferredName: string;
  employmentStatus: string; // permanent, intern, freelance
  department?: string | null;
  position?: string | null;
  active?: boolean;
  leftOn?: string | null;
  internProgram?: string | null;
  stipendDaily?: number | null;
  umkRegion?: string | null;
};

export type PayrollPeriodDTO = {
  id: string;
  name: string; // "YYYY-MM"
  startDate: string;
  endDate: string;
  payDate: string;
  status: string; // open, locked, finalized
  lockedAt: string | null;
  createdAt: string;
  runCount?: number;
  hasActiveRun?: boolean;
};

export type PayslipItemDTO = {
  id: string;
  componentCode: string; // base_salary, allowance, overtime, incentive, point_redemption, stipend, deduction
  label: string;
  classification: string; // earning, deduction, reimbursement
  quantity: number;
  rate: number;
  amount: number;
  sourceRef: string | null;
};

export type PayrollRunRefDTO = {
  id: string;
  revision: number;
  status: string; // draft, calculated, approved, finalized
};

export type PayslipDTO = {
  id: string;
  employeeId: string;
  employee?: EmployeeLiteDTO;
  gross: number;
  deduction: number;
  reimbursement: number;
  net: number;
  currency: string;
  status: string; // draft, finalized
  createdAt: string;
  items: PayslipItemDTO[];
  run?: PayrollRunRefDTO & { period?: { id: string; name: string; payDate: string; status: string } };
};

export type PayrollRunDTO = {
  id: string;
  periodId: string;
  revision: number;
  status: string;
  inputHash: string | null;
  note: string | null;
  createdBy: string;
  finalizedAt: string | null;
  createdAt: string;
  slips: PayslipDTO[];
};

export type PointEntryDTO = {
  id: string;
  employeeId: string;
  kind: string; // earn, redeem, adjust
  points: number;
  sourceType: string | null;
  sourceRef: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

export type PointReservationDTO = {
  id: string;
  employeeId: string;
  points: number;
  status: string; // reserved, released, settled
  requestId: string;
  createdAt: string;
  settledAt: string | null;
  employee?: EmployeeLiteDTO;
};

export type PointsSummaryDTO = {
  earned: number;
  redeemed: number;
  reserved: number;
  available: number;
};

export type IncentiveProposalDTO = {
  id: string;
  employeeId: string;
  employee?: EmployeeLiteDTO;
  sourceType: string; // task, overtime, travel, project, manual
  sourceRef: string | null;
  proposedPoints: number;
  proposedAmount: number;
  reason: string;
  ruleVersion: string | null;
  status: string; // pending, approved, rejected, paid
  proposedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type InternAccrualDTO = {
  id: string;
  employeeId: string;
  businessDate: string;
  rate: number;
  fraction: number;
  amount: number;
  status: string; // provisional, verified, adjusted
  sourceRef: string | null;
  createdAt: string;
  employee?: EmployeeLiteDTO;
};

export type InternSettlementDTO = {
  id: string;
  employeeId: string;
  employee?: EmployeeLiteDTO;
  totalAccrued: number;
  paidTotal: number;
  status: string; // open, submitted, approved, paid
  dueDate: string | null;
  approvedBy: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type UmkRefDTO = {
  id: string;
  regionCode: string;
  regionName: string;
  year: number;
  amount: number;
};

export type PayrollMeDTO = {
  employee: EmployeeLiteDTO & { department: string | null; position: string | null };
  mySlips: PayslipDTO[];
  points: PointsSummaryDTO;
  myReservations: PointReservationDTO[];
  myIncentives: IncentiveProposalDTO[];
};

export type PointsDetailDTO = {
  employee: EmployeeLiteDTO;
  account: { id: string; createdAt: string; updatedAt: string } | null;
  entries: PointEntryDTO[];
  summary: PointsSummaryDTO;
};

export const CONVERSION_VALUE = 50000; // sementara: Rp50.000 per 10 poin (OPEN blueprint)

export const payrollApi = {
  // Periode
  periods: () => request<{ periods: PayrollPeriodDTO[] }>("/api/erp/payroll/periods"),
  createPeriod: (payload: { name: string; startDate: string; endDate: string }) =>
    request<{ period: PayrollPeriodDTO }>("/api/erp/payroll/periods", { method: "POST", body: JSON.stringify(payload) }),
  lockPeriod: (id: string) =>
    request<{ period: PayrollPeriodDTO }>(`/api/erp/payroll/periods/${id}/lock`, { method: "POST", body: JSON.stringify({}) }),

  // Run payroll
  runs: (periodId: string) =>
    request<{ runs: PayrollRunDTO[] }>(`/api/erp/payroll/runs?periodId=${encodeURIComponent(periodId)}`),
  calculateRun: (periodId: string) =>
    request<{ run: PayrollRunDTO; incentiveCount: number }>("/api/erp/payroll/runs", { method: "POST", body: JSON.stringify({ periodId }) }),
  runAction: (id: string, action: "approve" | "finalize" | "reject") =>
    request<{ run?: PayrollRunDTO; finalized?: boolean; slipCount?: number; totalNet?: number; inputHash?: string }>(
      `/api/erp/payroll/runs/${id}`, { method: "PATCH", body: JSON.stringify({ action }) },
    ),

  // Self-service
  me: () => request<PayrollMeDTO>("/api/erp/payroll/me"),

  // Poin
  points: (employeeId: string) =>
    request<PointsDetailDTO>(`/api/erp/payroll/points?employeeId=${encodeURIComponent(employeeId)}`),
  redeemPoints: (payload: { employeeId?: string; points: number }) =>
    request<{ reservation: PointReservationDTO; available: number }>("/api/erp/payroll/points/redeem", { method: "POST", body: JSON.stringify(payload) }),
  adjustPoints: (payload: { employeeId: string; points: number; note: string }) =>
    request<{ entry: PointEntryDTO }>("/api/erp/payroll/points/adjust", { method: "POST", body: JSON.stringify(payload) }),
  reservations: (status?: string) =>
    request<{ reservations: PointReservationDTO[] }>(`/api/erp/payroll/points/reservations${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  reservationAction: (id: string, action: "release" | "settle", conversionValue?: number) =>
    request<{ reservation: PointReservationDTO; obligation?: unknown }>(
      `/api/erp/payroll/points/reservations/${id}${conversionValue ? `?conversionValue=${conversionValue}` : ""}`,
      { method: "PATCH", body: JSON.stringify({ action }) },
    ),

  // Insentif
  incentives: (status?: string) =>
    request<{ proposals: IncentiveProposalDTO[] }>(`/api/erp/payroll/incentives${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createIncentive: (payload: { employeeId: string; sourceType: string; proposedPoints: number; proposedAmount: number; reason: string; sourceRef?: string }) =>
    request<{ proposal: IncentiveProposalDTO }>("/api/erp/payroll/incentives", { method: "POST", body: JSON.stringify(payload) }),
  incentiveAction: (id: string, action: "approve" | "reject" | "pay") =>
    request<{ proposal: IncentiveProposalDTO }>(`/api/erp/payroll/incentives/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }),

  // Karyawan (picker payroll)
  employees: () => request<{ employees: EmployeeLiteDTO[] }>("/api/erp/payroll/employees"),

  // Uang saku magang
  internAccruals: (params?: { month?: string; employeeId?: string }) => {
    const sp = new URLSearchParams();
    if (params?.month) sp.set("month", params.month);
    if (params?.employeeId) sp.set("employeeId", params.employeeId);
    return request<{ accruals: InternAccrualDTO[]; totals: { employeeId: string; name: string; days: number; total: number }[] }>(
      `/api/erp/payroll/intern/accruals?${sp.toString()}`,
    );
  },
  generateInternAccruals: (payload: { employeeId: string; month: string }) =>
    request<{ createdCount: number; skipped: number; rate: number }>("/api/erp/payroll/intern/accruals/generate", { method: "POST", body: JSON.stringify(payload) }),
  internSettlements: () =>
    request<{ settlements: InternSettlementDTO[] }>("/api/erp/payroll/intern/settlements"),
  createInternSettlement: (employeeId: string) =>
    request<{ settlement: InternSettlementDTO }>("/api/erp/payroll/intern/settlements", { method: "POST", body: JSON.stringify({ employeeId }) }),
  internSettlementAction: (id: string, action: "submit" | "approve" | "pay") =>
    request<{ settlement: InternSettlementDTO }>(`/api/erp/payroll/intern/settlements/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }),

  // UMK
  umk: (year?: number) =>
    request<{ refs: UmkRefDTO[] }>(`/api/erp/payroll/umk${year ? `?year=${year}` : ""}`),
};
