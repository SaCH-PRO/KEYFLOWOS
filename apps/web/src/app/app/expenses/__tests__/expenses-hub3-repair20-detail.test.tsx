/**
 * EXPENSES-HUB-3 repair round 20 (R19 reviews at 7a0cb4e), the expense detail page.
 *
 *   R20-5  a refused void or delete closes its confirm, as Pay closes its dialog; with no switch, a void that throws
 *          says "Couldn't void this expense." and a delete that throws says "Couldn't delete this expense."
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const client = vi.hoisted(() => ({
  getExpense: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchFinanceAccounts: vi.fn(),
}));
const finance = vi.hoisted(() => ({ payBill: vi.fn(), voidBill: vi.fn(), createBill: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_A1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_A1" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("@/lib/api/finance", () => finance);

import { toast } from "sonner";
import ExpenseDetailPage from "../[id]/page";

const ok = <T,>(data: T) => ({ data, error: null });
function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_A1", description: "Printer toner", amount: 100, currency: "TTD", date: "2026-10-15T00:00:00.000Z",
    vendor: "Office Depot", paymentMethod: "cash", tags: [], isRecurring: false, status: "PAID", categoryId: null,
    createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z", ...over,
  } as Expense;
}

beforeEach(() => {
  ws.bid = "biz_A";
  nav.push.mockReset();
  nav.replace.mockReset();
  for (const fn of [...Object.values(client), ...Object.values(finance)]) fn.mockReset();
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

async function mount(over: Partial<Expense> = {}) {
  client.getExpense.mockResolvedValue(ok(expense(over)));
  render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Office Depot" });
}


/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */


afterEach(() => { blocked.on = false; });

async function openConfirm(button: RegExp, confirm: (b: HTMLButtonElement) => boolean) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  return Array.from(dialog.querySelectorAll("button")).find((b) => confirm(b as HTMLButtonElement))!;
}




describe("R20-5: a refused start closes the confirm", () => {
  it.each([
    ["void", /Void expense/, (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? "")],
    ["delete", /Delete expense/, (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete"],
  ] as const)("%s refused after a switch: the confirm closes", async (_n, button, confirm) => {
    await mount({ status: "PAID" });
    const okButton = await openConfirm(button, confirm);
    ws.bid = "biz_B";
    fireEvent.click(okButton);
    await waitFor(() => expect(screen.queryByRole("dialog"), "the confirm stays open after a refused start").toBeNull());
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe("R20-5: same-business failures", () => {
  it("a void that throws says 'Couldn't void this expense.'", async () => {
    finance.voidBill.mockRejectedValue(new TypeError("Failed to fetch"));
    await mount({ status: "PAID" });
    fireEvent.click(await openConfirm(/Void expense/, (b) => /Void expense/.test(b.textContent ?? "")));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't void this expense."));
  });
  it("a delete that throws says 'Couldn't delete this expense.'", async () => {
    client.deleteExpense.mockRejectedValue(new TypeError("Failed to fetch"));
    await mount({ status: "PAID" });
    fireEvent.click(await openConfirm(/Delete expense/, (b) => (b.textContent ?? "").trim() === "Delete"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't delete this expense."));
  });
});
