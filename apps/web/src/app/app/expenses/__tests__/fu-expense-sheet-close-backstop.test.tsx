/**
 * P257 R1-2 (LOW, from the P257 correctness review): the expense sheet passes closeUnlessSaving as the SideSheet's
 * onClose, alongside closeDisabled. That backstop reads the ref set at the click, so a close in the same tick as the
 * submit (before the submitting render lands, so before closeDisabled is set) is held too. With closeDisabled in the
 * real sheet it had no pin of its own: here the SideSheet is a stand-in that ignores closeDisabled and hands back the
 * onClose it was given, so the backstop alone is what holds the close.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
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

const sheet = vi.hoisted(() => ({ onClose: null as null | (() => void) }));
vi.mock("../../commerce/components/side-sheet", async () => {
  const { createElement, Fragment } = await import("react");
  function StandIn(props: { onClose: () => void; children?: unknown; footer?: unknown }) {
    sheet.onClose = props.onClose;
    return createElement("div", { role: "dialog" }, createElement(Fragment, null, props.children as never, props.footer as never));
  }
  return { SideSheet: StandIn, QuickSheet: StandIn };
});

import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
const A1 = (): Expense => ({
  id: "exp_A1", description: "Printer toner", amount: 100, currency: "TTD", date: "2026-10-15T00:00:00.000Z",
  vendor: "October Vendor", paymentMethod: "cash", tags: [], isRecurring: false, status: "PAID", categoryId: null,
  createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
} as Expense);
beforeEach(() => {
  ws.bid = "biz_A";
  sheet.onClose = null;
  for (const fn of [...Object.values(client), ...Object.values(finance)]) fn.mockReset();
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
});
afterEach(() => { cleanup(); blocked.on = false; });
const mount = (onClose: () => void) => render(
  <ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={A1()} onClose={onClose} onSaved={vi.fn()} isCurrentBusiness={() => true} />,
);

describe("P257 R1-2: the sheet's onClose backstop holds a close in the same tick as the submit", () => {
  it("the SideSheet's onClose, called in the click's own tick and after it, closes nothing while the save is out", async () => {
    client.updateExpense.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    mount(onClose);
    const before = sheet.onClose!;
    const submit = screen.getByRole("button", { name: "Update Expense" });
    act(() => {
      submit.click();
      // The same tick: the submitting render has not landed, so closeDisabled is not set yet.
      before();
    });
    await waitFor(() => expect(client.updateExpense).toHaveBeenCalled());
    sheet.onClose!();
    expect(onClose, "the sheet closed while its save was out").not.toHaveBeenCalled();
  });
  it("control: with nothing being saved, the SideSheet's onClose closes the sheet", () => {
    const onClose = vi.fn();
    mount(onClose);
    sheet.onClose!();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
