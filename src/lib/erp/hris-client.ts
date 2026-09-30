// ============ HRIS client helper (Fase 5 — ERP slice) ============
// Clone pola src/lib/crm/api-client.ts: request<T> same-origin + JSON + 423 lock.
// Semua endpoint slice HRIS + tipe lokal strict (tanpa any).

type QueryValue = string | number | boolean | null | undefined;

function qs(params?: Record<string, QueryValue>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin", // cookie sesi selalu ikut utk request same-origin
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Layar kunci: middleware menolak mutasi dgn 423 saat sesi terkunci.
    if (res.status === 423 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("crm:locked"));
    }
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

// ===== Tipe lokal =====

export type EmployeeLite = {
  id: string;
  preferredName: string;
  employeeNumber: string;
  department: string | null;
  position: string | null;
  userId: string | null;
  supervisorId: string | null;
};

export type EmployeeRow = {
  id: string;
  userId: string | null;
  employeeNumber: string;
  preferredName: string;
  employmentStatus: string; // permanent | intern | freelance
  department: string | null;
  position: string | null;
  supervisorId: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  internProgram: string | null;
  internStart: string | null;
  internEnd: string | null;
  stipendDaily: number | null;
  umkRegion: string | null;
  active: boolean;
  // Field sensitif — HANYA muncul bila role hr/director/super_admin.
  bankName?: string | null;
  bankAccount?: string | null;
  supervisor?: { id: string; preferredName: string; employeeNumber: string } | null;
  user?: { id: string; email: string } | null;
};

export type AttendanceRow = {
  id: string;
  employeeId: string;
  kind: string; // check_in | check_out
  businessDate: string;
  clientEventId: string | null;
  claimedAt: string | null;
  receivedAt: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  locationVerdict: string; // matched | unmatched | unknown
  validationStatus: string; // valid | exception | pending | rejected
  note: string | null;
  employee: EmployeeLite;
};

export type LeaveRow = {
  id: string;
  employeeId: string;
  type: string; // izin | sakit | cuti | koreksi
  startDate: string;
  endDate: string;
  reason: string;
  evidenceUrl: string | null;
  status: string; // pending | approved | rejected | cancelled
  approvedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  employee: EmployeeLite;
};

export type OvertimeRow = {
  id: string;
  employeeId: string;
  date: string;
  startMinute: number;
  endMinute: number; // boleh > 1440 (lintas tengah malam)
  reason: string;
  taskRef: string | null;
  consent: boolean;
  requestedBy: string;
  status: string; // pending | approved | rejected | verified
  approvedBy: string | null;
  decidedAt: string | null;
  realizedMinutes: number | null;
  verifiedBy: string | null;
  complianceFlag: string | null;
  createdAt: string;
  employee: EmployeeLite;
};

export type TravelRow = {
  id: string;
  employeeId: string;
  purpose: string;
  projectRef: string | null;
  destination: string;
  departDate: string;
  returnDate: string;
  advanceAmount: number;
  allowanceDaily: number;
  actualAmount: number | null;
  status: string; // draft | approved | ongoing | settlement_pending | closed
  settlementStatus: string; // none | return_due | additional_payable | balanced
  settlementDueAt: string | null;
  approvedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  employee: EmployeeLite;
};

export type DailyLogRow = {
  id: string;
  employeeId: string;
  date: string;
  projectId: string | null;
  content: string;
  hours: number;
  createdAt: string;
  updatedAt: string;
  employee: EmployeeLite;
};

export type HolidayRow = {
  id: string;
  date: string;
  name: string;
  kind: string; // national | company
};

export type LeaveBalanceRow = {
  id: string | null; // null = belum ada record Ledger (default kuota 12, bawaan 0)
  employeeId: string;
  employeeNumber: string;
  preferredName: string;
  employmentStatus: string; // permanent | intern | freelance
  department: string | null;
  quotaDays: number;
  carriedDays: number;
  usedDays: number; // hari kerja Sen–Jum di luar libur, dari cuti approved
  remaining: number; // quotaDays + carriedDays − usedDays
};

