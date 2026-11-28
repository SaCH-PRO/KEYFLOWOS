/**
 * P254 FU-RECURRING-NO-BUSINESS-READ (launch-track, D-315; from the EH3 R26 correctness review).
 *
 * With no business, the recurring panel reads nothing; it used to keep the previous business's list read (or show its
 * empty state, "No recurring expenses" with Add), so the hub could offer "New recurring expense" with no business.
 * With no business the panel shows no list, no empty state and no Add, reports a read that is not ok, and the hub
 * offers no "New recurring expense".
 * R1: the hub pin reaches the page's own no-business path ("No business is selected.", no Recurring panel); with no
 * business a New request (triggerNew) opens no builder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

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

import { toast } from "sonner";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import ExpensesInboxPage from "../page";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, ExpenseCategory[]> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" } as ExpenseCategory],
};


const SCHEDULE = {
  id: "rec_A1", name: "Rent", frequency: "MONTHLY", nextRunDate: "2026-12-01T00:00:00.000Z", isActive: true, runCount: 0,
  failureCount: 0, description: "Rent", amount: 1000, currency: "TTD", createsBill: false,
} as RecurringExpense;
const _BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockImplementation(async (b: string) => ok(CATS[b] ?? []));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockImplementation(async (b: string) => ok(b === "biz_A" ? [SCHEDULE] : []));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });





afterEach(() => {
  ZONES.biz_A = "America/Port_of_Spain";
  vi.useRealTimers();
});


afterEach(() => { blocked.on = false; });






const LONG = { timeout: 10000 };
import type { BlockRead } from "../components/use-expenses-data";

describe("P254: the recurring panel with no business", () => {
  it("mounted with no business: no empty state, no Add, and a read that is not ok", async () => {
    const reads: BlockRead[] = [];
    render(<RecurringExpensesPanel businessId={null} categories={[]} triggerNew={0} onListRead={(r) => reads.push(r)} />);
    await settle();
    expect(screen.queryByText(/no recurring expenses/i), "an empty state with no business").toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
    expect(reads.at(-1)?.kind).not.toBe("ok");
    expect(client.fetchRecurringExpenses).not.toHaveBeenCalled();
  });
  it("A's list answered, then no business: A's read is forgotten, and nothing of A shows", async () => {
    const reads: BlockRead[] = [];
    const el = (b: string | null) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} onListRead={(r) => reads.push(r)} />;
    const view = render(el("biz_A"));
    expect(await screen.findByRole("button", { name: /Run Now/i }, LONG)).toBeTruthy();
    await waitFor(() => expect(reads.at(-1)?.kind).toBe("ok"), LONG); // reported from an effect after the render
    ws.bid = null;
    view.rerender(el(null));
    await settle();
    expect(reads.at(-1)?.kind, "A's ok kept with no business").not.toBe("ok");
    expect(screen.queryByRole("button", { name: /Run Now/i })).toBeNull();
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
  });
  it("R1-2: with no business, a New request (triggerNew) opens no builder", async () => {
    const el = (t: number) => <RecurringExpensesPanel businessId={null} categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    await settle();
    expect(screen.queryByRole("dialog"), "the builder opened with no business").toBeNull();
  });
  it("R1-2: a business given after mount, then a New request, opens the builder", async () => {
    const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
    const view = render(el(null, 0));
    await settle();
    view.rerender(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
  it("R1-2 control: with a business, a New request opens the builder", async () => {
    const el = (t: number) => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
  it("control: a business whose list answers empty shows the empty state with Add", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(ok([]));
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(/no recurring expenses/i, {}, LONG)).toBeTruthy();
  });
});

describe("P254: the hub with no business", () => {
  it("the stored business cleared on the Recurring view: no 'New recurring expense'", async () => {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
    ws.bid = null;
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: null } })); });
    await settle();
    await settle();
    expect(screen.queryByRole("button", { name: /New recurring expense/ }), "offered with no business").toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
    // P254 R1-1: the page's own no-business path (the panel is not mounted with no business), pinned as such.
    expect(await screen.findByText("No business is selected.", {}, LONG)).toBeTruthy();
    expect(document.getElementById("expenses-panel-recurring"), "the Recurring panel mounted with no business").toBeNull();
  }, 30000);
});

describe("P254 R3-1: a business change alone never reopens the builder (COR MINOR-6, at the panel)", () => {
  const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
  async function newOnA() {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
    return view;
  }
  it("A, New, then B with the trigger unchanged: no builder", async () => {
    const view = await newOnA();
    view.rerender(el("biz_B", 1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder reopened for B on the business change alone").toBeNull();
  });
  it("A, New, then none, then B with the trigger unchanged: no builder", async () => {
    const view = await newOnA();
    view.rerender(el(null, 1));
    await settle();
    view.rerender(el("biz_B", 1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder reopened for B on the business change alone").toBeNull();
  });
});

describe("P254 R3-2: the hub's New request does not outlive the business it was made for", () => {
  const switchTo = (bid: string | null) => {
    ws.bid = bid;
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
  };
  for (const path of [["biz_B"], [null, "biz_B"]] as const) {
    it(`New under A, then ${path.map((b) => b ?? "none").join(" → ")}: no builder until New is pressed again`, async () => {
      render(<ExpensesInboxPage />);
      await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
      fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
      fireEvent.click(await screen.findByRole("button", { name: /New recurring expense/ }, LONG));
      expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
      for (const bid of path) {
        switchTo(bid);
        await settle();
        await settle();
      }
      await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_B"), LONG);
      const again = await screen.findByRole("button", { name: /New recurring expense/ }, LONG);
      await settle();
      expect(screen.queryByRole("dialog"), "the builder opened for B without a click").toBeNull();
      fireEvent.click(again);
      expect(await screen.findByRole("dialog", {}, LONG), "control: New pressed on B opens the builder").toBeTruthy();
    }, 30000);
  }
});

describe("P254 R4-1: a New queued for A, then the business changes in the same task, before the builder opens", () => {
  const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
  for (const next of [null, "biz_B"] as const) {
    it(`A, New, then ${next ?? "none"} before the queued open runs: no builder`, async () => {
      const view = render(el("biz_A", 0));
      await settle();
      // Two commits in one task: the open queued by the first has not run when the second lands.
      view.rerender(el("biz_A", 1));
      view.rerender(el(next, 1));
      await settle();
      await settle();
      expect(screen.queryByRole("dialog"), `A's queued New opened the builder under ${next ?? "none"}`).toBeNull();
    });
  }
  it("control: A, New, and no change: the builder opens", async () => {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
});

describe("P254 R4-2: a New and a business change in the same commit", () => {
  const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
  it("A to none, with New: no builder (the ref follows the business before the New is read)", async () => {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el(null, 1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder opened with no business").toBeNull();
  });
  it("A to B, with New: the builder opens, for B", async () => {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_B", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
});

describe("P254 R5-1: the panel remounted with the business unchanged opens no builder until New is pressed again", () => {
  const announce = (bid: string | null) => {
    ws.bid = bid;
    window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } }));
  };
  /** On A's Recurring view: New pressed, the builder opened, then cancelled. */
  async function newThenCancelOnA() {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
    fireEvent.click(await screen.findByRole("button", { name: /New recurring expense/ }, LONG));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    // The builder's own Cancel (the last in the dialog; the sheet's header has its own close).
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Cancel").at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), LONG);
  }
  async function noBuilderThenNewOpens(listReads: number) {
    await waitFor(() => expect(client.fetchRecurringExpenses.mock.calls.length).toBeGreaterThan(listReads), LONG);
    const again = await screen.findByRole("button", { name: /New recurring expense/ }, LONG);
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder opened on a remount, without a click").toBeNull();
    fireEvent.click(again);
    expect(await screen.findByRole("dialog", {}, LONG), "control: New pressed after the remount opens the builder").toBeTruthy();
  }
  it("New on A, then A -> B -> A in one batch", async () => {
    await newThenCancelOnA();
    const listReads = client.fetchRecurringExpenses.mock.calls.length;
    act(() => { announce("biz_B"); announce("biz_A"); });
    await noBuilderThenNewOpens(listReads);
  }, 30000);
  it("New on A, then the expenses read fails, then Try again answers", async () => {
    await newThenCancelOnA();
    const listReads = client.fetchRecurringExpenses.mock.calls.length;
    client.fetchExpenses.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    act(() => { announce("biz_B"); announce("biz_A"); });
    expect(await screen.findByText("Couldn't load expenses.", {}, LONG)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await noBuilderThenNewOpens(listReads);
  }, 30000);
});

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("P254 R5-2: after A -> B, B never offers New on A's list answer", () => {
  it("no 'New recurring expense' appears on B before B's list answers", async () => {
    const heldB = deferred<unknown>();
    client.fetchRecurringExpenses.mockImplementation((b: string) => (b === "biz_A" ? Promise.resolve(ok([SCHEDULE])) : heldB.promise));
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
    // Every node the page adds from here is checked, so a New offered for one commit is seen.
    let offered = false;
    const seen = new MutationObserver((records) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) {
        if (n instanceof HTMLElement && /New recurring expense/.test(n.textContent ?? "")) offered = true;
      }
    });
    seen.observe(document.body, { childList: true, subtree: true });
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_B"), LONG);
    await settle();
    await settle();
    seen.disconnect();
    expect(offered, "B offered New on A's list answer").toBe(false);
    expect(screen.queryByRole("button", { name: /New recurring expense/ })).toBeNull();
    // Control: B's list answers, and New is offered.
    await act(async () => { heldB.resolve(ok([])); });
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
  }, 30000);
});

