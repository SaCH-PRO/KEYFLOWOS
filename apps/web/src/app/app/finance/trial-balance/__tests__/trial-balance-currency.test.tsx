/**
 * V1-37b-CURRENCY-PROJECTIONS, review ST-V37-3 / RV37-01 — the trial balance
 * page keys and totals by (accountId, currency).
 *
 * WHY this test exists: V1-37 made the server's trial balance one row per
 * (account, currency), so an account that saw TTD and USD comes back twice.
 * The page keyed its table by accountId (two rows with one React key) and
 * added every row's debit and credit into one "Total Debits" / "Total
 * Credits" figure, so TTD and USD were summed into a number that is in no
 * currency. Each row must say its currency, keep its own key, and the totals
 * must be per currency, each balancing on its own.
 *
 * Mounted on the real TrialBalancePage and the real DataTable; only the
 * trial-balance fetch and next/navigation are stubbed. The rows are the
 * server's projection (finance.controller.ts trial-balance items).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import TrialBalancePage from "../page";
import { fetchTrialBalance } from "@/lib/api/finance";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance/trial-balance",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/api/finance", () => ({ fetchTrialBalance: vi.fn() }));

const BUSINESS = "biz_tb_currency";

/**
 * A TTD business that also invoiced in USD. TTD: debits 160 = credits 160.
 * USD: debits 297 = credits 297. Summed across currencies: 457, in no currency.
 */
const ROWS = [
  { accountId: "coa_ar", systemKey: "ACCOUNTS_RECEIVABLE", name: "Accounts Receivable", type: "ASSET", currency: "TTD", debit: "80", credit: "80", net: "0" },
  { accountId: "coa_ar", systemKey: "ACCOUNTS_RECEIVABLE", name: "Accounts Receivable", type: "ASSET", currency: "USD", debit: "165", credit: "120", net: "45" },
  { accountId: "coa_cash", systemKey: "CASH", name: "Cash", type: "ASSET", currency: "TTD", debit: "80", credit: "0", net: "80" },
  { accountId: "coa_cash", systemKey: "CASH", name: "Cash", type: "ASSET", currency: "USD", debit: "132", credit: "0", net: "132" },
  { accountId: "coa_equity", systemKey: "OWNER_EQUITY", name: "Owner Equity", type: "EQUITY", currency: "USD", debit: "0", credit: "12", net: "-12" },
  { accountId: "coa_rev", systemKey: "REVENUE", name: "Revenue", type: "INCOME", currency: "TTD", debit: "0", credit: "80", net: "-80" },
  { accountId: "coa_rev", systemKey: "REVENUE", name: "Revenue", type: "INCOME", currency: "USD", debit: "0", credit: "165", net: "-165" },
];

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BUSINESS);
  vi.mocked(fetchTrialBalance).mockResolvedValue({ data: { items: ROWS }, error: null } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function mount() {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(<TrialBalancePage />);
  await screen.findAllByText("Accounts Receivable");
  return errors;
}

describe("trial balance page: one line per (account, currency), totals per currency", () => {
  it("TB-CUR-01: an account in two currencies shows two lines, each with its currency and its own key", async () => {
    const errors = await mount();
    expect(fetchTrialBalance).toHaveBeenCalledWith(BUSINESS, undefined);

    const ar = screen.getAllByText("Accounts Receivable").map((cell) => cell.closest("tr") as HTMLElement);
    expect(ar).toHaveLength(2);
    expect(ar.map((row) => within(row).queryByText(/^(TTD|USD)$/)?.textContent).sort()).toEqual(["TTD", "USD"]);
    // Every server row is on the page: nothing collapsed.
    expect(screen.getAllByRole("row").filter((row) => row.querySelector("td"))).toHaveLength(ROWS.length);
    // No two rows share a React key.
    const keyWarnings = errors.mock.calls.filter((args) => args.some((a) => typeof a === "string" && a.includes("same key")));
    expect(keyWarnings).toEqual([]);
  });

  it("TB-CUR-02: totals are per currency, each balancing; nothing adds TTD and USD", async () => {
    await mount();
    const ttd = screen.getByTestId("trial-balance-totals-TTD");
    const usd = screen.getByTestId("trial-balance-totals-USD");
    expect(within(ttd).getByTestId("total-debits")).toHaveTextContent("160");
    expect(within(ttd).getByTestId("total-credits")).toHaveTextContent("160");
    expect(within(ttd).getByTestId("difference")).toHaveTextContent(/^TTD 0(\.00)?$/);
    expect(within(usd).getByTestId("total-debits")).toHaveTextContent("297");
    expect(within(usd).getByTestId("total-credits")).toHaveTextContent("297");
    expect(within(usd).getByTestId("difference")).toHaveTextContent(/^USD 0(\.00)?$/);
    // The cross-currency sum (160 + 297) appears nowhere.
    expect(document.body.textContent ?? "").not.toContain("457");
  });

  it("TB-CUR-03: an unbalanced currency is flagged on its own; the balanced one is not", async () => {
    vi.mocked(fetchTrialBalance).mockResolvedValue({
      data: { items: [...ROWS, { accountId: "coa_fee", systemKey: "EXPENSE_GENERAL", name: "Operating Expenses", type: "EXPENSE", currency: "USD", debit: "0.10", credit: "0", net: "0.10" }] },
      error: null,
    } as never);
    await mount();
    expect(within(screen.getByTestId("trial-balance-totals-USD")).getByTestId("difference")).toHaveTextContent(/^USD 0\.1/);
    expect(within(screen.getByTestId("trial-balance-totals-USD")).getByTestId("difference")).toHaveAttribute("data-balanced", "false");
    expect(within(screen.getByTestId("trial-balance-totals-TTD")).getByTestId("difference")).toHaveAttribute("data-balanced", "true");
  });
});