export type LeaveBalanceRecord = {
  id: string;
  employeeId: string;
  year: number;
  quotaDays: number;
  carriedDays: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceStatusToday = "hadir" | "izin" | "belum" | "exception";

export type TodayAttendanceRow = {
  employeeId: string;
  employeeNumber: string;
  preferredName: string;
  department: string | null;
  position: string | null;
  userId: string | null;
  status: AttendanceStatusToday;
  leaveType: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
};

export type HrisOverview = {
  businessDate: string;
  month: string | null;
  stats: {
    totalEmployees: number;
    presentToday: number;
    onLeaveToday: number;
    belumCheckIn: number;
    exceptionsToday: number;
    pendingLeaves: number;
    pendingOvertimes: number;
    activeTravels: number;
  };
  todayAttendance: TodayAttendanceRow[];
  serverDay: string;
};

// ===== Payload =====

export type EmployeeInput = {
  employeeNumber: string;
  preferredName: string;
  employmentStatus?: string;
  department?: string | null;
  position?: string | null;
  supervisorId?: string | null;
  userId?: string | null;
  joinedOn?: string | null;
  internProgram?: string | null;
  internStart?: string | null;
  internEnd?: string | null;
  stipendDaily?: number | null;
  bankName?: string | null;
  bankAccount?: string | null;
  umkRegion?: string | null;
  active?: boolean;
};

export type AttendanceInput = {
  kind: "check_in" | "check_out";
  clientEventId?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  note?: string;
  claimedAt?: string;
};

export type LeaveInput = {
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  evidenceUrl?: string;
};

export type LeaveDecision = { action: "approve" | "reject" | "cancel"; decisionNote?: string };

export type OvertimeInput = {
  employeeId?: string; // manager+ mengajukan utk bawahan
  date: string;
  startMinute: number;
  endMinute: number;
  reason: string;
  taskRef?: string;
  consent?: boolean; // HANYA boleh true bila pengaju = staf itu sendiri
};

export type OvertimeDecision =
  | { action: "approve" | "reject"; decisionNote?: string }
  | { action: "verify"; realizedMinutes: number };

export type TravelInput = {
  purpose: string;
  destination: string;
  projectRef?: string | null;
  departDate: string;
  returnDate: string;
  advanceAmount?: number;
  allowanceDaily?: number;
};

export type TravelAction =
  | { action: "submit" | "approve" | "start" | "close" }
  | { action: "settle"; actualAmount: number };

export type DailyLogInput = {
  date: string;
  content: string;
  hours: number;
  projectId?: string | null;
};

export type LeaveBalanceUpsertInput = {
  employeeId: string;
  year: number;
  quotaDays: number;
  carriedDays: number;
  note?: string | null;
};

// ===== API =====

export const hrisApi = {
  // Karyawan
  employees: (params?: { q?: string; status?: string }) =>
    request<{ employees: EmployeeRow[]; canSeeBank: boolean }>(
      `/api/erp/hris/employees${qs(params as Record<string, QueryValue>)}`,
    ),
  createEmployee: (data: EmployeeInput) =>
    request<{ employee: EmployeeRow }>("/api/erp/hris/employees", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEmployee: (id: string, data: Partial<EmployeeInput>) =>
    request<{ employee: EmployeeRow }>(`/api/erp/hris/employees/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Absensi
  attendance: (params?: { date?: string; employeeId?: string; mine?: boolean; from?: string; to?: string }) =>
    request<{ events: AttendanceRow[]; businessDate: string }>(
      `/api/erp/hris/attendance${qs(params as Record<string, QueryValue>)}`,
    ),
  createAttendance: (data: AttendanceInput) =>
    request<{ event: AttendanceRow; idempotent?: boolean }>("/api/erp/hris/attendance", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Izin/sakit/cuti
  leaves: (params?: { status?: string; mine?: boolean }) =>
    request<{ requests: LeaveRow[] }>(
      `/api/erp/hris/leave${qs(params as Record<string, QueryValue>)}`,
    ),
  createLeave: (data: LeaveInput) =>
    request<{ request: LeaveRow }>("/api/erp/hris/leave", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideLeave: (id: string, data: LeaveDecision) =>
    request<{ request: LeaveRow }>(`/api/erp/hris/leave/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Lembur
  overtimes: (params?: { status?: string; mine?: boolean }) =>
    request<{ requests: OvertimeRow[] }>(
      `/api/erp/hris/overtime${qs(params as Record<string, QueryValue>)}`,
    ),
  createOvertime: (data: OvertimeInput) =>
    request<{ request: OvertimeRow }>("/api/erp/hris/overtime", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  decideOvertime: (id: string, data: OvertimeDecision) =>
    request<{ request: OvertimeRow }>(`/api/erp/hris/overtime/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Perjalanan dinas
  travels: (params?: { status?: string; mine?: boolean }) =>
    request<{ orders: TravelRow[] }>(
      `/api/erp/hris/travel${qs(params as Record<string, QueryValue>)}`,
    ),
  createTravel: (data: TravelInput) =>
    request<{ order: TravelRow }>("/api/erp/hris/travel", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  travelAction: (id: string, data: TravelAction) =>
    request<{ order: TravelRow }>(`/api/erp/hris/travel/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Log harian
  dailyLogs: (params?: { date?: string; projectId?: string; mine?: boolean }) =>
    request<{ logs: DailyLogRow[] }>(
      `/api/erp/hris/dailylogs${qs(params as Record<string, QueryValue>)}`,
    ),
  createDailyLog: (data: DailyLogInput) =>
    request<{ log: DailyLogRow }>("/api/erp/hris/dailylogs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDailyLog: (id: string, data: Partial<DailyLogInput>) =>
    request<{ log: DailyLogRow }>(`/api/erp/hris/dailylogs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Kalender libur
  holidays: (params?: { year?: number }) =>
    request<{ holidays: HolidayRow[] }>(
      `/api/erp/hris/holidays${qs(params as Record<string, QueryValue>)}`,
    ),

  // Kuota cuti tahunan
  leaveBalances: (params?: { year?: number; employeeId?: string }) =>
    request<{ year: number; balances: LeaveBalanceRow[] }>(
      `/api/erp/hris/leave-balances${qs(params as Record<string, QueryValue>)}`,
    ),
  upsertLeaveBalance: (data: LeaveBalanceUpsertInput) =>
    request<{ balance: LeaveBalanceRecord }>("/api/erp/hris/leave-balances", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Ringkasan modul
  overview: (params?: { month?: string }) =>
    request<HrisOverview>(`/api/erp/hris/overview${qs(params as Record<string, QueryValue>)}`),
};
