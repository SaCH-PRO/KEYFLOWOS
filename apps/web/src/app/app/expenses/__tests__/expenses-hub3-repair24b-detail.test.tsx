/**
 * EXPENSES-HUB-3 repair round 24b (D-315), the expense detail page: its categories and budgets reads, refused in the
 * client's real shape ({ data: null, error }), say so with Retry: never "Uncategorized" for an expense that has a
 * category, never "No budget set for this category." for a budget that could not be read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const blocked = vi.hoisted(() => ({ on: false }));
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

async function mount(over: Partial<Expense> = {}) {
  client.getExpense.mockResolvedValue(ok(expense(over)));
  render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Office Depot" });
}


/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */


afterEach(() => { blocked.on = false; });






function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });



async function openEditAndSave() {
  fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
}


const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const CAT = { id: "cat_1", name: "Supplies", color: "#f97316" };

describe("R24b: the detail page's categories read", () => {
  it("refused: says it could not load the category, never 'Uncategorized', and Retry reads again", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await mount({ status: "PAID", categoryId: "cat_1" });
    expect((await screen.findAllByText(/Couldn't load the category/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Uncategorized/), "a category it could not read is said to be none").toBeNull();
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    const before = client.fetchExpenseCategories.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(client.fetchExpenseCategories.mock.calls.length).toBeGreaterThan(before));
    expect((await screen.findAllByText(/Supplies/)).length).toBeGreaterThan(0);
  });
  it("control: the category that answers is named", async () => {
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    await mount({ status: "PAID", categoryId: "cat_1" });
    expect((await screen.findAllByText(/Supplies/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Couldn't load the category/)).toBeNull();
  });
});

describe("R24b: the detail page's budgets read", () => {
  it("refused: says it could not load the budget, never 'No budget set'", async () => {
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    client.fetchExpenseBudgets.mockResolvedValue(refusedAnswer());
    await mount({ status: "PAID", categoryId: "cat_1" });
    expect(await screen.findByText(/Couldn't load this category's budget/)).toBeTruthy();
    expect(screen.queryByText("No budget set for this category.")).toBeNull();
  });
  it("control: no budget set is said when the read answers none", async () => {
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    await mount({ status: "PAID", categoryId: "cat_1" });
    expect(await screen.findByText("No budget set for this category.")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load this category's budget/)).toBeNull();
  });
});
