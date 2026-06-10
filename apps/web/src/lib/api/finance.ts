import { apiGet, apiPost, apiPatch, apiDelete } from "../api";

export interface ReserveBucket {
  id: string;
  name: string;
  purpose: string;
  targetAmount: number | null;
  currentAmount: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchReserveBuckets(businessId: string) {
  return apiGet<ReserveBucket[]>(`/finance/businesses/${businessId}/reserves`);
}

export async function createReserveBucket(businessId: string, body: { name: string; purpose: string; targetAmount?: number; currentAmount?: number; currency?: string }) {
  return apiPost<ReserveBucket>({ path: `/finance/businesses/${businessId}/reserves`, body });
}

export async function updateReserveBucket(businessId: string, id: string, body: Partial<{ name: string; purpose: string; targetAmount: number; currentAmount: number; status: string }>) {
  return apiPatch<ReserveBucket>(`/finance/businesses/${businessId}/reserves/${id}`, body);
}

export async function deleteReserveBucket(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/reserves/${id}`);
}

// ---------- General Ledger ----------
export interface GeneralLedgerRow {
  id: string;
  date: string;
  memo: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
  transaction: { id: string; type: string; description: string | null; reference: string | null };
  account: { id: string; name: string; type: string; code: string | null };
}

export async function fetchGeneralLedger(businessId: string, params?: { accountId?: string; from?: string; to?: string; page?: number; limit?: number }) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString() : "";
  return apiGet<{ rows: GeneralLedgerRow[]; total: number; page: number; limit: number }>(`/finance/businesses/${businessId}/general-ledger${qs ? `?${qs}` : ""}`);
}

// ---------- Trial Balance ----------
export interface TrialBalanceRow {
  accountId: string;
  accountName: string;
  accountType: string;
  accountCode: string | null;
  debit: number;
  credit: number;
  netBalance: number;
}

export async function fetchTrialBalance(businessId: string, asOf?: string) {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  return apiGet<TrialBalanceRow[]>(`/finance/businesses/${businessId}/trial-balance${qs}`);
}

export async function fetchAccountBalance(businessId: string, accountId: string, asOf?: string) {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  return apiGet<{ balance: number }>(`/finance/businesses/${businessId}/trial-balance/account/${accountId}${qs}`);
}

// ---------- Bank Rules ----------
export interface BankRule {
  id: string;
  name: string;
  priority: number;
  pattern: string;
  matchType: string;
  accountId: string;
  expenseCategoryId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchBankRules(businessId: string) {
  return apiGet<BankRule[]>(`/finance/businesses/${businessId}/bank-rules`);
}

export async function createBankRule(businessId: string, body: { name: string; pattern: string; matchType?: string; accountId: string; expenseCategoryId?: string | null; priority?: number }) {
  return apiPost<BankRule>({ path: `/finance/businesses/${businessId}/bank-rules`, body });
}

export async function updateBankRule(businessId: string, id: string, body: Partial<{ name: string; pattern: string; matchType: string; accountId: string; expenseCategoryId: string | null; priority: number; isActive: boolean }>) {
  return apiPatch<BankRule>(`/finance/businesses/${businessId}/bank-rules/${id}`, body);
}

export async function deleteBankRule(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/bank-rules/${id}`);
}

export async function applyBankRules(businessId: string, bankTransactionIds?: string[]) {
  return apiPost<{ scanned: number; matched: number; createdTransactions: number }>({ path: `/finance/businesses/${businessId}/bank-rules/apply`, body: { bankTransactionIds } });
}

// ---------- Recurring Journal Entries ----------
export interface RecurringJournalEntry {
  id: string;
  name: string;
  description: string | null;
  frequency: string;
  nextRunDate: string;
  endDate: string | null;
  isActive: boolean;
  entries: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }>;
  runCount: number;
  failureCount: number;
  lastError: string | null;
  lastRunDate: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchRecurringJournals(businessId: string) {
  return apiGet<RecurringJournalEntry[]>(`/finance/businesses/${businessId}/recurring-journal-entries`);
}

export async function createRecurringJournal(businessId: string, body: { name: string; description?: string; frequency: string; nextRunDate: string; endDate?: string | null; entries: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }> }) {
  return apiPost<RecurringJournalEntry>({ path: `/finance/businesses/${businessId}/recurring-journal-entries`, body });
}

export async function updateRecurringJournal(businessId: string, id: string, body: Partial<{ name: string; description: string; frequency: string; nextRunDate: string; endDate: string | null; entries: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }>; isActive: boolean }>) {
  return apiPatch<RecurringJournalEntry>(`/finance/businesses/${businessId}/recurring-journal-entries/${id}`, body);
}

export async function deleteRecurringJournal(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/recurring-journal-entries/${id}`);
}

export async function runRecurringJournal(businessId: string, id: string) {
  return apiPost<{ transactionId: string; nextRunDate: string }>({ path: `/finance/businesses/${businessId}/recurring-journal-entries/${id}/run`, body: {} });
}

// ---------- Credit Notes ----------
export interface CreditNote {
  id: string;
  invoiceId: string;
  creditNoteNumber: string;
  status: string;
  amount: number;
  reason: string | null;
  appliedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCreditNotes(businessId: string) {
  return apiGet<CreditNote[]>(`/finance/businesses/${businessId}/credit-notes`);
}

export async function createCreditNote(businessId: string, body: { invoiceId: string; creditNoteNumber: string; amount: number; reason?: string; items?: Array<{ description: string; quantity?: number; unitPrice?: number; amount: number }> }) {
  return apiPost<CreditNote>({ path: `/finance/businesses/${businessId}/credit-notes`, body });
}

export async function applyCreditNote(businessId: string, id: string) {
  return apiPost<{ transactionId: string }>({ path: `/finance/businesses/${businessId}/credit-notes/${id}/apply`, body: {} });
}

export async function voidCreditNote(businessId: string, id: string) {
  return apiPost<CreditNote>({ path: `/finance/businesses/${businessId}/credit-notes/${id}/void`, body: {} });
}

// ---------- Accounting Periods ----------
export interface AccountingPeriod {
  id: string;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  status: string;
  closedAt: string | null;
  closedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAccountingPeriods(businessId: string) {
  return apiGet<AccountingPeriod[]>(`/finance/businesses/${businessId}/accounting-periods`);
}

export async function createAccountingPeriod(businessId: string, body: { year: number; month: number }) {
  return apiPost<AccountingPeriod>({ path: `/finance/businesses/${businessId}/accounting-periods`, body });
}

export async function closeAccountingPeriod(businessId: string, id: string) {
  return apiPost<AccountingPeriod>({ path: `/finance/businesses/${businessId}/accounting-periods/${id}/close`, body: {} });
}

export async function reopenAccountingPeriod(businessId: string, id: string) {
  return apiPost<AccountingPeriod>({ path: `/finance/businesses/${businessId}/accounting-periods/${id}/reopen`, body: {} });
}
