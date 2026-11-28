/**
 * P264 FU-RECURRING-EXIT-BUILDER-INERT (launch-track, D-315), closed as a pin (the orchestrator's ruling on the P264
 * CONTRADICTION, #273 comment 7239404451). The row assumed that when the recurring panel stays mounted across a
 * business switch, AnimatePresence keeps the old business's builder in the DOM while it animates out, with Save
 * enabled. It does not: the builder is gone in the switching commit.
 *
 * Why (framer-motion's presence contexts nest): the panel wraps RecurringBuilder in <AnimatePresence>, but
 * RecurringBuilder's root is the commerce SideSheet, whose own root is another <AnimatePresence>. The SideSheet's
 * motion.div registers its exit with that inner presence context, so the outer one sees no presence-aware child and
 * removes RecurringBuilder at once. A child whose root is a motion element (the control below) does stay through its
 * exit; if the builder's root ever became one, the old business's builder would linger, and this pin fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { flushSync } from "react-dom";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { AnimatePresence, motion } from "framer-motion";

const ZONES: Record<string, string> = vi.hoisted(() => ({ biz_A: "America/Port_of_Spain", biz_B: "America/Port_of_Spain" } as Record<string, string>));
const CURRENCIES: Record<string, string> = vi.hoisted(() => ({ biz_A: "TTD", biz_B: "USD" } as Record<string, string>));
const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
  fetchFinanceAccounts: vi.fn(),
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchRecurringCandidates: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
  upsertExpenseBudget: vi.fn(),
  deleteExpenseBudget: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
const upload = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: upload.uploadFile, isUploading: false, progress: 0 }) }));
const drive = vi.hoisted(() => ({ uploadToDrive: vi.fn() }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: drive.uploadToDrive }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
const finance = vi.hoisted(() => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/api/finance", () => finance);
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: CURRENCIES[ws.bid] ?? "TTD", timezone: ZONES[ws.bid] ?? "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
}));

import RecurringExpensesPanel from "../components/recurring-expenses-panel";

import { SideSheet } from "../../commerce/components/side-sheet";

const ok = <T,>(data: T) => ({ data, error: null });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  client.createRecurringExpense.mockResolvedValue(ok({ id: "rec_new" }));
});
afterEach(() => { cleanup(); blocked.on = false; });

/** Every node the page adds or removes from here on, so a builder that lingers for one commit is seen. */
function watch() {
  const added: Node[] = [];
  const mo = new MutationObserver((records) => { for (const r of records) added.push(...Array.from(r.addedNodes)); });
  mo.observe(document.body, { childList: true, subtree: true });
  return { added, stop: () => { mo.takeRecords().forEach((r) => added.push(...Array.from(r.addedNodes))); mo.disconnect(); } };
}

describe("P264: the old business's builder is gone in the commit that switches the panel to B", () => {
  it("open and filled for A, then a flushSync switch to B: no builder, no Save, nothing of A focusable, no create sent", async () => {
    const el = (b: string, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    const title = await screen.findByText("New Recurring Expense", {}, { timeout: 10000 });
    fireEvent.change(screen.getByPlaceholderText("e.g., Office Rent"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("What is this expense for?"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "4500" } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2027-06-01" } });
    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    const name = screen.getByPlaceholderText("e.g., Office Rent") as HTMLInputElement;
    expect(create.disabled, "the fixture's builder is not ready to save").toBe(false);
    name.focus();
    ws.bid = "biz_B";
    const w = watch();
    act(() => { flushSync(() => { view.rerender(el("biz_B", 1)); }); });
    // Right after the switching commit, before any timer or animation frame:
    expect(title.isConnected, "A's builder is still in the DOM after the switch").toBe(false);
    expect(create.isConnected, "A's Save is still in the DOM").toBe(false);
    expect(screen.queryByText("New Recurring Expense"), "a builder is shown on B").toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(name.isConnected, "A's fields are still in the DOM").toBe(false);
    expect(document.activeElement === name, "A's field still has focus").toBe(false);
    fireEvent.click(create); // a detached button: nothing may come of it either
    await settle();
    w.stop();
    expect(w.added.some((n) => n instanceof HTMLElement && /New Recurring Expense/.test(n.textContent ?? "")), "A's builder came back after the switch").toBe(false);
    expect(client.createRecurringExpense, "a schedule was sent after the switch").not.toHaveBeenCalled();
  });
  it("control: with no switch, the builder saves", async () => {
    const el = (t: number) => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    await screen.findByText("New Recurring Expense", {}, { timeout: 10000 });
    fireEvent.change(screen.getByPlaceholderText("e.g., Office Rent"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("What is this expense for?"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "4500" } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2027-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await settle();
    expect(client.createRecurringExpense).toHaveBeenCalledTimes(1);
  });
  it("why (documentation): under <AnimatePresence>, a motion-rooted child stays through its exit; a SideSheet-rooted child does not", async () => {
    function Host({ child, show }: { child: "motion" | "sidesheet"; show: boolean }) {
      return (
        <AnimatePresence>
          {show && (child === "motion"
            ? <motion.div key="m" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}><button>Leaving</button></motion.div>
            : <SheetChild key="s" />)}
        </AnimatePresence>
      );
    }
    function SheetChild() {
      return <SideSheet open onClose={() => {}} title="Builder"><button>Leaving</button></SideSheet>;
    }
    for (const [child, staysThroughExit] of [["motion", true], ["sidesheet", false]] as const) {
      const view = render(<Host child={child} show />);
      await settle();
      act(() => { flushSync(() => { view.rerender(<Host child={child} show={false} />); }); });
      expect(!!screen.queryByRole("button", { name: "Leaving" }), `${child}-rooted child kept through its exit`).toBe(staysThroughExit);
      view.unmount();
    }
  });
});
