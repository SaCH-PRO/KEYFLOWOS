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
  return apiGet<{ items: ReserveBucket[] }>(`/finance/businesses/${businessId}/reserves`);
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

// ---------- Chart of Accounts ----------
export interface ChartOfAccount {
  id: string;
  name: string;
  code: string | null;
  type: string;
  subtype: string | null;
  systemKey: string | null;
  isActive: boolean;
}

export async function fetchChartOfAccounts(businessId: string) {
  return apiGet<{ items: ChartOfAccount[] }>(`/finance/businesses/${businessId}/chart-of-accounts`);
}

// ---------- General Ledger ----------
export interface GeneralLedgerRow {
  entryId: string;
  transactionId: string;
  date: string;
  accountId: string;
  accountName: string;
  accountCode: string | null;
  accountType: string;
  debit: string;
  credit: string;
  runningBalance: string;
  memo: string | null;
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
}

export async function fetchGeneralLedger(businessId: string, params?: { accountId?: string; from?: string; to?: string; page?: number; limit?: number }) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString() : "";
  return apiGet<{ rows: GeneralLedgerRow[]; total: number; page: number; limit: number }>(`/finance/businesses/${businessId}/general-ledger${qs ? `?${qs}` : ""}`);
}

// ---------- Trial Balance ----------
export interface TrialBalanceRow {
  accountId: string;
  systemKey: string | null;
  name: string;
  type: string;
  debit: string;
  credit: string;
  net: string;
}

export async function fetchTrialBalance(businessId: string, asOf?: string) {
  const qs = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  return apiGet<{ items: TrialBalanceRow[] }>(`/finance/businesses/${businessId}/trial-balance${qs}`);
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
  return apiGet<{ items: BankRule[] }>(`/finance/businesses/${businessId}/bank-rules`);
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
  return apiGet<{ items: RecurringJournalEntry[] }>(`/finance/businesses/${businessId}/recurring-journal-entries`);
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
  return apiGet<{ items: CreditNote[] }>(`/finance/businesses/${businessId}/credit-notes`);
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
  return apiGet<{ items: AccountingPeriod[] }>(`/finance/businesses/${businessId}/accounting-periods`);
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

// ---------- Bank Connections ----------
export interface BankConnection {
  id: string;
  financialAccountId: string;
  provider: string;
  providerItemId: string | null;
  status: string;
  lastSyncAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export async function fetchBankConnections(businessId: string) {
  return apiGet<{ items: BankConnection[] }>(`/finance/businesses/${businessId}/bank-connections`);
}

export async function createBankConnection(businessId: string, body: { financialAccountId: string; provider: string; providerItemId?: string; accessToken?: string }) {
  return apiPost<BankConnection>({ path: `/finance/businesses/${businessId}/bank-connections`, body });
}

export async function deleteBankConnection(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/bank-connections/${id}`);
}

export async function syncBankConnection(businessId: string, id: string) {
  return apiPost<{ lastSyncAt?: string; cursor?: string | null }>({ path: `/finance/businesses/${businessId}/bank-connections/${id}/sync`, body: {} });
}

// ---------- Exchange Rates ----------
export interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  source: string | null;
  createdAt: string;
}

export async function fetchExchangeRates(businessId: string, fromCurrency?: string, toCurrency?: string) {
  const qs = fromCurrency && toCurrency ? `?from=${fromCurrency}&to=${toCurrency}` : "";
  return apiGet<{ items: ExchangeRate[] }>(`/finance/businesses/${businessId}/exchange-rates${qs}`);
}

export async function createExchangeRate(businessId: string, body: { fromCurrency: string; toCurrency: string; rate: number; date: string; source?: string }) {
  return apiPost<ExchangeRate>({ path: `/finance/businesses/${businessId}/exchange-rates`, body });
}

export async function deleteExchangeRate(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/exchange-rates/${id}`);
}

// ---------- Fixed Assets ----------
export interface FixedAsset {
  id: string;
  name: string;
  category: string;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number | null;
  usefulLifeMonths: number;
  depreciationMethod: string;
  accumulatedDepreciation: number;
  netBookValue: number;
  status: string;
  disposalDate: string | null;
  createdAt: string;
}

export async function fetchFixedAssets(businessId: string) {
  return apiGet<{ items: FixedAsset[] }>(`/finance/businesses/${businessId}/fixed-assets`);
}

export async function createFixedAsset(businessId: string, body: { name: string; category: string; purchaseDate: string; purchaseCost: number; salvageValue?: number; usefulLifeMonths: number; depreciationMethod?: string }) {
  return apiPost<FixedAsset>({ path: `/finance/businesses/${businessId}/fixed-assets`, body });
}

export async function depreciateFixedAsset(businessId: string, id: string) {
  return apiPost<FixedAsset>({ path: `/finance/businesses/${businessId}/fixed-assets/${id}/depreciate`, body: {} });
}

export async function deleteFixedAsset(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/fixed-assets/${id}`);
}
