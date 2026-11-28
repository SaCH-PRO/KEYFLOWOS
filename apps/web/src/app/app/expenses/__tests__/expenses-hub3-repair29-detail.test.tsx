/**
 * EXPENSES-HUB-3 repair round 29 (R28 reviews at 4991cd20; D-308, D-315), the expense detail page.
 *
 *   R29-1  each Pay or edit-sheet open carries the read it was opened on: A1's reply that lands once the same dialog is
 *          open again on A2 says and sets nothing, and A2's dialog stays open (also for the edit refresh)
 *   R29-2  Pay's reply after the page has left, with the stored id back on A, says nothing
 *   R29-4  a budgets Retry leaves the open edit sheet (and its typed edit) and Pay open
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const routeParams = vi.hoisted(() => ({ id: "exp_A1" }));
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
  useParams: () => ({ id: routeParams.id }),
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



/** Another tab has switched: the stored id says B, but no storage event has reached this tab yet. */


afterEach(() => { blocked.on = false; });






const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });








const CAT = { id: "cat_1", name: "Supplies", color: "#f97316" };
const refusedAnswer = () => ({ data: null, error: "Request refused by the server", status: 503 });
const retryIn = (el: Element) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Retry") as HTMLButtonElement;
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const A1 = (over: Partial<Expense> = {}) => expense({ id: "exp_A1", status: "PAID", categoryId: "cat_1", date: "2026-10-15T00:00:00.000Z", vendor: "October Vendor", ...over });
const A2 = () => expense({ id: "exp_A2", status: "PAID", categoryId: "cat_1", date: "2026-11-15T00:00:00.000Z", vendor: "November Vendor" });
const OCT_BUDGET = { id: "bud_oct", categoryId: "cat_1", amount: 777, spent: 100, remaining: 677, percentUsed: 13, isOverBudget: false, isNearAlert: false, month: 10, year: 2026 };
let a1Status: Expense["status"] = "PAID";
afterEach(() => { routeParams.id = "exp_A1"; a1Status = "PAID"; });
beforeEach(() => {
  client.getExpense.mockImplementation(async (_b: string, id: string) => ok(id === "exp_A2" ? A2() : A1({ status: a1Status })));
  client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
});
async function onA1() {
  const view = render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "October Vendor" });
  return view;
}
async function toA2(view: ReturnType<typeof render>) {
  routeParams.id = "exp_A2";
  view.rerender(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "November Vendor" });
}
async function confirmIn(button: RegExp, pick: (b: HTMLButtonElement) => boolean) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => pick(b as HTMLButtonElement))!);
}
const voidOk = (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? "");
const deleteOk = (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete";
const noToasts = () => {
  expect(toast.success, "A1's reply said on A2").not.toHaveBeenCalled();
  expect(toast.error, "A1's failure said on A2").not.toHaveBeenCalled();
};

type Act = { name: string; call: () => ReturnType<typeof vi.fn>; start: () => Promise<void>; answer: () => unknown; said: string; bill?: boolean };
const ACTIONS: Act[] = [
  { name: "Void", call: () => finance.voidBill, start: () => confirmIn(/Void expense/, voidOk), answer: () => ok(A1({ status: "VOID" })), said: "Expense voided" },
  { name: "Delete", call: () => client.deleteExpense, start: () => confirmIn(/Delete expense/, deleteOk), answer: () => ok(null), said: "Expense deleted" },
  { name: "Pay", call: () => finance.payBill, bill: true,
    start: async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
      const pay = await screen.findByRole("button", { name: /^Pay$/ });
      await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(pay);
    },
    answer: () => ok(A1({ status: "PAID" })), said: "Bill paid" },
  { name: "Edit save", call: () => client.updateExpense,
    start: async () => {
      fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
    },
    answer: () => ok(A1({ description: "Edited on A1" })), said: "Expense saved" },
];


/** The dialog open on the page: Pay's has a Pay button, the edit sheet an Update Expense button. */
const payOpen = () => screen.queryByRole("button", { name: /^Pay$/ });
const editOpen = () => screen.queryByRole("button", { name: "Update Expense" });
async function openPay() {
  fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
  const pay = await screen.findByRole("button", { name: /^Pay$/ });
  await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
  return pay;
}
async function openEditSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
  return screen.findByRole("button", { name: "Update Expense" });
}
const A2Bill = () => expense({ id: "exp_A2", status: "BILL", categoryId: "cat_1", date: "2026-11-15T00:00:00.000Z", vendor: "November Vendor" });

