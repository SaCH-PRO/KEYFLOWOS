/**
 * EXPENSES-HUB-3 repair round 2 (round-1 correctness confirmation at cf53669).
 *
 *   R2-1 a Drive copy that fails after the expense was created is a notice on a saved expense, not "Failed to save
 *        expense" with the sheet left open (a second Save would create a duplicate)
 *   R2-2 a cross-tab change of the stored business (the storage event) is adopted as BUSINESS_CHANGED_EVENT is: the
 *        new business is read and a late reply for the old one is dropped
 *   R2-3 only /objects/uploads/<this business>/ is a stored receipt: any other /objects/ path is neither linked nor
 *        said to be stored, on the detail page and in the sheet
 *   R2-4 "Missing receipts" is the server's count over every status: the card says so and does not open a narrower
 *        list (the Approved tab)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const nav = vi.hoisted(() => ({ id: "exp_r2" }));

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
  getExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
  fetchFinanceAccounts: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());
const uploadToDrive = vi.hoisted(() => vi.fn(async (_req: Record<string, unknown>) => true));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: nav.id }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile, isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";
import ExpenseDetailPage from "../[id]/page";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";
const STORED_NOTE = /receipt stored — viewing isn't available yet/i;

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_r2",
    description: "Alpha rent",
    amount: 4321,
    currency: "TTD",
    date: "2026-11-20T00:00:00.000Z",
    vendor: "Alpha Landlord",
    paymentMethod: "cash",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    ...over,
  } as Expense;
}

function summary(total: number, extra: Record<string, unknown> = {}) {
  return { total, count: 1, byCategory: [], missingReceiptCount: 0, comparison: { prevTotal: 0, prevCount: 0, changePercent: 0, direction: "flat" }, ...extra };
}

beforeEach(() => {
  ws.bid = "biz_A";
  nav.id = "exp_r2";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok(summary(0)));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  client.fetchFinanceAccounts.mockResolvedValue(ok([]));
  client.createExpense.mockResolvedValue(ok({ id: "exp_new", description: "x", amount: 1, status: "PAID" }));
  uploadFile.mockReset();
  uploadToDrive.mockClear();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => cleanup());

describe("R2-1: a Drive copy that fails after the save is a notice, not a failed save", () => {
  it("the photo's bytes cannot be read: one create, the sheet closes, the notice says the Drive copy was not made", async () => {
    uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj1", metadata: {} });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={onClose} onSaved={onSaved} />);
    const sheet = screen.getByRole("dialog");
    const photo = new File([new Uint8Array([1])], "r.jpg", { type: "image/jpeg" });
    Object.defineProperty(photo, "arrayBuffer", { value: () => Promise.reject(new Error("NotReadableError")) });
    fireEvent.change(within(sheet).getByLabelText(/^take photo$/i), { target: { files: [photo] } });
    await waitFor(() => expect(within(sheet).getByText(/receipt attached/i)).toBeTruthy());
    fireEvent.change(within(sheet).getByPlaceholderText(/What was this expense for|description/i), { target: { value: "Flour" } });
    fireEvent.change(within(sheet).getByPlaceholderText("0.00"), { target: { value: "10" } });
    const buttons = within(sheet).getAllByRole("button", { name: /^(add|save|create)( expense)?$/i });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose, "the sheet closes once").toHaveBeenCalledTimes(1);
    expect(client.createExpense).toHaveBeenCalledTimes(1);
    const errors = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
    expect(errors.some((m) => /failed to save expense/i.test(m)), `errors: ${JSON.stringify(errors)}`).toBe(false);
    expect(errors.some((m) => /expense saved, but .*drive copy was not made/i.test(m)), `errors: ${JSON.stringify(errors)}`).toBe(true);
    expect(uploadToDrive).not.toHaveBeenCalled();
  });
});

describe("R2-2: a cross-tab change of the stored business is adopted", () => {
  it("the storage event re-reads for the new business and drops the old one's late reply", async () => {
    let resolveA: (v: unknown) => void = () => {};
    client.fetchExpenses.mockImplementation((b: string) =>
      b === "biz_A" ? new Promise((r) => { resolveA = r; }) : Promise.resolve(ok({ data: [expense({ id: "exp_b1", description: "Beta fuel", amount: 55 })], total: 1, page: 1, limit: 20 })),
    );
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B";
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", oldValue: "biz_A", newValue: "biz_B" }));
    });
    await waitFor(() => expect(text()).toMatch(/beta fuel/i));
    await act(async () => { resolveA(ok({ data: [expense()], total: 1, page: 1, limit: 20 })); });
    expect(text()).not.toMatch(/alpha rent/i);
    expect(text()).toMatch(/beta fuel/i);
  });

  it("a storage event for another key changes nothing", async () => {
    client.fetchExpenses.mockResolvedValue(ok({ data: [expense()], total: 1, page: 1, limit: 20 }));
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/alpha rent/i));
    const calls = client.fetchExpenses.mock.calls.length;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_theme", newValue: "dark" }));
    });
    expect(client.fetchExpenses.mock.calls.length).toBe(calls);
    expect(text()).toMatch(/alpha rent/i);
  });
});

describe("R2-3: only this business's /objects/uploads/ path is a stored receipt", () => {
  async function mountDetail(receiptUrl: string) {
    client.getExpense.mockResolvedValue(ok(expense({ receiptUrl })));
    render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "Alpha Landlord" });
  }

  it("detail: this business's path is said to be stored, with no link", async () => {
    await mountDetail("http://api.test/objects/uploads/biz_A/obj1");
    expect(text()).toMatch(STORED_NOTE);
    expect(screen.queryAllByRole("link").map((a) => a.getAttribute("href"))).not.toContain("http://api.test/objects/uploads/biz_A/obj1");
  });

  for (const [what, url] of [
    ["another business's upload", "http://api.test/objects/uploads/biz_OTHER/obj1"],
    ["an /objects/ path that is not an upload", "http://api.test/objects/exports/biz_A/x.zip"],
  ] as const) {
    it(`detail: ${what} is neither linked nor said to be stored`, async () => {
      await mountDetail(url);
      expect(text()).not.toMatch(STORED_NOTE);
      expect(screen.queryAllByRole("link").map((a) => a.getAttribute("href"))).not.toContain(url);
      expect(document.querySelector(`img[src="${url}"]`)).toBeNull();
    });

    it(`sheet: ${what} is not said to be stored`, () => {
      render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={expense({ receiptUrl: url })} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(within(screen.getByRole("dialog")).queryByText(STORED_NOTE)).toBeNull();
    });
  }

  it("sheet: this business's path is said to be stored (pins the sheet's own check)", () => {
    render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={expense({ receiptUrl: "http://api.test/objects/uploads/biz_A/obj1" })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).getByText(STORED_NOTE)).toBeTruthy();
  });
});

describe("R2-4: 'Missing receipts' says it counts every status and opens no narrower list", () => {
  it("the card names all statuses, and pressing it leaves the list as it was", async () => {
    client.fetchExpenses.mockResolvedValue(ok({ data: [expense({ id: "exp_bill", status: "BILL", description: "Phone bill" })], total: 1, page: 1, limit: 20 }));
    client.fetchExpenseSummary.mockResolvedValue(ok(summary(300, { missingReceiptCount: 3 })));
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/phone bill/i));
    const card = screen.getByRole("button", { name: /missing receipts/i });
    expect(card.textContent).toMatch(/all statuses/i);
    fireEvent.click(card);
    // The bill sits in Inbox; the card used to switch the list to Approved, which hides it.
    expect(text()).toMatch(/phone bill/i);
  });
});
