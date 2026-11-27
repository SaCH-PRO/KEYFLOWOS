/**
 * R22: ExpenseFormModal is retired (it had no production mount); its tests in this file were removed. The R22
 * PROGRESS on #273 names the side-sheet test that covers each.
 *
 * EXPENSES-HUB-3 repair round 18 (R17 reviews at 1eee70b).
 *
 *   R18-1 MAJOR  a write that asks first (window.confirm) checks the business again after the answer: a switch made
 *                while the confirm was open sends nothing (pipeline Delete, recurring Cancel)
 *   R18-2        the sheet: a save whose first write lands under a silent switch (the stored id already B) still
 *                completes for A and says, closes and reloads nothing
 *   R18-3        the modal: a landed save completes its schedule for A and says nothing on B
 *   R18-5        the sheet's receipt upload consults the given check
 *   R18-6        Pay starts through the shared check: a stored id already B sends nothing, whatever the given check says
 *   R18-8        A's schedule and Drive file are dated in A's zone, taken when the save starts, after the cache holds B
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense, ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

const ZONES: Record<string, string> = vi.hoisted(() => ({ biz_A: "America/Port_of_Spain", biz_B: "America/Port_of_Spain" } as Record<string, string>));
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
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: ZONES[ws.bid] ?? "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import { ExpensePipeline } from "../components/expense-pipeline";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { BillPayDialog } from "../components/bill-pay-dialog";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, ExpenseCategory[]> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" } as ExpenseCategory],
};

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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


const noToast2 = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};



function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_A1", description: "Diesel", amount: 50, currency: "TTD", date: "2026-11-20T00:00:00.000Z", vendor: "Shell",
    paymentMethod: "cash", tags: [], isRecurring: false, status: "BILL", categoryId: "cat_A_fuel",
    createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z", ...over,
  } as Expense;
}
const sheet = (b: string, extra: Partial<React.ComponentProps<typeof ExpenseFormSideSheet>> = {}) => (
  <ExpenseFormSideSheet businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} {...extra} />
);
function fill(description = "A rent", amount = "500") {
  fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: description } });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: amount } });
}


const receipt = () => {
  const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return { receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1", receiptFile: file };
};
afterEach(() => {
  ZONES.biz_A = "America/Port_of_Spain";
  vi.useRealTimers();
});

describe("R18-1 MAJOR: a switch while the confirm is open", () => {
  it("the pipeline's Delete: OK pressed after the switch sends nothing", async () => {
    client.deleteExpense.mockResolvedValue(ok(null));
    vi.spyOn(window, "confirm").mockImplementation(() => { ws.bid = "biz_B"; return true; });
    render(
      <ExpensePipeline
        businessId="biz_A" expenses={[expense()]} totalExpenses={1} categories={CATS.biz_A} summary={null}
        period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
        searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
        filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
        onReload={vi.fn()} onEdit={vi.fn()} isCurrentBusiness={() => true}
      />,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: /^Delete$/i }))[0]);
    await settle();
    expect(window.confirm).toHaveBeenCalled();
    expect(client.deleteExpense).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("the recurring panel's Cancel: OK pressed after the switch sends nothing", async () => {
    client.cancelRecurringExpense.mockResolvedValue(ok(null));
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={() => true} />);
    const cancel = await screen.findByRole("button", { name: /^Cancel$/i });
    vi.spyOn(window, "confirm").mockImplementation(() => { ws.bid = "biz_B"; return true; });
    fireEvent.click(cancel);
    await settle();
    expect(window.confirm).toHaveBeenCalled();
    expect(client.cancelRecurringExpense).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("R18-2: the sheet, a first write landing under a silent switch", () => {
  it("still completes the schedule for A, and says, closes and reloads nothing", async () => {
    const create = deferred<unknown>();
    client.createExpense.mockReturnValue(create.promise);
    client.createRecurringExpense.mockResolvedValue(ok({ id: "rec_A_new" }));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(sheet("biz_A", { onSaved, onClose, isCurrentBusiness: () => true }));
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B"; // another tab; no event yet, so the hook's check still says A
    await act(async () => { create.resolve(ok({ id: "exp_A_new" })); });
    await settle();
    expect(client.createRecurringExpense).toHaveBeenCalledWith("biz_A", expect.anything());
    noToast2();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("R18-5: the sheet's receipt upload consults the given check", () => {
  it("a given check that says no sends no upload, though the stored id is A", async () => {
    render(sheet("biz_A", { isCurrentBusiness: () => false }));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } });
    await settle();
    expect(upload.uploadFile).not.toHaveBeenCalled();
  });
});

describe("R18-6: Pay starts through the shared check", () => {
  it("with the stored id already B, nothing is paid, though the given check says A", async () => {
    client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
    render(<BillPayDialog businessId="biz_A" bill={expense()} onClose={vi.fn()} onPaid={vi.fn()} isCurrentBusiness={() => true} />);
    const pay = await screen.findByRole("button", { name: /^Pay$/ });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
    ws.bid = "biz_B";
    fireEvent.click(pay);
    await settle();
    expect(finance.payBill).not.toHaveBeenCalled();
  });
});

describe("R18-8: A's zone, taken when the save starts", () => {
  it("the schedule's next run and the Drive file are dated in A's zone after the cache holds B", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T20:00:00.000Z")); // the 21st in Tokyo, the 20th in Trinidad
    ZONES.biz_A = "Asia/Tokyo";
    const create = deferred<unknown>();
    client.createExpense.mockReturnValue(create.promise);
    client.createRecurringExpense.mockResolvedValue(ok({ id: "rec_A_new" }));
    drive.uploadToDrive.mockResolvedValue(true);
    const prefill = receipt();
    const view = render(sheet("biz_A", { prefill }));
    fill();
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-10-21" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B"; // the cache now holds B
    view.rerender(sheet("biz_B", { prefill }));
    await act(async () => { create.resolve(ok({ id: "exp_A_new" })); });
    await settle();
    const body = client.createRecurringExpense.mock.calls[0]?.[1] as { nextRunDate?: string };
    expect(body?.nextRunDate, "the schedule was dated in Trinidad's day, not A's (Tokyo)").toBe("2026-12-21");
    const upload = drive.uploadToDrive.mock.calls[0]?.[0] as { fileName?: string };
    expect(upload?.fileName).toMatch(/-2026-11-21\.jpg$/);
  });

});
