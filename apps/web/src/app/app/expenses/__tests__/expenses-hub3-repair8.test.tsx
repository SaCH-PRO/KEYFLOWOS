/**
 * EXPENSES-HUB-3 repair round 8 (round-7 confirmations at 55aeaba), absolute API base ("http://api.test").
 *
 *   R8-1 after each decode, backslashes and "."/".." segments are resolved as a URL path resolver does before the
 *        /objects and /__api test: a path that resolves to /objects (or /__api/objects) is never a link
 *   R8-2 a NUL (%00) anywhere, or a ";" straight after "objects" (matrix parameters, raw or %3B), is never a link
 *        (unicode lookalikes, fullwidth slashes and zero-width characters are out of scope)
 *   R8-3 a normal filter change costs exactly one read
 *   R8-4 run-by-run decoding: "caf%C3%A9 50%.pdf" is a link
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

describe("R8-1: dot segments and backslashes are resolved before the /objects test", () => {
  it.each([
    "https://elsewhere.test/a/..%2Fobjects/x",
    "https://elsewhere.test/a/%2e%2e%2Fobjects/x",
    "https://elsewhere.test/a/%252e%252e/objects/x",
    "https://elsewhere.test/a/..%2F__api/objects/x",
    "https://elsewhere.test/__api/%252e/objects/x",
    "https://elsewhere.test/__api%5Cobjects/x",
    "https://elsewhere.test/%5Cobjects/x",
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });

  it.each([
    "https://elsewhere.test/x/__api/objects/x",
    "https://elsewhere.test/a/b/../c/receipt.pdf",
    "https://drive.google.com/file/d/abc/view",
  ])("%s is still a link", (url) => {
    expect(receiptKind(url, "biz_A")).toBe("link");
  });
});

describe("R8-2: a NUL, or a ';' straight after objects, is never a link", () => {
  it.each([
    "https://elsewhere.test/receipt%00.pdf",
    "https://elsewhere.test/%2500/objects/x",
    "https://elsewhere.test/objects;v=1/x",
    "https://elsewhere.test/objects%3Bv=1/x",
    "https://elsewhere.test/__api/objects;x",
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });

  it("a ';' elsewhere in an ordinary receipt path is still a link", () => {
    expect(receiptKind("https://elsewhere.test/receipts;page=2/r.pdf", "biz_A")).toBe("link");
  });
});

describe("R8-3: a normal filter change costs exactly one read", () => {
  it("one read on each change of the category filter, and none more", async () => {
    client.fetchExpenses.mockImplementation(async (_b: string, params?: { categoryId?: string }) => (params?.categoryId ? page("x") : page("a1")));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1"]));
    for (const [filter, rows] of [["cat_X", ["x"]], ["", ["a1"]], ["cat_Y", ["x"]]] as const) {
      const before = client.fetchExpenses.mock.calls.length;
      act(() => result.current.setFilterCategory(filter));
      await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(rows));
      await waitFor(() => expect(result.current.loading).toBe(false));
      await new Promise((r) => setTimeout(r, 30));
      expect(client.fetchExpenses.mock.calls.length - before, `reads for filter '${filter}'`).toBe(1);
    }
  });
});

describe("R8-4: run-by-run decoding keeps ordinary names links", () => {
  it.each(["https://example.com/caf%C3%A9 50%.pdf", "https://example.com/caf%C3%A9%2050%25.pdf"])("%s → link", (url) => {
    expect(receiptKind(url, "biz_A")).toBe("link");
  });
});
