/**
 * P256 FU-EXPENSE-EDIT-CANCEL-MID-SAVE (launch-track, D-315; from both EH3 R29 reviews).
 *
 * The edit sheet could be cancelled while its save was submitting (Cancel, Escape, the overlay, the header's Close);
 * reopened on the same read, the first save's late reply then closed the reopened sheet and lost what was typed.
 * While a save is submitting, every way to close the sheet is held: Cancel is disabled, and Escape, the overlay and
 * the header's Close do nothing (as BillPayDialog holds Pay). Not submitting, each closes the sheet; and a reopen after
 * a save shows the saved values.
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
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

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
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const A1 = (over: Partial<Expense> = {}) => expense({ id: "exp_A1", status: "PAID", categoryId: "cat_1", date: "2026-10-15T00:00:00.000Z", vendor: "October Vendor", ...over });
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



/** The dialog open on the page: Pay's has a Pay button, the edit sheet an Update Expense button. */


const overlay = () => screen.getByRole("dialog").parentElement as HTMLElement;
const cancel = () => screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
type Way = { name: string; close: () => void };
const WAYS: Way[] = [
  { name: "Cancel", close: () => fireEvent.click(cancel()) },
  { name: "Escape", close: () => fireEvent.keyDown(document, { key: "Escape" }) },
  { name: "the overlay", close: () => fireEvent.click(overlay()) },
  { name: "the header's Close", close: () => fireEvent.click(screen.getByRole("button", { name: "Close" })) },
];
const sheetFor = (onClose: () => void) => render(
  <ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={A1({ description: "Printer toner" })} onClose={onClose} onSaved={vi.fn()} isCurrentBusiness={() => true} />,
);

describe("P256: while a save is submitting, the edit sheet cannot be closed", () => {
  it("Cancel is disabled while the save is out", async () => {
    client.updateExpense.mockReturnValue(new Promise(() => {}));
    sheetFor(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(client.updateExpense).toHaveBeenCalled());
    expect(cancel().disabled, "Cancel offered mid-save").toBe(true);
  });
  for (const w of WAYS) {
    it(`${w.name} does not close it mid-save`, async () => {
      client.updateExpense.mockReturnValue(new Promise(() => {}));
      const onClose = vi.fn();
      sheetFor(onClose);
      fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
      await waitFor(() => expect(client.updateExpense).toHaveBeenCalled());
      w.close();
      await settle();
      expect(onClose, `${w.name} closed the sheet while its save was out`).not.toHaveBeenCalled();
    });
    it(`control: ${w.name} closes it when nothing is being saved`, async () => {
      const onClose = vi.fn();
      sheetFor(onClose);
      w.close();
      await settle();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  }
  it("once the save has answered, the sheet can be closed again (a refused save leaves it open and closable)", async () => {
    client.updateExpense.mockResolvedValue({ data: null, error: "Amount can't change on a posted expense", status: 409 });
    const onClose = vi.fn();
    sheetFor(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect(cancel().disabled).toBe(false));
    fireEvent.click(cancel());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("P256: on the detail page", () => {
  it("the reported path: Cancel mid-save is not offered, and the save's reply closes the one open sheet", async () => {
    const held = deferred<unknown>();
    client.updateExpense.mockReturnValue(held.promise);
    await onA1();
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    fireEvent.change(await screen.findByPlaceholderText("What was this expense for?"), { target: { value: "Typed edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(client.updateExpense).toHaveBeenCalled());
    expect(cancel().disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.getByRole("button", { name: "Update Expense" }), "Escape closed the sheet mid-save").toBeTruthy();
    client.getExpense.mockResolvedValue(ok(A1({ description: "Typed edit" })));
    await act(async () => { held.resolve(ok(A1({ description: "Typed edit" }))); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Expense" })).toBeNull());
  });
  it("a reopen after a save shows the saved values", async () => {
    client.updateExpense.mockResolvedValue(ok(A1({ description: "Saved description" })));
    await onA1();
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    fireEvent.change(await screen.findByPlaceholderText("What was this expense for?"), { target: { value: "Saved description" } });
    client.getExpense.mockResolvedValue(ok(A1({ description: "Saved description" })));
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Expense" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
    const field = await screen.findByPlaceholderText("What was this expense for?") as HTMLInputElement;
    expect(field.value).toBe("Saved description");
  });
});
