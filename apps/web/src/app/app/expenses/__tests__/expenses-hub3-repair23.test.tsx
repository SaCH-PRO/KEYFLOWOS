/**
 * EXPENSES-HUB-3 repair round 23 (R22 reviews at bf31a26; D-315).
 *
 *   R23-1  the sheet's Extract, with another tab switching A -> B -> A while it is out: its reply or failure says and
 *          writes nothing, and the button is usable again (extracting clears in a finally)
 *   R23-2  the same-business control: a throwing Extract says "Extraction failed" and the button is usable again
 *   R23-3  the panel's same-business control: a rejected read shows "No recurring expenses"
 *   R23-5  the page's sheet never renders for B: no instance of it is given B's id while it holds A's state; a
 *          device capture's prefill still opens it on the first business
 *   R23-7  the page's effects, without lint disables, behave as before: the prefill opens the sheet once and the
 *          query param is stripped once, though the router is a new object on every render
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
// The search params are one object until a test sets others, as in the app; the router is a new object on every
// render (the page must not run its prefill effect again for that).
const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.sp,
}));
beforeEach(() => { nav.sp = new URLSearchParams(); nav.replace.mockReset(); });
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

const sheetRenders = vi.hoisted(() => [] as string[]);
// A transparent wrapper: it records the business each render of the sheet is given, then renders the real sheet.
vi.mock("../components/expense-form-sidesheet", async (importOriginal) => {
  const m = await importOriginal<typeof import("../components/expense-form-sidesheet")>();
  const R = await import("react");
  const Recorded = (p: React.ComponentProps<typeof m.ExpenseFormSideSheet>) => {
    sheetRenders.push(p.businessId);
    return R.createElement(m.ExpenseFormSideSheet, p);
  };
  return { ...m, ExpenseFormSideSheet: Recorded };
});
beforeEach(() => { sheetRenders.length = 0; });

import { toast } from "sonner";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import ExpensesInboxPage from "../page";

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
afterEach(() => {
  ZONES.biz_A = "America/Port_of_Spain";
  vi.useRealTimers();
});


afterEach(() => { blocked.on = false; });
const always = () => true;





const receiptExpense = () => expense({ status: "PAID", receiptUrl: "https://drive.google.com/file/d/abc/view" });
const extractButton = () => screen.getAllByRole("button").find((b) => /Extract with AI|Extracting/.test(b.textContent ?? "")) as HTMLButtonElement;
const sheetEl = () => <ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={receiptExpense()} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={always} />;
const descriptionValue = () => (screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement).value;

describe("R23-1: the sheet's Extract, with another tab switching A -> B -> A while it is out", () => {
  for (const outcome of ["answers", "throws"] as const) {
    it(`that ${outcome} after the switch away says and writes nothing, and the button is usable again on A`, async () => {
      const ex = deferred<unknown>();
      client.extractReceipt.mockReturnValue(ex.promise);
      render(sheetEl());
      const before = descriptionValue();
      fireEvent.click(extractButton());
      await waitFor(() => expect(extractButton().textContent).toMatch(/Extracting/));
      ws.bid = "biz_B"; // another tab switched away
      await act(async () => {
        if (outcome === "answers") ex.resolve(ok({ invoiceData: { total: 99, lineItems: [{ description: "B toner" }] }, confidence: 0.9 }));
        else ex.reject(new TypeError("Failed to fetch"));
      });
      await settle();
      ws.bid = "biz_A"; // and back
      await settle();
      noToast2();
      expect(toast.info).not.toHaveBeenCalled();
      expect(descriptionValue(), "the reply wrote the form").toBe(before);
      expect(extractButton().textContent, "Extract stuck on Extracting…").toMatch(/Extract with AI/);
      expect(extractButton().disabled).toBe(false);
    });
  }
});

describe("R23-2: the sheet's Extract that throws, with no switch", () => {
  it("says 'Extraction failed' and the button is usable again", async () => {
    client.extractReceipt.mockRejectedValue(new TypeError("Failed to fetch"));
    render(sheetEl());
    fireEvent.click(extractButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Extraction failed"));
    await settle();
    expect(extractButton().textContent).toMatch(/Extract with AI/);
    expect(extractButton().disabled).toBe(false);
  });
});

describe("R23-3: the recurring panel's read that fails, with no switch", () => {
  it("shows the empty state", async () => {
    client.fetchRecurringExpenses.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(/no recurring expenses/i)).toBeTruthy();
  });
});

describe("R23-5: the page's sheet across a switch", () => {
  it("never renders for B: no instance of it has B's id with A's state", async () => {
    render(<ExpensesInboxPage />);
    const LONG = { timeout: 10000 };
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click((await screen.findAllByRole("button", { name: /add expense/i }, LONG))[0]);
    const desc = await screen.findByPlaceholderText("What was this expense for?", {}, LONG);
    fireEvent.change(desc, { target: { value: "A rent" } });
    expect(sheetRenders.at(-1)).toBe("biz_A");
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()), LONG);
    await settle();
    expect(sheetRenders, "the sheet rendered with B's id").not.toContain("biz_B");
    expect(screen.queryByPlaceholderText("What was this expense for?")).toBeNull();
  }, 30000);
});

describe("R23-5 / R23-7: a device capture's prefill on the page", () => {
  it("opens the sheet on the first business with the prefill, and strips the param once", async () => {
    nav.sp = new URLSearchParams(`prefill=${encodeURIComponent(JSON.stringify({ description: "Fuel from capture", amount: 12 }))}`);
    render(<ExpensesInboxPage />);
    const LONG = { timeout: 10000 };
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    const desc = await screen.findByPlaceholderText("What was this expense for?", {}, LONG);
    expect((desc as HTMLInputElement).value, "the first business closed the capture's sheet").toBe("Fuel from capture");
    await settle();
    expect(nav.replace, "the prefill effect ran again").toHaveBeenCalledTimes(1);
    expect(sheetRenders.every((b) => b === "biz_A")).toBe(true);
  }, 30000);
});
