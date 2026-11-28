/**
 * EXPENSES-HUB-3 repair round 26 (R25 reviews at 360f85e; D-308, D-315), the expense detail page.
 *
 *   R26-1  a Retry reply that outlives the page (unmounted, the stored id then B) navigates nowhere and says nothing
 *   R26-2  while a Retry is out, the category reads "Loading…", never "Uncategorized", and the budget never "No budget
 *          set for this category."
 *   R26-3  a budgets read that throws after the expense loaded fails the budget block (with Retry), toasted as such
 *   R26-4  the Retry guards: another tab's stored id before its storage event leaves the page and sets nothing; a
 *          throw then says nothing; the same-business throw is said; a new expense id whose read throws is said as a
 *          failure, never shown as the previous expense
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






const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const CAT = { id: "cat_1", name: "Supplies", color: "#f97316" };
const retryIn = (el: Element) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Retry") as HTMLButtonElement;
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
afterEach(() => { routeParams.id = "exp_A1"; });

type Block = { name: "categories" | "budgets"; call: () => ReturnType<typeof vi.fn>; failText: RegExp; answer: () => unknown };
const BLOCKS: Block[] = [
  { name: "categories", call: () => client.fetchExpenseCategories, failText: /Couldn't load the category:/, answer: () => ok([CAT]) },
  { name: "budgets", call: () => client.fetchExpenseBudgets, failText: /Couldn't load this category's budget/, answer: () => ok([]) },
];
/** Mounts A's expense with the block refused, then presses its Retry with the reply held. */
async function heldRetry(b: Block) {
  if (b.name === "budgets") client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
  b.call().mockResolvedValue(refusedAnswer());
  const view = render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Office Depot" });
  const note = (await screen.findAllByText(b.failText)).map((n) => n.closest('[role="status"]')).find(Boolean)!;
  const reply = deferred<unknown>();
  b.call().mockReturnValue(reply.promise);
  const calls = b.call().mock.calls.length;
  fireEvent.click(retryIn(note));
  await waitFor(() => expect(b.call().mock.calls.length).toBeGreaterThan(calls));
  return { view, reply };
}
beforeEach(() => { client.getExpense.mockResolvedValue(ok(expense({ status: "PAID", categoryId: "cat_1" }))); });

describe("R26-1 MAJOR: a Retry reply that outlives the page navigates nowhere", () => {
  for (const b of BLOCKS) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`${b.name}: Retry, unmount, the stored id to B, the reply ${outcome}: no navigation, nothing said`, async () => {
        const { view, reply } = await heldRetry(b);
        nav.replace.mockReset();
        view.unmount();
        ws.bid = "biz_B";
        await act(async () => {
          if (outcome === "answers") reply.resolve(b.answer());
          else reply.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        expect(nav.replace, "a reply for a page that is gone threw the user off B's page").not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
      });
    }
  }
  it("control: the main read in the same case navigates nowhere (R16-1)", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    const view = render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
    view.unmount();
    ws.bid = "biz_B";
    await act(async () => { read.resolve(ok(expense({ status: "PAID" }))); });
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
  });
  for (const b of BLOCKS) {
    it(`${b.name}: control, a switch event in this tab drops the reply (the page leaves once)`, async () => {
      const { reply } = await heldRetry(b);
      nav.replace.mockReset();
      ws.bid = "biz_B";
      act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
      await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
      ws.bid = "biz_A"; // another tab, before its storage event
      await act(async () => { reply.resolve(b.answer()); });
      await settle();
      expect(nav.replace).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("heading", { name: "Office Depot" }), "A's expense shown again after the page left").toBeNull();
    });
  }
});

describe("R26-2 MAJOR: while a Retry is out, no empty-state words", () => {
  it("categories: the label is 'Loading…', never 'Uncategorized'", async () => {
    await heldRetry(BLOCKS[0]);
    expect(screen.queryByText(/Uncategorized/), "a category being read again called none").toBeNull();
    expect(screen.getAllByText(/Loading…/).length).toBeGreaterThan(0);
  });
  it("budgets: 'Loading…', never 'No budget set for this category.'", async () => {
    await heldRetry(BLOCKS[1]);
    expect(screen.queryByText("No budget set for this category."), "a budget being read again called none").toBeNull();
    expect(screen.getAllByText(/Loading…/).length).toBeGreaterThan(0);
  });
});

describe("R26-3: the main read's catch after the expense loaded", () => {
  it("budgets that throw: the budget block says it could not load, with Retry; the toast names the block", async () => {
    client.fetchExpenseCategories.mockResolvedValue(ok([CAT]));
    client.fetchExpenseBudgets.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "Office Depot" });
    const note = (await screen.findByText(/Couldn't load this category's budget/)).closest('[role="status"]')!;
    expect(retryIn(note)).toBeTruthy();
    expect(screen.queryByText("No budget set for this category.")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Couldn't load this category's budget.");
    expect(toast.error).not.toHaveBeenCalledWith("Failed to load expense");
  });
});

describe("R26-4: the detail Retry guards", () => {
  for (const b of BLOCKS) {
    it(`${b.name}: the stored id moved to B before its storage event: the reply leaves the page and sets nothing`, async () => {
      const { reply } = await heldRetry(b);
      nav.replace.mockReset();
      ws.bid = "biz_B";
      await act(async () => { reply.resolve(b.answer()); });
      await settle();
      expect(nav.replace).toHaveBeenCalledWith("/app/expenses");
      expect(screen.queryByRole("heading", { name: "Office Depot" })).toBeNull();
    });
    it(`${b.name}: the stored id moved to B, the reply throws: nothing is said`, async () => {
      const { reply } = await heldRetry(b);
      ws.bid = "biz_B";
      await act(async () => { reply.reject(new TypeError("Failed to fetch")); });
      await settle();
      expect(screen.queryByText(b.name === "categories" ? /Couldn't load the category/ : /Couldn't load this category's budget/), "a failure said for a business no longer stored").toBeNull();
    });
    it(`${b.name}: control, the same business, the reply throws: the failure is said again with Retry`, async () => {
      const { reply } = await heldRetry(b);
      await act(async () => { reply.reject(new TypeError("Failed to fetch")); });
      const note = (await screen.findAllByText(b.name === "categories" ? /Couldn't load the category/ : /Couldn't load this category's budget/)).map((n) => n.closest('[role="status"]')).find(Boolean)!;
      expect(retryIn(note)).toBeTruthy();
    });
  }
  it("a new expense id whose read throws says it could not load, never the previous expense", async () => {
    const view = render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "Office Depot" });
    client.getExpense.mockRejectedValue(new TypeError("Failed to fetch"));
    routeParams.id = "exp_A2";
    view.rerender(<ExpenseDetailPage />);
    expect(await screen.findByText(/Couldn't load this expense/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Office Depot" }), "the previous expense shown for the new id").toBeNull();
  });
});
