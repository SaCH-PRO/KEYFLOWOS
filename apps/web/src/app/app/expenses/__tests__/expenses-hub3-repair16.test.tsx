/**
 * EXPENSES-HUB-3 repair round 16 (R15 reviews at 89f75fa), the Expenses page.
 *
 *   R16-3  the Add expense sheet's Save checks the business before sending: another tab's switch whose storage event
 *          has not arrived yet (the stored id already says B) sends no createExpense for A, and says why
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

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
  upsertExpenseBudget: vi.fn(),
  deleteExpenseBudget: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
const upload = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: upload.uploadFile, isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, ExpenseCategory[]> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" } as ExpenseCategory],
};


const SCHEDULE = {
  id: "rec_A1", name: "Rent", frequency: "MONTHLY", nextRunDate: "2026-12-01T00:00:00.000Z", isActive: true, runCount: 0,
  failureCount: 0, description: "Rent", amount: 1000, currency: "TTD", createsBill: false,
} as RecurringExpense;
const _BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockImplementation(async (b: string) => ok(CATS[b] ?? []));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockImplementation(async (b: string) => ok(b === "biz_A" ? [SCHEDULE] : []));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });




describe("R16-3: the Add expense sheet checks before sending", () => {
  it("with the stored id already B, Add Expense sends nothing for A and says the business changed", async () => {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    fireEvent.click((await screen.findAllByRole("button", { name: "Add expense" }))[0]);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    ws.bid = "biz_B"; // another tab switched; its storage event has not reached this tab
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await settle();
    expect(client.createExpense).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/business changed in another tab/i));
  });

  it("control: with no switch, Add Expense sends", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    render(<ExpensesInboxPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add expense" }))[0]);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledWith("biz_A", expect.anything()));
  });
});
