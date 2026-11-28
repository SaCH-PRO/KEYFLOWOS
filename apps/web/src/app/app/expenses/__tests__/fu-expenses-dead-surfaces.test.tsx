/**
 * P252 FU-EXPENSES-DEAD-SURFACES (launch-track, D-315; from the EH3 R24 correctness review and the R24/R24b security
 * note n2). Removed, not mounted: no v1 packet ships them (the EXPENSES-HUB-3 plan entry mounts the Categories and
 * Recurring views only, D-152 hides what v1 does not promise, and its definition of done is "no figure that is not
 * read from the server").
 *
 *   - hooks/use-expenses-ai-hub.ts reported canned successes ("Expenses categorized", "Margin analysis complete", ...)
 *     with no client call; no screen imports it.
 *   - the Insights, Analytics and Vendors tabs (and the stats block only Analytics used) were never mounted.
 *   - their reads (vendor analytics, margin analysis, recurring patterns) were made on every page load for nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
/** The hook's reads, and the three removed reads the spec asserts are not made. */
const client = vi.hoisted(() => ({
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchRecurringCandidates: vi.fn(),
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

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EXPENSES = join(__dirname, "..");
const DEAD = [
  "hooks/use-expenses-ai-hub.ts",
  "components/expense-insights-tab.tsx",
  "components/expense-analytics-tab.tsx",
  "components/expense-vendors-tab.tsx",
  "components/expense-stats.tsx",
];

describe("P252: the dead expense surfaces are gone", () => {
  for (const path of DEAD) {
    it(`${path} is removed`, () => {
      expect(existsSync(join(EXPENSES, path)), `${path} still ships`).toBe(false);
    });
  }
});

describe("P252: the data hook makes no read nothing shows", () => {
  it("vendor analytics, margin analysis and recurring patterns are not read", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(client.fetchVendorAnalytics, "vendor analytics read for no screen").not.toHaveBeenCalled();
    expect(client.fetchMarginAnalysis, "margin analysis read for no screen").not.toHaveBeenCalled();
    expect(client.fetchRecurringCandidates, "recurring patterns read for no screen").not.toHaveBeenCalled();
  });
  it("and exposes none of them", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    for (const key of ["vendors", "vendorsRead", "marginData", "marginRead", "recurringCandidates", "candidatesRead"]) {
      expect(Object.prototype.hasOwnProperty.call(result.current, key), `the hook still exposes ${key}`).toBe(false);
    }
  });
  it("control: the reads v1 shows are still made", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(client.fetchExpenses).toHaveBeenCalled();
    expect(client.fetchExpenseCategories).toHaveBeenCalled();
    expect(client.fetchExpenseSummary).toHaveBeenCalled();
    expect(client.fetchExpenseBudgets).toHaveBeenCalled();
  });
});
