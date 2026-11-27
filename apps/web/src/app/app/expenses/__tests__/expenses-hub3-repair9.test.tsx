/**
 * EXPENSES-HUB-3 repair round 9 (round-8 confirmations at ac1085b), absolute API base ("http://api.test").
 *
 *   R9-1 "..%2Fobjects" straight under the root is still an object path: ".." never pops the root segment
 *   R9-2 a filter change while on page 2 ends on page 1 with the new filter, and no reply of the stale page-2 read
 *        is ever applied (repair round 10: at most 2 reads; the skip that made it exactly 1 could starve reads)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const client = vi.hoisted(() => ({
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
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [] }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => ({ id: "biz_A", name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
  getStoredBusinessId: () => "biz_A",
}));

import { useExpensesData } from "../components/use-expenses-data";
import { receiptKind } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
function expense(id: string): Expense {
  return {
    id, description: id, amount: 10, currency: "TTD", date: "2026-11-20T00:00:00.000Z", vendor: "V", paymentMethod: "cash",
    tags: [], isRecurring: false, status: "PAID", categoryId: null, createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z",
  } as Expense;
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [], missingReceiptCount: 0 }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
});
afterEach(() => cleanup());

describe("R9-1: '..' never pops the root segment", () => {
  it.each(["https://elsewhere.test/..%2Fobjects/x", "https://elsewhere.test/%2e%2e%2F__api/objects/x"])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });
});

describe("R9-2: a filter change while on page 2 ends on page 1 with the new filter", () => {
  it("the final rows come from {cat_X, page 1}; the stale page-2 read's reply is never applied; at most 2 reads", async () => {
    let releasePage2: () => void = () => {};
    // Every rows state the hook renders, from the filter change on (not only the final one).
    const applied: string[][] = [];
    let recording = false;
    client.fetchExpenses.mockImplementation((_b: string, params: { categoryId?: string; page?: number }) => {
      const id = `${params.categoryId ?? "all"}_p${params.page}`;
      const answer = ok({ data: [expense(id)], total: 45, page: params.page ?? 1, limit: 20 });
      // The page-2 read with the new filter answers last, after the page-1 read: it must never be applied.
      if (params.categoryId === "cat_X" && params.page === 2) return new Promise((r) => { releasePage2 = () => r(answer); });
      return Promise.resolve(answer);
    });
    const { result } = renderHook(() => {
      const d = useExpensesData();
      if (recording) applied.push(d.expenses.map((e) => e.id));
      return d;
    });
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["all_p1"]));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["all_p2"]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const before = client.fetchExpenses.mock.calls.length;
    recording = true;
    act(() => result.current.setFilterCategory("cat_X"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["cat_X_p1"]));
    await act(async () => { releasePage2(); });
    await new Promise((r) => setTimeout(r, 30));
    recording = false;
    const everyRow = applied.flat();
    expect(everyRow, `no rendered state holds the stale page-2 reply (states: ${JSON.stringify(applied)})`).not.toContain("cat_X_p2");
    expect(applied.at(-1)).toEqual(["cat_X_p1"]);
    expect(result.current.page).toBe(1);
    expect(result.current.loading).toBe(false);
    const reads = client.fetchExpenses.mock.calls.slice(before).map((c) => c[1] as { categoryId?: string; page?: number });
    expect(reads.length, `reads after the filter change: ${JSON.stringify(reads)}`).toBeLessThanOrEqual(2);
    // The stale read is really issued, before the page-1 one: otherwise "never applied" would test nothing.
    const stale = reads.findIndex((r) => r.categoryId === "cat_X" && r.page === 2);
    const fresh = reads.findIndex((r) => r.categoryId === "cat_X" && r.page === 1);
    expect(stale, `the stale {cat_X, page 2} read is issued (reads: ${JSON.stringify(reads)})`).toBeGreaterThanOrEqual(0);
    expect(fresh).toBeGreaterThan(stale);
    expect(reads.at(-1)).toMatchObject({ categoryId: "cat_X", page: 1 });
  });
});
