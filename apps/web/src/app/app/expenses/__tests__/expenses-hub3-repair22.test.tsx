/**
 * EXPENSES-HUB-3 repair round 22 (R21 reviews at 8a87fa1).
 *
 *   R22-1  the recurring panel's read that fails for A after the panel shows B leaves B's loading as it is: no empty
 *          state while B's own read is out
 *   R22-2  the sheet's Extract that throws under a switch changes nothing of the sheet, as its reply does
 *   R22-3  the given check's half of every start and reply guard: this tab switched A -> B, another tab switched back
 *          to A, and A's held reply lands before the storage event. The stored id reads A, this tab shows B: nothing
 *          of A's starts or is said (the helper, the hook, the sheet, the panel, the pipeline, the list, budgets,
 *          categories, Pay, the page's upload; the detail page in -detail)
 *   R22-4  a refused pre-check shows no confirm (pipeline Delete, recurring Cancel)
 *   R22-P  ported from the retired modal: the sheet's schedule that throws under a silent switch says nothing
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
import { useExpensesData } from "../components/use-expenses-data";
import ExpensesInboxPage from "../page";
import { canStartFor, startRefusal, BUSINESS_CHANGED_ELSEWHERE } from "../components/expense-utils";
import { renderHook } from "@testing-library/react";

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




// The business this tab shows; the given check says only it is shown. The stored id (ws.bid) is the other half.
const shown = { id: "biz_A" };
const check = (b: string) => shown.id === b;
const backToA = () => { shown.id = "biz_B"; ws.bid = "biz_A"; }; // this tab shows B; another tab stored A again
afterEach(() => { shown.id = "biz_A"; });

const BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;
const pipelineEl = () => (
  <ExpensePipeline
    businessId="biz_A" expenses={[expense()]} totalExpenses={1} categories={CATS.biz_A} summary={null}
    period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
    searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
    filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
    onReload={vi.fn()} onEdit={vi.fn()} isCurrentBusiness={check}
  />
);
const listEl = () => (
  <ExpenseList
    businessId="biz_A" expenses={[expense({ status: "PAID" })]} totalExpenses={1}
    categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
    filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
    page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
    onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={vi.fn()} isCurrentBusiness={check}
  />
);
const panelEl = () => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} isCurrentBusiness={check} />;
const withReceipt = () => {
  const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return { receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1", receiptFile: file };
};
type Handles = { onPaid?: ReturnType<typeof vi.fn>; onSaved?: ReturnType<typeof vi.fn>; onClose?: ReturnType<typeof vi.fn> };
const sheetMount = (extra: Partial<React.ComponentProps<typeof ExpenseFormSideSheet>> = {}): Handles => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={onClose} onSaved={onSaved} isCurrentBusiness={check} {...extra} />);
  return { onSaved, onClose };
};
const extractButton = () => screen.getAllByRole("button").find((b) => /Extract with AI|Extracting/.test(b.textContent ?? "")) as HTMLButtonElement;
const pickFile = () => fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } });

type Site = {
  name: string; call: () => ReturnType<typeof vi.fn>; mount: () => Handles | void;
  prep?: () => Promise<void>; fire: () => Promise<void>; answer?: () => unknown; outcomes?: ("answers" | "throws")[];
  clearAfterSend?: boolean; notAStart?: boolean;
};
const SITES: Site[] = [
  { name: "pipeline Mark Paid", call: () => client.updateExpense, mount: () => { render(pipelineEl()); },
    prep: async () => { await screen.findAllByRole("button", { name: /^Mark Paid$/i }); },
    fire: async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Mark Paid$/i })[0]); } },
  { name: "pipeline Delete", call: () => client.deleteExpense, mount: () => { render(pipelineEl()); },
    prep: async () => { await screen.findAllByRole("button", { name: /^Delete$/i }); },
    fire: async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Delete$/i })[0]); } },
  { name: "recurring save (Update)", call: () => client.updateRecurringExpense, mount: () => { render(panelEl()); },
    prep: async () => { fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i })); await screen.findByRole("button", { name: /^Update$/ }); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: /^Update$/ })); } },
  { name: "recurring Cancel", call: () => client.cancelRecurringExpense, mount: () => { render(panelEl()); },
    prep: async () => { await screen.findByRole("button", { name: /^Cancel$/i }); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i })); } },
  { name: "recurring Run Now", call: () => client.runRecurringExpenseNow, mount: () => { render(panelEl()); },
    prep: async () => { await screen.findByRole("button", { name: /Run Now/i }); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: /Run Now/i })); } },
  { name: "list bulk categorize", call: () => client.updateExpense, mount: () => { render(listEl()); },
    prep: async () => {
      fireEvent.click((await screen.findByRole("table", { name: "Expenses list" })).querySelector("button")!);
      fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).options[0]?.textContent === "Assign category...")!, { target: { value: "cat_A_tolls" } });
    },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: /Apply/ })); } },
  { name: "list inline categorize", call: () => client.updateExpense, mount: () => { render(listEl()); },
    prep: async () => { fireEvent.click((await screen.findAllByTitle("Click to change category"))[0]); },
    fire: async () => { fireEvent.change(screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "cat_A_fuel")!, { target: { value: "cat_A_tolls" } }); } },
  { name: "budgets save", call: () => client.upsertExpenseBudget,
    mount: () => { render(<ExpenseBudgetsTab businessId="biz_A" budgets={[]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={vi.fn()} isCurrentBusiness={check} />); },
    prep: async () => { fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]); fireEvent.change(await screen.findByPlaceholderText("5000.00"), { target: { value: "800" } }); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: "Save Budget" })); } },
  { name: "budgets delete", call: () => client.deleteExpenseBudget,
    mount: () => { render(<ExpenseBudgetsTab businessId="biz_A" budgets={[BUDGET]} categories={CATS.biz_A} expenses={[]} summary={null} onReload={vi.fn()} isCurrentBusiness={check} />); },
    fire: async () => { fireEvent.click(document.querySelector("button svg.lucide-trash-2, button svg.lucide-trash2")!.closest("button")!); } },
  { name: "categories Add", call: () => client.createExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={check} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    prep: async () => { fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } }); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: /^add category$/i })); },
    answer: () => ok({ id: "cat_new", name: "Supplies", color: "#f97316" }) },
  { name: "categories delete", call: () => client.deleteExpenseCategory,
    mount: () => { render(<ExpenseCategoriesTab businessId="biz_A" categories={CATS.biz_A} isCurrentBusiness={check} addCategory={() => true} removeCategory={() => true} summary={null} budgets={[]} />); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: "Delete category Fuel A" })); } },
  { name: "Pay", call: () => finance.payBill,
    mount: () => {
      client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
      const onPaid = vi.fn();
      render(<BillPayDialog businessId="biz_A" bill={expense()} onClose={vi.fn()} onPaid={onPaid} isCurrentBusiness={check} />);
      return { onPaid };
    },
    prep: async () => { const pay = await screen.findByRole("button", { name: /^Pay$/ }); await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false)); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: /^Pay$/ })); },
    answer: () => ok(expense({ status: "PAID" })) },
  { name: "the sheet's bill (createBill)", call: () => finance.createBill, mount: () => sheetMount({ initialKind: "bill" }),
    prep: async () => { fill("A supplier", "300"); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: "Record bill" })); },
    answer: () => ({ data: null, error: "Insufficient permissions: finance requires write access", status: 403 }) },
  { name: "the sheet's save (createExpense)", call: () => client.createExpense, mount: () => sheetMount(),
    prep: async () => { fill(); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => ({ data: null, error: "Amount can't change on a posted expense", status: 409 }) },
  { name: "the sheet's Drive copy", call: () => drive.uploadToDrive, notAStart: true,
    mount: () => { client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" })); return sheetMount({ prefill: withReceipt() }); },
    prep: async () => { fill(); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => true, clearAfterSend: true },
  { name: "the sheet's schedule", call: () => client.createRecurringExpense, notAStart: true,
    mount: () => { client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" })); return sheetMount(); },
    prep: async () => { fill(); fireEvent.click(screen.getByRole("checkbox", { name: /Recurring/ })); },
    fire: async () => { fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => ({ data: null, error: "Schedule refused", status: 409 }) },
  { name: "the sheet's receipt upload", call: () => upload.uploadFile, mount: () => sheetMount(),
    fire: async () => { pickFile(); },
    answer: () => ({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} }) },
  { name: "the sheet's Extract with AI", call: () => client.extractReceipt,
    mount: () => sheetMount({ editingExpense: expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" }) }),
    fire: async () => { fireEvent.click(extractButton()); },
    answer: () => ok({ invoiceData: { total: 99, lineItems: [{ description: "A toner" }] }, confidence: 0.9 }) },
];

describe("R22-3: the given check's half of the start check", () => {
  for (const site of SITES.filter((s) => !s.notAStart)) {
    it(`${site.name}: this tab shows B, the stored id reads A: nothing starts for A`, async () => {
      site.call().mockReturnValue(new Promise(() => {}) as never);
      site.mount();
      await site.prep?.();
      backToA();
      await site.fire();
      await settle();
      expect(site.call(), "A's write started while this tab shows B").not.toHaveBeenCalled();
    });
  }
});

describe("R22-3: the given check's half of every reply guard", () => {
  for (const site of SITES) {
    for (const outcome of site.outcomes ?? (["answers", "throws"] as const)) {
      it(`${site.name} that ${outcome}, landing with this tab on B and the stored id back on A, says nothing`, async () => {
        const pending = deferred<unknown>();
        site.call().mockReturnValue(pending.promise as never);
        const handles = site.mount() || {};
        await site.prep?.();
        await site.fire();
        await waitFor(() => expect(site.call()).toHaveBeenCalled());
        if (site.clearAfterSend) {
          await settle();
          vi.mocked(toast.success).mockReset();
          vi.mocked(toast.error).mockReset();
          handles.onSaved?.mockReset();
          handles.onClose?.mockReset();
        }
        backToA();
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

describe("R22-3: the shared helper", () => {
  it("refuses when the stored id is the business but the given check says it is not shown", () => {
    ws.bid = "biz_A";
    expect(canStartFor("biz_A", (b) => b === "biz_B")).toBe(false);
    expect(startRefusal("biz_A", (b) => b === "biz_B")).toBe(BUSINESS_CHANGED_ELSEWHERE);
    expect(canStartFor("biz_A", (b) => b === "biz_A"), "control").toBe(true);
  });
});

describe("R22-3: the data hook", () => {
  it("A's read landing with the hook on B and the stored id back on A writes nothing of A's", async () => {
    const readA = deferred<unknown>();
    client.fetchExpenses.mockImplementation((b: string) => (b === "biz_A" ? readA.promise : Promise.resolve(ok({ data: [expense({ id: "exp_B1", description: "B row" })], total: 1, page: 1, limit: 20 }))));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["exp_B1"]));
    ws.bid = "biz_A"; // another tab, before its storage event
    expect(result.current.isCurrentBusiness("biz_A"), "the hook's check says A is shown while it shows B").toBe(false);
    await act(async () => { readA.resolve(ok({ data: [expense({ id: "exp_A1", description: "A row" })], total: 1, page: 1, limit: 20 })); });
    await settle();
    expect(result.current.expenses.map((e) => e.id), "A's rows landed on B").toEqual(["exp_B1"]);
  });
});

describe("R22-3: the page's receipt upload", () => {
  it("A's upload landing with the page on B and the stored id back on A opens no sheet and says nothing", async () => {
    const up = deferred<unknown>();
    upload.uploadFile.mockReturnValue(up.promise);
    render(<ExpensesInboxPage />);
    const LONG = { timeout: 10000 };
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    await screen.findByRole("tab", { name: "Categories" }, LONG);
    const input = await waitFor(() => {
      const found = document.querySelector('input[type="file"]') as HTMLInputElement | null;
      expect(found).toBeTruthy();
      return found!;
    }, LONG);
    fireEvent.change(input, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalled(), LONG);
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()), LONG);
    ws.bid = "biz_A"; // another tab, before its storage event
    await act(async () => {
      up.resolve({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} });
      await up.promise;
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    noToast2();
    expect(screen.queryByRole("dialog"), "a sheet opened on B with A's receipt").toBeNull();
  }, 30000);
});

describe("R22-4: a refused pre-check shows no confirm", () => {
  const CASES = [
    ["pipeline Delete", pipelineEl, /^Delete$/i],
    ["recurring Cancel", panelEl, /^Cancel$/i],
  ] as const;
  for (const [name, el, button] of CASES) {
    for (const how of ["this tab shows B", "the stored id is B"] as const) {
      it(`${name}, ${how}: no confirm dialog`, async () => {
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
        render(el());
        const b = (await screen.findAllByRole("button", { name: button }))[0];
        if (how === "this tab shows B") shown.id = "biz_B";
        else ws.bid = "biz_B";
        fireEvent.click(b);
        await settle();
        expect(confirm, "a confirm for a write that cannot start").not.toHaveBeenCalled();
      });
    }
  }
});

describe("R22-1: the recurring panel's read that fails for A after the panel shows B", () => {
  it("shows no empty state while B's read is out", async () => {
    const readA = deferred<unknown>();
    client.fetchRecurringExpenses.mockImplementation((b: string) => (b === "biz_A" ? readA.promise : new Promise(() => {})));
    const el = (b: string) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />;
    const view = render(el("biz_A"));
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_A"));
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_B"));
    await act(async () => { readA.reject(new TypeError("Failed to fetch")); });
    await settle();
    expect(screen.queryByText(/no recurring expenses/i), "A's failure ended B's loading").toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
  });
});

describe("R22-2: the sheet's Extract under a silent switch", () => {
  for (const outcome of ["answers", "throws"] as const) {
    it(`that ${outcome} changes nothing of the sheet`, async () => {
      const ex = deferred<unknown>();
      client.extractReceipt.mockReturnValue(ex.promise);
      render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" })} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={always} />);
      fireEvent.click(extractButton());
      await waitFor(() => expect(client.extractReceipt).toHaveBeenCalled());
      ws.bid = "biz_B";
      await act(async () => {
        if (outcome === "answers") ex.resolve(ok({ invoiceData: { total: 1 }, confidence: 0.5 }));
        else ex.reject(new TypeError("Failed to fetch"));
      });
      await settle();
      noToast2();
      expect(extractButton().textContent, "A's Extract changed the sheet after the switch").toMatch(/Extracting/);
    });
  }
});

describe("R22-P (from the retired modal): the sheet's schedule under a silent switch", () => {
  for (const outcome of ["answers", "throws"] as const) {
    it(`that ${outcome} says nothing, and neither saves nor closes`, async () => {
      client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
      const pending = deferred<unknown>();
      client.createRecurringExpense.mockReturnValue(pending.promise);
      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={onClose} onSaved={onSaved} isCurrentBusiness={always} />);
      fill();
      fireEvent.click(screen.getByRole("checkbox", { name: /Recurring/ }));
      fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
      await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalled());
      ws.bid = "biz_B";
      await act(async () => {
        if (outcome === "answers") pending.resolve(ok({ id: "rec_A_new" }));
        else pending.reject(new TypeError("Failed to fetch"));
      });
      await settle();
      noToast2();
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  }
});
