/**
 * EXPENSES-HUB-3 repair round 15 (R14 reviews at 0622e7a, MINORs), the expense detail page.
 *
 *   R15-1  Pay checks the business before it sends: a switch in another tab whose storage event has not arrived yet
 *          (the stored id already says B) sends no payBill for A
 *   R15-3  the page's stored-id key is the one the workspace writes (setStoredBusinessId, the real module)
 *   R15-4  another tab's switch, as a real StorageEvent, leaves the page; the listeners are removed on unmount
 *   R15-5  with the stored id already B (no event yet): A's reads that land write nothing (no A expense, no A budget),
 *          a failing read says nothing, void and delete send nothing, the edit sheet's save answering says nothing,
 *          and the reload after an edit writes nothing; a switch announced during a failing load says nothing
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
import { EXPENSES_BUSINESS_ID_KEY } from "../components/expense-utils";

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
const noToast = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};


/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */
const silentSwitch = (bid: string) => { ws.bid = bid; };

describe("R15-1: Pay checks the business before sending", () => {
  it("a stored id already B sends no payBill for A, and says nothing", async () => {
    await mount({ status: "BILL" });
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    const pay = await screen.findByRole("button", { name: /^Pay$/ });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
    silentSwitch("biz_B");
    fireEvent.click(pay);
    await settle();
    expect(finance.payBill).not.toHaveBeenCalled();
    noToast();
  });
});

describe("R15-3: the stored-id key", () => {
  it("is the key the workspace writes", async () => {
    const real = await vi.importActual<typeof import("@/lib/workspace")>("@/lib/workspace");
    window.localStorage.clear();
    real.setStoredBusinessId("biz_key_probe");
    expect(window.localStorage.getItem(EXPENSES_BUSINESS_ID_KEY)).toBe("biz_key_probe");
    window.localStorage.clear();
  });
});

describe("R15-4: another tab's switch, and unmount", () => {
  it("a StorageEvent for the stored id, now B, leaves the page", async () => {
    await mount();
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: EXPENSES_BUSINESS_ID_KEY, newValue: "biz_B" })); });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
    expect(screen.queryByRole("heading", { name: "Office Depot" })).toBeNull();
  });

  it("control: a StorageEvent for another key, or for the same business, changes nothing", async () => {
    await mount();
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "kf_theme", newValue: "dark" })); });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: EXPENSES_BUSINESS_ID_KEY, newValue: "biz_A" })); });
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Office Depot" })).toBeTruthy();
  });

  it("after unmount, neither a switch event nor a StorageEvent reaches the page", async () => {
    client.getExpense.mockResolvedValue(ok(expense()));
    const view = render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "Office Depot" });
    view.unmount();
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: EXPENSES_BUSINESS_ID_KEY, newValue: "biz_B" })); });
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("R15-5: with the stored id already B", () => {
  it("A's expense read that lands writes nothing and leaves at once: no A expense shown", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    client.fetchExpenseBudgets.mockReturnValue(new Promise(() => {})); // the budgets read never answers
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalledWith("biz_A", "exp_A1"));
    silentSwitch("biz_B");
    await act(async () => { read.resolve(ok(expense())); });
    await settle();
    expect(nav.replace, "the page stays on A's expense under B").toHaveBeenCalledWith("/app/expenses");
    expect(client.fetchExpenseBudgets, "A's budgets were read under B").not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Office Depot" }), "A's expense is shown under B").toBeNull();
  });

  it("A's budgets read that lands writes nothing: no A budget shown", async () => {
    const budgets = deferred<unknown>();
    client.fetchExpenseBudgets.mockReturnValue(budgets.promise);
    client.getExpense.mockResolvedValue(ok(expense()));
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.fetchExpenseBudgets).toHaveBeenCalled());
    silentSwitch("biz_B");
    await act(async () => {
      budgets.resolve(ok([{ id: "bud_A", categoryId: null, amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false }]));
    });
    await settle();
    expect(screen.queryByText("Monthly budget"), "A's budget is shown under B").toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/app/expenses");
  });

  it.each(["silently", "announced"] as const)("a failing read of A, with the switch made %s, says nothing", async (how) => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
    if (how === "silently") silentSwitch("biz_B");
    else switchTo("biz_B");
    await act(async () => { read.reject(new TypeError("Failed to fetch")); });
    await settle();
    noToast();
  });

  it("control: a failing read with no switch says 'Failed to load expense'", async () => {
    client.getExpense.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to load expense"));
  });

  it("void sends nothing for A", async () => {
    await mount({ status: "PAID" });
    fireEvent.click(screen.getByRole("button", { name: /Void expense/ }));
    const dialog = await screen.findByRole("dialog");
    silentSwitch("biz_B");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => /Void expense/.test(b.textContent ?? ""))!);
    await settle();
    expect(finance.voidBill).not.toHaveBeenCalled();
    noToast();
  });

  it("delete sends nothing for A", async () => {
    await mount({ status: "PAID" });
    fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
    const dialog = await screen.findByRole("dialog");
    silentSwitch("biz_B");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Delete")!);
    await settle();
    expect(client.deleteExpense).not.toHaveBeenCalled();
    noToast();
  });

  it("the edit sheet's save answering after the switch says nothing (the page gives the sheet its check)", async () => {
    const save = deferred<unknown>();
    client.updateExpense.mockReturnValue(save.promise);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(client.updateExpense).toHaveBeenCalledWith("biz_A", "exp_A1", expect.anything()));
    silentSwitch("biz_B");
    await act(async () => { save.resolve(ok(expense())); });
    await settle();
    noToast();
  });

  it("the reload after an edit, landing after the switch, writes nothing", async () => {
    client.updateExpense.mockResolvedValue(ok(expense()));
    await mount();
    const reload = deferred<unknown>();
    client.getExpense.mockReturnValue(reload.promise);
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(client.getExpense).toHaveBeenCalledTimes(2)); // the mount's read, then the reload
    silentSwitch("biz_B");
    await act(async () => { reload.resolve(ok(expense({ vendor: "Vendor of A, edited" }))); });
    await settle();
    expect(screen.queryByRole("heading", { name: "Vendor of A, edited" }), "the reload wrote A's row under B").toBeNull();
  });
});
