/**
 * EXPENSES-HUB-3 repair round 24 (R23 reviews at 5c0d303; D-315).
 *
 *   R24-1  the client (lib/api.ts) never rejects for a refusal or a network failure: it answers { data: null, error }.
 *          Every write in the folder treats that answer, and a create or update that answers no row, as a failure:
 *          said in the server's words on its own business, nothing said under a switch, never "it went through". A
 *          Drive copy whose hook answers false (its failure) is said. A refused recurring read is a rejected one.
 *   R24-3  the page's search box reaches the read
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense, ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

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
import { ExpensePipeline } from "../components/expense-pipeline";
import { BillPayDialog } from "../components/bill-pay-dialog";
import { ExpenseCategoriesTab } from "../components/expense-categories-tab";
import { ExpenseList } from "../components/expense-list";
import { ExpenseBudgetsTab } from "../components/expense-budgets-tab";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { writeFailure } from "../components/expense-utils";
import ExpensesInboxPage from "../page";

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





// The client's real failure shape (lib/api.ts): an HTTP or network failure resolves, it never rejects.
const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 409 });
const noRow = () => ({ data: null, error: null });

const BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;
const onReload = vi.fn();
beforeEach(() => { onReload.mockReset(); });
const pipelineEl = () => (
  <ExpensePipeline
    businessId="biz_A" expenses={[expense()]} totalExpenses={1} categories={CATS.biz_A} summary={null}
    period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
    searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
    filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
    onReload={onReload} onEdit={vi.fn()} isCurrentBusiness={always}
  />
);
const listEl = () => (
  <ExpenseList
    businessId="biz_A" expenses={[expense({ status: "PAID" })]} totalExpenses={1}
    categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
    filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
    page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
    onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={onReload} isCurrentBusiness={always}
  />
);
const panelEl = () => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={always} />;

type W = { name: string; call: () => ReturnType<typeof vi.fn>; mount: () => void; go: () => Promise<void>; reloads?: boolean };
const WRITES: W[] = [
  { name: "pipeline Mark Paid", call: () => client.updateExpense, mount: () => { render(pipelineEl()); }, reloads: true,
    go: async () => { fireEvent.click((await screen.findAllByRole("button", { name: /^Mark Paid$/i }))[0]); } },
  { name: "pipeline Delete", call: () => client.deleteExpense, mount: () => { render(pipelineEl()); }, reloads: true,
    go: async () => { fireEvent.click((await screen.findAllByRole("button", { name: /^Delete$/i }))[0]); } },
  { name: "list bulk categorize", call: () => client.updateExpense, mount: () => { render(listEl()); }, reloads: false,
    go: async () => {
      fireEvent.click((await screen.findByRole("table", { name: "Expenses list" })).querySelector("button")!);
      fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).options[0]?.textContent === "Assign category...")!, { target: { value: "cat_A_tolls" } });
      fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    } },
  { name: "list inline categorize", call: () => client.updateExpense, mount: () => { render(listEl()); }, reloads: true,
    go: async () => {
      fireEvent.click((await screen.findAllByTitle("Click to change category"))[0]);
      fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "cat_A_fuel")!, { target: { value: "cat_A_tolls" } });
    } },
  { name: "budgets save", call: () => client.upsertExpenseBudget, reloads: true,
    mount: () => { render(<ExpenseBudgetsTab businessId="biz_A" budgets={[]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={onReload} isCurrentBusiness={always} />); },
    go: async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]);
      fireEvent.change(await screen.findByPlaceholderText("5000.00"), { target: { value: "800" } });
      fireEvent.click(screen.getByRole("button", { name: "Save Budget" }));
    } },
  { name: "budgets delete", call: () => client.deleteExpenseBudget, reloads: true,
    mount: () => { render(<ExpenseBudgetsTab businessId="biz_A" budgets={[BUDGET]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={onReload} isCurrentBusiness={always} />); },
    go: async () => { fireEvent.click(document.querySelector("button svg.lucide-trash-2, button svg.lucide-trash2")!.closest("button")!); } },
  { name: "categories Add", call: () => client.createExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={always} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    go: async () => {
      fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
      fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    } },
  { name: "categories delete", call: () => client.deleteExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={always} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    go: async () => { fireEvent.click(screen.getByRole("button", { name: "Delete category Fuel A" })); } },
  { name: "Pay", call: () => finance.payBill,
    mount: () => {
      client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
      render(<BillPayDialog businessId="biz_A" bill={expense()} onClose={vi.fn()} onPaid={onReload} isCurrentBusiness={always} />);
    },
    reloads: true,
    go: async () => {
      const pay = await screen.findByRole("button", { name: /^Pay$/ });
      await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(pay);
    } },
  { name: "recurring Cancel", call: () => client.cancelRecurringExpense, mount: () => { render(panelEl()); },
    go: async () => { fireEvent.click(await screen.findByRole("button", { name: /^Cancel$/i })); } },
  { name: "recurring Run Now", call: () => client.runRecurringExpenseNow, mount: () => { render(panelEl()); },
    go: async () => { fireEvent.click(await screen.findByRole("button", { name: /Run Now/i })); } },
];

describe("R24-1: a write the server refuses, in the client's real shape ({ data: null, error })", () => {
  for (const w of WRITES) {
    it(`${w.name}: says why, never that it went through`, async () => {
      w.call().mockResolvedValue(refusedAnswer());
      w.mount();
      await w.go();
      await waitFor(() => expect(w.call()).toHaveBeenCalled());
      // The refusal's words lead the toast (a failure-kit refusal adds its toast options).
      await waitFor(() => expect(vi.mocked(toast.error).mock.calls.some(([m]) => String(m).includes(WORDS))).toBe(true));
      expect(toast.success, `${w.name} said it went through`).not.toHaveBeenCalled();
      if (w.reloads) expect(onReload, "reloaded as if it went through").not.toHaveBeenCalled();
    });
    it(`${w.name}: refused under a silent switch, says nothing`, async () => {
      const pending = deferred<unknown>();
      w.call().mockReturnValue(pending.promise);
      w.mount();
      await w.go();
      await waitFor(() => expect(w.call()).toHaveBeenCalled());
      ws.bid = "biz_B";
      await act(async () => { pending.resolve(refusedAnswer()); });
      await settle();
      noToast2();
    });
  }
});

const sheet = (extra: Partial<React.ComponentProps<typeof ExpenseFormSideSheet>> = {}) => {
  const onSaved = vi.fn();
  render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={onSaved} isCurrentBusiness={always} {...extra} />);
  return { onSaved };
};
const withReceipt = () => {
  const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return { receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1", receiptFile: file };
};

describe("R24-1: the sheet's save, in the client's real shapes", () => {
  it("a create that answers no row is not saved", async () => {
    client.createExpense.mockResolvedValue(noRow());
    const { onSaved } = sheet();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save expense"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("an update that answers no row is not saved", async () => {
    client.updateExpense.mockResolvedValue(noRow());
    const { onSaved } = sheet({ editingExpense: expense({ status: "PAID" }) });
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save expense"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("a schedule that answers no row is said as not created", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    client.createRecurringExpense.mockResolvedValue(noRow());
    sheet();
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("its recurring schedule was not created")));
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("a bill whose extra fields answer no row says they were not saved", async () => {
    finance.createBill.mockResolvedValue(ok({ id: "exp_A_bill" }));
    client.updateExpense.mockResolvedValue(noRow());
    sheet({ initialKind: "bill" });
    fill("A supplier", "300");
    fireEvent.change(screen.getByPlaceholderText(/tag/i), { target: { value: "urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Record bill" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("its tags were not saved") /* R25-7: tags only, so no receipt is named */));
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("a Drive copy that answers false (the hook's failure) is said", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    drive.uploadToDrive.mockResolvedValue(false);
    sheet({ prefill: withReceipt() });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Expense saved, but its Drive copy was not made"));
  });
  it("a Drive copy that answers false under a silent switch says nothing", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    const copy = deferred<boolean>();
    drive.uploadToDrive.mockReturnValue(copy.promise);
    sheet({ prefill: withReceipt() });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(drive.uploadToDrive).toHaveBeenCalled());
    await settle();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    ws.bid = "biz_B";
    await act(async () => { copy.resolve(false); });
    await settle();
    noToast2();
  });
});