describe("R29-1 MAJOR: the same dialog reopened on A2 before A1's reply lands", () => {
  for (const kind of ["Pay", "Edit save"] as const) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`${kind} that ${outcome}: no toast, A2's heading, A2's dialog still open, no read of A1`, async () => {
        const held = deferred<unknown>();
        if (kind === "Pay") {
          a1Status = "BILL";
          client.getExpense.mockImplementation(async (_b: string, id: string) => ok(id === "exp_A2" ? A2Bill() : A1({ status: a1Status })));
          finance.payBill.mockReturnValueOnce(held.promise);
        } else {
          client.updateExpense.mockReturnValueOnce(held.promise);
        }
        const view = await onA1();
        if (kind === "Pay") fireEvent.click(await openPay());
        else fireEvent.click(await openEditSheet());
        await waitFor(() => expect(kind === "Pay" ? finance.payBill : client.updateExpense).toHaveBeenCalled());
        await toA2(view);
        if (kind === "Pay") await openPay();
        else await openEditSheet();
        vi.mocked(toast.success).mockReset();
        vi.mocked(toast.error).mockReset();
        const a1Reads = client.getExpense.mock.calls.filter((c) => c[1] === "exp_A1").length;
        await act(async () => {
          if (outcome === "answers") held.resolve(ok(A1({ status: "PAID", description: "Edited on A1" })));
          else held.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToasts();
        expect(screen.getByRole("heading", { name: "November Vendor" })).toBeTruthy();
        expect(screen.queryByRole("heading", { name: "October Vendor" }), "A1 shown at A2's address").toBeNull();
        expect(kind === "Pay" ? payOpen() : editOpen(), "A2's dialog closed by A1's reply").toBeTruthy();
        expect(client.getExpense.mock.calls.filter((c) => c[1] === "exp_A1").length, "A1 read again").toBe(a1Reads);
      });
    }
  }
  it("the edit refresh held, then the edit sheet reopened on A2: A2 stays A2 and its sheet stays open", async () => {
    client.updateExpense.mockResolvedValue(ok(A1({ description: "Edited on A1" })));
    const view = await onA1();
    const refresh = deferred<unknown>();
    const reads = client.getExpense.mock.calls.length;
    client.getExpense.mockImplementation((_b: string, id: string) => (id === "exp_A1" && client.getExpense.mock.calls.length > reads ? refresh.promise : Promise.resolve(ok(id === "exp_A2" ? A2() : A1()))));
    fireEvent.click(await openEditSheet());
    await waitFor(() => expect(client.getExpense.mock.calls.length).toBeGreaterThan(reads));
    await toA2(view);
    await openEditSheet();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    await act(async () => { refresh.resolve(ok(A1({ description: "Edited on A1" }))); });
    await settle();
    noToasts();
    expect(screen.queryByRole("heading", { name: "October Vendor" }), "A1's refresh set A1 on A2's page").toBeNull();
    expect(editOpen(), "A2's sheet closed").toBeTruthy();
  });
});

describe("R29-2: Pay's reply after the page has left, with the stored id back on A", () => {
  it("says nothing and reports nothing paid", async () => {
    a1Status = "BILL";
    const held = deferred<unknown>();
    finance.payBill.mockReturnValue(held.promise);
    await onA1();
    fireEvent.click(await openPay());
    await waitFor(() => expect(finance.payBill).toHaveBeenCalled());
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
    ws.bid = "biz_A"; // another tab, before its storage event
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    await act(async () => { held.resolve(ok(A1({ status: "PAID" }))); });
    await settle();
    noToasts();
  });
});

describe("R29-4: a budgets Retry leaves the open dialogs open", () => {
  it("the edit sheet: still open, with the typed edit, after the budgets Retry", async () => {
    client.fetchExpenseBudgets.mockResolvedValue(refusedAnswer());
    await onA1();
    await openEditSheet();
    const field = screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Typed, not saved" } });
    const calls = client.fetchExpenseBudgets.mock.calls.length;
    client.fetchExpenseBudgets.mockResolvedValue(ok([]));
    fireEvent.click(retryIn((await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!));
    await waitFor(() => expect(client.fetchExpenseBudgets.mock.calls.length).toBeGreaterThan(calls));
    await settle();
    expect(editOpen(), "the budgets Retry closed the edit sheet").toBeTruthy();
    expect((screen.getByPlaceholderText("What was this expense for?") as HTMLInputElement).value).toBe("Typed, not saved");
  });
  it("Pay: still open after the budgets Retry", async () => {
    a1Status = "BILL";
    client.fetchExpenseBudgets.mockResolvedValue(refusedAnswer());
    await onA1();
    await openPay();
    const calls = client.fetchExpenseBudgets.mock.calls.length;
    client.fetchExpenseBudgets.mockResolvedValue(ok([]));
    fireEvent.click(retryIn((await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!));
    await waitFor(() => expect(client.fetchExpenseBudgets.mock.calls.length).toBeGreaterThan(calls));
    await settle();
    expect(payOpen(), "the budgets Retry closed Pay").toBeTruthy();
  });
});
