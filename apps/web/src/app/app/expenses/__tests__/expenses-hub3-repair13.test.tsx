/**
 * EXPENSES-HUB-3 repair round 13 (R12 confirmations at 226873a, MINORs): the guards R12 left unpinned, and the
 * caller-supplied check.
 *
 *   R13-1  budgets save, list bulk categorize, pipeline delete, recurring save (edit): a reply for A that lands after
 *          the switch to B (answering or throwing) says and reloads nothing; the recurring panel's own read for A that
 *          answers after B's does not put A's schedule on B
 *   R13-2  through the real page: the page passes the data hook's check to the recurring panel, so a reply that lands
 *          after the switch but before React commits it (the hook adopts the switch at once; the panel's fallback only
 *          at commit) says nothing
 *   R13-3  ExpenseBudgetsTab, ExpenseList, ExpensePipeline and the recurring panel honour a supplied
 *          `isCurrentBusiness`: it is consulted, not only the fallback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense, ExpenseCategory, RecurringExpense } from "@/lib/client";

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
const noToast = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};


async function openEditAndSave() {
  fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
  fireEvent.change(await screen.findByPlaceholderText("0.00"), { target: { value: "1200" } });
  fireEvent.click(screen.getByRole("button", { name: /^Update$/ }));
}

type Case = {
  name: string;
  call: keyof typeof client;
  mount: (bid: string, check?: (b: string) => boolean) => { rerenderFor: (bid: string) => void; reload?: ReturnType<typeof vi.fn> };
  act: () => Promise<void>;
  success: string;
  failure: string;
  reloadCalls?: () => number;
};

const panel = (b: string, check?: (b: string) => boolean) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} isCurrentBusiness={check} />;

const CASES: Case[] = [
  {
    name: "the budgets tab's save",
    call: "upsertExpenseBudget",
    mount: (bid, check) => {
      const reload = vi.fn();
      const el = (b: string) => <ExpenseBudgetsTab businessId={b} budgets={[]} categories={CATS[b]} expenses={[]} summary={null} onReload={reload} isCurrentBusiness={check} />;
      const view = render(el(bid));
      return { rerenderFor: (b) => view.rerender(el(b)), reload };
    },
    act: async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]);
      fireEvent.change(await screen.findByPlaceholderText("5000.00"), { target: { value: "800" } });
      fireEvent.click(screen.getByRole("button", { name: "Save Budget" }));
    },
    success: "Budget saved",
    failure: "Failed to save budget",
  },
  {
    name: "the expense list's bulk categorize",
    call: "updateExpense",
    mount: (bid, check) => {
      const reload = vi.fn();
      const el = (b: string) => (
        <ExpenseList
          businessId={b} expenses={b === "biz_A" ? [expense({ status: "PAID" })] : []} totalExpenses={b === "biz_A" ? 1 : 0}
          categories={[...CATS.biz_A, { id: "cat_A_tolls", name: "Tolls A", color: "#22c55e" } as ExpenseCategory]}
          filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
          page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
          onEdit={vi.fn()} onDelete={vi.fn()} onViewDetail={vi.fn()} onReload={reload} isCurrentBusiness={check}
        />
      );
      const view = render(el(bid));
      return { rerenderFor: (b) => view.rerender(el(b)), reload };
    },
    act: async () => {
      const table = await screen.findByRole("table", { name: "Expenses list" });
      fireEvent.click(table.querySelector("button")!); // the row's select box
      const assign = screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).options[0]?.textContent === "Assign category...")!;
      fireEvent.change(assign, { target: { value: "cat_A_tolls" } });
      fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    },
    success: "1 expense categorized",
    failure: "Failed to bulk categorize",
  },
  {
    name: "the pipeline's delete",
    call: "deleteExpense",
    mount: (bid, check) => {
      const reload = vi.fn();
      const el = (b: string) => (
        <ExpensePipeline
          businessId={b} expenses={b === "biz_A" ? [expense()] : []} totalExpenses={b === "biz_A" ? 1 : 0} categories={CATS.biz_A} summary={null}
          period="month" setPeriod={vi.fn()} customStart="" setCustomStart={vi.fn()} customEnd="" setCustomEnd={vi.fn()}
          searchQuery="" setSearchQuery={vi.fn()} filterCategory="" setFilterCategory={vi.fn()} filterPayment="" setFilterPayment={vi.fn()}
          filterStatus="" setFilterStatus={vi.fn()} page={1} setPage={vi.fn()} pageSize={20} setPageSize={vi.fn()}
          onReload={reload} onEdit={vi.fn()} isCurrentBusiness={check}
        />
      );
      const view = render(el(bid));
      return { rerenderFor: (b) => view.rerender(el(b)), reload };
    },
    act: async () => { fireEvent.click((await screen.findAllByRole("button", { name: /^Delete$/i }))[0]); },
    success: "Expense deleted",
    failure: "Failed to delete",
  },
  {
    name: "the recurring panel's save (edit)",
    call: "updateRecurringExpense",
    mount: (bid, check) => {
      const view = render(panel(bid, check));
      return { rerenderFor: (b) => view.rerender(panel(b, check)) };
    },
    act: openEditAndSave,
    success: "Recurring expense updated",
    failure: "Failed to save",
    reloadCalls: () => client.fetchRecurringExpenses.mock.calls.filter((c) => c[0] === "biz_A").length,
  },
];

describe("R13-1: a reply for A that lands after the switch to B", () => {
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

  it("the recurring panel's own read for A, answering after B's, does not put A's schedule on B", async () => {
    const readA = deferred<unknown>();
    client.fetchRecurringExpenses.mockImplementation((b: string) => (b === "biz_A" ? readA.promise : Promise.resolve(ok([]))));
    const view = render(panel("biz_A"));
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_A"));
    ws.bid = "biz_B";
    view.rerender(panel("biz_B"));
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_B"));
    await screen.findByText(/no recurring expenses/i);
    await act(async () => { readA.resolve(ok([SCHEDULE])); });
    await settle();
    expect(screen.queryByText("Rent"), "A's schedule is on B").toBeNull();
    expect(screen.getByText(/no recurring expenses/i)).toBeTruthy();
  });
});

describe("R13-1c control: with no switch, each still says so", () => {
  for (const c of CASES) {
    it(`${c.name}: success, then failure`, async () => {
      client[c.call].mockResolvedValue(ok(null) as never);
      const { reload } = c.mount("biz_A");
      await c.act();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(c.success));
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

describe("R13-3: a supplied isCurrentBusiness is consulted", () => {
  for (const c of CASES) {
    it(`${c.name}: a check that says A is no longer shown silences A's reply, with no re-render`, async () => {
      const pending = deferred<unknown>();
      client[c.call].mockReturnValue(pending.promise as never);
      let shown = "biz_A";
      const check = vi.fn((b: string) => b === shown);
      const { reload } = c.mount("biz_A", check);
      await c.act();
      await waitFor(() => expect(client[c.call]).toHaveBeenCalled());
      shown = "biz_B"; // the parent's check moves on; this component's businessId prop is still A
      await act(async () => { pending.resolve(ok(null)); });
      await settle();
      expect(check).toHaveBeenCalledWith("biz_A");
      noToast();
      if (reload) expect(reload).not.toHaveBeenCalled();
    });
  }
});

describe("R13-2: the page passes the data hook's check to the recurring panel", () => {
  it("A's Run Now answering after the switch, before React commits it, says nothing on B", async () => {
    const run = deferred<unknown>();
    client.runRecurringExpenseNow.mockReturnValue(run.promise);
    render(<ExpensesInboxPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }));
    fireEvent.click(await screen.findByRole("button", { name: /Run Now/i }));
    await waitFor(() => expect(client.runRecurringExpenseNow).toHaveBeenCalledWith("biz_A", "rec_A1"));
    // One act: the switch is announced (the hook adopts B at once) and A's reply lands before the act ends, so before
    // React commits the switch: the panel's own fallback still shows A; only the hook's check knows.
    await act(async () => {
      ws.bid = "biz_B";
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } }));
      run.resolve(ok(null));
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    expect(toast.success).not.toHaveBeenCalledWith("Expense generated");
    expect(client.fetchRecurringExpenses.mock.calls.filter((c) => c[0] === "biz_A").length).toBe(1);
  });
});
