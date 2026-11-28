/**
 * P259 FU-EXPENSES-DATA-GUARD-PINS (launch-track, D-315; from the P252 security review). Ten guard sites in
 * components/use-expenses-data.ts survived mutation on main. Each is pinned here, or (sites 8 and 9) documented in the
 * hook as covered by another guard:
 *   1 the switch's clearAll                      6 the business half of the picker reply's check
 *   2 the switch's generation bump               7 the business half of the picker throw's check
 *   3 the switch's summaryRead reset             8 loadData's stale-epoch refusal (documented: covered)
 *   4 the switch's budgetsRead reset             9 the business half of current() (documented: covered)
 *   5 the switch's picker-list clear            10 refused categories never shown as their data
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Expense, ExpenseBudget, ExpenseCategory, ExpenseSummary } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
}));

vi.mock("@/lib/client", () => client);
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { useExpensesData } from "../components/use-expenses-data";

const ok = <T,>(data: T) => ({ data, error: null });
const refused = { data: null, error: "Request refused by the server", status: 503 };
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const never = () => new Promise<never>(() => {});
/** Lets pending replies run their continuations (inside an act, before React renders). */
const microtasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const EXP_A = { id: "exp_A1", description: "A's row", amount: 10, status: "PAID" } as unknown as Expense;
const EXP_A_FUEL = { id: "exp_A_fuel", description: "A's fuel row", amount: 5, status: "PAID" } as unknown as Expense;
const CAT_A = { id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory;
const SUM_A = { total: 10, count: 1, byCategory: [] } as unknown as ExpenseSummary;
const BUD_A = { id: "bud_A", categoryId: "cat_A_fuel", amount: 100, spent: 10, remaining: 90, percentUsed: 10, isOverBudget: false, isNearAlert: false } as unknown as ExpenseBudget;
const page = (rows: Expense[]) => ok({ data: rows, total: rows.length, page: 1, limit: 20 });

/** A answers everything; B's reads never answer unless a test says otherwise. */
beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  const forA = <T,>(answer: T) => async (b: string) => (b === "biz_A" ? answer : never());
  client.fetchExpenses.mockImplementation(forA(page([EXP_A])));
  client.fetchExpenseCategories.mockImplementation(forA(ok([CAT_A])));
  client.fetchExpenseSummary.mockImplementation(forA(ok(SUM_A)));
  client.fetchExpenseBudgets.mockImplementation(forA(ok([BUD_A])));
  client.fetchProjects.mockImplementation(forA(ok([{ id: "prj_A", name: "Project A" }])));
  client.fetchServices.mockImplementation(forA(ok([{ id: "svc_A", name: "Service A" }])));
  client.fetchContacts.mockImplementation(forA(ok({ contacts: [{ id: "ct_A", displayName: "Contact A" }] })));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The switch as this tab's switcher announces it (adopt runs in the listener, before React renders). */
const announce = (bid: string | null) => {
  ws.bid = bid;
  window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } }));
};
const switchTo = (bid: string | null) => act(() => { announce(bid); });

async function onA() {
  const hook = renderHook(() => useExpensesData());
  await waitFor(() => expect(hook.result.current.read.kind).toBe("ok"));
  await waitFor(() => expect(hook.result.current.pickersRead.kind).toBe("ok"));
  expect(hook.result.current.expenses).toEqual([EXP_A]);
  expect(hook.result.current.projects).toEqual([{ id: "prj_A", name: "Project A" }]);
  return hook;
}

describe("P259: a switch to B, B's reads not yet answered, shows nothing of A", () => {
  it("site 1 (clearAll): A's rows, total, categories, summary and budgets are gone", async () => {
    const { result } = await onA();
    switchTo("biz_B");
    await settle();
    expect(result.current.businessId).toBe("biz_B");
    expect(result.current.expenses, "A's rows shown while B is read").toEqual([]);
    expect(result.current.totalExpenses).toBe(0);
    expect(result.current.categories, "A's categories shown while B is read").toEqual([]);
    expect(result.current.summary, "A's summary shown while B is read").toBeNull();
    expect(result.current.budgets, "A's budgets shown while B is read").toEqual([]);
  });
  it("site 3: the summary's read is loading again, never A's ok", async () => {
    const { result } = await onA();
    expect(result.current.summaryRead.kind).toBe("ok");
    switchTo("biz_B");
    await settle();
    expect(result.current.summaryRead.kind, "A's summary read said for B").toBe("loading");
  });
  it("site 4: the budgets' read is loading again, never A's ok", async () => {
    const { result } = await onA();
    expect(result.current.budgetsRead.kind).toBe("ok");
    switchTo("biz_B");
    await settle();
    expect(result.current.budgetsRead.kind, "A's budgets read said for B").toBe("loading");
  });
  it("site 5: A's projects, services and contacts are gone", async () => {
    const { result } = await onA();
    switchTo("biz_B");
    await settle();
    expect(result.current.projects, "A's projects offered on B").toEqual([]);
    expect(result.current.services, "A's services offered on B").toEqual([]);
    expect(result.current.contacts, "A's contacts offered on B").toEqual([]);
  });
});

