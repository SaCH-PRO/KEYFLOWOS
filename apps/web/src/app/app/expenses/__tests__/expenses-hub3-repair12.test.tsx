/**
 * EXPENSES-HUB-3 repair round 12 (R11 confirmations at 55b2f46, MINORs): an action started on business A whose reply
 * lands after the switch to B says nothing on B and reloads nothing of A's onto B.
 *
 *   R12-1  the Categories tab: A's create or delete that throws (a network error) after the switch says no
 *          "Failed to…" on B (the catch guards)
 *   R12-3  the recurring panel (Run Now, Cancel), the budgets tab (delete), the expense list (inline category) and the
 *          pipeline (Mark Paid): success and failure toasts, and the reload, only while A is still the business shown
 *   R12-3c control: with no switch, each still says so and reloads
 *
 * Real components; only the client calls, next/navigation, sonner, the upload hooks and the stored business are stubbed.
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
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
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
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import { ExpenseBudgetsTab } from "../components/expense-budgets-tab";
import { ExpenseList } from "../components/expense-list";
import { ExpensePipeline } from "../components/expense-pipeline";

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

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_A1", description: "Diesel", amount: 50, currency: "TTD", date: "2026-11-20T00:00:00.000Z", vendor: "Shell",
    paymentMethod: "cash", tags: [], isRecurring: false, status: "BILL", categoryId: "cat_A_fuel",
    createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z", ...over,
  } as Expense;
}
const SCHEDULE = {
  id: "rec_A1", name: "Rent", frequency: "MONTHLY", nextRunDate: "2026-12-01T00:00:00.000Z", isActive: true, runCount: 0,
  failureCount: 0, description: "Rent", amount: 1000, currency: "TTD", createsBill: false,
} as RecurringExpense;
const BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;

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

function switchTo(bid: string) {
  ws.bid = bid;
  act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const noToast = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};

describe("R12-1: the Categories tab's catch guards", () => {
  async function openCategories() {
    render(<ExpensesInboxPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Categories" }));
    await screen.findByText("Fuel A");
  }

  it("A's create that throws after the switch to B says no 'Failed to create category'", async () => {
    const create = deferred<unknown>();
    client.createExpenseCategory.mockReturnValue(create.promise);
    await openCategories();
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await waitFor(() => expect(client.createExpenseCategory).toHaveBeenCalled());
    switchTo("biz_B");
    await screen.findByText("Rent B");
    await act(async () => { create.reject(new TypeError("Failed to fetch")); });
    await settle();
    noToast();
  });

  it("A's delete that throws after the switch to B says no 'Failed to delete category'", async () => {
    const del = deferred<unknown>();
    client.deleteExpenseCategory.mockReturnValue(del.promise);
    await openCategories();
    fireEvent.click(screen.getByRole("button", { name: "Delete category Fuel A" }));
    await waitFor(() => expect(client.deleteExpenseCategory).toHaveBeenCalled());
    switchTo("biz_B");
    await screen.findByText("Rent B");
    await act(async () => { del.reject(new TypeError("Failed to fetch")); });
    await settle();
    noToast();
  });

  it("control: a create that throws with no switch says 'Failed to create category'", async () => {
    client.createExpenseCategory.mockRejectedValue(new TypeError("Failed to fetch"));
    await openCategories();
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to create category"));
  });
});

/** The four other places an action can start on A: each one's button, and the client call it waits on. */
type Case = {
  name: string;
  call: keyof typeof client;
  /** Renders the component for business `bid`; returns its rerender for the switch, and the reload spy if it has one. */
  mount: (bid: string) => { rerenderFor: (bid: string) => void; reload?: ReturnType<typeof vi.fn> };
  act: () => Promise<void>;
  success: string;
  failure: string;
  /** For the recurring panel: its own reload is a read of the schedules. */
  reloadCalls?: () => number;
};

