/**
 * EXPENSES-HUB-3 repair round 22 (R21 reviews at 8a87fa1), the expense detail page.
 *
 *   R22-3  the given check's half: this tab switched A -> B (the page leaves), another tab stored A again, and A's
 *          held void or delete lands before the storage event. The stored id reads A, but this page no longer shows
 *          A: nothing is said or applied.
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

async function openConfirm(button: RegExp, confirm: (b: HTMLButtonElement) => boolean) {
  fireEvent.click(screen.getByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  return Array.from(dialog.querySelectorAll("button")).find((b) => confirm(b as HTMLButtonElement))!;
}





function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("R22-3: the detail page, left for B, with the stored id back on A", () => {
  const ACTIONS = [
    ["void", () => finance.voidBill, /Void expense/, (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? ""), () => ok(expense({ status: "VOID" }))],
    ["delete", () => client.deleteExpense, /Delete expense/, (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete", () => ok(null)],
  ] as const;
  for (const [name, call, button, confirm, answer] of ACTIONS) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`A's ${name} that ${outcome} says nothing`, async () => {
        const pending = deferred<unknown>();
        call().mockReturnValue(pending.promise as never);
        await mount({ status: "PAID" });
        fireEvent.click(await openConfirm(button, confirm));
        await waitFor(() => expect(call()).toHaveBeenCalled());
        ws.bid = "biz_B";
        act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
        await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
        ws.bid = "biz_A"; // another tab, before its storage event
        await act(async () => {
          if (outcome === "answers") pending.resolve(answer());
          else pending.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        expect(toast.success, `A's ${name} said on B`).not.toHaveBeenCalled();
        expect(toast.error, `A's ${name} failure said on B`).not.toHaveBeenCalled();
        expect(nav.push).not.toHaveBeenCalled();
      });
    }
  }
});

describe("R22-3: the detail page's own check, after the page has left", () => {
  const ACTIONS = [
    ["void", () => finance.voidBill, /Void expense/, (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? "")],
    ["delete", () => client.deleteExpense, /Delete expense/, (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete"],
  ] as const;
  for (const [name, call, button, confirm] of ACTIONS) {
    it(`a ${name} confirm open when the page leaves for B is gone (R14-4): with the stored id back on A, pressing it sends nothing`, async () => {
      call().mockReturnValue(new Promise(() => {}) as never);
      await mount({ status: "PAID" });
      const okButton = await openConfirm(button, confirm);
      ws.bid = "biz_B";
      act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
      ws.bid = "biz_A"; // another tab, before its storage event; the router has not yet unmounted this page
      fireEvent.click(okButton);
      await settle();
      expect(call(), `A's ${name} sent after the page left`).not.toHaveBeenCalled();
    });
  }
});

describe("R22-3: a reply landing while storage is blocked", () => {
  const ACTIONS = [
    ["void", () => finance.voidBill, /Void expense/, (b: HTMLButtonElement) => /Void expense/.test(b.textContent ?? ""), () => ok(expense({ status: "VOID" }))],
    ["delete", () => client.deleteExpense, /Delete expense/, (b: HTMLButtonElement) => (b.textContent ?? "").trim() === "Delete", () => ok(null)],
  ] as const;
  for (const [name, call, button, confirm, answer] of ACTIONS) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`A's ${name} that ${outcome} says nothing and throws nothing`, async () => {
        const pending = deferred<unknown>();
        call().mockReturnValue(pending.promise as never);
        const unhandled: unknown[] = [];
        const onUnhandled = (e: PromiseRejectionEvent) => { unhandled.push(e.reason); e.preventDefault(); };
        const onNode = (r: unknown) => { unhandled.push(r); };
        window.addEventListener("unhandledrejection", onUnhandled);
        process.on("unhandledRejection", onNode);
        try {
          await mount({ status: "PAID" });
          fireEvent.click(await openConfirm(button, confirm));
          await waitFor(() => expect(call()).toHaveBeenCalled());
          blocked.on = true;
          await act(async () => {
            if (outcome === "answers") pending.resolve(answer());
            else pending.reject(new TypeError("Failed to fetch"));
          });
          await settle();
          blocked.on = false;
          expect(toast.success).not.toHaveBeenCalled();
          expect(toast.error).not.toHaveBeenCalled();
          expect(unhandled, `A's ${name} reply threw with storage blocked`).toEqual([]);
        } finally {
          blocked.on = false;
          window.removeEventListener("unhandledrejection", onUnhandled);
          process.off("unhandledRejection", onNode);
        }
      });
    }
  }
});
