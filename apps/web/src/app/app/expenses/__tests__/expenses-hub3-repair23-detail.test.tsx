/**
 * EXPENSES-HUB-3 repair round 23 (R22 reviews at bf31a26; D-315), the expense detail page.
 *
 *   R23-4  the edit sheet's save, held while the page leaves for B with the stored id back on A, lands saying and
 *          calling nothing; a refresh after a same-business save that fails says so and throws nothing
 *   R23-6  a read failing while storage is blocked throws nothing (no unhandled rejection) and says nothing
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






function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });



function trapUnhandled() {
  const seen: unknown[] = [];
  const onWin = (e: PromiseRejectionEvent) => { seen.push(e.reason); e.preventDefault(); };
  const onNode = (r: unknown) => { seen.push(r); };
  window.addEventListener("unhandledrejection", onWin);
  process.on("unhandledRejection", onNode);
  return { seen, stop: () => { window.removeEventListener("unhandledrejection", onWin); process.off("unhandledRejection", onNode); } };
}
async function openEditAndSave() {
  fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
}

describe("R23-4: the detail page's edit save", () => {
  for (const outcome of ["answers", "throws"] as const) {
    it(`held while the page leaves for B, the stored id back on A, that ${outcome} says and calls nothing`, async () => {
      const pending = deferred<unknown>();
      client.updateExpense.mockReturnValue(pending.promise);
      await mount({ status: "PAID" });
      expect(client.getExpense).toHaveBeenCalledTimes(1);
      await openEditAndSave();
      await waitFor(() => expect(client.updateExpense).toHaveBeenCalled());
      ws.bid = "biz_B";
      act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
      ws.bid = "biz_A"; // another tab, before its storage event
      await act(async () => {
        if (outcome === "answers") pending.resolve(ok(expense({ status: "PAID", description: "Edited" })));
        else pending.reject(new TypeError("Failed to fetch"));
      });
      await settle();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(client.getExpense, "A's saved expense read again after the page left").toHaveBeenCalledTimes(1);
    });
  }

  it("a same-business save whose refresh fails says so and throws nothing", async () => {
    client.updateExpense.mockResolvedValue(ok(expense({ status: "PAID" })));
    await mount({ status: "PAID" });
    client.getExpense.mockRejectedValue(new TypeError("Failed to fetch"));
    const trap = trapUnhandled();
    try {
      await openEditAndSave();
      await waitFor(() => expect(client.getExpense).toHaveBeenCalledTimes(2));
      await settle();
      expect(toast.error).toHaveBeenCalledWith("Saved, but couldn't refresh this expense. Reload to see it.");
      expect(trap.seen, "the refresh's failure was unhandled").toEqual([]);
    } finally {
      trap.stop();
    }
  });
});

describe("R23-6: the detail page's read, failing while storage is blocked", () => {
  it("throws nothing and says nothing", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    const trap = trapUnhandled();
    try {
      render(<ExpenseDetailPage />);
      await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
      blocked.on = true;
      await act(async () => { read.reject(new TypeError("Failed to fetch")); });
      await settle();
      blocked.on = false;
      expect(toast.error).not.toHaveBeenCalled();
      expect(trap.seen, "the read's failure threw with storage blocked").toEqual([]);
    } finally {
      blocked.on = false;
      trap.stop();
    }
  });
});
