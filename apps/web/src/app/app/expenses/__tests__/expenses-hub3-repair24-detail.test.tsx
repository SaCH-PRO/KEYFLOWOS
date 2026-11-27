/**
 * EXPENSES-HUB-3 repair round 24 (R23 reviews at 5c0d303; D-315), the expense detail page, in the client's real
 * failure shape ({ data: null, error }: lib/api.ts never rejects for a refusal or a network failure).
 *
 *   R24-1  the page's read that is refused says "Failed to load expense" (nothing under a switch); a refresh after a
 *          save that is refused says it could not refresh
 *   R24-2  the refresh's live guards: the save answers live, the refresh is held, the stored id moves to B, and the
 *          refresh that answers or is refused sets and says nothing
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



async function openEditAndSave() {
  fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Update Expense" }));
}

const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const heading = () => screen.queryByRole("heading", { name: "Office Depot" });

describe("R24-1: the detail page's read, refused", () => {
  it("says 'Failed to load expense'", async () => {
    client.getExpense.mockResolvedValue(refusedAnswer());
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to load expense"));
    expect(heading()).toBeNull();
  });
  it("refused after the stored id moved to B, says nothing", async () => {
    const read = deferred<unknown>();
    client.getExpense.mockReturnValue(read.promise);
    render(<ExpenseDetailPage />);
    await waitFor(() => expect(client.getExpense).toHaveBeenCalled());
    ws.bid = "biz_B";
    await act(async () => { read.resolve(refusedAnswer()); });
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("R24-1: the refresh after a save, refused", () => {
  it("says it could not refresh", async () => {
    client.updateExpense.mockResolvedValue(ok(expense({ status: "PAID" })));
    await mount({ status: "PAID" });
    client.getExpense.mockResolvedValue(refusedAnswer());
    await openEditAndSave();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Saved, but couldn't refresh this expense. Reload to see it."));
  });
});

describe("R24-2: the refresh's live guards", () => {
  for (const outcome of ["answers", "is refused", "throws"] as const) {
    it(`a refresh held while the stored id moves to B, that ${outcome}, sets and says nothing`, async () => {
      client.updateExpense.mockResolvedValue(ok(expense({ status: "PAID" })));
      await mount({ status: "PAID" });
      const refresh = deferred<unknown>();
      client.getExpense.mockReturnValue(refresh.promise);
      await openEditAndSave();
      await waitFor(() => expect(client.getExpense).toHaveBeenCalledTimes(2));
      vi.mocked(toast.success).mockReset();
      vi.mocked(toast.error).mockReset();
      ws.bid = "biz_B"; // another tab, before its storage event
      await act(async () => {
        if (outcome === "answers") refresh.resolve(ok(expense({ status: "PAID", vendor: "Vendor of B" })));
        else if (outcome === "is refused") refresh.resolve(refusedAnswer());
        else refresh.reject(new TypeError("Failed to fetch"));
      });
      await settle();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", { name: "Vendor of B" }), "the refresh set the expense after the switch").toBeNull();
    });
  }
});
