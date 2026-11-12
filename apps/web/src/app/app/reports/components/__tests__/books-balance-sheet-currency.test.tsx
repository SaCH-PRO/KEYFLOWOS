/**
 * V1-37b-CURRENCY-PROJECTIONS, review RV37-02 — the Books balance sheet never
 * shows one figure made of two currencies.
 *
 * WHY this test exists: V1-37 made the trial balance one row per (account,
 * currency), and getBalanceSheet summed those rows into one sheet labelled
 * with the business currency: a TTD business's USD receivable was added to its
 * TTD assets, and the account appeared as two unlabelled lines. The server now
 * answers the business currency's sheet at the top level and one sheet per
 * currency under byCurrency. The view must show the business-currency sheet,
 * then each other currency's sheet on its own, every line and total in its
 * own currency, never added together.
 *
 * Mounted on the real BooksReportView; only the report fetch is stubbed, with
 * the server's shape (ledger-reporting.service.ts getBalanceSheet).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { BooksReportView } from "../BooksReportView";
import { fetchLedgerBalanceSheet } from "@/lib/client";

vi.mock("@/lib/client", () => ({
  fetchLedgerPnl: vi.fn(),
  fetchLedgerCashflow: vi.fn(),
  fetchLedgerBalanceSheet: vi.fn(),
  fetchLedgerTaxSummary: vi.fn(),
  fetchLedgerArAging: vi.fn(),
  fetchLedgerApAging: vi.fn(),
  ledgerReportExportUrl: () => "#",
}));

const AS_OF = "2026-11-02T00:00:00.000Z";
const line = (accountId: string, systemKey: string, name: string, amount: number, currency: string) => ({ accountId, systemKey, name, amount, currency });

function sheet(currency: string, assets: ReturnType<typeof line>[], equity: ReturnType<typeof line>[], income: number) {
  const assetsTotal = assets.reduce((s, l) => s + l.amount, 0);
  const equityTotal = equity.reduce((s, l) => s + l.amount, 0);
  return {
    asOf: AS_OF,
    currency,
    assets: { total: assetsTotal, lines: assets, cashAndBank: 0, accountsReceivable: 0, inventory: 0 },
    liabilities: { total: 0, lines: [], accountsPayable: 0, taxPayable: 0, loans: 0 },
    equity: { total: equityTotal, lines: equity, ownerEquity: equityTotal, retainedEarnings: 0 },
    netEquityFromIncome: income,
    identityHolds: true,
    identityDelta: 0,
  };
}

/** A TTD business: TTD cash 80 (income 80); USD cash 132 + AR 45 (equity 12, income 165). */
const TTD = sheet("TTD", [line("coa_cash", "CASH", "Cash", 80, "TTD")], [], 80);
const USD = sheet(
  "USD",
  [line("coa_ar", "ACCOUNTS_RECEIVABLE", "Accounts Receivable", 45, "USD"), line("coa_cash", "CASH", "Cash", 132, "USD")],
  [line("coa_equity", "OWNER_EQUITY", "Owner Equity", 12, "USD")],
  165,
);
const REPORT = { ...TTD, byCurrency: { TTD, USD } };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Books balance sheet: one sheet per currency, never summed", () => {
  it("BS-CUR-01: the business-currency sheet first, then the USD sheet on its own; every line and total in its own currency", async () => {
    vi.mocked(fetchLedgerBalanceSheet).mockResolvedValue({ data: REPORT, error: null } as never);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<BooksReportView businessId="biz_bs" kind="books-balance-sheet" asOf="2026-11-02" />);

    const ttd = await screen.findByTestId("balance-sheet-TTD");
    const usd = screen.getByTestId("balance-sheet-USD");
    // The TTD sheet holds only TTD figures.
    expect(within(ttd).getByText("Total Assets").parentElement).toHaveTextContent("TTD 80.00");
    expect(ttd.textContent).not.toMatch(/USD/);
    // The USD sheet: its own lines and totals, labelled USD.
    expect(within(usd).getByText("Accounts Receivable").parentElement).toHaveTextContent("USD 45.00");
    expect(within(usd).getByText("Cash").parentElement).toHaveTextContent("USD 132.00");
    expect(within(usd).getByText("Total Assets").parentElement).toHaveTextContent("USD 177.00");
    expect(within(usd).getByText("Total Equity (with retained)").parentElement).toHaveTextContent("USD 177.00");
    expect(usd.textContent).not.toMatch(/TTD/);
    // Nothing adds the two: TTD 80 + USD 177 = 257 appears nowhere.
    expect(document.body.textContent ?? "").not.toContain("257");
    // Cash appears once per currency, each with its own key.
    expect(screen.getAllByText("Cash")).toHaveLength(2);
    expect(errors.mock.calls.filter((args) => args.some((a) => typeof a === "string" && a.includes("same key")))).toEqual([]);
  });

  it("BS-CUR-02: a single-currency book shows one sheet and no other-currency section", async () => {
    vi.mocked(fetchLedgerBalanceSheet).mockResolvedValue({ data: { ...TTD, byCurrency: { TTD } }, error: null } as never);
    render(<BooksReportView businessId="biz_bs" kind="books-balance-sheet" asOf="2026-11-02" />);
    await screen.findByTestId("balance-sheet-TTD");
    expect(screen.queryByTestId("balance-sheet-USD")).toBeNull();
    expect(screen.queryByText(/other currenc/i)).toBeNull();
    expect(screen.queryByText(/export/i)).toBeNull();
  });

  /*
   * W9-BALANCE-SHEET-EXPORT review CR-BSX-01 / SEC-BSX-1 (owner ruling D-13): the
   * exports now carry every currency's sheet (RV37b-CR-03, report-formatters.ts),
   * so the note no longer says they carry the business-currency sheet only: a
   * reader who trusted it could share an export as a one-currency sheet and hand
   * over the other balances without knowing it.
   */
  it("BS-CUR-03 (review RV37b-CR-03; W9-BALANCE-SHEET-EXPORT review CR-BSX-01, D-13): with other currencies on screen, the view says the CSV / PDF export carries the business-currency sheet and then each other currency's sheet on its own, never the business-currency sheet only", async () => {
    vi.mocked(fetchLedgerBalanceSheet).mockResolvedValue({ data: REPORT, error: null } as never);
    render(<BooksReportView businessId="biz_bs" kind="books-balance-sheet" asOf="2026-11-02" />);
    await screen.findByTestId("balance-sheet-USD");
    const note = screen.getByTestId("balance-sheet-export-note");
    expect(note).toHaveTextContent(
      "The CSV and PDF exports carry the TTD sheet and then the USD balances, each on its own, as shown here.",
    );
    expect(note.textContent).not.toMatch(/\bonly\b/);
  });
});
