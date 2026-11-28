/**
 * R22: ExpenseFormModal is retired (it had no production mount); its tests in this file were removed. The R22
 * PROGRESS on #273 names the side-sheet test that covers each.
 *
 * EXPENSES-HUB-3 repair round 21 (R20 reviews at 1d4ab51).
 *
 *   R21-1 MAJOR  every reply site of the side sheet (the sheet the Expenses and detail pages use) judges its reply by
 *                the start check's test: under a silent switch (the stored id already B, the given check still A) the
 *                refused bill, the refused save, the Drive copy's success and failure, the save's catch, the upload's
 *                reply and catch, and Extract's reply and catch each say nothing
 *   R21-2        the data hook's read that fails for A after the switch to B does not clear B's rows or say B failed
 *   R21-3        the recurring panel re-rendered A -> B shows no empty state while B's read is out
 *   R21-4        the modal ends only the edit open at the switch: a fresh edit passed afterwards still updates
 *   R21-5        the modal's Extract dropped at a switch leaves B's Extract enabled
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
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { useExpensesData } from "../components/use-expenses-data";
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




const sheetEl = (b: string, extra: Partial<React.ComponentProps<typeof ExpenseFormSideSheet>> = {}) => (
  <ExpenseFormSideSheet businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={always} {...extra} />
);
const withReceipt = () => {
  const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
  return { receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1", receiptFile: file };
};
const silent = () => { ws.bid = "biz_B"; }; // the stored id moves; the given check still says A

type SheetSite = { name: string; call: () => ReturnType<typeof vi.fn>; before?: () => void; mount: () => { onSaved: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> }; go: () => Promise<void>; answer: () => unknown; outcomes: ("answers" | "throws")[]; resetToastsAfterSend?: boolean };
const mountSheet = (extra: Partial<React.ComponentProps<typeof ExpenseFormSideSheet>> = {}) => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(sheetEl("biz_A", { onSaved, onClose, ...extra }));
  return { onSaved, onClose };
};
const SHEET: SheetSite[] = [
  {
    name: "refused bill (createBill)", call: () => finance.createBill,
    mount: () => mountSheet({ initialKind: "bill" }),
    go: async () => { fill("A supplier", "300"); fireEvent.click(screen.getByRole("button", { name: "Record bill" })); },
    answer: () => ({ data: null, error: "Insufficient permissions: finance requires write access", status: 403 }), outcomes: ["answers"],
  },
  {
    name: "refused save (createExpense)", call: () => client.createExpense,
    mount: () => mountSheet(),
    go: async () => { fill(); fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => ({ data: null, error: "Amount can't change on a posted expense", status: 409 }), outcomes: ["answers"],
  },
  {
    name: "the save's catch (createExpense throws)", call: () => client.createExpense,
    mount: () => mountSheet(),
    go: async () => { fill(); fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => ok(null), outcomes: ["throws"],
  },
  {
    name: "the Drive copy (success and failure)", call: () => drive.uploadToDrive,
    before: () => { client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" })); },
    mount: () => mountSheet({ prefill: withReceipt() }),
    go: async () => { fill(); fireEvent.click(screen.getByRole("button", { name: "Add Expense" })); },
    answer: () => true, outcomes: ["answers", "throws"], resetToastsAfterSend: true,
  },
  {
    name: "the receipt upload (reply and catch)", call: () => upload.uploadFile,
    mount: () => mountSheet(),
    go: async () => { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } }); },
    answer: () => ({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} }), outcomes: ["answers", "throws"],
  },
  {
    name: "Extract with AI (reply and catch)", call: () => client.extractReceipt,
    mount: () => mountSheet({ editingExpense: expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" }) }),
    go: async () => { fireEvent.click(screen.getAllByRole("button").find((b) => /Extract with AI/.test(b.textContent ?? ""))!); },
    answer: () => ok({ invoiceData: { total: 99, lineItems: [{ description: "A toner" }] }, confidence: 0.9 }), outcomes: ["answers", "throws"],
  },
];

describe("R21-1 MAJOR: the side sheet's reply sites, under a silent switch", () => {
  for (const site of SHEET) {
    for (const outcome of site.outcomes) {
      it(`${site.name} that ${outcome} says nothing`, async () => {
        site.before?.();
        const pending = deferred<unknown>();
        site.call().mockReturnValue(pending.promise as never);
        const { onSaved, onClose } = site.mount();
        await site.go();
        await waitFor(() => expect(site.call()).toHaveBeenCalled());
        if (site.resetToastsAfterSend) {
          await settle();
          vi.mocked(toast.success).mockReset();
          vi.mocked(toast.error).mockReset();
          onSaved.mockReset();
          onClose.mockReset();
        }
        silent();
        await act(async () => {
          if (outcome === "answers") pending.resolve(site.answer());
          else pending.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToast2();
        expect(toast.info).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      });
    }
  }
});

describe("R21-2: the data hook's failing read for A, after the switch to B", () => {
  it("leaves B's rows and B's read as they are", async () => {
    const readA = deferred<unknown>();
    client.fetchExpenses.mockImplementation((b: string) => (b === "biz_A" ? readA.promise : Promise.resolve(ok({ data: [expense({ id: "exp_B1", description: "B row" })], total: 1, page: 1, limit: 20 }))));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["exp_B1"]));
    await act(async () => { readA.reject(new TypeError("Failed to fetch")); });
    await settle();
    expect(result.current.expenses.map((e) => e.id), "A's failure cleared B's rows").toEqual(["exp_B1"]);
    expect(result.current.read.kind, "A's failure is said on B").not.toBe("failed");
  });
});

describe("R21-3: the recurring panel, re-rendered A -> B", () => {
  it("shows no empty state while B's read is out", async () => {
    client.fetchRecurringExpenses.mockImplementation((b: string) => (b === "biz_A" ? Promise.resolve(ok([SCHEDULE])) : new Promise(() => {})));
    const el = (b: string) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />;
    const view = render(el("biz_A"));
    await screen.findByRole("button", { name: /Run Now/i });
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    expect(screen.queryByText(/no recurring expenses/i), "B shows 'No recurring expenses' before its read answers").toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
  });
});

