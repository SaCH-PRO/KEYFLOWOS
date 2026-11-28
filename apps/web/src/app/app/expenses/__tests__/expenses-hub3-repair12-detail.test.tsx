/**
 * EXPENSES-HUB-3 repair round 12 (R11 confirmations at 55b2f46, MINOR): the detail page's Download link uses the
 * trimmed receipt address, as the preview link and image already do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const EXPENSE_ID = "exp_hub3_r12";
const getExpense = vi.hoisted(() => vi.fn());
const fetchExpenseBudgets = vi.hoisted(() => vi.fn());
const fetchExpenseCategories = vi.hoisted(() => vi.fn());
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_hub3_r12",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_hub3_r12" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => "biz_hub3_r12",
  getCachedBusiness: () => ({ id: "biz_hub3_r12", name: "R12 Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
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


describe("R12-2: the Download link", () => {
  it("links the trimmed address of a padded receipt link", async () => {
    await mountDetail({ receiptUrl: `  ${DRIVE_URL}  ` });
    const download = screen.getByText("Download").closest("a");
    expect(download?.getAttribute("href")).toBe(DRIVE_URL);
    expect(screen.getByText(/view receipt/i).closest("a")?.getAttribute("href")).toBe(DRIVE_URL);
  });
});
