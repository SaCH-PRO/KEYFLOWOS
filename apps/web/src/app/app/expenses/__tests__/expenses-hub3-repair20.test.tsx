/**
 * EXPENSES-HUB-3 repair round 20 (R19 reviews at 7a0cb4e).
 *
 *   R20-1  every remaining reply site judges its reply by the start check's test: under a silent switch (the stored id
 *          already B, the given check still A) the reply says nothing, one pin per site
 *   R20-2  the modal, A -> B -> A, gives an Add form: the edit of A's expense ended at the first switch, for good
 *   R20-3  the modal's currency follows the business it shows
 *   R20-4  the recurring panel re-rendered A -> B shows none of A's schedules, even before B's read answers
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
import { ExpenseFormModal } from "../components/expense-form-modal";
import { BillPayDialog } from "../components/bill-pay-dialog";
import { ExpenseCategoriesTab } from "../components/expense-categories-tab";
import { ExpenseList } from "../components/expense-list";
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



type Site = { name: string; call: () => ReturnType<typeof vi.fn>; mount: () => { onPaid?: ReturnType<typeof vi.fn>; onSaved?: ReturnType<typeof vi.fn>; onClose?: ReturnType<typeof vi.fn> } | void; go: () => Promise<void>; answer?: () => unknown; outcomes?: ("answers" | "throws")[] };
const pipeline = () => render(
  <ExpensePipeline
    businessId="biz_A" expenses={[expense()]} totalExpenses={1} categories={CATS.biz_A} summary={null}
    period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
    searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
    filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
    onReload={vi.fn()} onEdit={vi.fn()} isCurrentBusiness={always}
  />,
);
const list = () => render(
  <ExpenseList
    businessId="biz_A" expenses={[expense({ status: "PAID" })]} totalExpenses={1}
    categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
    filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
    page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
    onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={vi.fn()} isCurrentBusiness={always}
  />,
);
const BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;
const modal = (extra: Partial<React.ComponentProps<typeof ExpenseFormModal>> = {}) => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<ExpenseFormModal businessId="biz_A" categories={[]} editingExpense={null} onClose={onClose} onSaved={onSaved} isCurrentBusiness={always} {...extra} />);
  return { onSaved, onClose };
};
const SITES: Site[] = [
  {
    name: "pipeline Delete", call: () => client.deleteExpense,
    mount: () => { vi.spyOn(window, "confirm").mockReturnValue(true); pipeline(); },
    go: async () => { fireEvent.click((await screen.findAllByRole("button", { name: /^Delete$/i }))[0]); },
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
    name: "recurring Cancel", call: () => client.cancelRecurringExpense,
    mount: () => { vi.spyOn(window, "confirm").mockReturnValue(true); render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={always} />); },
    go: async () => { fireEvent.click(await screen.findByRole("button", { name: /^Cancel$/i })); },
  },
  {
    name: "list bulk categorize", call: () => client.updateExpense,
    mount: () => { list(); },
    go: async () => {
      fireEvent.click((await screen.findByRole("table", { name: "Expenses list" })).querySelector("button")!);
      fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).options[0]?.textContent === "Assign category...")!, { target: { value: "cat_A_tolls" } });
      fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    },
  },
  {
    name: "budgets delete", call: () => client.deleteExpenseBudget,
    mount: () => { render(<ExpenseBudgetsTab businessId="biz_A" budgets={[BUDGET]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={vi.fn()} isCurrentBusiness={always} />); },
    go: async () => { fireEvent.click(document.querySelector("button svg.lucide-trash-2, button svg.lucide-trash2")!.closest("button")!); },
  },
  {
    name: "categories delete", call: () => client.deleteExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={always} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    go: async () => { fireEvent.click(screen.getByRole("button", { name: "Delete category Fuel A" })); },
  },
  {
    name: "Pay", call: () => finance.payBill,
    mount: () => {
      client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
      const onPaid = vi.fn();
      render(<BillPayDialog businessId="biz_A" bill={expense()} onClose={vi.fn()} onPaid={onPaid} isCurrentBusiness={always} />);
      return { onPaid };
    },
    go: async () => {
      const pay = await screen.findByRole("button", { name: /^Pay$/ });
      await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(pay);
    },
    answer: () => ok(expense({ status: "PAID" })),
  },
  {
    name: "the modal's refused save", call: () => client.createExpense,
    mount: () => modal(),
    go: async () => { fill(); fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => ({ data: null, error: "Amount can't change on a posted expense", status: 409 }),
    outcomes: ["answers"],
  },
  {
    name: "the modal's save", call: () => client.createExpense,
    mount: () => modal(),
    go: async () => { fill(); fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => ok({ id: "exp_A_new" }),
  },
  {
    name: "the modal's schedule", call: () => client.createRecurringExpense,
    mount: () => { client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" })); return modal(); },
    go: async () => {
      fill();
      fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
      fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    },
    answer: () => ok({ id: "rec_A_new" }),
  },
  {
    name: "the modal's receipt upload", call: () => upload.uploadFile,
    mount: () => modal(),
    go: async () => { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } }); },
    answer: () => ({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} }),
  },
  {
    name: "the modal's Extract with AI", call: () => client.extractReceipt,
    mount: () => modal({ editingExpense: expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" }) }),
    go: async () => { fireEvent.click(screen.getAllByRole("button").find((b) => /Extract with AI/.test(b.textContent ?? ""))!); },
    answer: () => ok({ invoiceData: { total: 99, lineItems: [{ description: "A toner" }] }, confidence: 0.9 }),
  },
];

describe("R20-1: every remaining reply site, under a silent switch", () => {
  for (const site of SITES) {
    for (const outcome of site.outcomes ?? (["answers", "throws"] as const)) {
      it(`${site.name} that ${outcome} says nothing`, async () => {
        const pending = deferred<unknown>();
        site.call().mockReturnValue(pending.promise as never);
        const handles = site.mount() || {};
        await site.go();
        await waitFor(() => expect(site.call()).toHaveBeenCalled());
        ws.bid = "biz_B"; // the stored id moves; the given check still says A
        await act(async () => {
          if (outcome === "answers") pending.resolve(site.answer ? site.answer() : ok(null));
          else pending.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToast2();
        expect(toast.info).not.toHaveBeenCalled();
        if (handles.onPaid) expect(handles.onPaid, "A's bill reported paid on B").not.toHaveBeenCalled();
        if (handles.onSaved) expect(handles.onSaved).not.toHaveBeenCalled();
        if (handles.onClose) expect(handles.onClose).not.toHaveBeenCalled();
      });
    }
  }
});

describe("R20-2: the modal, A -> B -> A", () => {
  it("gives an Add form: no update of A's expense with blank or new fields", async () => {
    client.updateExpense.mockResolvedValue(ok(expense({ status: "PAID" })));
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={expense({ status: "PAID" })} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await settle();
    ws.bid = "biz_A";
    view.rerender(el("biz_A"));
    await settle();
    expect(screen.queryByRole("button", { name: "Update" }), "back on A, the cleared edit came back").toBeNull();
    fill("A new", "10");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await settle();
    expect(client.updateExpense).not.toHaveBeenCalled();
  });
});

describe("R20-3: the modal's currency", () => {
  it("follows the business it shows", async () => {
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    expect(screen.getByText(/Amount \(TTD\)/)).toBeTruthy();
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await settle();
    expect(screen.getByText(/Amount \(USD\)/), "B's form names A's currency").toBeTruthy();
  });
});

describe("R20-4: the recurring panel, re-rendered A -> B", () => {
  it("shows none of A's schedules before B's read answers", async () => {
    const readB = deferred<unknown>();
    client.fetchRecurringExpenses.mockImplementation((b: string) => (b === "biz_A" ? Promise.resolve(ok([SCHEDULE])) : readB.promise));
    const el = (b: string) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />;
    const view = render(el("biz_A"));
    await screen.findByRole("button", { name: /Run Now/i });
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await settle();
    expect(screen.queryByRole("button", { name: /Run Now/i }), "A's schedule can be run under B").toBeNull();
    expect(screen.queryByText("Rent")).toBeNull();
  });
});
