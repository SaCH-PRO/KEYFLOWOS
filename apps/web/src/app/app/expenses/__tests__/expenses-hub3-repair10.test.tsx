/**
 * EXPENSES-HUB-3 repair round 10 (round-9 security review at b4b2833: MAJOR regression in the page > 1 read skip).
 *
 *   R10-1 a filter change on page 2, then a page change batched with the page reset: the rows match the final filter
 *         and page, and a later loadData() (Retry, the reload after a delete or mark-paid) makes a read
 *   R10-2 page 2 of business B, with the same filters as A, is read
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useRef } from "react";
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
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { useExpensesData } from "../components/use-expenses-data";

const ok = <T,>(data: T) => ({ data, error: null });
function expense(id: string): Expense {
  return {
    id, description: id, amount: 10, currency: "TTD", date: "2026-11-20T00:00:00.000Z", vendor: "V", paymentMethod: "cash",
    tags: [], isRecurring: false, status: "PAID", categoryId: null, createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z",
  } as Expense;
}

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchExpenses.mockImplementation(async (b: string, params: { categoryId?: string; page?: number }) =>
    ok({ data: [expense(`${b}_${params.categoryId ?? "all"}_p${params.page}`)], total: 45, page: params.page ?? 1, limit: 20 }),
  );
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [], missingReceiptCount: 0 }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
});
afterEach(() => cleanup());

const ids = (r: { current: { expenses: Expense[] } }) => r.current.expenses.map((e) => e.id);

describe("R10-1: a filter change on page 2, then a page change batched with the reset", () => {
  it("the rows match the final filter and page, and a later loadData() still reads", async () => {
    // A page change made in the same commit as the filter change, after the hook's own effects (so after the reset
    // queues setPage(1)): the two page updates batch, page 1 never renders, the reset does not fire again.
    const pageTwoOnY = { armed: false };
    const { result } = renderHook(() => {
      const d = useExpensesData();
      const setPage = useRef(d.setPage);
      useEffect(() => {
        if (pageTwoOnY.armed && d.filterCategory === "cat_Y") {
          pageTwoOnY.armed = false;
          setPage.current(2);
        }
      }, [d.filterCategory]);
      return d;
    });
    await waitFor(() => expect(ids(result)).toEqual(["biz_A_all_p1"]));
    act(() => result.current.setFilterCategory("cat_X"));
    await waitFor(() => expect(ids(result)).toEqual(["biz_A_cat_X_p1"]));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(ids(result)).toEqual(["biz_A_cat_X_p2"]));

    // Filter Y while on page 2; the reset to page 1 is queued; a page change lands after it, in the same commit.
    pageTwoOnY.armed = true;
    act(() => result.current.setFilterCategory("cat_Y"));
    await waitFor(() => expect(ids(result)).toEqual(["biz_A_cat_Y_p2"]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filterCategory).toBe("cat_Y");
    expect(result.current.page).toBe(2);

    const before = client.fetchExpenses.mock.calls.length;
    await act(async () => { await result.current.loadData(); });
    expect(client.fetchExpenses.mock.calls.length, "a later loadData() (Retry, a reload after a delete) reads").toBe(before + 1);
    expect(client.fetchExpenses.mock.calls.at(-1)?.[1]).toMatchObject({ categoryId: "cat_Y", page: 2 });
    expect(ids(result)).toEqual(["biz_A_cat_Y_p2"]);
  });
});

describe("R10-2: page 2 of business B, with the same filters as A, is read", () => {
  it("B's page 2 is read and shown", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(ids(result)).toEqual(["biz_A_all_p1"]));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(ids(result)).toEqual(["biz_A_all_p2"]));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(ids(result)).toEqual(["biz_B_all_p1"]));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(ids(result)).toEqual(["biz_B_all_p2"]));
    expect(client.fetchExpenses.mock.calls.some((c) => c[0] === "biz_B" && (c[1] as { page?: number }).page === 2)).toBe(true);
  });
});
