/**
 * EXPENSES-HUB-3 repair round 25 (R24 + R24b reviews at 24c41fc; D-308, D-315), the page side.
 *
 *   R25-2  the Recurring list has its own read state: refused, thrown or no access is said, never "No recurring
 *          expenses" with its Add invitation (moves the R23-3 and R24 empty-state pins: a correction, not a weakening)
 *   R25-4  the picker read has a generation: an older failure never lands over a newer success
 *   R25-5  the picker read offers Retry when any of its parts can be retried
 *   R25-6  pins of guards no test held: a switch resets vendors, margin, candidates and pickers; A's thrown picker
 *          read does not fail B; a thrown main read fails the secondary blocks; no Retry on no access; each note's
 *          Retry reads its block again
 *   R25-7  the bill-extras notice names what was not saved; the Categories tab offers no Add while its list is unread
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

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
import ExpensesInboxPage from "../page";
import { ReadFailureNote } from "../components/read-failure-note";
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





// The client's real failure shapes (lib/api.ts): a refusal or a network failure resolves, it never rejects.
const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const noAccess = () => ({ data: null, error: "Insufficient permissions: crm requires read access (you have none)", status: 403 });
const LONG = { timeout: 10000 };

async function pageFor(view?: "Categories" | "Recurring") {
  render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
  if (view) fireEvent.click(await screen.findByRole("tab", { name: view }, LONG));
}
async function openSheet() {
  fireEvent.click((await screen.findAllByRole("button", { name: /add expense/i }, LONG))[0]);
  return screen.findByRole("dialog", {}, LONG);
}
const retryIn = (el: HTMLElement) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Retry") as HTMLButtonElement | undefined;

describe("R25-2: the Recurring list's own read", () => {
  it("refused: says 'Couldn't load recurring expenses' in the server's words, with Retry; never the empty state or Add", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(refusedAnswer());
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(new RegExp(`Couldn't load recurring expenses: ${WORDS}`))).toBeTruthy();
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
    client.fetchRecurringExpenses.mockResolvedValue(ok([SCHEDULE]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Run Now/i })).toBeTruthy();
    expect(screen.queryByText(/Couldn't load recurring expenses/)).toBeNull();
  });
  it("thrown: says it could not load, never the empty state", async () => {
    client.fetchRecurringExpenses.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(/Couldn't load recurring expenses/)).toBeTruthy();
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
  it("no access: says so, offers no Retry, never the empty state", async () => {
    client.fetchRecurringExpenses.mockResolvedValue({ data: null, error: "Insufficient permissions: expenses requires read access (you have none)", status: 403 });
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    await waitFor(() => expect(screen.queryByText(/access/i)).toBeTruthy());
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
  it("control: an empty list that answers shows the empty state", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(ok([]));
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(/no recurring expenses/i)).toBeTruthy();
  });
});

describe("R25-4: the picker read has a generation", () => {
  it("an older failure never lands over a newer success (two Retries, replies out of order)", async () => {
    client.fetchProjects.mockResolvedValue(refusedAnswer());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("failed"));
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    client.fetchProjects.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => { result.current.retryPickers(); });
    await waitFor(() => expect(client.fetchProjects).toHaveBeenCalledTimes(2));
    act(() => { result.current.retryPickers(); });
    await waitFor(() => expect(client.fetchProjects).toHaveBeenCalledTimes(3));
    await act(async () => { second.resolve(ok([])); });
    await waitFor(() => expect(result.current.pickersRead.kind).toBe("ok"));
    await act(async () => { first.resolve(refusedAnswer()); });
    await settle();
    expect(result.current.pickersRead.kind, "the older failure landed over the newer success").toBe("ok");
  });
});

describe("R25-5: the picker read offers Retry when any part can be retried", () => {
  it("projects no-access and services failed: failed, with Retry", async () => {
    client.fetchProjects.mockResolvedValue(noAccess());
    client.fetchServices.mockResolvedValue(refusedAnswer());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("failed"));
  });
  it("only no-access: no-access (no Retry)", async () => {
    client.fetchProjects.mockResolvedValue(noAccess());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("no-access"));
  });
});

describe("R25-6 (a): a switch resets the secondary blocks", () => {
  it("vendors, margin, candidates and pickers: A's refusals are loading on B while B's reads are out", async () => {
    client.fetchVendorAnalytics.mockResolvedValue(refusedAnswer());
    client.fetchMarginAnalysis.mockResolvedValue(refusedAnswer());
    client.fetchRecurringCandidates.mockResolvedValue(refusedAnswer());
    client.fetchProjects.mockResolvedValue(refusedAnswer());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => {
      expect(result.current.vendorsRead.kind).toBe("failed");
      expect(result.current.marginRead.kind).toBe("failed");
      expect(result.current.candidatesRead.kind).toBe("failed");
      expect(result.current.pickersRead.kind).toBe("failed");
    });
    client.fetchExpenses.mockImplementation((b: string) => (b === "biz_B" ? new Promise(() => {}) : Promise.resolve(ok({ data: [], total: 0, page: 1, limit: 20 }))));
    client.fetchProjects.mockImplementation((b: string) => (b === "biz_B" ? new Promise(() => {}) : Promise.resolve(refusedAnswer())));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    expect(result.current.vendorsRead.kind).toBe("loading");
    expect(result.current.marginRead.kind).toBe("loading");
    expect(result.current.candidatesRead.kind).toBe("loading");
    expect(result.current.pickersRead.kind).toBe("loading");
  });
  it("A's failed-links note does not show in B's sheet", async () => {
    client.fetchProjects.mockImplementation((b: string) => (b === "biz_A" ? Promise.resolve(refusedAnswer()) : new Promise(() => {})));
    await pageFor();
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()), LONG);
    const dialog = await openSheet();
    await settle();
    expect(dialog.textContent, "A's links failure shown in B's sheet").not.toMatch(/Couldn't load the projects/);
  }, 30000);
});

describe("R25-6 (b): the thrown picker read's business check", () => {
  it("A's picker read rejecting after the switch to B does not fail B's links", async () => {
    const contactsA = deferred<unknown>();
    client.fetchContacts.mockImplementation((b: string) => (b === "biz_A" ? contactsA.promise : Promise.resolve(ok({ contacts: [] }))));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(client.fetchContacts).toHaveBeenCalledWith("biz_A"));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(result.current.pickersRead.kind).toBe("ok"));
    await act(async () => { contactsA.reject(new TypeError("Failed to fetch")); });
    await settle();
    expect(result.current.pickersRead.kind, "A's throw failed B's links").toBe("ok");
  });
});

describe("R25-6 (c): a thrown main read fails the secondary blocks", () => {
  it("categories is failed, not loading for good", async () => {
    client.fetchExpenses.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.categoriesRead.kind).toBe("failed"));
  });
});

describe("R25-6 (d): the note offers no Retry on no access", () => {
  it("no-access: the words, and no Retry", () => {
    const onRetry = vi.fn();
    render(<ReadFailureNote read={{ kind: "no-access", message: "You don't have access to this" }} onRetry={onRetry} />);
    expect(screen.getByText(/You don't have access/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
  it("failed: Retry calls back", () => {
    const onRetry = vi.fn();
    render(<ReadFailureNote read={{ kind: "failed", message: "Couldn't load this." }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("R25-6 (e): each note's Retry reads its block again", () => {
  it("the sheet's links Retry reads the pickers again", async () => {
    client.fetchProjects.mockResolvedValue(refusedAnswer());
    await pageFor();
    const dialog = await openSheet();
    await waitFor(() => expect(dialog.textContent).toMatch(/Couldn't load the projects/));
    const before = client.fetchProjects.mock.calls.length;
    client.fetchProjects.mockResolvedValue(ok([]));
    const note = Array.from(dialog.querySelectorAll('[role="status"]')).find((n) => /projects/.test(n.textContent ?? "")) as HTMLElement;
    fireEvent.click(retryIn(note)!);
    await waitFor(() => expect(client.fetchProjects.mock.calls.length).toBeGreaterThan(before));
  }, 30000);
  it("the sheet's categories Retry reads the categories again", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor();
    const dialog = await openSheet();
    await waitFor(() => expect(dialog.textContent).toMatch(/Couldn't load expense categories/));
    const before = client.fetchExpenseCategories.mock.calls.length;
    const note = Array.from(dialog.querySelectorAll('[role="status"]')).find((n) => /categories/.test(n.textContent ?? "")) as HTMLElement;
    fireEvent.click(retryIn(note)!);
    await waitFor(() => expect(client.fetchExpenseCategories.mock.calls.length).toBeGreaterThan(before));
  }, 30000);
  it("the filter's Retry reads the categories again", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor();
    fireEvent.click(await screen.findByRole("button", { name: "Filters" }, LONG));
    const filters = document.getElementById("expenses-filters")!;
    await waitFor(() => expect(filters.textContent).toMatch(/Couldn't load expense categories/));
    const before = client.fetchExpenseCategories.mock.calls.length;
    fireEvent.click(retryIn(filters)!);
    await waitFor(() => expect(client.fetchExpenseCategories.mock.calls.length).toBeGreaterThan(before));
  }, 30000);
  it("the Recurring view's Retry reads the categories again", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor("Recurring");
    const note = (await screen.findByText(/Couldn't load expense categories/, {}, LONG)).closest('[role="status"]') as HTMLElement;
    const before = client.fetchExpenseCategories.mock.calls.length;
    fireEvent.click(retryIn(note)!);
    await waitFor(() => expect(client.fetchExpenseCategories.mock.calls.length).toBeGreaterThan(before));
  }, 30000);
});

describe("R25-7: two smaller items", () => {
  it("the bill-extras notice names what was not saved (tags only: not 'receipt')", async () => {
    finance.createBill.mockResolvedValue(ok({ id: "exp_A_bill" }));
    client.updateExpense.mockResolvedValue(refusedAnswer());
    render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={always} initialKind="bill" />);
    fill("A supplier", "300");
    fireEvent.change(screen.getByPlaceholderText(/tag/i), { target: { value: "urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Record bill" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("its tags were not saved")));
    expect(vi.mocked(toast.error).mock.calls.some(([m]) => /receipt/.test(String(m))), "names a receipt that was never there").toBe(false);
  });
  it("the Categories tab offers no Add while its list could not be read", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor("Categories");
    expect(await screen.findByText(/Couldn't load expense categories/, {}, LONG)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^add category$/i })).toBeNull();
    expect(screen.queryByLabelText("Category name")).toBeNull();
  }, 30000);
  it("control: with its list read, the Categories tab offers Add", async () => {
    await pageFor("Categories");
    expect(await screen.findByRole("button", { name: /^add category$/i }, LONG)).toBeTruthy();
  }, 30000);
});
