/**
 * PR195-PORT (owner PR #195 part 3): the Financial Flow page shows a
 * Safe-to-Spend breakdown card with the committed-payroll reserve (part 1), and
 * links the General Journal.
 *
 * Held to the head: safe-to-spend needs revenue read (D-57). A member the
 * server refuses it sees the page's load error naming Safe-to-spend, and no
 * breakdown card with made-up zeroes.
 *
 *   FF-01  the card lists cash, tax, bills, committed payroll, buffer, other
 *          reserves and safe to spend, each in the business currency
 *   FF-02  a refused safe-to-spend read shows no card and names the failed read
 *   FF-03  the page offers the General Journal (/app/finance/journal)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/financial-flow",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_ff_1" }));

const apiGetMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  apiPost: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/lib/api/finance", () => ({
  fetchReserveBuckets: vi.fn(async () => ({ data: { items: [] }, error: null })),
  createReserveBucket: vi.fn(),
  deleteReserveBucket: vi.fn(),
}));
vi.mock("@/lib/api/flow-signal", () => ({
  fetchRoleFlowQueue: vi.fn(async () => ({ data: { items: [] }, error: null })),
  resolveFlowSignal: vi.fn(),
}));

const SAFE = {
  safeToSpend: 36_499.5,
  cashBalance: 50_000,
  taxReserved: 0,
  billsDueNext30Days: 0,
  payrollReserved: 8_500.5,
  debtPaymentsDue: 0,
  operatingBuffer: 5_000,
  otherReserves: 0,
  currency: "USD",
  explanation: ["Payroll reserved: USD 8500.50 (2 committed runs)"],
};

function answer(path: string, safe: { data: unknown; error: string | null; status?: number }) {
  if (path.endsWith("/safe-to-spend")) return safe;
  if (path.endsWith("/overview")) {
    return { data: { cashBalance: 50_000, outstandingInvoices: 0, overdueInvoices: 0, billsDue: 0, taxReserved: 0, netProfitThisMonth: 0, currency: "USD" }, error: null };
  }
  if (path.includes("/cashflow-forecast")) {
    return { data: { days: 90, expected: 1, conservative: 1, optimistic: 1, dangerDate: null, recommendations: [] }, error: null };
  }
  return { data: null, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("Financial Flow: Safe-to-Spend breakdown (PR195-PORT)", () => {
  it("FF-01 lists every part of the figure, committed payroll included, in the business currency", async () => {
    apiGetMock.mockImplementation(async (path: string) => answer(path, { data: SAFE, error: null }));
    const { default: FinancialFlowPage } = await import("../page");
    render(<FinancialFlowPage />);
    const card = await waitFor(() => screen.getByText("Safe-to-Spend Breakdown").closest("section, div") as HTMLElement);
    const scope = within(card.parentElement ?? card);
    expect(scope.getByText("Committed Payroll")).toBeTruthy();
    expect(scope.getByText(/USD\s*8,500\.5/)).toBeTruthy();
    expect(scope.getByText("Cash Balance")).toBeTruthy();
    expect(scope.getByText("Tax Reserved")).toBeTruthy();
    expect(scope.getByText("Bills Due (30d)")).toBeTruthy();
    expect(scope.getByText("Operating Buffer")).toBeTruthy();
    expect(scope.getByText("Other Reserves")).toBeTruthy();
    expect(scope.getByText("Safe to Spend")).toBeTruthy();
  });

  it("FF-02 a refused safe-to-spend read shows no breakdown and names the failed read", async () => {
    apiGetMock.mockImplementation(async (path: string) =>
      answer(path, { data: null, error: "Insufficient permissions: revenue requires read access (you have none)", status: 403 }),
    );
    const { default: FinancialFlowPage } = await import("../page");
    render(<FinancialFlowPage />);
    await waitFor(() => expect(screen.getByText(/Safe-to-spend/)).toBeTruthy());
    expect(screen.queryByText("Safe-to-Spend Breakdown")).toBeNull();
    expect(screen.queryByText("Committed Payroll")).toBeNull();
  });

  it("FF-03 the page offers the General Journal", async () => {
    apiGetMock.mockImplementation(async (path: string) => answer(path, { data: SAFE, error: null }));
    const { default: FinancialFlowPage } = await import("../page");
    const { container } = render(<FinancialFlowPage />);
    await waitFor(() => expect(container.querySelector('a[href="/app/finance/journal"], [data-href="/app/finance/journal"]') ?? screen.queryByText("Journal Entries")).toBeTruthy());
  });
});
