/**
 * EXPENSES-HUB-3 repair round 1 (acceptance reviews at f6d3c2f0), the expense detail page and the Add expense sheet.
 *
 *   COR MINOR-1 a receipt stored at an /objects/ path cannot be viewed yet (no route serves it: server row P222), so
 *               the detail page and the sheet say "Receipt stored — viewing isn't available yet" and offer no link
 *               to it; a receipt at another address (a Drive copy) keeps its link
 *   COR MINOR-4 the budget is the server's for the expense's own month: "Remaining" is the server's remaining as is
 *               (it already counts the expense), and the month named is the expense's
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const BUSINESS = "biz_hub3_r1";
const EXPENSE_ID = "exp_hub3_r1";
const getExpense = vi.hoisted(() => vi.fn());
const fetchExpenseBudgets = vi.hoisted(() => vi.fn());
const fetchExpenseCategories = vi.hoisted(() => vi.fn());
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_hub3_r1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_hub3_r1" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => "biz_hub3_r1",
  getCachedBusiness: () => ({ id: "biz_hub3_r1", name: "R1 Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile, isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/client", () => ({
  getExpense: (...args: unknown[]) => getExpense(...args),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchExpenseCategories: (...args: unknown[]) => fetchExpenseCategories(...args),
  fetchExpenseBudgets: (...args: unknown[]) => fetchExpenseBudgets(...args),
  fetchFinanceAccounts: vi.fn(async () => ({ data: [], error: null })),
  PAYMENT_METHODS: [],
}));
vi.mock("@/lib/api/finance", () => ({ payBill: vi.fn(), voidBill: vi.fn(), createBill: vi.fn() }));

import ExpenseDetailPage from "../[id]/page";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const OBJECT_URL = `http://api.test/objects/uploads/${BUSINESS}/obj_1`;
const DRIVE_URL = "https://drive.google.com/file/d/abc/view";

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: EXPENSE_ID,
    description: "Printer toner",
    amount: 100,
    currency: "TTD",
    date: "2026-10-15T00:00:00.000Z",
    vendor: "Office Depot",
    paymentMethod: "cash",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: "cat_office",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...over,
  } as Expense;
}

const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";

beforeEach(() => {
  getExpense.mockReset();
  fetchExpenseBudgets.mockReset().mockResolvedValue({ data: [], error: null });
  fetchExpenseCategories.mockReset().mockResolvedValue({ data: [{ id: "cat_office", name: "Office", color: "#06b6d4" }], error: null });
  uploadFile.mockReset();
});
afterEach(() => cleanup());

async function mountDetail(over: Partial<Expense>) {
  getExpense.mockResolvedValue({ data: expense(over), error: null });
  render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Office Depot" });
}

describe("COR MINOR-1: a stored receipt is said, not linked, until it can be viewed (P222)", () => {
  it("the detail page says 'Receipt stored — viewing isn't available yet' and links nothing at the /objects/ path", async () => {
    await mountDetail({ receiptUrl: OBJECT_URL });
    expect(text()).toMatch(/receipt stored — viewing isn't available yet/i);
    const links = screen.queryAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).not.toContain(OBJECT_URL);
    expect(document.querySelector(`img[src="${OBJECT_URL}"]`)).toBeNull();
    expect(text()).not.toMatch(/no receipt uploaded/i);
  });

  it("a receipt at another address (a Drive copy) keeps its link", async () => {
    await mountDetail({ receiptUrl: DRIVE_URL });
    const links = screen.queryAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(DRIVE_URL);
    expect(text()).not.toMatch(/viewing isn't available yet/i);
  });

  it("the sheet says the same once a photo is stored", async () => {
    uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: `/objects/uploads/${BUSINESS}/obj_1`, metadata: {} });
    render(<ExpenseFormSideSheet businessId={BUSINESS} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText(/^take photo$/i), { target: { files: [new File([new Uint8Array([1])], "r.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(within(sheet).getByText(/receipt stored — viewing isn't available yet/i)).toBeTruthy());
  });
});

describe("COR MINOR-4: the budget is the server's, for the expense's own month", () => {
  it("reads the budgets of the expense's month and shows the server's remaining as is", async () => {
    fetchExpenseBudgets.mockResolvedValue({
      data: [{ id: "bud_oct", categoryId: "cat_office", category: { id: "cat_office", name: "Office" }, amount: 500, spent: 200, remaining: 300, percentUsed: 40, isOverBudget: false, isNearAlert: false }],
      error: null,
    });
    await mountDetail({});
    await waitFor(() => expect(fetchExpenseBudgets).toHaveBeenCalledWith(BUSINESS, 10, 2026));
    await waitFor(() => expect(text()).toMatch(/October 2026/));
    expect(text()).toMatch(/Remaining\s*TTD\s*300\.00/);
    expect(text()).not.toMatch(/Remaining after/i);
    expect(text()).not.toMatch(/TTD\s*200\.00\s*$/);
  });
});
