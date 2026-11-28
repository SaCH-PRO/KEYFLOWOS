/**
 * EXPENSES-HUB-3 repair round 27 (R26 reviews at 19da368; D-308), the expense detail page: the expense id changing
 * within the same page instance.
 *
 *   R27-1  a read starts from nothing for every block: A2 whose budgets read throws never shows A1's budget figures,
 *          it shows the budget note with Retry
 *   R27-2  a Retry started on A1 whose reply lands once the page shows A2 sets nothing (both blocks)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const routeParams = vi.hoisted(() => ({ id: "exp_A1" }));
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
  useParams: () => ({ id: routeParams.id }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
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



/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */


afterEach(() => { blocked.on = false; });






const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });







const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const CAT = { id: "cat_1", name: "Supplies", color: "#f97316" };
const CAT2 = { id: "cat_2", name: "Travel", color: "#22c55e" };
const retryIn = (el: Element) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Retry") as HTMLButtonElement;
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const A1 = () => expense({ id: "exp_A1", status: "PAID", categoryId: "cat_1", date: "2026-10-15T00:00:00.000Z", vendor: "October Vendor" });
const A2 = (over: Partial<Expense> = {}) => expense({ id: "exp_A2", status: "PAID", categoryId: "cat_1", date: "2026-11-15T00:00:00.000Z", vendor: "November Vendor", ...over });
const OCT_BUDGET = { id: "bud_oct", categoryId: "cat_1", amount: 777, spent: 100, remaining: 677, percentUsed: 13, isOverBudget: false, isNearAlert: false, month: 10, year: 2026 };
afterEach(() => { routeParams.id = "exp_A1"; });
beforeEach(() => {
  client.getExpense.mockImplementation(async (_b: string, id: string) => ok(id === "exp_A2" ? A2() : A1()));
  client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
});
async function toA2(view: ReturnType<typeof render>) {
  routeParams.id = "exp_A2";
  view.rerender(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "November Vendor" });
}

describe("R27-1: A2's budgets read throws after A1's budget was shown", () => {
  it("A1's figures are gone; the budget note offers Retry", async () => {
    client.fetchExpenseBudgets.mockResolvedValue(ok([OCT_BUDGET]));
    const view = render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "October Vendor" });
    expect(await screen.findByText("Monthly budget")).toBeTruthy();
    client.fetchExpenseBudgets.mockRejectedValue(new TypeError("Failed to fetch"));
    await toA2(view);
    const note = (await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!;
    expect(retryIn(note)).toBeTruthy();
    expect(screen.queryByText("Monthly budget"), "October's budget shown on November's expense").toBeNull();
  });
});

describe("R27-2: a Retry started on A1 lands once the page shows A2", () => {
  it("budgets: A2's 'No budget set' stays; October's budget never shows", async () => {
    client.fetchExpenseBudgets.mockResolvedValue(refusedAnswer());
    const view = render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "October Vendor" });
    const held = deferred<unknown>();
    client.fetchExpenseBudgets.mockReturnValueOnce(held.promise);
    fireEvent.click(retryIn((await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!));
    client.fetchExpenseBudgets.mockResolvedValue(ok([]));
    await toA2(view);
    expect(await screen.findByText("No budget set for this category.")).toBeTruthy();
    await act(async () => { held.resolve(ok([OCT_BUDGET])); });
    await settle();
    expect(screen.queryByText("Monthly budget"), "A1's Retry reply set October's budget on A2").toBeNull();
    expect(screen.getByText("No budget set for this category.")).toBeTruthy();
  });
  it("categories: A2's own category stays", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    client.fetchExpenseBudgets.mockResolvedValue(ok([]));
    client.getExpense.mockImplementation(async (_b: string, id: string) => ok(id === "exp_A2" ? A2({ categoryId: "cat_2" }) : A1()));
    const view = render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "October Vendor" });
    const held = deferred<unknown>();
    client.fetchExpenseCategories.mockReturnValueOnce(held.promise);
    const note = (await screen.findAllByText(/Couldn't load the category:/)).map((n) => n.closest('[role="status"]')).find(Boolean)!;
    fireEvent.click(retryIn(note));
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT, CAT2]));
    await toA2(view);
    expect((await screen.findAllByText(/Travel/)).length).toBeGreaterThan(0);
    await act(async () => { held.resolve(refusedAnswer()); });
    await settle();
    expect(screen.queryAllByText(/Travel/).length, "A1's Retry reply replaced A2's categories").toBeGreaterThan(0);
    expect(screen.queryByText(/Couldn't load the category/)).toBeNull();
  });
});
