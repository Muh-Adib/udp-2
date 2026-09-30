"use client";

/**
 * FASE 7 — Client helper modul Pembukuan (Accounting).
 * Pola identik dgn @/lib/crm/api-client: fetch same-origin (cookie sesi selalu
 * ikut), error dilempar sebagai Error(data.error), dan status 423 (layar
 * terkunci) memicu event global "crm:locked".
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

// ===== Tipe data (bentuk JSON dari /api/erp/finance/*) =====

export type AccountDTO = {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense" | string;
  active: boolean;
  createdAt: string;
};

export type JournalLineDTO = {
  id: string;
  entryId: string;
  accountId: string;
  debit: number;
  credit: number;
  account: { id: string; code: string; name: string; type: string };
};

export type JournalEntryDTO = {
  id: string;
  date: string;
  memo: string;
  sourceType: string | null;
  sourceId: string | null;
  status: "draft" | "posted" | string;
  postedAt: string | null;
  createdBy: string;
  createdAt: string;
  periodId: string | null;
  lines: JournalLineDTO[];
  totalDebit?: number;
  totalCredit?: number;
};

export type AccountingPeriodDTO = {
  id: string;
  name: string; // "YYYY-MM"
  status: "open" | "closed" | string;
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
  entryCount?: number;
  draftCount?: number;
};

export type ExpenseItemDTO = {
  id: string;
  claimId: string;
  purchaseDate: string;
  description: string;
  category: "transport" | "meals" | "accommodation" | "material" | "other" | string;
  amount: number;
  receiptRef: string | null;
};

export type ExpenseClaimDTO = {
  id: string;
  employeeId: string;
  employee: { id: string; employeeNumber: string; preferredName: string };
  title: string;
  brandId: string | null;
  projectId: string | null;
  totalAmount: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "paid" | string;
  submittedAt: string | null;
  approvedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  payoutAt: string | null;
  createdAt: string;
  items: ExpenseItemDTO[];
};

export type ExpenseMeDTO = { id: string; preferredName: string } | null;

export type CashDisbursementDTO = {
  id: string;
  obligationId: string | null;
  payeeName: string;
  amount: number;
  method: "transfer" | "cash" | string;
  bankRef: string | null;
  disbursedAt: string;
  createdBy: string;
  note: string | null;
};

export type FinancialObligationDTO = {
  id: string;
  payeeType: string;
  payeeEmployeeId: string | null;
  payeeName: string;
  amount: number;
  currency: string;
  sourceType: "payroll" | "expense" | "intern_settlement" | "point_redemption" | "travel_settlement" | string;
  sourceId: string;
  status: "open" | "paid" | string;
  createdAt: string;
  payee?: { id: string; employeeNumber: string; preferredName: string } | null;
  disbursements: CashDisbursementDTO[];
};

export type AccountMutationDTO = {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
};

export type FinanceSummaryDTO = {
  totalDebit: number;
  totalCredit: number;
  byAccount: AccountMutationDTO[];
  unbalancedCount: number;
  periodOpen: boolean;
  currentPeriod: { id: string; name: string; status: string } | null;
  journalsThisMonth: number;
  pendingClaims: number;
  openObligations: number;
};

// ===== Input aksi =====

export type JournalLineInput = { accountId: string; debit: number; credit: number };

export type ExpenseItemInput = {
  purchaseDate: string;
  description: string;
  category: string;
  amount: number;
  receiptRef?: string;
};

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== "all") sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** API modul pembukuan — semua endpoint /api/erp/finance/*. */
export const accountingApi = {
  // --- Ringkasan buku besar ---
  summary: () => request<FinanceSummaryDTO>("/api/erp/finance/summary"),

  // --- Bagan akun ---
  accounts: (params: { type?: string; q?: string } = {}) =>
    request<{ accounts: AccountDTO[] }>(`/api/erp/finance/accounts${qs(params)}`),
  createAccount: (body: { code: string; name: string; type: string }) =>
    request<{ account: AccountDTO }>("/api/erp/finance/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: string, body: { name?: string; active?: boolean }) =>
    request<{ account: AccountDTO }>(`/api/erp/finance/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  // --- Jurnal umum ---
  journals: (params: { status?: string; periodId?: string; sourceType?: string; q?: string } = {}) =>
    request<{ journals: JournalEntryDTO[] }>(`/api/erp/finance/journals${qs(params)}`),
  createJournal: (body: {
    date: string;
    memo: string;
    lines: JournalLineInput[];
    sourceType?: string;
    sourceId?: string;
    postNow?: boolean;
  }) => request<{ journal: JournalEntryDTO }>("/api/erp/finance/journals", { method: "POST", body: JSON.stringify(body) }),
  updateJournal: (id: string, body: { memo?: string; date?: string; lines?: JournalLineInput[] }) =>
    request<{ journal: JournalEntryDTO }>(`/api/erp/finance/journals/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  postJournal: (id: string) =>
    request<{ journal: JournalEntryDTO }>(`/api/erp/finance/journals/${id}/post`, { method: "POST", body: JSON.stringify({}) }),
  reverseJournal: (id: string) =>
    request<{ journal: JournalEntryDTO }>(`/api/erp/finance/journals/${id}/reverse`, { method: "POST", body: JSON.stringify({}) }),

  // --- Periode pembukuan ---
  periods: () =>
    request<{ periods: AccountingPeriodDTO[]; currentPeriodName: string }>("/api/erp/finance/periods"),
  createPeriod: (body: { name: string }) =>
    request<{ period: AccountingPeriodDTO }>("/api/erp/finance/periods", { method: "POST", body: JSON.stringify(body) }),
  closePeriod: (id: string) =>
    request<{ period: AccountingPeriodDTO }>(`/api/erp/finance/periods/${id}/close`, { method: "POST", body: JSON.stringify({}) }),

  // --- Klaim reimbursement ---
  expenses: (params: { status?: string; mine?: boolean; employeeId?: string } = {}) =>
    request<{ claims: ExpenseClaimDTO[]; me?: ExpenseMeDTO }>(
      `/api/erp/finance/expenses${qs({ status: params.status, ...(params.mine ? { mine: "1" } : {}), employeeId: params.employeeId })}`,
    ),
  createExpense: (body: {
    title: string;
    brandId?: string;
    projectId?: string;
    items: ExpenseItemInput[];
    submitNow?: boolean;
  }) => request<{ claim: ExpenseClaimDTO }>("/api/erp/finance/expenses", { method: "POST", body: JSON.stringify(body) }),
  expenseAction: (
    id: string,
    body: { action: "submit" | "approve" | "reject" | "pay"; decisionNote?: string; method?: string; bankRef?: string },
  ) => request<{ claim: ExpenseClaimDTO }>(`/api/erp/finance/expenses/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  updateExpenseItems: (id: string, body: { items: ExpenseItemInput[] }) =>
    request<{ claim: ExpenseClaimDTO }>(`/api/erp/finance/expenses/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  // --- Kewajiban & pencairan ---
  obligations: (params: { status?: string; sourceType?: string } = {}) =>
    request<{ obligations: FinancialObligationDTO[] }>(`/api/erp/finance/obligations${qs(params)}`),
  createDisbursement: (body: { obligationId: string; method: string; bankRef?: string; note?: string }) =>
    request<{ disbursement: CashDisbursementDTO; obligation: FinancialObligationDTO }>(
      "/api/erp/finance/disbursements",
      { method: "POST", body: JSON.stringify(body) },
    ),
};

export default accountingApi;
