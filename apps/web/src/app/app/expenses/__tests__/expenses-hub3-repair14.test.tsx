/**
 * EXPENSES-HUB-3 repair round 14 (R13 review at 246cbd4): replies for A that land on B, through the real page.
 *
 *   R14-1 MAJOR  the Add expense sheet: A's save answering (or throwing) after the switch to B, with B's own sheet
 *                open, says nothing ("Expense saved" / "Failed to save expense") and does not close B's sheet; the
 *                same for a receipt upload answering after the switch; the e2e fixture's ExpenseFormModal likewise
 *   R14-2        the data hook's picker read (projects, services, contacts) for A, answering after B's, does not fill
 *                B's pickers
 *   R14-3        the CSV export failing after the switch says nothing on B (one that succeeds still downloads: the
 *                owner asked for it)
 *   R14-6        an Edit opened on A (recurring schedule) or a budget modal opened on A closes on the switch to B
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
import { ExpenseFormModal } from "../components/expense-form-modal";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { renderHook } from "@testing-library/react";
import { useExpensesData } from "../components/use-expenses-data";

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
async function openSheet() {
  fireEvent.click((await screen.findAllByRole("button", { name: "Add expense" }))[0]);
  return screen.findByRole("dialog");
}

describe("R14-1: the Add expense sheet across a switch", () => {
  it.each(["answers", "throws"] as const)("A's save that %s after the switch to B leaves B's sheet open and says nothing", async (outcome) => {
    const save = deferred<unknown>();
    client.createExpense.mockReturnValue(save.promise);
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    await openSheet();
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledWith("biz_A", expect.objectContaining({ description: "A diesel" })));

    switchTo("biz_B");
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // A's sheet closed with A
    await openSheet();
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "B rent" } });

    await act(async () => {
      if (outcome === "answers") save.resolve(ok({ id: "exp_A_new" }));
      else save.reject(new TypeError("Failed to fetch"));
    });
    await settle();
    noToast2();
    expect(screen.getByRole("dialog"), "B's sheet was closed by A's reply").toBeTruthy();
    expect((screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement).value).toBe("B rent");
  });

  async function startSave(fill?: () => void) {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    await openSheet();
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    fill?.();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
  }
  async function switchAndOpenB() {
    switchTo("biz_B");
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openSheet();
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "B rent" } });
  }
  const bSheetIntact = () => {
    expect(screen.getByRole("dialog"), "B's sheet was closed by A's reply").toBeTruthy();
    expect((screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement).value).toBe("B rent");
  };

  it("A's save refused after the switch says no refusal on B", async () => {
    const save = deferred<unknown>();
    client.createExpense.mockReturnValue(save.promise);
    await startSave();
    await waitFor(() => expect(client.createExpense).toHaveBeenCalled());
    await switchAndOpenB();
    await act(async () => { save.resolve({ data: null, error: "Amount can't change on a posted expense", status: 409 }); });
    await settle();
    noToast2();
    bSheetIntact();
  });

  it("A's recurring save whose schedule answers after the switch says nothing on B and leaves B's sheet open", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    const schedule = deferred<unknown>();
    client.createRecurringExpense.mockReturnValue(schedule.promise);
    await startSave(() => fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ })));
    await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalledWith("biz_A", expect.anything()));
    await switchAndOpenB();
    await act(async () => { schedule.resolve(ok({ id: "rec_A_new" })); });
    await settle();
    noToast2();
    bSheetIntact();
  });

  it("the page passes its check: A's save answering after the switch is announced, before React commits it, says nothing", async () => {
    const save = deferred<unknown>();
    client.createExpense.mockReturnValue(save.promise);
    await startSave();
    await waitFor(() => expect(client.createExpense).toHaveBeenCalled());
    // One act: the hook adopts B at once; the sheet's own fallback would learn of it only when React commits.
    await act(async () => {
      ws.bid = "biz_B";
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } }));
      save.resolve(ok({ id: "exp_A_new" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
    noToast2();
  });

  it("control: a save with no switch says 'Expense saved' and closes the sheet", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    render(<ExpensesInboxPage />);
    await openSheet();
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Expense saved"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each(["answers", "throws"] as const)("A's receipt upload in the sheet that %s after the switch says nothing on B", async (outcome) => {
    const up = deferred<unknown>();
    upload.uploadFile.mockReturnValue(up.promise);
    render(<ExpensesInboxPage />);
    const sheet = await openSheet();
    const input = sheet.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalled());
    switchTo("biz_B");
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    await act(async () => {
      if (outcome === "answers") up.resolve({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} });
      else up.reject(new TypeError("Failed to fetch"));
    });
    await settle();
    noToast2();
  });
});

describe("R14-1: the e2e fixture's ExpenseFormModal", () => {
  it.each(["answers", "throws"] as const)("A's save that %s after its business is no longer shown says nothing and does not close", async (outcome) => {
    const save = deferred<unknown>();
    client.createExpense.mockReturnValue(save.promise);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={null} onClose={onClose} onSaved={onSaved} />;
    const view = render(el("biz_A"));
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A diesel" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createExpense).toHaveBeenCalled());
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => {
      if (outcome === "answers") save.resolve(ok({ id: "exp_A_new" }));
      else save.reject(new TypeError("Failed to fetch"));
    });
    await settle();
    noToast2();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("R14-1: receipt upload and extraction in the sheet and the modal, answering after the switch", () => {
  const DRIVE = "https://drive.google.com/file/d/abc/view";
  const editing = expense({ status: "PAID", receiptUrl: DRIVE });
  const extractButton = () => screen.getAllByRole("button").find((b) => /Extract with AI/.test(b.textContent ?? ""))!;

  it.each(["answers", "throws"] as const)("the sheet's Extract with AI that %s says nothing on B", async (outcome) => {
    const ex = deferred<unknown>();
    client.extractReceipt.mockReturnValue(ex.promise);
    const el = (b: string) => <ExpenseFormSideSheet businessId={b} categories={[]} editingExpense={editing} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.click(extractButton());
    await waitFor(() => expect(client.extractReceipt).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => {
      if (outcome === "answers") ex.resolve(ok({ invoiceData: { total: 99, lineItems: [{ description: "A toner" }] }, confidence: 0.9 }));
      else ex.reject(new TypeError("Failed to fetch"));
    });
    await settle();
    noToast2();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each(["answers", "throws"] as const)("the modal's Extract with AI that %s says nothing on B", async (outcome) => {
    const ex = deferred<unknown>();
    client.extractReceipt.mockReturnValue(ex.promise);
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={editing} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.click(extractButton());
    await waitFor(() => expect(client.extractReceipt).toHaveBeenCalled());
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => {
      if (outcome === "answers") ex.resolve(ok({ invoiceData: { total: 99, lineItems: [{ description: "A toner" }] }, confidence: 0.9 }));
      else ex.reject(new TypeError("Failed to fetch"));
    });
    await settle();
    noToast2();
  });

  it.each(["answers", "throws"] as const)("the modal's receipt upload that %s says nothing on B", async (outcome) => {
    const up = deferred<unknown>();
    upload.uploadFile.mockReturnValue(up.promise);
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalled());
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => {
      if (outcome === "answers") up.resolve({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj_1", metadata: {} });
      else up.reject(new TypeError("Failed to fetch"));
    });
    await settle();
    noToast2();
  });
});

describe("R14-1: the modal's recurring save whose schedule answers after its business is no longer shown", () => {
  it("says nothing and neither saves nor closes", async () => {
    client.createExpense.mockResolvedValue(ok({ id: "exp_A_new" }));
    const schedule = deferred<unknown>();
    client.createRecurringExpense.mockReturnValue(schedule.promise);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const el = (b: string) => <ExpenseFormModal businessId={b} categories={[]} editingExpense={null} onClose={onClose} onSaved={onSaved} />;
    const view = render(el("biz_A"));
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "A rent" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await act(async () => { schedule.resolve(ok({ id: "rec_A_new" })); });
    await settle();
    noToast2();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("R14-2: the data hook's picker read", () => {
  it("A's projects, services and contacts answering after B's do not fill B's pickers", async () => {
    const reads = { projects: deferred<unknown>(), services: deferred<unknown>(), contacts: deferred<unknown>() };
    client.fetchProjects.mockImplementation((b: string) => (b === "biz_A" ? reads.projects.promise : Promise.resolve(ok([]))));
    client.fetchServices.mockImplementation((b: string) => (b === "biz_A" ? reads.services.promise : Promise.resolve(ok([]))));
    client.fetchContacts.mockImplementation((b: string) => (b === "biz_A" ? reads.contacts.promise : Promise.resolve(ok({ contacts: [] }))));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(client.fetchContacts).toHaveBeenCalledWith("biz_A"));
    switchTo("biz_B");
    await waitFor(() => expect(client.fetchContacts).toHaveBeenCalledWith("biz_B"));
    await settle();
    await act(async () => {
      reads.projects.resolve(ok([{ id: "proj_A", name: "A project" }]));
      reads.services.resolve(ok([{ id: "svc_A", name: "A service" }]));
      reads.contacts.resolve(ok({ contacts: [{ id: "ct_A", displayName: "A contact" }] }));
    });
    await settle();
    expect(result.current.projects).toEqual([]);
    expect(result.current.services).toEqual([]);
    expect(result.current.contacts).toEqual([]);
  });
});

describe("R14-3: the CSV export", () => {
  function stubFetch() {
    const answer = deferred<unknown>();
    vi.stubGlobal("fetch", vi.fn(() => answer.promise));
    return answer;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("A's export failing after the switch to B says nothing on B", async () => {
    const answer = stubFetch();
    render(<ExpensesInboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    switchTo("biz_B");
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    await act(async () => { answer.resolve({ ok: false, status: 500, blob: async () => new Blob([]) }); });
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("control: a failing export with no switch says so", async () => {
    const answer = stubFetch();
    render(<ExpensesInboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Export CSV/ }));
    await act(async () => { answer.resolve({ ok: false, status: 500, blob: async () => new Blob([]) }); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't export expenses."));
  });
});

describe("R14-6: an editor opened on A closes on the switch to B", () => {
  it("the recurring panel's Edit of A's schedule closes, so Update cannot send A's schedule to B", async () => {
    const el = (b: string) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} />;
    const view = render(el("biz_A"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }));
    expect(await screen.findByRole("button", { name: /^Update$/ })).toBeTruthy();
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    await settle();
    expect(screen.queryByRole("button", { name: /^Update$/ }), "A's schedule editor is open on B").toBeNull();
    expect(client.updateRecurringExpense).not.toHaveBeenCalled();
  });

  it("the budgets tab's Set Budget modal closes", async () => {
    const el = (b: string) => <ExpenseBudgetsTab businessId={b} budgets={[]} categories={CATS[b]} expenses={[]} summary={null} onReload={vi.fn()} />;
    const view = render(el("biz_A"));
    fireEvent.click(screen.getAllByRole("button", { name: /Set Budget/i })[0]);
    fireEvent.change(await screen.findByPlaceholderText("5000.00"), { target: { value: "800" } });
    ws.bid = "biz_B";
    view.rerender(el("biz_B"));
    // The modal animates out (AnimatePresence): it is gone once its exit ends.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save Budget" }), "A's budget modal is open on B").toBeNull());
    expect(client.upsertExpenseBudget).not.toHaveBeenCalled();
  });
});
