/**
 * EXPENSES-HUB-3 repair round 14 (R13 review at 246cbd4, MINOR-4), the expense detail page across a business switch.
 *
 *   R14-4a  a switch while A's expense is open leaves for /app/expenses and stops showing A's expense
 *   R14-4b  A's void, delete and bill pay, answering (or throwing) after the switch, say nothing on B
 *   R14-4c  control: with no switch, they still say so
 *
 * Mounted on the real page and the real Pay dialog; only the client calls, next/navigation, sonner, the upload hooks
 * and the stored business are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

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
  getStoredBusinessId: () => ws.bid,
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
function switchTo(bid: string) {
  ws.bid = bid;
  act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const noToast = () => {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
};

describe("R14-4a: a switch while A's expense is open", () => {
  it("leaves for /app/expenses and shows A's expense no more", async () => {
    await mount();
    switchTo("biz_B");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/expenses"));
    expect(screen.queryByRole("heading", { name: "Office Depot" }), "A's expense is still shown under B").toBeNull();
    expect(screen.queryByRole("button", { name: /Delete expense/ })).toBeNull();
  });

  it("control: a storage event for the same business changes nothing", async () => {
    await mount();
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_A" } })); });
    await settle();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Office Depot" })).toBeTruthy();
  });
});

type Action = { name: string; over: Partial<Expense>; call: () => ReturnType<typeof vi.fn>; start: () => Promise<void>; success: string; failure: string };
const ACTIONS: Action[] = [
  {
    name: "void",
    over: { status: "PAID" },
    call: () => finance.voidBill,
    start: async () => {
      fireEvent.click(screen.getByRole("button", { name: /Void expense/ }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => /Void expense/.test(b.textContent ?? ""))!);
    },
    success: "Expense voided",
    failure: "Couldn't void this expense.",
  },
  {
    name: "delete",
    over: { status: "PAID" },
    call: () => client.deleteExpense,
    start: async () => {
      fireEvent.click(screen.getByRole("button", { name: /Delete expense/ }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "Delete")!);
    },
    success: "Expense deleted",
    failure: "Couldn't delete this expense.",
  },
  {
    name: "bill pay",
    over: { status: "BILL" },
    call: () => finance.payBill,
    start: async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
      const pay = await screen.findByRole("button", { name: /^Pay$/ });
      await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(pay);
    },
    success: "Bill paid",
    failure: "Couldn't pay this bill.",
  },
];

describe("R14-4b: A's actions answering after the switch say nothing on B", () => {
  for (const a of ACTIONS) {
    for (const outcome of ["answers", "throws"] as const) {
      it(`${a.name} that ${outcome}`, async () => {
        const pending = deferred<unknown>();
        a.call().mockReturnValue(pending.promise);
        await mount(a.over);
        await a.start();
        await waitFor(() => expect(a.call()).toHaveBeenCalledWith("biz_A", "exp_A1", ...(a.name === "bill pay" ? [expect.anything()] : [])));
        switchTo("biz_B");
        await act(async () => {
          if (outcome === "answers") pending.resolve(ok({ id: "exp_A1", status: "VOID" }));
          else pending.reject(new TypeError("Failed to fetch"));
        });
        await settle();
        noToast();
        expect(nav.push).not.toHaveBeenCalled();
      });
    }
  }
});

describe("R14-4c control: with no switch, each still says so", () => {
  for (const a of ACTIONS) {
    it(`${a.name}`, async () => {
      a.call().mockResolvedValue(ok({ id: "exp_A1", status: "VOID" }));
      await mount(a.over);
      await a.start();
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith(a.success));
    });
  }
});
