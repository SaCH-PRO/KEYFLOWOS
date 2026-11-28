/**
 * EXPENSES-HUB-3 (SWP-EXPENSE-PAGE-TRUTH; BUG-064, BUG-073, BUG-072; journeys J6 and H10).
 *
 * BUG-064: a member the server refuses the expenses read sees the page's empty values ("TTD 0.00", "No expenses
 * found", "All caught up"), as if the business had spent nothing. Journey J6: a refused screen says "No access, ask
 * the owner", never zeros. A read that failed for another reason says it could not load, never zeros either.
 *
 * BUG-073: the toolbar's buttons do nothing ("Filters", the month label "May 2026" hard-coded in every month) or the
 * wrong thing ("Import bank feed" downloads the CSV export). Each one works or goes.
 *
 * BUG-072 (fixed by removal): figures the server never sent are shown as data: "67% of monthly budget" (the total
 * divided by 1.5 times itself, with or without a budget), "exceeds travel policy by $..." (a 500 limit invented in the
 * browser, in dollars), "categoryies". The expenses page shows no figure that is not read from the server.
 *
 * Mounted on the real page; only the client calls, next/navigation, sonner, the upload hooks and the cached business
 * are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Expense } from "@/lib/client";


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
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => ({ id: "biz_hub3_truth", name: "Truth Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
  getStoredBusinessId: () => "biz_hub3_truth",
}));

import ExpensesInboxPage from "../page";

const ok = <T,>(data: T) => ({ data, error: null });
const READ_REFUSAL = "Insufficient permissions: expenses requires read access (you have none)";
const refused = { data: null, error: READ_REFUSAL, status: 403 };

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_1",
    description: "Hotel stay",
    amount: 600,
    currency: "TTD",
    date: "2026-11-20T00:00:00.000Z",
    vendor: "Hyatt",
    paymentMethod: "card",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: null,
    receiptUrl: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    ...over,
  } as Expense;
}

function allowed(expenses: Expense[] = [], total = 0) {
  client.fetchExpenses.mockResolvedValue(ok({ data: expenses, total: expenses.length, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total, count: expenses.length, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
}

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
});

afterEach(() => cleanup());

const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";

async function mountPage() {
  const view = render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
  return view;
}

describe("BUG-064 / J6: a member refused the expenses read sees no access, never zeros", () => {
  beforeEach(() => {
    client.fetchExpenses.mockResolvedValue(refused);
    client.fetchExpenseCategories.mockResolvedValue(refused);
    client.fetchExpenseSummary.mockResolvedValue(refused);
    client.fetchVendorAnalytics.mockResolvedValue(refused);
    client.fetchExpenseBudgets.mockResolvedValue(refused);
    client.fetchMarginAnalysis.mockResolvedValue(refused);
    client.fetchRecurringExpenses.mockResolvedValue(refused);
  });

  it("says 'No access - ask the owner' and shows no amount, no count and no empty list", async () => {
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/no access/i));
    expect(text()).toMatch(/ask (the|your) owner/i);
    expect(text()).not.toMatch(/0\.00/);
    expect(text()).not.toMatch(/no expenses found/i);
    expect(text()).not.toMatch(/all caught up/i);
    expect(text()).not.toMatch(/all receipts attached/i);
    expect(document.querySelector('[data-state="no-access"]')).toBeTruthy();
  });

  it("the no-access state is the same on the Categories and Recurring views", async () => {
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/no access/i));
    // The views are not offered to a member who may not read expenses: there is nothing behind them.
    expect(screen.queryByRole("tab", { name: "Categories" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Recurring" })).toBeNull();
    expect(text()).not.toMatch(/create category/i);
  });
});

describe("BUG-064: a read that failed for another reason says it could not load, never zeros", () => {
  it("a server error is said, with no amount and no empty list", async () => {
    allowed();
    client.fetchExpenses.mockResolvedValue({ data: null, error: "Internal server error", status: 500 });
    client.fetchExpenseSummary.mockResolvedValue({ data: null, error: "Internal server error", status: 500 });
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/couldn't load expenses/i));
    expect(text()).not.toMatch(/0\.00/);
    expect(text()).not.toMatch(/no expenses found/i);
    expect(text()).not.toMatch(/no access/i);
  });
});

describe("BUG-072: no figure the server did not send", () => {
  it("no budget share is invented: there is no '% of monthly budget' with no budget set", async () => {
    allowed([expense()], 600);
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/hotel stay/i));
    expect(text()).not.toMatch(/% of (your )?(monthly )?budget/i);
  });

  it("no travel policy is invented for a large expense without a receipt", async () => {
    allowed([expense({ amount: 600, receiptUrl: undefined })], 600);
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/hotel stay/i));
    expect(text()).not.toMatch(/travel policy/i);
    expect(text()).not.toMatch(/over policy/i);
  });

  it("the over-budget count is spelled from the server's budgets ('categories', never 'categoryies')", async () => {
    allowed([expense()], 600);
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/hotel stay/i));
    expect(text()).not.toMatch(/categoryies/i);
    expect(text()).toMatch(/0 categories/i);
  });

  it("the spend figure is named for the period the server summed, not 'this month'", async () => {
    allowed([expense()], 600);
    await mountPage();
    await waitFor(() => expect(text()).toMatch(/hotel stay/i));
    expect(text()).not.toMatch(/spent this month/i);
    expect(text()).toMatch(/spent.{0,5}30 days/i);
  });
});

describe("BUG-073: the toolbar's buttons work or go", () => {
  it("no hard-coded month: the period is a control, and choosing one reads that period from the server", async () => {
    allowed([expense()], 600);
    await mountPage();
    expect(text()).not.toMatch(/\bMay 2026\b/);
    const period = screen.getByRole("combobox", { name: /time period/i }) as HTMLSelectElement;
    expect(period.value).toBe("30d");
    client.fetchExpenses.mockClear();
    client.fetchExpenseSummary.mockClear();
    fireEvent.change(period, { target: { value: "90d" } });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
    expect(client.fetchExpenses.mock.calls.at(-1)?.[1]).toMatchObject({ period: "90d" });
    await waitFor(() => expect(client.fetchExpenseSummary.mock.calls.at(-1)?.[1]).toBe("90d"));
  });

  it("Filters opens a category filter, and choosing a category reads it from the server", async () => {
    allowed([expense()], 600);
    client.fetchExpenseCategories.mockResolvedValue(ok([{ id: "cat_travel", name: "Travel", color: "#f97316" }]));
    await mountPage();
    const filters = screen.getByRole("button", { name: /^filters$/i });
    expect(filters.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(filters);
    expect(filters.getAttribute("aria-expanded")).toBe("true");
    const category = await screen.findByRole("combobox", { name: /^category$/i });
    await waitFor(() => expect(Array.from((category as HTMLSelectElement).options).map((o) => o.textContent)).toContain("Travel"));
    client.fetchExpenses.mockClear();
    fireEvent.change(category, { target: { value: "cat_travel" } });
    await waitFor(() => expect(client.fetchExpenses.mock.calls.at(-1)?.[1]).toMatchObject({ categoryId: "cat_travel" }));
  });

  it("there is no 'Import bank feed' button: the CSV download is named what it does", async () => {
    allowed([expense()], 600);
    await mountPage();
    expect(screen.queryByRole("button", { name: /import bank feed/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^export csv$/i })).toBeTruthy();
  });
});
