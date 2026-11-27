/**
 * EXPENSES-HUB-3 repair round 7 (round-6 confirmations at 05e3dcf), absolute API base ("http://api.test").
 *
 *   R7-1 "/__api/objects/..." on any host is the API's object path (next.config rewrites /__api/* on every host that
 *        serves the app: aliases, previews): never a link
 *   R7-2 a leftover "%uXXXX" escape after a decode is an escape too: never a link
 *   R7-3 a raw literal "%" with no escape at all ("100%.pdf") cannot hide /objects: a link
 *   R7-4 a stale closure of the same switch epoch with old filters (a delete started under filter X, the filter
 *        cleared while it ran) never reads with X: it asks for one fresh read with the current filters
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
const page = (...ids: string[]) => ok({ data: ids.map(expense), total: ids.length, page: 1, limit: 20 });

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

describe("R7-1: /__api/objects/... on any host is never a link", () => {
  it.each([
    "http://127.0.0.1:3000/__api/objects/uploads/biz_OTHER/o1",
    "http://[::1]:3000/__api/objects/uploads/biz_OTHER/o1",
    "http://sub.localhost:3000/__api/objects/uploads/biz_OTHER/o1",
    "https://elsewhere.test/__api/objects/uploads/biz_OTHER/o1",
    "https://elsewhere.test//__api//objects/x",
    "https://elsewhere.test/%5F%5Fapi/objects/x",
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });

  it("a path that merely mentions __api elsewhere is still a link", () => {
    expect(receiptKind("https://elsewhere.test/docs/__api/receipt.pdf", "biz_A")).toBe("link");
  });
});

describe("R7-2: a leftover %uXXXX escape is an escape", () => {
  it.each(["https://elsewhere.test/%25u002Fobjects/x", "https://elsewhere.test/%25u006Fbjects/x"])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });
});

describe("R7-3: a raw literal % with no escape is a link", () => {
  it.each(["https://example.com/100%.pdf", "https://example.com/invoice 50% deposit.pdf"])("%s → link", (url) => {
    expect(receiptKind(url, "biz_A")).toBe("link");
  });
});

describe("R7-4: a same-epoch closure with old filters never reads with them", () => {
  it("a delete started under filter X, the filter cleared meanwhile: one fresh read with no filter", async () => {
    client.fetchExpenses.mockImplementation(async (_b: string, params?: { categoryId?: string }) =>
      params?.categoryId ? page("x_only") : page("a1", "a2"),
    );
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]));
    act(() => result.current.setFilterCategory("cat_X"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["x_only"]));
    const reloadAfterDelete = result.current.loadData; // the delete started under filter X
    act(() => result.current.setFilterCategory(""));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]));
    const before = client.fetchExpenses.mock.calls.length;
    await act(async () => { await reloadAfterDelete(); });
    await waitFor(() => expect(client.fetchExpenses.mock.calls.length).toBe(before + 1));
    const fresh = client.fetchExpenses.mock.calls.slice(before);
    expect(fresh.every((c) => !(c[1] as { categoryId?: string }).categoryId), "no read with the old filter X").toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filterCategory).toBe("");
    expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]);
  });
});
