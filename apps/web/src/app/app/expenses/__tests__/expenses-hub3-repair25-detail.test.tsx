/**
 * EXPENSES-HUB-3 repair round 25 (R24 + R24b reviews at 24c41fc; D-308, D-315), the expense detail page.
 *
 *   R25-1  a Retry of a refused categories or budgets read reads only that block: the page and the open edit sheet
 *          stay mounted (the typed edits and the same field survive) and the expense is not read again
 *   R25-3  a refused or failed expense read says "Couldn't load this expense" in the server's words with Retry;
 *          "Expense not found" is for a real 404 only
 *   R25-6  (e) the budget note's Retry reads the budgets again; the edit sheet is given the categories read
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






const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });





const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const CAT = { id: "cat_1", name: "Supplies", color: "#f97316" };
const desc = () => screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement;
const retryIn = (el: Element) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Retry") as HTMLButtonElement;

describe("R25-1: a Retry keeps the page and the open edit sheet", () => {
  it("the categories Retry: the typed edit and its field survive, and the expense is not read again", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await mount({ status: "PAID", categoryId: "cat_1" });
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    const field = await waitFor(() => desc());
    fireEvent.change(field, { target: { value: "Typed, not saved" } });
    const reads = client.getExpense.mock.calls.length;
    const catReads = client.fetchExpenseCategories.mock.calls.length;
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    const dialog = screen.getByRole("dialog");
    const note = Array.from(dialog.querySelectorAll('[role="status"]')).find((n) => /category/.test(n.textContent ?? ""))!;
    fireEvent.click(retryIn(note));
    await waitFor(() => expect(client.fetchExpenseCategories.mock.calls.length).toBeGreaterThan(catReads));
    await settle();
    expect(desc(), "the sheet was remounted").toBe(field);
    expect(desc().value, "the typed edit was lost").toBe("Typed, not saved");
    expect(client.getExpense.mock.calls.length, "the expense was read again").toBe(reads);
  });
  it("the budget Retry reads the budgets again, not the expense (R25-6 e)", async () => {
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    client.fetchExpenseBudgets.mockResolvedValue(refusedAnswer());
    await mount({ status: "PAID", categoryId: "cat_1" });
    const note = (await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!;
    const reads = client.getExpense.mock.calls.length;
    const budReads = client.fetchExpenseBudgets.mock.calls.length;
    client.fetchExpenseBudgets.mockResolvedValue(ok([]));
    fireEvent.click(retryIn(note));
    await waitFor(() => expect(client.fetchExpenseBudgets.mock.calls.length).toBeGreaterThan(budReads));
    expect(await screen.findByText("No budget set for this category.")).toBeTruthy();
    expect(client.getExpense.mock.calls.length).toBe(reads);
  });
  it("the edit sheet is told the categories could not be read (R25-6 e)", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await mount({ status: "PAID", categoryId: "cat_1" });
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toMatch(/Couldn't load the category/));
  });
});

describe("R25-3: the expense read itself", () => {
  it("refused: 'Couldn't load this expense' in the server's words, with Retry, never 'not found'", async () => {
    client.getExpense.mockResolvedValue(refusedAnswer());
    render(<ExpenseDetailPage />);
    expect(await screen.findByText(new RegExp(`Couldn't load this expense: ${WORDS}`))).toBeTruthy();
    expect(screen.queryByText("Expense not found")).toBeNull();
    client.getExpense.mockResolvedValue(ok(expense({ status: "PAID" })));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Office Depot" })).toBeTruthy();
  });
  it("thrown: 'Couldn't load this expense', with Retry", async () => {
    client.getExpense.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ExpenseDetailPage />);
    expect(await screen.findByText(/Couldn't load this expense/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("Expense not found")).toBeNull();
  });
  it("a real 404: 'Expense not found', no Retry", async () => {
    client.getExpense.mockResolvedValue({ data: null, error: "Expense not found", status: 404 });
    render(<ExpenseDetailPage />);
    expect(await screen.findByText("Expense not found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/Couldn't load this expense/)).toBeNull();
  });
});