describe("P254 R5-1 at the panel: mounted with a New already counted", () => {
  const el = (t: number) => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={t} />;
  it("the mount-time value opens nothing", async () => {
    render(el(1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder opened on the value the panel mounted with").toBeNull();
  });
  it("reset to 0 while mounted, then New (1 again): the builder opens", async () => {
    const view = render(el(1));
    await settle();
    view.rerender(el(0));
    await settle();
    view.rerender(el(1));
    expect(await screen.findByRole("dialog", {}, LONG), "a New after the reset was taken for the mount-time value").toBeTruthy();
  });
});

describe("P254 R5-3: the queued open fires after the next business has committed, before its passive effects", () => {
  /**
   * The window the reviewer found (a New committed at default priority under A, the switch committed a macrotask
   * later): React flushes A's effects while rendering B, so the open is queued for A, and it fires once B has
   * committed but before B's passive effects run. Here the open A's New queued is captured, and replayed from a probe's
   * layout effect in the commit that shows the next business: after its DOM and the panel's layout effects, before any
   * passive effect. That is that window, deterministically.
   */
  function Probe({ fire, run }: { fire: boolean; run: () => void }) {
    React.useLayoutEffect(() => { if (fire) run(); });
    return null;
  }
  function harness() {
    let queued: (() => void) | null = null;
    let fired = false;
    const run = () => { if (queued && !fired) { fired = true; queued(); } };
    const el = (b: string | null, t: number, fire: boolean) => (
      <>
        <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />
        <Probe fire={fire} run={run} />
      </>
    );
    return {
      el,
      /** New pressed on A, its queued open captured and not run. */
      async newOnA(view: ReturnType<typeof render>) {
        const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((cb: () => void) => { queued = cb; });
        view.rerender(el("biz_A", 1, false));
        spy.mockRestore();
        expect(queued, "New queued no open").toBeTruthy();
      },
    };
  }
  it("A, New, then B: the open replayed in B's commit opens no builder", async () => {
    const h = harness();
    const view = render(h.el("biz_A", 0, false));
    await settle();
    await h.newOnA(view);
    act(() => { view.rerender(h.el("biz_B", 1, true)); });
    await settle();
    expect(screen.queryByRole("dialog"), "A's New opened the builder under B").toBeNull();
  });
  it("A, New, then B, then A again before it fires: no builder (the New was made before a switch)", async () => {
    const h = harness();
    const view = render(h.el("biz_A", 0, false));
    await settle();
    await h.newOnA(view);
    act(() => { view.rerender(h.el("biz_B", 1, false)); });
    act(() => { view.rerender(h.el("biz_A", 1, true)); });
    await settle();
    expect(screen.queryByRole("dialog"), "a New made before A -> B -> A opened the builder").toBeNull();
  });
  it("control: A, New, the open replayed in a commit that keeps A: the builder opens", async () => {
    const h = harness();
    const view = render(h.el("biz_A", 0, false));
    await settle();
    await h.newOnA(view);
    act(() => { view.rerender(h.el("biz_A", 1, true)); });
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
});

describe("P254 R6-1: A's queued New, run while B's render is in progress (before B's layout effects), shows nothing under B", () => {
  /**
   * The reviewer's time-sliced case: the switch to B renders in a transition that yields before commit, and A's queued
   * open runs in that gap, before B's layout effects. act cannot drive a yielding transition deterministically, so the
   * open A's New queued is captured and run from a probe's render, after the panel has rendered for B and before that
   * render commits (React warns about an update during another component's render; the update still lands).
   */
  function RenderProbe({ fire, run }: { fire: boolean; run: () => void }) {
    if (fire) run();
    return null;
  }
  it("A, New, then B: the open run mid-render opens no builder under B", async () => {
    let queued: (() => void) | null = null;
    let fired = false;
    const run = () => { if (queued && !fired) { fired = true; queued(); } };
    const el = (b: string | null, t: number, fire: boolean) => (
      <>
        <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />
        <RenderProbe fire={fire} run={run} />
      </>
    );
    const view = render(el("biz_A", 0, false));
    await settle();
    const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((cb: () => void) => { queued = cb; });
    view.rerender(el("biz_A", 1, false));
    spy.mockRestore();
    expect(queued, "New queued no open").toBeTruthy();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => { view.rerender(el("biz_B", 1, true)); });
    await settle();
    await settle();
    quiet.mockRestore();
    expect(fired).toBe(true);
    expect(screen.queryByRole("dialog"), "A's New opened the builder under B").toBeNull();
  });
});

describe("P254 R6-2: the panel remounted for the same business offers no New before its list is read again", () => {
  const announce = (bid: string | null) => {
    ws.bid = bid;
    window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } }));
  };
  async function onRecurringWithNewOffered() {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
  }
  /** Watches every node the page adds, so a New offered for one commit is seen. */
  function watchForNew() {
    const seen = { offered: false };
    const scan = (records: MutationRecord[]) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) {
        if (n instanceof HTMLElement && /New recurring expense/.test(n.textContent ?? "")) seen.offered = true;
      }
    };
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    // P254 R8-3: records not yet delivered are read before the observer stops.
    return { seen, stop: () => { scan(mo.takeRecords()); mo.disconnect(); } };
  }
  for (const path of ["A -> B -> A in one batch", "a failed read, then Try again"] as const) {
    it(`${path}: no New until the list answers again`, async () => {
      await onRecurringWithNewOffered();
      const reads = client.fetchRecurringExpenses.mock.calls.length;
      const held = deferred<unknown>();
      client.fetchRecurringExpenses.mockImplementation(() => held.promise);
      const w = watchForNew();
      if (path === "A -> B -> A in one batch") {
        act(() => { announce("biz_B"); announce("biz_A"); });
      } else {
        client.fetchExpenses.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        act(() => { announce("biz_B"); announce("biz_A"); });
        expect(await screen.findByText("Couldn't load expenses.", {}, LONG)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      }
      await waitFor(() => expect(client.fetchRecurringExpenses.mock.calls.length).toBeGreaterThan(reads), LONG);
      await settle();
      w.stop();
      expect(w.seen.offered, "New offered beside a list not read again").toBe(false);
      expect(screen.queryByRole("button", { name: /New recurring expense/ })).toBeNull();
      // Control: the list answers, and New is offered.
      await act(async () => { held.resolve(ok([SCHEDULE])); });
      expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
    }, 30000);
  }
});

