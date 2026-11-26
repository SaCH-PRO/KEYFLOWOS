/**
 * EXPENSES-HUB-3 repair round 6 (round-5 confirmations at 9897426), absolute API base ("http://api.test").
 *
 *   S-1  the page's own host is an API host too (next.config rewrites /__api/* to the API whatever the base): an
 *        address on it is never a link
 *   C-1  an ordinary receipt name with a literal "%" ("receipt-100%25.pdf", "invoice 50% deposit.pdf") stays a link:
 *        a decode that fails after a successful one judges what was decoded, unless what is left still holds an
 *        escape (the undecodable pins hold)
 *   D    a path encoded five or more times that hides /objects is never a link
 *   C-4  a reload asked for by a call from before A → B → A (a delete that returns late) reads the current view
 *        afresh, so a deleted row does not stay on screen
 *   S-3  after a batched A → B → A, the projects, services and contacts lists are read again
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));

const client = vi.hoisted(() => ({
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
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [] }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { useExpensesData } from "../components/use-expenses-data";
import { receiptKind } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
function expense(id: string): Expense {
  return {
    id, description: id, amount: 10, currency: "TTD", date: "2026-11-20T00:00:00.000Z", vendor: "V", paymentMethod: "cash",
    tags: [], isRecurring: false, status: "PAID", categoryId: null, createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z",
  } as Expense;
}
const page = (...ids: string[]) => ok({ data: ids.map(expense), total: ids.length, page: 1, limit: 20 });
const PAGE = window.location.origin;

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [], missingReceiptCount: 0 }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockImplementation(async (b: string) => ok([{ id: `p_${b}`, name: `Project ${b}` }]));
  client.fetchServices.mockImplementation(async (b: string) => ok([{ id: `s_${b}`, name: `Service ${b}` }]));
  client.fetchContacts.mockImplementation(async (b: string) => ok({ contacts: [{ id: `c_${b}`, displayName: `Contact ${b}` }] }));
});
afterEach(() => cleanup());

const announce = (id: string) => {
  ws.bid = id;
  window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: id } }));
};

describe("S-1: the page's own host is never a link (next.config rewrites /__api/*)", () => {
  it.each([
    `${PAGE}/__api/objects/uploads/biz_OTHER/o`,
    `${PAGE}/__api//objects/uploads/biz_OTHER/o`,
    `${PAGE}/__api/objects/uploads/biz_A/o`,
    `${PAGE}/anything.png`,
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });
});

describe("C-1: a receipt name with a literal % is still a link", () => {
  it.each([
    "https://example.com/receipt%20one.pdf",
    "https://example.com/receipt-100%25.pdf",
    "https://example.com/invoice%2050%25%20deposit.pdf",
    "https://example.com/%2541.png",
  ])("%s → link", (url) => {
    expect(receiptKind(url, "biz_A")).toBe("link");
  });

  it.each([
    "https://elsewhere.test/%E0%A4%A/objects/x",
    "https://elsewhere.test/%25E0%A4%A.png",
  ])("the undecodable pin %s still holds", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });
});

describe("D: a path encoded five or more times that hides /objects", () => {
  it.each([
    "https://elsewhere.test/%252525256Fbjects/x", // 5 rounds to reach "/objects"
    "https://elsewhere.test/%25252525256Fbjects/x", // 6
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });
});

describe("C-4: a late reload from before A → B → A reads the current view afresh", () => {
  it("a delete that returns after the switches does not leave the deleted row on screen", async () => {
    let deleted = false;
    client.fetchExpenses.mockImplementation(async (b: string) => (b === "biz_B" ? page("b1") : deleted ? page("a2") : page("a1", "a2")));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"]));
    const reloadAfterDelete = result.current.loadData; // the delete of a1 started here
    act(() => announce("biz_B"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]));
    act(() => announce("biz_A"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1", "a2"])); // read before the delete committed
    deleted = true; // the delete commits, then its reload runs
    await act(async () => { await reloadAfterDelete(); });
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a2"]));
    expect(result.current.loading).toBe(false);
  });

  it("a late call from another business still asks for nothing", async () => {
    client.fetchExpenses.mockImplementation(async (b: string) => (b === "biz_B" ? page("b1") : page("a1")));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1"]));
    const staleOfA = result.current.loadData;
    act(() => announce("biz_B"));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]));
    const before = client.fetchExpenses.mock.calls.length;
    await act(async () => { await staleOfA(); });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.fetchExpenses.mock.calls.length).toBe(before);
    expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]);
  });
});

describe("S-3: projects, services and contacts are read again after a batched A → B → A", () => {
  it("the lists are not left empty", async () => {
    client.fetchExpenses.mockImplementation(async (b: string) => page(`${b}_row`));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.projects.map((p) => p.id)).toEqual(["p_biz_A"]));
    act(() => { announce("biz_B"); announce("biz_A"); });
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    await waitFor(() => expect(result.current.projects.map((p) => p.id)).toEqual(["p_biz_A"]));
    expect(result.current.services.map((s) => s.id)).toEqual(["s_biz_A"]);
    expect(result.current.contacts.map((c) => c.id)).toEqual(["c_biz_A"]);
  });
});
