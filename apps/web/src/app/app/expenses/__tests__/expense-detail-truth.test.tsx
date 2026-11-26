/**
 * EXPENSES-HUB-1 (web half; BUG-031, BUG-058; owner ruling voidexpense D-170) - the expense detail page tells the
 * truth about Delete and offers Void on a posted expense.
 *
 * WHY: handleDelete awaited deleteExpense and toasted "Expense deleted" and left the page whatever came back. The
 * client answers a refusal as { data: null, error } and does not throw, and the server refuses to delete a posted
 * expense (FIN3: "Cannot delete a posted expense - call POST .../bills/:id/void ..."), so Delete on a paid expense
 * said "deleted" and deleted nothing (BUG-031). A posted expense offered Delete and no way to correct it (BUG-058);
 * D-170: a "Void expense" action, with a confirm step, on posted expenses (POST .../bills/:id/void, the reversal the
 * server pins in expense-edit-posted.integration.test.ts).
 *
 *   EDT-01  RED  a refused Delete says why, names Void, does not say "deleted" and stays on the expense
 *   EDT-02  ctrl a Delete that goes through says so and goes back to the list
 *   EDT-03  RED  a PAID (posted) expense offers "Void expense"; it asks first, and only the confirm voids
 *   EDT-04  RED  Cancel on the confirm step voids nothing
 *   EDT-05  RED  a refused void says the server's words and no success; the expense stays as it was
 *   EDT-06  ctrl a BILL (Reject voids it) and a VOID expense offer no "Void expense"
 *   Repair round 1 (acceptance reviews at 35c72cb):
 *   EDT-07  pin  SEC MINOR-3: a member without expenses write is told so on Delete, and nothing says "deleted"
 *   EDT-08  pin  SEC MINOR-3: the same on Void, and nothing says "voided"
 *   EDT-09  RED  COR M1: a refused Delete on a BILL names Reject (a bill's void), not a Void it does not offer
 *   EDT-10  RED  COR M1: a refused Delete on a VOID row says it is already voided, not to void it
 *
 * Mounted on the real ExpenseDetailPage; the client reads, the finance API helpers, the workspace, next/navigation
 * and sonner are stubbed (as expense-detail-actions.test.tsx does).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const BUSINESS = "biz_hub1_truth";
const EXPENSE_ID = "exp_hub1_truth";

const getExpense = vi.fn();
const deleteExpense = vi.fn();
const payBill = vi.fn();
const voidBill = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/app/expenses/${EXPENSE_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: EXPENSE_ID }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => BUSINESS }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test" }));
vi.mock("@/lib/client", () => ({
  getExpense: (...args: unknown[]) => getExpense(...args),
  updateExpense: vi.fn(),
  deleteExpense: (...args: unknown[]) => deleteExpense(...args),
  createExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchExpenseCategories: vi.fn(async () => ({ data: [], error: null })),
  fetchExpenseBudgets: vi.fn(async () => ({ data: [], error: null })),
  fetchFinanceAccounts: vi.fn(async () => ({ data: { items: [] }, error: null })),
  PAYMENT_METHODS: [{ value: "cash", label: "Cash" }],
}));
vi.mock("@/lib/api/finance", () => ({
  payBill: (...args: unknown[]) => payBill(...args),
  voidBill: (...args: unknown[]) => voidBill(...args),
}));

import { toast } from "sonner";
import ExpenseDetailPage from "../[id]/page";

const SCOPE_REFUSAL = "Insufficient permissions: expenses requires write access (you have read)";
const POSTED_REFUSAL =
  "Cannot delete a posted expense — call POST /finance/businesses/:businessId/bills/:expenseId/void to reverse the ledger entries instead.";

function expense(status: string): Expense {
  return {
    id: EXPENSE_ID,
    description: "Gas cylinder",
    amount: 95,
    currency: "TTD",
    date: "2026-11-01T00:00:00.000Z",
    vendor: "Massy Gas",
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
  await screen.findByRole("heading", { name: "Massy Gas" });
}

const successTexts = () => vi.mocked(toast.success).mock.calls.map((c) => String(c[0]));
const errorTexts = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));

function openDialog(): HTMLElement {
  const dialogs = screen.getAllByRole("dialog");
  return dialogs[dialogs.length - 1];
}

beforeEach(() => {
  for (const fn of [getExpense, deleteExpense, payBill, voidBill, push]) fn.mockReset();
  voidBill.mockResolvedValue({ data: expense("VOID"), error: null });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EXPENSES-HUB-1: Delete tells the truth (BUG-031)", () => {
  it("EDT-01 a refused Delete says why, names Void, does not say 'deleted' and stays on the expense", async () => {
    deleteExpense.mockResolvedValue({ data: null, error: POSTED_REFUSAL });
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(deleteExpense).toHaveBeenCalledTimes(1));
    expect(deleteExpense).toHaveBeenCalledWith(BUSINESS, EXPENSE_ID);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(successTexts().filter((t) => /deleted/i.test(t))).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    // Said in the owner's words, with the way out: Void. No API path.
    const said = errorTexts().join(" | ");
    expect(said).toMatch(/can't be deleted|cannot be deleted/i);
    expect(said).toMatch(/void/i);
    expect(said).not.toMatch(/POST \/finance/);
    // Still on the expense.
    expect(screen.getByRole("heading", { name: "Massy Gas" })).toBeTruthy();
  });

  it("EDT-02 a Delete that goes through says so and goes back to the list", async () => {
    deleteExpense.mockResolvedValue({ data: undefined, error: null });
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Expense deleted"));
    expect(push).toHaveBeenCalledWith("/app/expenses");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("EXPENSES-HUB-1: Void a posted expense, with a confirm step (D-170, BUG-058)", () => {
  it("EDT-03 a PAID expense offers 'Void expense'; it asks first, and only the confirm voids", async () => {
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /^Void expense$/ }));

    const dialog = openDialog();
    expect(within(dialog).getByText(/void this expense\?/i)).toBeTruthy();
    expect(voidBill).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^Void expense$/ }));
    await waitFor(() => expect(voidBill).toHaveBeenCalledTimes(1));
    expect(voidBill.mock.calls[0][0]).toBe(BUSINESS);
    expect(voidBill.mock.calls[0][1]).toBe(EXPENSE_ID);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Expense voided"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(deleteExpense).not.toHaveBeenCalled();
    // The row as the door answered it: VOID, so nothing left to void.
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Void expense$/ })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("EDT-04 Cancel on the confirm step voids nothing", async () => {
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /^Void expense$/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Cancel$/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(voidBill).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Void expense$/ })).toBeTruthy();
  });

  it("EDT-05 a refused void says the server's words and no success; the expense stays as it was", async () => {
    voidBill.mockResolvedValue({ data: null, error: "Ledger entry is locked by reconciliation", status: 409 });
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /^Void expense$/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Void expense$/ }));

    await waitFor(() => expect(errorTexts().join(" | ")).toMatch(/Ledger entry is locked by reconciliation/));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Void expense$/ })).toBeTruthy();
  });

  it.each(["BILL", "VOID"])("EDT-06 a %s expense offers no 'Void expense'", async (status) => {
    await mount(status);
    expect(screen.queryByRole("button", { name: /^Void expense$/ })).toBeNull();
  });
});

describe("EXPENSES-HUB-1 repair round 1: refusals said as they are, for the row they are about", () => {
  it("EDT-07 a member without expenses write is told so on Delete, and nothing says 'deleted'", async () => {
    deleteExpense.mockResolvedValue({ data: null, error: SCOPE_REFUSAL, status: 403 });
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(errorTexts().join(" | ")).toMatch(/You can't delete this expense in this business: it needs expenses write access\./);
    expect(successTexts().filter((t) => /deleted/i.test(t))).toEqual([]);
    expect(errorTexts().join(" | ")).not.toMatch(/void it/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("EDT-08 a member without expenses write is told so on Void, and nothing says 'voided'", async () => {
    voidBill.mockResolvedValue({ data: null, error: SCOPE_REFUSAL, status: 403 });
    await mount("PAID");
    fireEvent.click(screen.getByRole("button", { name: /^Void expense$/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Void expense$/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(errorTexts().join(" | ")).toMatch(/You can't void this expense in this business: it needs expenses write access\./);
    expect(successTexts().filter((t) => /voided/i.test(t))).toEqual([]);
    expect(screen.getByRole("button", { name: /^Void expense$/ })).toBeTruthy();
  });

  it("EDT-09 a refused Delete on a BILL names Reject, not a Void it does not offer", async () => {
    deleteExpense.mockResolvedValue({ data: null, error: POSTED_REFUSAL });
    await mount("BILL");
    fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const said = errorTexts().join(" | ");
    expect(said).toMatch(/can't be deleted/i);
    expect(said).toMatch(/Reject it instead/);
    expect(said).not.toMatch(/Void it/);
    expect(screen.getByRole("button", { name: /^Reject$/ })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("EDT-10 a refused Delete on a VOID row says it is already voided, not to void it", async () => {
    deleteExpense.mockResolvedValue({ data: null, error: POSTED_REFUSAL });
    await mount("VOID");
    fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
    fireEvent.click(within(openDialog()).getByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const said = errorTexts().join(" | ");
    expect(said).toMatch(/already voided/i);
    expect(said).not.toMatch(/Void it|Reject it/);
    expect(successTexts()).toEqual([]);
  });
});