describe("P254 R7-1: a reload that goes from ok straight to failed (no loading between) offers no New before the list answers", () => {
  it("the categories Retry's reload rejects on Recurring, then Try again: no New until the list answers again", async () => {
    // Categories refused at first, so the panel offers its categories Retry (the page's loadData).
    client.fetchExpenseCategories.mockResolvedValueOnce({ data: null, error: "Request refused by the server", status: 503 });
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
    // P254 R8-2: the Retry in the categories' own note (the list's note, if any, has its own).
    const catNote = (await screen.findByText(/Couldn't load expense categories/, {}, LONG)).closest('[role="status"]');
    // P254 R9: a markup change fails here, with this message, not as a null inside within().
    expect(catNote, "the categories note is a status region").not.toBeNull();
    const retry = within(catNote as HTMLElement).getByRole("button", { name: "Retry" });
    // loadData's catch sets the read to failed with no loading before it (use-expenses-data's refresh path).
    client.fetchExpenses.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(retry);
    expect(await screen.findByText("Couldn't load expenses.", {}, LONG)).toBeTruthy();
    const reads = client.fetchRecurringExpenses.mock.calls.length;
    const held = deferred<unknown>();
    client.fetchRecurringExpenses.mockImplementation(() => held.promise);
    let offered = false;
    const scan = (records: MutationRecord[]) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) {
        if (n instanceof HTMLElement && /New recurring expense/.test(n.textContent ?? "")) offered = true;
      }
    };
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(client.fetchRecurringExpenses.mock.calls.length).toBeGreaterThan(reads), LONG);
    await settle();
    // P254 R8-3: records not yet delivered to the callback are read before the observer stops.
    scan(mo.takeRecords());
    mo.disconnect();
    expect(offered, "New offered beside a list not read again").toBe(false);
    expect(screen.queryByRole("button", { name: /New recurring expense/ })).toBeNull();
    await act(async () => { held.resolve(ok([SCHEDULE])); });
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG), "control: New offered once the list answers").toBeTruthy();
  }, 30000);
});

