/**
 * EXPENSES-HUB-3 repair round 28 (R27 reviews at 396f618; D-308, D-315), the expense detail page: the expense id
 * changing within the same page instance, inside one business.
 *
 *   R28-1  a reply to an action taken on A1 (Void, Delete, Pay, the edit sheet's save) that lands once the page shows
 *          A2 drops: A2 stays A2 and nothing of A1 is said; control, a reply that lands on A1 is said
 *   R28-2  a dialog opened on A1 (Delete, Void, Pay, Edit) is closed by the id change and acts on nothing
 *   R28-4  A1's budgets Retry landing before A2's expense answers, then A2's budgets throwing: October's figures stay
 *          absent
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

describe("R28-1 MAJOR: a reply to an action taken on A1 lands once the page shows A2", () => {
  for (const a of ACTIONS) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`${a.name} that ${outcome}: A2 stays A2, and nothing of A1 is said`, async () => {
        if (a.bill) a1Status = "BILL";
        const held = deferred<unknown>();
        a.call().mockReturnValue(held.promise);
        const view = await onA1();
        await a.start();
        await waitFor(() => expect(a.call()).toHaveBeenCalled());
        await toA2(view);
        vi.mocked(toast.success).mockReset();
        vi.mocked(toast.error).mockReset();
        const reads = client.getExpense.mock.calls.length;
        await act(async () => {
          if (outcome === "answers") held.resolve(a.answer());
          else held.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToasts();
        expect(screen.getByRole("heading", { name: "November Vendor" }), "A1 shown at A2's address").toBeTruthy();
        expect(screen.queryByRole("heading", { name: "October Vendor" })).toBeNull();
        expect(nav.push).not.toHaveBeenCalled();
        expect(client.getExpense.mock.calls.length, "A1 read again on A2's page").toBe(reads);
      });
    }
    it(`${a.name}: control, the reply lands while the page still shows A1: it is said`, async () => {
      if (a.bill) a1Status = "BILL";
      a.call().mockResolvedValue(a.answer());
      await onA1();
      await a.start();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(a.said));
    });
  }
});

describe("R28-2 MAJOR: a dialog opened on A1 is closed by the id change", () => {
  const DIALOGS = [
    { name: "Delete expense?", open: () => fireEvent.click(screen.getByRole("button", { name: /Delete expense/ })), call: () => client.deleteExpense },
    { name: "Void", open: () => fireEvent.click(screen.getByRole("button", { name: /Void expense/ })), call: () => finance.voidBill },
    { name: "Pay", bill: true, open: () => fireEvent.click(screen.getByRole("button", { name: /Approve/ })), call: () => finance.payBill },
    { name: "Edit", open: () => fireEvent.click(screen.getByRole("button", { name: /Edit expense/ })), call: () => client.updateExpense },
  ];
  for (const d of DIALOGS) {
    it(`${d.name}: closed on A2, and nothing is called for A2`, async () => {
      if (d.bill) a1Status = "BILL";
      const view = await onA1();
      d.open();
      expect(await screen.findByRole("dialog")).toBeTruthy();
      await toA2(view);
      await settle();
      expect(screen.queryByRole("dialog"), "A1's dialog open on A2").toBeNull();
      expect(d.call()).not.toHaveBeenCalled();
    });
  }
});

describe("R28-4: A1's budgets Retry lands before A2's expense answers; A2's budgets then throw", () => {
  it("October's figures stay absent", async () => {
    client.fetchExpenseBudgets.mockResolvedValue(refusedAnswer());
    const view = await onA1();
    const retryReply = deferred<unknown>();
    client.fetchExpenseBudgets.mockReturnValueOnce(retryReply.promise);
    fireEvent.click(retryIn((await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!));
    const a2Read = deferred<unknown>();
    client.getExpense.mockImplementation((_b: string, id: string) => (id === "exp_A2" ? a2Read.promise : Promise.resolve(ok(A1()))));
    client.fetchExpenseBudgets.mockRejectedValue(new TypeError("Failed to fetch"));
    routeParams.id = "exp_A2";
    view.rerender(<ExpenseDetailPage />);
    await act(async () => { retryReply.resolve(ok([OCT_BUDGET])); });
    await act(async () => { a2Read.resolve(ok(A2())); });
    await screen.findByRole("heading", { name: "November Vendor" });
    await settle();
    expect(screen.queryByText("Monthly budget"), "October's budget shown on A2").toBeNull();
  });
});

describe("R28-1: the edit sheet's refresh, held while the page moves to A2", () => {
  for (const outcome of ["answers", "throws"] as const) {
    it(`A1's save lands on A1, its refresh ${outcome} once the page shows A2: A2 stays A2, nothing said`, async () => {
      client.updateExpense.mockResolvedValue(ok(A1({ description: "Edited on A1" })));
      const view = await onA1();
      const refresh = deferred<unknown>();
      const reads = client.getExpense.mock.calls.length;
      client.getExpense.mockImplementation((_b: string, id: string) => (id === "exp_A1" && client.getExpense.mock.calls.length > reads ? refresh.promise : Promise.resolve(ok(id === "exp_A2" ? A2() : A1()))));
      fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
      await waitFor(() => expect(client.getExpense.mock.calls.length).toBeGreaterThan(reads));
      await toA2(view);
      vi.mocked(toast.success).mockReset();
      vi.mocked(toast.error).mockReset();
      await act(async () => {
        if (outcome === "answers") refresh.resolve(ok(A1({ description: "Edited on A1" })));
        else refresh.reject(new TypeError("Failed to fetch"));
      });
      await settle();
      noToasts();
      expect(screen.getByRole("heading", { name: "November Vendor" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "October Vendor" }), "A1's refresh set A1 on A2's page").toBeNull();
    });
  }
});

describe("R28-2: an action in flight on A1 leaves A2's actions free", () => {
  it("A1's Void out, the id changes: A2's Void is enabled, and stays so when A1's reply lands", async () => {
    const held = deferred<unknown>();
    finance.voidBill.mockReturnValue(held.promise);
    const view = await onA1();
    await confirmIn(/Void expense/, voidOk);
    await waitFor(() => expect(finance.voidBill).toHaveBeenCalled());
    await toA2(view);
    const voidA2 = () => screen.getByRole("button", { name: /Void expense/ }) as HTMLButtonElement;
    expect(voidA2().disabled, "A2's Void held by A1's action").toBe(false);
    await act(async () => { held.resolve(ok(A1({ status: "VOID" }))); });
    await settle();
    expect(voidA2().disabled).toBe(false);
  });
});
