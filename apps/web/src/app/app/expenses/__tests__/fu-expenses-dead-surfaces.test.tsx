/**
 * P252 FU-EXPENSES-DEAD-SURFACES (launch-track, D-315; from the EH3 R24 correctness review and the R24/R24b security
 * note n2). Removed, not mounted: no v1 packet ships them (the EXPENSES-HUB-3 plan entry mounts the Categories and
 * Recurring views only, D-152 hides what v1 does not promise, and its definition of done is "no figure that is not
 * read from the server").
 *
 *   - hooks/use-expenses-ai-hub.ts reported canned successes ("Expenses categorized", "Margin analysis complete", ...)
 *     with no client call; no screen imports it.
 *   - the Insights, Analytics and Vendors tabs (and the stats block only Analytics used) were never mounted.
 *   - their reads (vendor analytics, margin analysis, recurring patterns) were made on every page load for nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

const ZONES: Record<string, string> = vi.hoisted(() => ({ biz_A: "America/Port_of_Spain", biz_B: "America/Port_of_Spain" } as Record<string, string>));
const CURRENCIES: Record<string, string> = vi.hoisted(() => ({ biz_A: "TTD", biz_B: "USD" } as Record<string, string>));
const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
  fetchFinanceAccounts: vi.fn(),
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchRecurringCandidates: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
  upsertExpenseBudget: vi.fn(),
  deleteExpenseBudget: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
const upload = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: upload.uploadFile, isUploading: false, progress: 0 }) }));
const drive = vi.hoisted(() => ({ uploadToDrive: vi.fn() }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: drive.uploadToDrive }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
const finance = vi.hoisted(() => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/api/finance", () => finance);
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: CURRENCIES[ws.bid] ?? "TTD", timezone: ZONES[ws.bid] ?? "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
}));

import { toast } from "sonner";
import { useExpensesData } from "../components/use-expenses-data";
import { renderHook } from "@testing-library/react";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, ExpenseCategory[]> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" } as ExpenseCategory],
};


const SCHEDULE = {
  id: "rec_A1", name: "Rent", frequency: "MONTHLY", nextRunDate: "2026-12-01T00:00:00.000Z", isActive: true, runCount: 0,
  failureCount: 0, description: "Rent", amount: 1000, currency: "TTD", createsBill: false,
} as RecurringExpense;
const _BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockImplementation(async (b: string) => ok(CATS[b] ?? []));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockImplementation(async (b: string) => ok(b === "biz_A" ? [SCHEDULE] : []));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});






afterEach(() => {
  ZONES.biz_A = "America/Port_of_Spain";
  vi.useRealTimers();
});


afterEach(() => { blocked.on = false; });






import { existsSync } from "node:fs";
import { join } from "node:path";

const EXPENSES = join(__dirname, "..");
const DEAD = [
  "hooks/use-expenses-ai-hub.ts",
  "components/expense-insights-tab.tsx",
  "components/expense-analytics-tab.tsx",
  "components/expense-vendors-tab.tsx",
  "components/expense-stats.tsx",
];

describe("P252: the dead expense surfaces are gone", () => {
  for (const path of DEAD) {
    it(`${path} is removed`, () => {
      expect(existsSync(join(EXPENSES, path)), `${path} still ships`).toBe(false);
    });
  }
});

describe("P252: the data hook makes no read nothing shows", () => {
  it("vendor analytics, margin analysis and recurring patterns are not read", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(client.fetchVendorAnalytics, "vendor analytics read for no screen").not.toHaveBeenCalled();
    expect(client.fetchMarginAnalysis, "margin analysis read for no screen").not.toHaveBeenCalled();
    expect(client.fetchRecurringCandidates, "recurring patterns read for no screen").not.toHaveBeenCalled();
  });
  it("and exposes none of them", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    for (const key of ["vendors", "vendorsRead", "marginData", "marginRead", "recurringCandidates", "candidatesRead"]) {
      expect(Object.prototype.hasOwnProperty.call(result.current, key), `the hook still exposes ${key}`).toBe(false);
    }
  });
  it("control: the reads v1 shows are still made", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(client.fetchExpenses).toHaveBeenCalled();
    expect(client.fetchExpenseCategories).toHaveBeenCalled();
    expect(client.fetchExpenseSummary).toHaveBeenCalled();
    expect(client.fetchExpenseBudgets).toHaveBeenCalled();
  });
});