describe("P259: A's picker reply lands after the switch to B, before B's picker read starts", () => {
  async function heldPickersOnA() {
    const held = { projects: deferred<unknown>(), services: deferred<unknown>(), contacts: deferred<unknown>() };
    client.fetchProjects.mockImplementation((b: string) => (b === "biz_A" ? held.projects.promise : never()));
    client.fetchServices.mockImplementation((b: string) => (b === "biz_A" ? held.services.promise : never()));
    client.fetchContacts.mockImplementation((b: string) => (b === "biz_A" ? held.contacts.promise : never()));
    const hook = renderHook(() => useExpensesData());
    await waitFor(() => expect(hook.result.current.read.kind).toBe("ok"));
    await waitFor(() => expect(client.fetchProjects).toHaveBeenCalledWith("biz_A"));
    return { ...hook, held };
  }
  it("site 6: the reply answers: B offers none of A's projects, services or contacts", async () => {
    const { result, held } = await heldPickersOnA();
    await act(async () => {
      announce("biz_B");
      held.projects.resolve(ok([{ id: "prj_A", name: "Project A" }]));
      held.services.resolve(ok([{ id: "svc_A", name: "Service A" }]));
      held.contacts.resolve(ok({ contacts: [{ id: "ct_A", displayName: "Contact A" }] }));
      await microtasks();
    });
    await settle();
    expect(result.current.businessId).toBe("biz_B");
    expect(result.current.projects, "A's projects offered on B").toEqual([]);
    expect(result.current.services).toEqual([]);
    expect(result.current.contacts).toEqual([]);
    expect(result.current.pickersRead.kind, "A's picker read said for B").toBe("loading");
  });
  it("site 7: the reply throws: B's picker read is not said to have failed", async () => {
    const { result, held } = await heldPickersOnA();
    await act(async () => {
      announce("biz_B");
      held.projects.reject(new TypeError("Failed to fetch"));
      await microtasks();
    });
    await settle();
    expect(result.current.businessId).toBe("biz_B");
    expect(result.current.pickersRead.kind, "A's picker failure said for B").toBe("loading");
  });
  it("control: the same reply with no switch is shown", async () => {
    const { result, held } = await heldPickersOnA();
    await act(async () => {
      held.projects.resolve(ok([{ id: "prj_A", name: "Project A" }]));
      held.services.resolve(ok([]));
      held.contacts.resolve(ok({ contacts: [] }));
      await microtasks();
    });
    await waitFor(() => expect(result.current.projects).toEqual([{ id: "prj_A", name: "Project A" }]));
  });
});

describe("P259 site 2: a filtered read of A answers during A -> B -> A, before the fresh read starts", () => {
  it("its filtered rows are not shown under the cleared filter", async () => {
    const filtered = deferred<unknown>();
    client.fetchExpenses.mockImplementation(async (b: string, opts?: { categoryId?: string }) => {
      if (b !== "biz_A") return never();
      return opts?.categoryId ? filtered.promise : page([EXP_A]);
    });
    const { result } = await onA();
    act(() => { result.current.setFilterCategory("cat_A_fuel"); });
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.objectContaining({ categoryId: "cat_A_fuel" })));
    // The fresh read after the switch back is held, so what shows is what the old reply left.
    client.fetchExpenses.mockImplementation(() => never());
    await act(async () => {
      announce("biz_B");
      announce("biz_A");
      filtered.resolve(page([EXP_A_FUEL]));
      await microtasks();
    });
    await settle();
    expect(result.current.businessId).toBe("biz_A");
    expect(result.current.filterCategory).toBe("");
    expect(result.current.expenses, "the old filter's rows shown under the cleared filter").toEqual([]);
    expect(result.current.read.kind, "the old read's answer said for the fresh one").toBe("loading");
  });
});

describe("P259 site 10: a refused categories answer is never shown as categories", () => {
  it("an answer carrying both data and an error: the categories are empty, and their read says it", async () => {
    client.fetchExpenseCategories.mockResolvedValue({ data: [CAT_A], error: "Request refused by the server", status: 503 });
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(result.current.categoriesRead.kind).toBe("failed");
    expect(result.current.categories, "a refused answer's data shown as categories").toEqual([]);
  });
  it("control: the plain refusal (data null) shows no categories either", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refused);
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(result.current.categoriesRead.kind).toBe("failed");
    expect(result.current.categories).toEqual([]);
  });
});
