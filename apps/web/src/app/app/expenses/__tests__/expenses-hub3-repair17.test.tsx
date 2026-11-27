/**
 * EXPENSES-HUB-3 repair round 17 (R16 reviews at 4e1ef6b): one start check on every write, and the multi-step save.
 *
 *   R17-1  a save whose first write has landed for A completes its remaining steps for A after the switch to B (no
 *          recurring bill left without its schedule, no schedule without its receipt's Drive copy), silently: no
 *          toast, close or reload on B
 *   R17-2  every write in the folder checks, before it sends, that its business is still the one chosen (the stored
 *          id, which another tab can change before its storage event arrives): with the stored id already B, nothing
 *          is sent for A; a control with no switch sends
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense, ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
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
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import { ExpenseCategoriesTab } from "../components/expense-categories-tab";
import { ExpenseList } from "../components/expense-list";
import { ExpensePipeline } from "../components/expense-pipeline";
import { ExpenseFormModal } from "../components/expense-form-modal";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { ExpenseBudgetsTab } from "../components/expense-budgets-tab";

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
const silentSwitch = (bid: string) => { ws.bid = bid; };
const sheet = (b: string, extra: Partial<React.ComponentProps<typeof ExpenseFormSideSheet>> = {}) => (
  <ExpenseFormSideSheet businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} {...extra} />
);
function fill(description = "A rent", amount = "500") {
  fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: description } });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: amount } });
}

describe("R17-1: a save whose first write has landed completes for A, silently", () => {
  it("(a) a recurring bill with tags: the extra update is held, B is announced, and the schedule is still created for A", async () => {
    finance.createBill.mockResolvedValue(ok({ id: "exp_A_bill" }));
    const extra = deferred<unknown>();
    client.updateExpense.mockReturnValue(extra.promise);
    client.createRecurringExpense.mockResolvedValue(ok({ id: "rec_A_new" }));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const view = render(sheet("biz_A", { initialKind: "bill", onSaved, onClose }));
    fill("A supplier", "300");
    fireEvent.change(screen.getByPlaceholderText("tag1, tag2, ..."), { target: { value: "supplies" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record bill" }));
    await waitFor(() => expect(client.updateExpense).toHaveBeenCalledWith("biz_A", "exp_A_bill", expect.objectContaining({ tags: ["supplies"] })));
    ws.bid = "biz_B";
    view.rerender(sheet("biz_B", { initialKind: "bill", onSaved, onClose }));
    await act(async () => { extra.resolve(ok(expense({ id: "exp_A_bill" }))); });
    await settle();
    expect(client.createRecurringExpense, "the bill is left without its schedule").toHaveBeenCalledWith("biz_A", expect.anything());
    noToast2();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("(b) a recurring expense with a receipt: the schedule is held, B is announced, and the Drive copy is still made for A", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    const schedule = deferred<unknown>();
    client.createRecurringExpense.mockReturnValue(schedule.promise);
    drive.uploadToDrive.mockResolvedValue(true);
    const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
    const prefill = { receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1", receiptFile: file };
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const view = render(sheet("biz_A", { prefill, onSaved, onClose }));
    fill();
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    view.rerender(sheet("biz_B", { prefill, onSaved, onClose }));
    await act(async () => { schedule.resolve(ok({ id: "rec_A_new" })); });
    await settle();
    expect(drive.uploadToDrive, "the schedule is left without its receipt").toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_A", entityId: "exp_A_new" }));
    noToast2();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a save that has not sent its first write does not start (the R16 start check)", async () => {
    render(sheet("biz_A"));
    fill();
    silentSwitch("biz_B");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await settle();
    expect(client.createExpense).not.toHaveBeenCalled();
  });
});

type Start = { name: string; call: () => ReturnType<typeof vi.fn>; mount: () => void; go: () => Promise<void> };
const always = () => true;
const STARTS: Start[] = [
  {
    name: "recurring Run Now", call: () => client.runRecurringExpenseNow,
    mount: () => { render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={always} />); },
    go: async () => { fireEvent.click(await screen.findByRole("button", { name: /Run Now/i })); },
  },
  {
    name: "recurring Cancel", call: () => client.cancelRecurringExpense,
    mount: () => { render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={always} />); },
    go: async () => { fireEvent.click(await screen.findByRole("button", { name: /^Cancel$/i })); },
  },
  {
    name: "recurring save (Update)", call: () => client.updateRecurringExpense,
    mount: () => { render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={always} />); },
    go: async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^Update$/ }));
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
    name: "delete category", call: () => client.deleteExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={always} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    go: async () => { fireEvent.click(screen.getByRole("button", { name: "Delete category Fuel A" })); },
  },
  {
    name: "the sheet's Extract with AI", call: () => client.extractReceipt,
    mount: () => { render(sheet("biz_A", { editingExpense: expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" }) })); },
    go: async () => { fireEvent.click(screen.getAllByRole("button").find((b) => /Extract with AI/.test(b.textContent ?? ""))!); },
  },
  {
    name: "the sheet's receipt upload", call: () => upload.uploadFile,
    mount: () => { render(sheet("biz_A")); },
    go: async () => { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } }); },
  },
  {
    name: "the modal's save", call: () => client.createExpense,
    mount: () => { render(<ExpenseFormModal businessId="biz_A" categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />); },
    go: async () => { fill(); fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
  },
  {
    name: "the modal's receipt upload", call: () => upload.uploadFile,
    mount: () => { render(<ExpenseFormModal businessId="biz_A" categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />); },
    go: async () => { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } }); },
  },
  {
    name: "the modal's Extract with AI", call: () => client.extractReceipt,
    mount: () => { render(<ExpenseFormModal businessId="biz_A" categories={[]} editingExpense={expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" })} onClose={vi.fn()} onSaved={vi.fn()} />); },
    go: async () => { fireEvent.click(screen.getAllByRole("button").find((b) => /Extract with AI/.test(b.textContent ?? ""))!); },
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
    name: "budgets delete", call: () => client.deleteExpenseBudget,
    mount: () => {
      const budget = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;
      render(<ExpenseBudgetsTab businessId="biz_A" budgets={[budget]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={vi.fn()} isCurrentBusiness={always} />);
    },
    go: async () => { fireEvent.click(document.querySelector("button svg.lucide-trash-2, button svg.lucide-trash2")!.closest("button")!); },
  },
  ...(["inline", "bulk"] as const).map((how): Start => ({
    name: `the list's ${how} categorize`, call: () => client.updateExpense,
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
      if (how === "inline") {
        fireEvent.click((await screen.findAllByTitle("Click to change category"))[0]);
        fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "cat_A_fuel")!, { target: { value: "cat_A_tolls" } });
      } else {
        fireEvent.click((await screen.findByRole("table", { name: "Expenses list" })).querySelector("button")!);
        fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).options[0]?.textContent === "Assign category...")!, { target: { value: "cat_A_tolls" } });
        fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
      }
    },
  })),
  ...(["Mark Paid", "Delete"] as const).map((label): Start => ({
    name: `the pipeline's ${label}`, call: () => (label === "Delete" ? client.deleteExpense : client.updateExpense),
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
    go: async () => { fireEvent.click((await screen.findAllByRole("button", { name: new RegExp(`^${label}$`, "i") }))[0]); },
  })),
];

describe("R17-2: every write checks the stored business before sending", () => {
  for (const s of STARTS) {
    it(`${s.name}: with the stored id already B, nothing is sent for A`, async () => {
      s.call().mockResolvedValue(ok(null) as never);
      s.mount();
      silentSwitch("biz_B");
      await s.go();
      await settle();
      expect(s.call()).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });
    it(`${s.name}: control, with no switch, it sends`, async () => {
      s.call().mockResolvedValue(ok(null) as never);
      s.mount();
      await s.go();
      await waitFor(() => expect(s.call()).toHaveBeenCalled());
    });
  }
});
