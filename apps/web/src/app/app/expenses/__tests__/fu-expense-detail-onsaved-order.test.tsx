/**
 * P261 FU-EXPENSE-DETAIL-ONSAVED-ORDER (launch-track, D-315). The detail page's edit-sheet onSaved closed the sheet
 * (setEditFor(null)) before it checked the read it was opened on, so a late onSaved from A1's sheet, once the page shows
 * A2 and A2's sheet is open, closed A2's sheet and lost its typing.
 *
 * Through the real sheet this is held off today by the sheet's own check (live(), which asks the page's editCheck,
 * synchronously before it calls onSaved). The page's onSaved is its own guard too: here the sheet is a stand-in that
 * hands back the onSaved each open was given, so that guard is pinned on its own.
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

type SheetProps = { editingExpense: Expense | null; onSaved: () => void | Promise<void>; onClose: () => void };
const sheets = vi.hoisted(() => ({ opened: [] as Array<{ id: string; onSaved: () => void | Promise<void> }> }));
vi.mock("../components/expense-form-sidesheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/expense-form-sidesheet")>();
  const { createElement } = await import("react");
  function StandIn(props: SheetProps) {
    sheets.opened.push({ id: props.editingExpense?.id ?? "", onSaved: props.onSaved });
    return createElement("div", { role: "dialog", "aria-label": `Edit ${props.editingExpense?.id}` },
      createElement("input", { placeholder: "Typed edit" }));
  }
  return { ...actual, ExpenseFormSideSheet: StandIn };
});

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
const A1 = () => expense({ id: "exp_A1", vendor: "October Vendor" });
const A2 = () => expense({ id: "exp_A2", vendor: "November Vendor", date: "2026-11-15T00:00:00.000Z" });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  ws.bid = "biz_A";
  routeParams.id = "exp_A1";
  sheets.opened = [];
  nav.push.mockReset();
  nav.replace.mockReset();
  for (const fn of [...Object.values(client), ...Object.values(finance)]) fn.mockReset();
  client.getExpense.mockImplementation(async (_b: string, id: string) => ok(id === "exp_A2" ? A2() : A1()));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => { cleanup(); blocked.on = false; });

async function onA1() {
  const view = render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "October Vendor" });
  return view;
}
async function openEdit(id: string) {
  fireEvent.click(screen.getByRole("button", { name: /Edit expense/ }));
  await screen.findByRole("dialog", { name: `Edit ${id}` });
  return sheets.opened.filter((s) => s.id === id).at(-1)!.onSaved;
}

describe("P261: a late onSaved from the previous expense's sheet", () => {
  it("leaves the sheet open for the new expense, with its typing, and reads nothing of the old one", async () => {
    const view = await onA1();
    const a1Saved = await openEdit("exp_A1");
    routeParams.id = "exp_A2";
    view.rerender(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "November Vendor" });
    await openEdit("exp_A2");
    fireEvent.change(screen.getByPlaceholderText("Typed edit"), { target: { value: "Not saved yet" } });
    const a1Reads = client.getExpense.mock.calls.filter((c) => c[1] === "exp_A1").length;
    await act(async () => { await a1Saved(); });
    await settle();
    expect(screen.queryByRole("dialog", { name: "Edit exp_A2" }), "A1's onSaved closed A2's sheet").toBeTruthy();
    expect((screen.getByPlaceholderText("Typed edit") as HTMLInputElement).value, "A2's typing lost").toBe("Not saved yet");
    expect(client.getExpense.mock.calls.filter((c) => c[1] === "exp_A1").length, "A1 read again").toBe(a1Reads);
    expect(screen.getByRole("heading", { name: "November Vendor" })).toBeTruthy();
  });
  it("control: the same expense's onSaved closes its sheet and reads the expense again", async () => {
    await onA1();
    const a1Saved = await openEdit("exp_A1");
    const reads = client.getExpense.mock.calls.length;
    await act(async () => { await a1Saved(); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit exp_A1" })).toBeNull());
    expect(client.getExpense.mock.calls.length).toBeGreaterThan(reads);
  });
});
