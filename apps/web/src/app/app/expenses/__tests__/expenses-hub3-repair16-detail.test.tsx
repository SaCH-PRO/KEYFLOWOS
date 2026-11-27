/**
 * EXPENSES-HUB-3 repair round 16 (R15 reviews at 89f75fa), the expense detail page.
 *
 *   R16-1  a read that lands after the page has gone (unmounted, then a switch) navigates nowhere
 *   R16-2  a real switch leaves once: the listener, then the stale read landing, replace exactly once
 *   R16-3  the edit sheet's Save checks the business before sending: with the stored id already B, no updateExpense
 *   R16-5  localStorage.clear() in another tab (a StorageEvent with key null) leaves the page
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

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
function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_A1", description: "Printer toner", amount: 100, currency: "TTD", date: "2026-10-15T00:00:00.000Z",
    vendor: "Office Depot", paymentMethod: "cash", tags: [], isRecurring: false, status: "PAID", categoryId: null,
    createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z", ...over,
  } as Expense;
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

async function mount(over: Partial<Expense> = {}) {
  client.getExpense.mockResolvedValue(ok(expense(over)));
  render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Office Depot" });
}
function switchTo(bid: string) {
  ws.bid = bid;
  act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });


/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */
const silentSwitch = (bid: string) => { ws.bid = bid; };


describe("R16-1: a read landing after the page has gone", () => {
  it("navigates nowhere", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    const view = render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
    view.unmount();
    silentSwitch("biz_B");
    await act(async () => { read.resolve(ok(expense())); });
    await settle();
    expect(nav.replace).toHaveBeenCalledTimes(0);
  });
});

describe("R16-2: a real switch leaves once", () => {
  it("the listener, then A's read landing: replace exactly once", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
    switchTo("biz_B");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    await act(async () => { read.resolve(ok(expense())); });
    await settle();
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});

describe("R16-3: the edit sheet's Save checks before sending", () => {
  it("with the stored id already B, Update sends no updateExpense for A and says nothing", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    const update = await screen.findByRole("button", { name: "Update Expense" });
    silentSwitch("biz_B");
    fireEvent.click(update);
    await settle();
    expect(client.updateExpense).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("R16-5: localStorage.clear() in another tab", () => {
  it("a StorageEvent with key null leaves the page", async () => {
    await mount();
    ws.bid = null;
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
  });
});
