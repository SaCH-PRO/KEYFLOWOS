/**
 * EXPENSES-HUB-3 repair round 5 (round-4 confirmations at 37abcc5), with the absolute API base.
 *
 *   MAJOR-2 two switches in one batch (B then A while A's read is in flight; C then B during B's first read) leave
 *           the business state unchanged; the page must still read afresh, exactly once, and settle with its rows
 *   MINOR-1 a stale call leaves loading alone: B's spinner stays until B's own read lands
 *   MINOR-2 a stale loadData from before A → B → A (an old filter in its closure) is refused: it neither fetches
 *           nor replaces the fresh read
 *   MINOR-3 the API host spelled with a trailing dot or another scheme is still the API host: never a link
 *   MINOR-4 on another host, a path that decodes (repeatedly) to /objects, or has doubled slashes before objects,
 *           is never a link
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));

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
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
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
  ws.bid = "biz_A";
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

const announce = (id: string) => {
  ws.bid = id;
  window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: id } }));
};
const callsFor = (bid: string) => client.fetchExpenses.mock.calls.filter((c) => c[0] === bid).length;

describe("MAJOR-2: two switches in one batch still read afresh and settle", () => {
  it("B then A while A's read is in flight: one fresh A read, settled with A's rows", async () => {
    let aCalls = 0;
    client.fetchExpenses.mockImplementation((b: string) => {
      if (b === "biz_A" && ++aCalls === 1) return new Promise(() => {}); // A's first read never answers
      return Promise.resolve(b === "biz_A" ? page("a_fresh") : page("b1"));
    });
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(aCalls).toBe(1));
    act(() => { announce("biz_B"); announce("biz_A"); });
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(result.current.loading).toBe(false);
    expect(result.current.businessId).toBe("biz_A");
    expect(result.current.expenses.map((e) => e.id)).toEqual(["a_fresh"]);
    expect(callsFor("biz_A")).toBe(2); // the first (lost) read and exactly one fresh one
  });

  it("C then B during B's first read: one fresh B read, settled with B's rows", async () => {
    ws.bid = "biz_B";
    let bCalls = 0;
    client.fetchExpenses.mockImplementation((b: string) => {
      if (b === "biz_B" && ++bCalls === 1) return new Promise(() => {});
      return Promise.resolve(b === "biz_B" ? page("b_fresh") : page("c1"));
    });
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(bCalls).toBe(1));
    act(() => { announce("biz_C"); announce("biz_B"); });
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(result.current.loading).toBe(false);
    expect(result.current.expenses.map((e) => e.id)).toEqual(["b_fresh"]);
    expect(callsFor("biz_B")).toBe(2);
  });
});

describe("MINOR-1: a stale call leaves loading alone", () => {
  it("B's spinner stays on until B's own read lands", async () => {
    let resolveB: (v: unknown) => void = () => {};
    client.fetchExpenses.mockImplementation((b: string) => (b === "biz_A" ? Promise.resolve(page("a1")) : new Promise((r) => { resolveB = r; })));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1"]));
    const staleLoadOfA = result.current.loadData;
    act(() => announce("biz_B"));
    await waitFor(() => expect(callsFor("biz_B")).toBe(1));
    await act(async () => { await staleLoadOfA(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.read.kind).toBe("loading");
    await act(async () => { resolveB(page("b1")); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]);
  });
});

describe("MINOR-2: a stale loadData from before A → B → A is refused", () => {
  it("its old filter neither fetches nor replaces the fresh read", async () => {
    client.fetchExpenses.mockImplementation(async (b: string, params?: { categoryId?: string }) =>
      b === "biz_B" ? page("b1") : params?.categoryId ? page("a_c1_only") : page("a1", "a2"),
    );
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]));
    act(() => result.current.setFilterCategory("c1"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a_c1_only"]));
    const staleFiltered = result.current.loadData; // a delete started under the c1 filter
    act(() => announce("biz_B"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]));
    act(() => announce("biz_A"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]));
    expect(result.current.filterCategory).toBe("");
    const before = client.fetchExpenses.mock.calls.length;
    await act(async () => { await staleFiltered(); });
    expect(client.fetchExpenses.mock.calls.length).toBe(before);
    expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]);
    expect(result.current.loading).toBe(false);
  });
});

describe("MINOR-3 / MINOR-4: receiptKind, absolute API base", () => {
  it.each([
    "http://api.test./files/x.png",
    "https://api.test/files/x.png",
    "https://API.TEST./objects/uploads/biz_A/obj1",
    "https://elsewhere.test/%256Fbjects/uploads/biz2/x.png",
    "https://elsewhere.test//objects/x",
    "https://elsewhere.test/%2Fobjects/x",
    "https://elsewhere.test/%252Fobjects/x",
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });

  it.each([
    ["http://api.test/objects/uploads/biz_A/obj1", "stored"],
    ["https://drive.google.com/file/d/abc/view", "link"],
    ["https://elsewhere.test/receipts/objects-2026.png", "link"],
  ])("%s → %s", (url, kind) => {
    expect(receiptKind(url, "biz_A")).toBe(kind);
  });
});
