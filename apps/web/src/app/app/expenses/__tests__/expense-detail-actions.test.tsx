/**
 * FOLLOW3-B7-EXPENSE-EDIT-POSTED (V1-82; owner ruling D-67) — the expense
 * detail page's Approve and Reject do what they say.
 *
 * WHY: handleApprove sent {status: 'PAID', paidAt} and handleReject
 * {status: 'VOID'} to PATCH /expenses/businesses/:b/expenses/:id, whose
 * updateExpense never reads `status`, so both were 200 no-ops; the page then
 * toasted "Expense approved" / "Expense rejected" without reading the
 * ApiResult's error. D-67: on a BILL, Approve pays it through the existing
 * door POST /finance/businesses/:b/bills/:id/pay (Dr AP / Cr cash) and Reject
 * voids it through POST .../bills/:id/void (the reversal); both buttons are
 * hidden for an expense that is not a BILL. The server side of both doors is
 * pinned in apps/server/test/expense-edit-posted.integration.test.ts (EE-06,
 * EE-07).
 *
 * Mounted on the real ExpenseDetailPage; the client reads, the finance API
 * helpers, the workspace, next/navigation and sonner are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const BUSINESS = "biz_b7_detail";
const EXPENSE_ID = "exp_b7";

const getExpense = vi.fn();
const updateExpense = vi.fn();
const deleteExpense = vi.fn();
const payBill = vi.fn();
const voidBill = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/app/expenses/${EXPENSE_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: EXPENSE_ID }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => BUSINESS }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test" }));
vi.mock("@/lib/client", () => ({
  getExpense: (...args: unknown[]) => getExpense(...args),
  updateExpense: (...args: unknown[]) => updateExpense(...args),
  deleteExpense: (...args: unknown[]) => deleteExpense(...args),
  createExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchExpenseCategories: vi.fn(async () => ({ data: [], error: null })),
  fetchExpenseBudgets: vi.fn(async () => ({ data: [], error: null })),
  PAYMENT_METHODS: [],
}));
vi.mock("@/lib/api/finance", () => ({
  payBill: (...args: unknown[]) => payBill(...args),
  voidBill: (...args: unknown[]) => voidBill(...args),
}));

import { toast } from "sonner";
import ExpenseDetailPage from "../[id]/page";

function expense(status: string): Expense {
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
    status,
    categoryId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

async function mount(status: string) {
  getExpense.mockResolvedValue({ data: expense(status), error: null });
  render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Office Depot" });
}

beforeEach(() => {
  for (const fn of [getExpense, updateExpense, deleteExpense, payBill, voidBill]) fn.mockReset();
  updateExpense.mockResolvedValue({ data: expense("BILL"), error: null });
  payBill.mockResolvedValue({ data: { ...expense("PAID"), paidAt: "2026-11-03T00:00:00.000Z" }, error: null });
  voidBill.mockResolvedValue({ data: expense("VOID"), error: null });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("D-67: Approve pays a BILL and Reject voids it, through the bills doors", () => {
  it("Approve on a BILL calls payBill(businessId, id) and never updateExpense; the page shows the paid row", async () => {
    await mount("BILL");
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));

    await waitFor(() => expect(payBill).toHaveBeenCalledTimes(1));
    expect(payBill).toHaveBeenCalledWith(BUSINESS, EXPENSE_ID);
    expect(updateExpense).not.toHaveBeenCalled();
    expect(voidBill).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    // The row the door returned: no longer a BILL, so no Approve / Reject.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull());
  });

  it("Reject on a BILL calls voidBill(businessId, id) and never updateExpense", async () => {
    await mount("BILL");
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));

    await waitFor(() => expect(voidBill).toHaveBeenCalledTimes(1));
    expect(voidBill).toHaveBeenCalledWith(BUSINESS, EXPENSE_ID);
    expect(updateExpense).not.toHaveBeenCalled();
    expect(payBill).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull());
  });

  it("an {error} from payBill shows toast.error with it and no success toast; the BILL stays actionable", async () => {
    payBill.mockResolvedValue({ data: null, error: "Cannot mark a voided expense as paid", status: 400 });
    await mount("BILL");
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot mark a voided expense as paid"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Approve/ })).toBeTruthy();
  });

  it("an {error} from voidBill shows toast.error with it and no success toast", async () => {
    voidBill.mockResolvedValue({ data: null, error: "Ledger entry is locked by reconciliation", status: 409 });
    await mount("BILL");
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ledger entry is locked by reconciliation"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(["PAID", "VOID"])("a %s expense shows neither Approve nor Reject (D-67: BILLs only)", async (status) => {
    await mount(status);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull();
  });
});
