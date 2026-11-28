/**
 * EXPENSES-HUB-3 repair round 15 (R14 reviews at 0622e7a, MINORs): the export's file name, the sheet's bill and
 * Drive guards, and the editors reset on a switch.
 *
 *   R15-2  the CSV names the business it is for: an export of A that arrives after the switch to B still downloads,
 *          as expenses-<A's name>-<date>.csv, so it cannot pass for B's
 *   R15-6  a refused createBill for A answering after the switch says nothing; the Drive copy's follow-up toasts
 *          ("Receipt saved to Drive", and its failure) say nothing once the business is no longer shown
 *   R15-7  the budget modal, reopened on B, shows none of A's category or amount; the recurring panel, after the
 *          switch, opens New as a new schedule (Create, empty), not A's schedule (Update)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

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
import ExpensesInboxPage from "../page";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
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

function switchTo(bid: string) {
  ws.bid = bid;
  act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });


const noToast2 = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};


describe("R15-2: the export's file name", () => {
  const downloads: string[] = [];
  beforeEach(() => {
    downloads.length = 0;
    vi.stubGlobal("URL", Object.assign(Object.create(URL), URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("A's CSV arriving after the switch to B downloads under A's name", async () => {
    const answer = deferred<unknown>();
    vi.stubGlobal("fetch", vi.fn(() => answer.promise));
    render(<ExpensesInboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    switchTo("biz_B");
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    await act(async () => { answer.resolve({ ok: true, status: 200, blob: async () => new Blob(["a,b"]) }); });
    await settle();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^expenses-biz-a-co-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("R15-6: the sheet's bill and Drive guards", () => {
  it("a refused createBill for A answering after the switch says nothing", async () => {
    const bill = deferred<unknown>();
    finance.createBill.mockReturnValue(bill.promise);
    const el = (b: string) => <ExpenseFormSideSheet businessId={b} categories={[]} editingExpense={null} initialKind="bill" onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A supplier bill" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Record bill" }));
    await waitFor(() => expect(finance.createBill).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => { bill.resolve({ data: null, error: "Insufficient permissions: finance requires write access", status: 403 }); });
    await settle();
    noToast2();
  });

  it.each(["copied", "failed"] as const)("the Drive copy's follow-up, %s after the switch, says nothing", async (outcome) => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    const copy = deferred<boolean>();
    drive.uploadToDrive.mockReturnValue(copy.promise);
    const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(1) });
    const prefill = { receiptUrl: "http://api.test/objects/uploads/biz_A/obj_1", receiptFile: file };
    const el = (b: string) => <ExpenseFormSideSheet businessId={b} categories={[]} editingExpense={null} prefill={prefill} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(drive.uploadToDrive).toHaveBeenCalledWith(expect.objectContaining({ businessId: "biz_A", entityId: "exp_A_new" })));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Expense saved")); // A's save, said on A
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => {
      if (outcome === "copied") copy.resolve(true);
      else copy.reject(new Error("drive down"));
    });
    await settle();
    noToast2();
  });
});

describe("R15-7: editors after the switch", () => {
  const SHARED = [{ id: "cat_shared", name: "Shared", color: "#f97316" } as ExpenseCategory];
  it("the budget modal reopened on B shows none of A's category or amount", async () => {
    const el = (b: string) => <ExpenseBudgetsTab businessId={b} budgets={[]} categories={SHARED} expenses={[]} summary={null} onReload={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]);
    fireEvent.change(await screen.findByPlaceholderText("5000.00"), { target: { value: "800" } });
    fireEvent.change(screen.getByDisplayValue("All Categories (Total Budget)"), { target: { value: "cat_shared" } });
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save Budget" })).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]);
    const amount = (await screen.findByPlaceholderText("5000.00")) as HTMLInputElement;
    expect(amount.value, "A's amount on B's form").toBe("");
    expect((screen.getByDisplayValue("All Categories (Total Budget)") as HTMLSelectElement).value, "A's category on B's form").toBe("");
  });

  it("the recurring panel, after an Edit of A's schedule and the switch, opens New as a new schedule", async () => {
    const el = (b: string) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />;
    const view = render(el("biz_A"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
    await screen.findByRole("button", { name: /^Update$/ });
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Update$/ })).toBeNull());
    // No builder at all is left open: not A's schedule, and not an empty one either.
    await waitFor(() => expect(screen.queryByPlaceholderText("e.g., Office Rent"), "a builder is still open on B").toBeNull());
    expect(screen.queryByRole("button", { name: /^Create$/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Add Recurring Expense" }));
    expect(await screen.findByRole("button", { name: /^Create$/ }), "New opened A's schedule").toBeTruthy();
    expect((screen.getByPlaceholderText("e.g., Office Rent") as HTMLInputElement).value).toBe("");
  });
});