describe("R24-1: the recurring panel's read, refused in the client's real shape", () => {
  // R25-2 (correction, not a weakening): a refused read is said, never shown as "No recurring expenses".
  it("says it could not load, never the empty state (R25-2)", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(refusedAnswer());
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(/Couldn't load recurring expenses/)).toBeTruthy();
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
  });
  it("refused for A after the panel shows B, leaves B loading", async () => {
    const readA = deferred<unknown>();
    client.fetchRecurringExpenses.mockImplementation((b: string) => (b === "biz_A" ? readA.promise : new Promise(() => {})));
    const el = (b: string) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />;
    const view = render(el("biz_A"));
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_A"));
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => { readA.resolve(refusedAnswer()); });
    await settle();
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
  });
});

describe("R24-3: the page's search reaches the read", () => {
  it("typing 'toner' reads expenses with search 'toner'", async () => {
    render(<ExpensesInboxPage />);
    const LONG = { timeout: 10000 };
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    const box = await screen.findByPlaceholderText(/search/i, {}, LONG);
    fireEvent.change(box, { target: { value: "toner" } });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.objectContaining({ search: "toner" })), LONG);
  }, 30000);
});

describe("R24-1: writeFailure, the one reading of a write's answer", () => {
  it("names a refusal in the server's words, no answer, and a missing row where the row is the success", () => {
    expect(writeFailure({ data: null, error: WORDS, status: 409 }, "save this")).toBe(WORDS);
    expect(writeFailure(null, "save this")).toBe("Couldn't save this.");
    expect(writeFailure({ data: null, error: null }, "save this", true)).toBe("Couldn't save this.");
    expect(writeFailure({ data: null, error: null }, "delete this"), "a delete needs no row").toBeNull();
    expect(writeFailure({ data: { id: "x" }, error: null }, "save this", true)).toBeNull();
  });
});

describe("R24-1: the list's bulk categorize, partly refused", () => {
  it("says how many were not categorized, in the server's words", async () => {
    client.updateExpense.mockImplementation(async (_b: string, id: string) => (id === "exp_A2" ? refusedAnswer() : ok(expense({ id }))));
    render(
      <ExpenseList
        businessId="biz_A" expenses={[expense({ id: "exp_A1", status: "PAID" }), expense({ id: "exp_A2", status: "PAID", description: "Second" })]} totalExpenses={2}
        categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
        filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
        page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
        onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={onReload} isCurrentBusiness={always}
      />,
    );
    fireEvent.click((await screen.findByRole("table", { name: "Expenses list" })).querySelector("button")!);
    fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).options[0]?.textContent === "Assign category...")!, { target: { value: "cat_A_tolls" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`1 of 2 expenses were not categorized: ${WORDS}`));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onReload, "the list is read again to show which went through").toHaveBeenCalled();
  });
});

describe("R24-1: the sheet's create answering no row under a silent switch", () => {
  it("says nothing", async () => {
    const pending = deferred<unknown>();
    client.createExpense.mockReturnValue(pending.promise);
    const { onSaved } = sheet();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalled());
    ws.bid = "biz_B";
    await act(async () => { pending.resolve(noRow()); });
    await settle();
    noToast2();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
