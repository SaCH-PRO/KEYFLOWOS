/**
 * EXPENSES-HUB-3 repair round 19 (R18 reviews at c2a3e49).
 *
 *   R19-1  the modal, after an announced switch, keeps none of A's form: Save after A's save lands sends nothing for
 *          B with A's data
 *   R19-2  the modal's refused save answering after the switch says nothing
 *   R19-3  a refused start says the truth as the component shows it: blocked storage says it could not check which
 *          business is open; a switch says the business changed (M21: "refusedStart always says changed" dies)
 *   R19-5  every single-write surface's reply guard is the start check's test (given check and stored id): under a
 *          silent switch (the stored id already B, the given check still A) a reply says nothing; one per surface
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense, ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

const ZONES: Record<string, string> = vi.hoisted(() => ({ biz_A: "America/Port_of_Spain", biz_B: "America/Port_of_Spain" } as Record<string, string>));
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
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: ZONES[ws.bid] ?? "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
}));

import { toast } from "sonner";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import { ExpensePipeline } from "../components/expense-pipeline";
import { ExpenseFormModal } from "../components/expense-form-modal";
import { BillPayDialog } from "../components/bill-pay-dialog";
import { ExpenseCategoriesTab } from "../components/expense-categories-tab";
import { ExpenseList } from "../components/expense-list";
import { ExpenseBudgetsTab } from "../components/expense-budgets-tab";
import ExpensesInboxPage from "../page";
import { BUSINESS_CHANGED_ELSEWHERE, BUSINESS_UNREADABLE } from "../components/expense-utils";

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

describe("R19-1: the modal keeps none of A's form after an announced switch", () => {
  it("A's save lands after the switch; Save then sends nothing for B with A's data", async () => {
    const create = deferred<unknown>();
    client.createExpense.mockReturnValueOnce(create.promise).mockResolvedValue(ok({ id: "exp_B_new" }));
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fill("A rent", "500");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledTimes(1));
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => { create.resolve(ok({ id: "exp_A_new" })); });
    await settle();
    expect((screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement).value, "A's form is on B").toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await settle();
    expect(client.createExpense.mock.calls.filter((c) => c[0] === "biz_B" && (c[1] as { description?: string }).description === "A rent")).toEqual([]);
  });
});

describe("R19-1b: the modal's edit of A's expense, after an announced switch", () => {
  it("is no longer an edit: Save sends no update of A's expense under B", async () => {
    client.updateExpense.mockResolvedValue(ok(expense({ status: "PAID" })));
    client.createExpense.mockResolvedValue(ok({ id: "exp_B_new" }));
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={expense({ status: "PAID" })} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await settle();
    expect(screen.queryByRole("button", { name: "Update" }), "still an edit of A's expense").toBeNull();
    fill("B rent", "40");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await settle();
    expect(client.updateExpense).not.toHaveBeenCalled();
  });
});

describe("R19-2: the modal's refused save after the switch", () => {
  it("says nothing on B", async () => {
    const create = deferred<unknown>();
    client.createExpense.mockReturnValue(create.promise);
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalled());
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => { create.resolve({ data: null, error: "Amount can't change on a posted expense", status: 409 }); });
    await settle();
    noToast2();
  });
});

describe("R19-3: a refused start says the truth, as the component shows it", () => {
  const openCategories = () => render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={always} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />);
  it("blocked storage: Add category says it could not check which business is open, and sends nothing", async () => {
    openCategories();
    blocked.on = true;
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await settle();
    expect(client.createExpenseCategory).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(BUSINESS_UNREADABLE);
    expect(toast.error).not.toHaveBeenCalledWith(BUSINESS_CHANGED_ELSEWHERE);
  });
  it("a switch: Add category says the business changed", async () => {
    openCategories();
    ws.bid = "biz_B";
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await settle();
    expect(toast.error).toHaveBeenCalledWith(BUSINESS_CHANGED_ELSEWHERE);
  });
  it("Pay with blocked storage says it could not check, and pays nothing", async () => {
    client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
    render(<BillPayDialog businessId="biz_A" bill={expense()} onClose={vi.fn()} onPaid={vi.fn()} isCurrentBusiness={always} />);
    const pay = await screen.findByRole("button", { name: /^Pay$/ });
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
    blocked.on = true;
    fireEvent.click(pay);
    await settle();
    expect(finance.payBill).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(BUSINESS_UNREADABLE);
  });
});

/** One write per single-write surface: held reply, a silent switch (the stored id moves; the given check does not). */
type Reply = { name: string; call: () => ReturnType<typeof vi.fn>; mount: () => void; go: () => Promise<void> };
const REPLIES: Reply[] = [
  {
    name: "pipeline Mark Paid", call: () => client.updateExpense,
    mount: () => {
      render(
        <ExpensePipeline
          businessId="biz_A" expenses={[expense()]} totalExpenses={1} categories={CATS.biz_A} summary={null}
          period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
          searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
          filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
          onReload={vi.fn()} onEdit={vi.fn()} isCurrentBusiness={always}
        />,
      );
    },
    go: async () => { fireEvent.click((await screen.findAllByRole("button", { name: /^Mark Paid$/i }))[0]); },
  },
  {
    name: "recurring Run Now", call: () => client.runRecurringExpenseNow,
    mount: () => { render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={always} />); },
    go: async () => { fireEvent.click(await screen.findByRole("button", { name: /Run Now/i })); },
  },
  {
    name: "list inline categorize", call: () => client.updateExpense,
    mount: () => {
      render(
        <ExpenseList
          businessId="biz_A" expenses={[expense({ status: "PAID" })]} totalExpenses={1}
          categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
          filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
          page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
          onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={vi.fn()} isCurrentBusiness={always}
        />,
      );
    },
    go: async () => {
      fireEvent.click((await screen.findAllByTitle("Click to change category"))[0]);
      fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "cat_A_fuel")!, { target: { value: "cat_A_tolls" } });
    },
  },
  {
    name: "budgets save", call: () => client.upsertExpenseBudget,
    mount: () => { render(<ExpenseBudgetsTab businessId="biz_A" budgets={[]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={vi.fn()} isCurrentBusiness={always} />); },
    go: async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]);
      fireEvent.change(await screen.findByPlaceholderText("5000.00"), { target: { value: "800" } });
      fireEvent.click(screen.getByRole("button", { name: "Save Budget" }));
    },
  },
  {
    name: "Add category", call: () => client.createExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={always} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    go: async () => {
      fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
      fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    },
  },
  {
    name: "Pay", call: () => finance.payBill,
    mount: () => {
      client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
      render(<BillPayDialog businessId="biz_A" bill={expense()} onClose={vi.fn()} onPaid={vi.fn()} isCurrentBusiness={always} />);
    },
    go: async () => {
      const pay = await screen.findByRole("button", { name: /^Pay$/ });
      await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(pay);
    },
  },
];

describe("R19-5: replies under a silent switch say nothing", () => {
  for (const r of REPLIES) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`${r.name} that ${outcome}`, async () => {
        const pending = deferred<unknown>();
        r.call().mockReturnValue(pending.promise as never);
        r.mount();
        await r.go();
        await waitFor(() => expect(r.call()).toHaveBeenCalled());
        ws.bid = "biz_B"; // the stored id moves; the given check still says A
        await act(async () => {
          if (outcome === "answers") pending.resolve(r.name === "Add category" ? ok({ id: "cat_new", name: "Supplies", color: "#f97316" }) : ok(null));
          else pending.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToast2();
      });
    }
  }

  it("the page's receipt upload: a reply under a silent switch says nothing and opens no sheet", async () => {
    const up = deferred<unknown>();
    upload.uploadFile.mockReturnValue(up.promise);
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    const input = Array.from(document.querySelectorAll('input[type="file"]')).find((i) => i.getAttribute("capture") !== null || true) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalled());
    ws.bid = "biz_B";
    await act(async () => { up.resolve({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} }); });
    await settle();
    noToast2();
    expect(screen.queryByRole("dialog"), "a sheet opened for B with A's receipt").toBeNull();
  });
});
