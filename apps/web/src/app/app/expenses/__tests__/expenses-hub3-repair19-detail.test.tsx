/**
 * EXPENSES-HUB-3 repair round 19 (R18 reviews at c2a3e49), the expense detail page.
 *
 *   R19-3  void and delete refuse their start through the shared check and say the truth: a switch says the business
 *          changed; blocked storage says it could not check which business is open
 *   R19-5  void's reply under a silent switch says nothing (the page's own check is the stored id)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
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
import { BUSINESS_CHANGED_ELSEWHERE, BUSINESS_UNREADABLE } from "../components/expense-utils";

const ok = <T,>(data: T) => ({ data, error: null });
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
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
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const noToast = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};


/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */


afterEach(() => { blocked.on = false; });

async function openConfirm(button: RegExp, confirm: (b: HTMLButtonElement) => boolean) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  return Array.from(dialog.querySelectorAll("button")).find((b) => confirm(b as HTMLButtonElement))!;
}

describe("R19-3: void and delete say the truth when they will not start", () => {
  it.each([
    ["void", /Void expense/, (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? ""), () => finance.voidBill],
    ["delete", /Delete expense/, (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete", () => client.deleteExpense],
  ] as const)("%s after a switch says the business changed", async (_n, button, confirm, call) => {
    await mount({ status: "PAID" });
    const ok_ = await openConfirm(button, confirm);
    ws.bid = "biz_B";
    fireEvent.click(ok_);
    await settle();
    expect(call()).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(BUSINESS_CHANGED_ELSEWHERE);
  });

  it.each([
    ["void", /Void expense/, (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? ""), () => finance.voidBill],
    ["delete", /Delete expense/, (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete", () => client.deleteExpense],
  ] as const)("%s with blocked storage says it could not check which business is open", async (_n, button, confirm, call) => {
    await mount({ status: "PAID" });
    const ok_ = await openConfirm(button, confirm);
    blocked.on = true;
    fireEvent.click(ok_);
    await settle();
    expect(call()).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(BUSINESS_UNREADABLE);
  });
});

describe("R19-5: the detail page's reply under a silent switch", () => {
  it("void's reply says nothing", async () => {
    const pending = deferred<unknown>();
    finance.voidBill.mockReturnValue(pending.promise);
    await mount({ status: "PAID" });
    fireEvent.click(await openConfirm(/Void expense/, (b) => /Void expense/.test(b.textContent ?? "")));
    await waitFor(() => expect(finance.voidBill).toHaveBeenCalled());
    ws.bid = "biz_B";
    await act(async () => { pending.resolve(ok({ id: "exp_A1", status: "VOID" })); });
    await settle();
    noToast();
  });
});