const CASES: Case[] = [
  {
    name: "the recurring panel's Run Now",
    call: "runRecurringExpenseNow",
    mount: (bid) => {
      const view = render(<RecurringExpensesPanel businessId={bid} categories={[]} triggerNew={0} />);
      return { rerenderFor: (b) => view.rerender(<RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />) };
    },
    act: async () => { fireEvent.click(await screen.findByRole("button", { name: /Run Now/i })); },
    success: "Expense generated",
    failure: "Failed to run",
    reloadCalls: () => client.fetchRecurringExpenses.mock.calls.filter((c) => c[0] === "biz_A").length,
  },
  {
    name: "the recurring panel's Cancel",
    call: "cancelRecurringExpense",
    mount: (bid) => {
      const view = render(<RecurringExpensesPanel businessId={bid} categories={[]} triggerNew={0} />);
      return { rerenderFor: (b) => view.rerender(<RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />) };
    },
    act: async () => { fireEvent.click(await screen.findByRole("button", { name: /^Cancel$/i })); },
    success: "Cancelled",
    failure: "Failed to cancel",
    reloadCalls: () => client.fetchRecurringExpenses.mock.calls.filter((c) => c[0] === "biz_A").length,
  },
  {
    name: "the budgets tab's delete",
    call: "deleteExpenseBudget",
    mount: (bid) => {
      const reload = vi.fn();
      const el = (b: string) => <ExpenseBudgetsTab businessId={b} budgets={b === "biz_A" ? [BUDGET] : []} categories={CATS[b]} expenses={[]} summary={null} onReload={reload} />;
      const view = render(el(bid));
      return { rerenderFor: (b) => view.rerender(el(b)), reload };
    },
    act: async () => {
      const trash = document.querySelector("button svg.lucide-trash-2, button svg.lucide-trash2")?.closest("button") as HTMLButtonElement;
      fireEvent.click(trash);
    },
    success: "Budget deleted",
    failure: "Failed to delete budget",
  },
  {
    name: "the expense list's inline category",
    call: "updateExpense",
    mount: (bid) => {
      const reload = vi.fn();
      const el = (b: string) => (
        <ExpenseList
          businessId={b} expenses={b === "biz_A" ? [expense({ status: "PAID" })] : []} totalExpenses={b === "biz_A" ? 1 : 0}
          categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
          filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
          page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
          onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={reload}
        />
      );
      const view = render(el(bid));
      return { rerenderFor: (b) => view.rerender(el(b)), reload };
    },
    act: async () => {
      fireEvent.click((await screen.findAllByTitle("Click to change category"))[0]);
      // The row's own select shows the row's category (the filter select above the table shows "All").
      const inline = screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "cat_A_fuel")!;
      fireEvent.change(inline, { target: { value: "cat_A_tolls" } });
    },
    success: "Category updated",
    failure: "Failed to update category",
  },
  {
    name: "the pipeline's Mark Paid",
    call: "updateExpense",
    mount: (bid) => {
      const reload = vi.fn();
      const el = (b: string) => (
        <ExpensePipeline
          businessId={b} expenses={b === "biz_A" ? [expense()] : []} totalExpenses={b === "biz_A" ? 1 : 0} categories={CATS.biz_A} summary={null}
          period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
          searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
          filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
          onReload={reload} onEdit={vi.fn()}
        />
      );
      const view = render(el(bid));
      return { rerenderFor: (b) => view.rerender(el(b)), reload };
    },
    act: async () => { fireEvent.click((await screen.findAllByRole("button", { name: /Mark Paid/i }))[0]); },
    success: "Bill marked as paid",
    failure: "Failed to mark as paid",
  },
];

describe("R12-3: a reply for A that lands after the switch to B", () => {
  for (const c of CASES) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`${c.name} that ${outcome} says nothing on B and reloads nothing`, async () => {
        const pending = deferred<unknown>();
        client[c.call].mockReturnValue(pending.promise as never);
        const { rerenderFor, reload } = c.mount("biz_A");
        await c.act();
        await waitFor(() => expect(client[c.call]).toHaveBeenCalled());
        const readsBefore = c.reloadCalls?.() ?? 0;
        ws.bid = "biz_B";
        rerenderFor("biz_B");
        await act(async () => {
          if (outcome === "answers") pending.resolve(ok(null));
          else pending.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToast();
        if (reload) expect(reload, "A's reload ran on B").not.toHaveBeenCalled();
        if (c.reloadCalls) expect(c.reloadCalls(), "A's schedules were read again onto B").toBe(readsBefore);
      });
    }
  }
});

describe("R12-3c control: with no switch, each says so", () => {
  for (const c of CASES) {
    it(`${c.name}: success, then failure`, async () => {
      client[c.call].mockResolvedValue(ok(null) as never);
      const { reload } = c.mount("biz_A");
      await c.act();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining(c.success)));
      if (reload) expect(reload).toHaveBeenCalled();
      cleanup();
      vi.mocked(toast.error).mockReset();
      client[c.call].mockRejectedValue(new TypeError("Failed to fetch"));
      c.mount("biz_A");
      await c.act();
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(c.failure));
    });
  }
});
