/**
 * EXPENSES-HUB-3 (BUG-072, fixed by removal; journey H10 "no invented figures", which reads the expense's page).
 *
 * The expense detail page shows an approval chain and a history the server never sent: "Approval: Manager" with
 * "Jane → Finance" on a bill and "Self / Auto-approved" otherwise, "Policy check passed" and "Within policy" (there is
 * no expense policy), "Uploaded today" under every date, "Recurring SaaS" for any recurring expense, "Tax included"
 * for every expense, and an activity list ("Uploaded receipt", "Rule suggested ...", "Queued for review",
 * "Approved") stamped "Today" whatever happened. All of it is deleted: the page shows nothing the server did not send.
 *
 * Mounted on the real ExpenseDetailPage; the client reads, the finance API helpers, the workspace, next/navigation
 * and sonner are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const EXPENSE_ID = "exp_hub3_detail";
const getExpense = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_hub3_detail",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_hub3_detail" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => "biz_hub3_detail",
  getCachedBusiness: () => ({ id: "biz_hub3_detail", name: "Detail Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/client", () => ({
  getExpense: (...args: unknown[]) => getExpense(...args),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  voidExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchExpenseCategories: vi.fn(async () => ({ data: [], error: null })),
  fetchExpenseBudgets: vi.fn(async () => ({ data: [], error: null })),
  fetchFinancialAccounts: vi.fn(async () => ({ data: [], error: null })),
  PAYMENT_METHODS: [],
}));
vi.mock("@/lib/api/finance", () => ({ payBill: vi.fn(), voidBill: vi.fn(), createBill: vi.fn() }));

import ExpenseDetailPage from "../[id]/page";

function expense(over: Partial<Expense>): Expense {
  return {
    id: EXPENSE_ID,
    description: "Printer toner",
    amount: 30,
    currency: "TTD",
    date: "2026-11-01T00:00:00.000Z",
    vendor: "Office Depot",
    paymentMethod: "cash",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  } as Expense;
}

const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";

const INVENTED = [
  /\bJane\b/,
  /approval\s*:?\s*manager/i,
  /auto-approved/i,
  /policy check passed/i,
  /within policy/i,
  /uploaded today/i,
  /recurring saas/i,
  /tax included/i,
  /rule suggested/i,
  /queued for review/i,
  /finance workflow/i,
];

beforeEach(() => getExpense.mockReset());
afterEach(() => cleanup());

describe("BUG-072: the expense detail page shows no approval chain, policy or history the server did not send", () => {
  for (const [label, over] of [
    ["a bill to pay later", { status: "BILL" }],
    ["a paid expense", { status: "PAID", isRecurring: true, receiptUrl: "http://api.test/objects/uploads/biz/obj.jpg" }],
  ] as const) {
    it(`${label}: none of the invented lines`, async () => {
      getExpense.mockResolvedValue({ data: expense(over as Partial<Expense>), error: null });
      render(<ExpenseDetailPage />);
      await screen.findByRole("heading", { name: "Office Depot" });
      const seen = INVENTED.filter((re) => re.test(text())).map((re) => re.source);
      expect(seen).toEqual([]);
    });
  }
});