describe("P254 R7-2: a save that goes through closes the builder; a refused one leaves it open", () => {
  const refusedSave = { data: null, error: "Request refused by the server", status: 503 };
  async function fillCreate() {
    fireEvent.change(await screen.findByPlaceholderText("e.g., Office Rent", {}, LONG), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("What is this expense for?"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "4500" } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2027-06-01" } });
  }
  async function newBuilder() {
    client.fetchRecurringExpenses.mockResolvedValue(ok([]));
    const el = (t: number) => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
    await fillCreate();
  }
  async function editBuilder() {
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/i }, LONG));
    expect(await screen.findByRole("button", { name: "Update" }, LONG)).toBeTruthy();
  }
  for (const kind of ["Create", "Update"] as const) {
    const call = () => (kind === "Create" ? client.createRecurringExpense : client.updateRecurringExpense);
    it(`${kind}, answered: the builder closes`, async () => {
      call().mockResolvedValue(ok(SCHEDULE));
      if (kind === "Create") await newBuilder(); else await editBuilder();
      fireEvent.click(screen.getByRole("button", { name: kind }));
      await waitFor(() => expect(call()).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByRole("dialog"), `${kind} saved, and the builder stayed open`).toBeNull(), LONG);
      // P254 R8-4: and the save was for the business the panel shows.
      expect(call(), `${kind} sent more than once`).toHaveBeenCalledTimes(1);
      expect(call().mock.calls[0][0], `${kind} sent for another business`).toBe("biz_A");
    }, 30000);
    it(`${kind}, refused: the builder stays open`, async () => {
      call().mockResolvedValue(refusedSave);
      if (kind === "Create") await newBuilder(); else await editBuilder();
      fireEvent.click(screen.getByRole("button", { name: kind }));
      await waitFor(() => expect(call()).toHaveBeenCalled());
      await settle();
      expect(screen.queryByRole("dialog"), `a refused ${kind} closed the builder`).toBeTruthy();
    }, 30000);
  }
});

describe("P254 R7-3: the trigger going back to 0 while mounted opens nothing", () => {
  it("1, the builder closed, then 0: no builder", async () => {
    const el = (t: number) => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Cancel").at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), LONG);
    view.rerender(el(0));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the trigger's reset to 0 opened the builder").toBeNull();
  }, 30000);
});
