/**
 * EXPENSES-HUB-3 repair round 17 (R16 reviews at 4e1ef6b), the expense detail page.
 *
 *   R17-5  a read that fails after the page has gone (unmounted, no switch) says nothing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, cleanup, waitFor, act } from "@testing-library/react";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const client = vi.hoisted(() => ({
  getExpense: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchFinanceAccounts: vi.fn(),
}));
const finance = vi.hoisted(() => ({ payBill: vi.fn(), voidBill: vi.fn(), createBill: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_A1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_A1" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => ws.bid,
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("@/lib/api/finance", () => finance);

import { toast } from "sonner";
import ExpenseDetailPage from "../[id]/page";

const ok = <T,>(data: T) => ({ data, error: null });
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  ws.bid = "biz_A";
  nav.push.mockReset();
  nav.replace.mockReset();
  for (const fn of [...Object.values(client), ...Object.values(finance)]) fn.mockReset();
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });





describe("R17-5: a failing read after the page has gone", () => {
  it("unmounted with no switch, the failure says nothing", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    const view = render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
    view.unmount();
    await act(async () => { read.reject(new TypeError("Failed to fetch")); });
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
