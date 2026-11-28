/**
 * EXPENSES-HUB-3 repair round 26 (R25 reviews at 360f85e; D-308, D-315), the page side.
 *
 *   R26-5  the Recurring list's Retry sets the list loading: a double click sends one read (and R22-1 now also holds
 *          that A's failure is not said on B)
 *   R26-6  the hub's "New recurring expense" is offered only when the Recurring list's read answered
 *   R26-7  the bill-extras notice's was/were: a bill with a receipt only reads "its receipt was not saved"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

const ZONES: Record<string, string> = vi.hoisted(() => ({ biz_A: "America/Port_of_Spain", biz_B: "America/Port_of_Spain" } as Record<string, string>));
const CURRENCIES: Record<string, string> = vi.hoisted(() => ({ biz_A: "TTD", biz_B: "USD" } as Record<string, string>));
const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
  fetchFinanceAccounts: vi.fn(),
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
const drive = vi.hoisted(() => ({ uploadToDrive: vi.fn() }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: drive.uploadToDrive }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
const finance = vi.hoisted(() => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/api/finance", () => finance);
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: CURRENCIES[ws.bid] ?? "TTD", timezone: ZONES[ws.bid] ?? "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
}));

import { toast } from "sonner";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
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
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
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





function fill(description = "A rent", amount = "500") {
  fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: description } });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: amount } });
}
afterEach(() => {
  ZONES.biz_A = "America/Port_of_Spain";
  vi.useRealTimers();
});


afterEach(() => { blocked.on = false; });
const always = () => true;





const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const LONG = { timeout: 10000 };

describe("R26-5: the Recurring list's Retry", () => {
  it("a double click sends one read", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(refusedAnswer());
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    const before = client.fetchRecurringExpenses.mock.calls.length;
    client.fetchRecurringExpenses.mockReturnValue(new Promise(() => {}));
    fireEvent.click(retry);
    fireEvent.click(retry);
    await settle();
    expect(client.fetchRecurringExpenses.mock.calls.length - before, "two reads for one list").toBe(1);
    expect(screen.queryByRole("button", { name: "Retry" }), "Retry offered while the read is out").toBeNull();
  });
});

describe("R26-6: the hub's 'New recurring expense'", () => {
  const open = async () => {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
  };
  it("refused list: not offered", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(refusedAnswer());
    await open();
    expect(await screen.findByText(/Couldn't load recurring expenses/, {}, LONG)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New recurring expense/ })).toBeNull();
  }, 30000);
  it("no-access list: not offered", async () => {
    client.fetchRecurringExpenses.mockResolvedValue({ data: null, error: "Insufficient permissions: expenses requires read access (you have none)", status: 403 });
    await open();
    await waitFor(() => expect(screen.queryByText(/access/i)).toBeTruthy(), LONG);
    expect(screen.queryByRole("button", { name: /New recurring expense/ })).toBeNull();
  }, 30000);
  it("control: a list that answers offers it", async () => {
    await open();
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
  }, 30000);
});

describe("R26-7: the bill-extras notice's was/were", () => {
  it("a bill with a receipt only: 'its receipt was not saved'", async () => {
    finance.createBill.mockResolvedValue(ok({ id: "exp_A_bill" }));
    client.updateExpense.mockResolvedValue(refusedAnswer());
    render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={always} initialKind="bill" prefill={{ receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1" }} />);
    fill("A supplier", "300");
    fireEvent.click(screen.getByRole("button", { name: "Record bill" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("its receipt was not saved")));
  });
});
