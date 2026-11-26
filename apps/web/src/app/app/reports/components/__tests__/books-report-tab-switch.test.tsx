/**
 * SWP-FIN-WEB-CRASHES (journey H, step H8; sweep BUG-039): switching Books
 * tabs in Reports never crashes, and /app/finance is a plain server redirect.
 *
 * WHY this test exists: BooksReportView keeps the last report it loaded in one
 * `data` slot. When the tab (`kind`) changed, the next render drew the NEW
 * tab's block from the OLD tab's report before the effect had even started the
 * new fetch: Cash flow read `accrualAdjustments` from a P&L report, Balance
 * sheet read `assets.lines` from a cash-flow report, Tax read `invoiceTaxes`
 * from a balance sheet. Each threw a TypeError and the page fell into its
 * error boundary ("Something went wrong"). The sweep saw it on 'Books ·
 * Cashflow' and 'Tax Summary'.
 *
 * Here the real BooksReportView is mounted inside an error boundary; only the
 * report fetches are stubbed, each answering only when the test releases it
 * (a slow network), with the server's shapes (ledger-reporting.service.ts).
 * The view must show "loading" until the tab's own report arrives, then that
 * report, and never the boundary.
 */
import { Component, useLayoutEffect, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { BooksReportView, type BooksReportKind } from "../BooksReportView";
import {
  fetchLedgerPnl, fetchLedgerCashflow, fetchLedgerBalanceSheet, fetchLedgerTaxSummary,
} from "@/lib/client";

vi.mock("@/lib/client", () => ({
  fetchLedgerPnl: vi.fn(),
  fetchLedgerCashflow: vi.fn(),
  fetchLedgerBalanceSheet: vi.fn(),
  fetchLedgerTaxSummary: vi.fn(),
  fetchLedgerArAging: vi.fn(),
  fetchLedgerApAging: vi.fn(),
  ledgerReportExportUrl: () => "#",
}));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const PERIOD = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-30T23:59:59.999Z" };
const group = (total: number) => ({ total, accounts: [] });

const PNL = {
  basis: "accrual", currency: "USD", period: PERIOD,
  revenue: group(500), discounts: group(0), cogs: group(100), grossProfit: 400,
  operatingExpenses: group(150), netProfit: 250,
};
const CASHFLOW = {
  basis: "accrual", currency: "USD", period: PERIOD,
  cashIn: 320, cashOut: 75, netMovement: 245,
  byAccount: [{ accountId: "coa_cash", systemKey: "CASH", name: "Cash", inflow: 320, outflow: 75, net: 245 }],
  accrualAdjustments: { netIncome: 250, arChange: 30, apChange: 25, taxPayableChange: 0, cashFromOperations: 245 },
  upcomingReceivables: { total: 180, count: 1 },
  upcomingPayables: { total: 60, count: 1 },
};
const BALANCE_SHEET = {
  asOf: PERIOD.to, currency: "USD",
  assets: { total: 425, lines: [{ accountId: "coa_cash", systemKey: "CASH", name: "Cash", amount: 425, currency: "USD" }], cashAndBank: 425, accountsReceivable: 0, inventory: 0 },
  liabilities: { total: 0, lines: [], accountsPayable: 0, taxPayable: 0, loans: 0 },
  equity: { total: 175, lines: [{ accountId: "coa_equity", systemKey: "OWNER_EQUITY", name: "Owner Equity", amount: 175, currency: "USD" }], ownerEquity: 175, retainedEarnings: 0 },
  netEquityFromIncome: 250,
  identityHolds: true,
  identityDelta: 0,
  byCurrency: {},
};
const TAX = {
  currency: "USD", period: PERIOD,
  taxableSales: 500, taxCollected: 62.5, taxPaidOnPurchases: 10, estimatedDue: 52.5,
  invoiceTaxes: { taxAmount: 62.5, subtotal: 500, ledgerToInvoiceDelta: 0 },
  liabilities: [],
};

/** A fetch that answers only when the test calls release(), as a slow network would. */
function slow<T>(data: T) {
  let release!: () => void;
  const answer = new Promise<{ data: T; error: null }>((done) => { release = () => done({ data, error: null }); });
  return { answer, release: async () => { await act(async () => { release(); await answer; }); } };
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error
      ? <div data-testid="error-boundary">Something went wrong: {this.state.error.name}: {this.state.error.message}</div>
      : this.props.children;
  }
}

const START = PERIOD.from;
const END = PERIOD.to;
const view = (kind: BooksReportKind) => (
  <Boundary><BooksReportView businessId="biz_tabs" kind={kind} startDate={START} endDate={END} /></Boundary>
);

function boundaryText(): string | null {
  return screen.queryByTestId("error-boundary")?.textContent ?? null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Books report tabs: switching never crashes (BUG-039)", () => {
  it("TAB-01: P&L, then Cash flow, then Balance sheet, then Tax, each answering late: each tab shows loading, then its own report, never the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pnl = slow(PNL);
    const cashflow = slow(CASHFLOW);
    const sheet = slow(BALANCE_SHEET);
    const tax = slow(TAX);
    vi.mocked(fetchLedgerPnl).mockReturnValue(pnl.answer as never);
    vi.mocked(fetchLedgerCashflow).mockReturnValue(cashflow.answer as never);
    vi.mocked(fetchLedgerBalanceSheet).mockReturnValue(sheet.answer as never);
    vi.mocked(fetchLedgerTaxSummary).mockReturnValue(tax.answer as never);

    const { rerender } = render(view("books-pnl"));
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    await pnl.release();
    expect(boundaryText()).toBeNull();
    expect(screen.getByText("Gross Profit")).toBeInTheDocument();
    expect(screen.getByText("Net Profit").parentElement).toHaveTextContent("250.00");

    // Cash flow: the P&L report is still the one held when the tab changes.
    rerender(view("books-cashflow"));
    expect(boundaryText(), "Cash flow opened while its report is on the way").toBeNull();
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    expect(screen.queryByText("Gross Profit"), "the P&L is not shown under Cash flow").toBeNull();
    await cashflow.release();
    expect(boundaryText()).toBeNull();
    expect(screen.getByText("Cash In").parentElement).toHaveTextContent("320.00");
    expect(screen.getByText("Cash from operations").parentElement).toHaveTextContent("245.00");

    // Balance sheet: the cash-flow report is the one held.
    rerender(view("books-balance-sheet"));
    expect(boundaryText(), "Balance sheet opened while its report is on the way").toBeNull();
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    expect(screen.queryByText("Cash In"), "the cash flow is not shown under Balance sheet").toBeNull();
    await sheet.release();
    expect(boundaryText()).toBeNull();
    expect(screen.getByText("Total Assets").parentElement).toHaveTextContent("425.00");

    // Tax: the balance sheet is the one held.
    rerender(view("books-tax"));
    expect(boundaryText(), "Tax opened while its report is on the way").toBeNull();
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    await tax.release();
    expect(boundaryText()).toBeNull();
    expect(screen.getByText("Estimated tax due").parentElement).toHaveTextContent("52.50");

    expect(fetchLedgerPnl).toHaveBeenCalledWith("biz_tabs", START, END, "accrual");
    expect(fetchLedgerCashflow).toHaveBeenCalledWith("biz_tabs", START, END, "accrual");
  });

  it("TAB-02: a report that answers after its tab was left is never drawn under the next tab", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pnl = slow(PNL);
    const cashflow = slow(CASHFLOW);
    vi.mocked(fetchLedgerPnl).mockReturnValue(pnl.answer as never);
    vi.mocked(fetchLedgerCashflow).mockReturnValue(cashflow.answer as never);

    const { rerender } = render(view("books-pnl"));
    // Leave P&L before its report arrives; it arrives while Cash flow is loading.
    rerender(view("books-cashflow"));
    await pnl.release();
    expect(boundaryText()).toBeNull();
    expect(screen.queryByText("Gross Profit"), "the late P&L is not shown under Cash flow").toBeNull();
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    await cashflow.release();
    expect(boundaryText()).toBeNull();
    expect(screen.getByText("Net Movement").parentElement).toHaveTextContent("245.00");
  });

  it("TAB-03: going back to a tab already seen draws it again from its own report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetchLedgerPnl).mockResolvedValue({ data: PNL, error: null } as never);
    vi.mocked(fetchLedgerCashflow).mockResolvedValue({ data: CASHFLOW, error: null } as never);
    vi.mocked(fetchLedgerBalanceSheet).mockResolvedValue({ data: BALANCE_SHEET, error: null } as never);

    const { rerender } = render(view("books-pnl"));
    for (const kind of ["books-cashflow", "books-balance-sheet", "books-pnl", "books-balance-sheet", "books-cashflow"] as const) {
      rerender(view(kind));
      expect(boundaryText(), `opening ${kind}`).toBeNull();
      await act(async () => { await Promise.resolve(); });
      expect(boundaryText(), `after ${kind} loaded`).toBeNull();
    }
    expect(await screen.findByText("Cash In")).toBeInTheDocument();
  });
});

/** The view for one business (or none), START to END. */
const viewFor = (businessId: string | null, kind: BooksReportKind, probe?: ReactNode) => (
  <Boundary>
    <BooksReportView businessId={businessId} kind={kind} startDate={START} endDate={END} />
    {probe}
  </Boundary>
);

/**
 * Records what the screen holds at each commit, before passive effects run: a layout effect of a sibling rendered
 * after the view runs once the DOM is updated and before the view's own useEffect starts the next fetch.
 */
function Probe({ seen }: { seen: string[] }) {
  useLayoutEffect(() => {
    seen.push(document.body.textContent ?? "");
  });
  return null;
}

describe("Books report tabs: review repair round 1", () => {
  it("TAB-04 (SEC M1): switching business never shows the first business's figures under the second", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const x = slow({ ...PNL, netProfit: 111 });
    const y = slow({ ...PNL, netProfit: 222 });
    vi.mocked(fetchLedgerPnl).mockImplementation(((businessId: string) => (businessId === "biz_x" ? x.answer : y.answer)) as never);

    const seen: string[] = [];
    const { rerender } = render(viewFor("biz_x", "books-pnl", <Probe seen={seen} />));
    await x.release();
    expect(screen.getByText("Net Profit").parentElement).toHaveTextContent("111.00");

    const before = seen.length;
    rerender(viewFor("biz_y", "books-pnl", <Probe seen={seen} />));
    // The first commit under business Y, before any effect has run, and every one after it.
    expect(seen.length, "a commit was recorded for the switch").toBeGreaterThan(before);
    for (const [i, text] of seen.slice(before).entries()) {
      expect(text, `commit ${i} under business Y shows none of business X's figures`).not.toMatch(/111\.00/);
    }
    expect(seen[before], "the first commit under business Y says it is loading").toMatch(/Loading ledger data/);
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    await y.release();
    expect(boundaryText()).toBeNull();
    expect(screen.getByText("Net Profit").parentElement).toHaveTextContent("222.00");
    for (const text of seen.slice(before)) expect(text).not.toMatch(/111\.00/);
    expect(fetchLedgerPnl).toHaveBeenCalledWith("biz_y", START, END, "accrual");
  });

  it("TAB-05 (COR MINOR-1): the tab's own answer comes first, then the left tab's late one: the tab stays on its report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pnl = slow(PNL);
    const cashflow = slow(CASHFLOW);
    vi.mocked(fetchLedgerPnl).mockReturnValue(pnl.answer as never);
    vi.mocked(fetchLedgerCashflow).mockReturnValue(cashflow.answer as never);

    const { rerender } = render(view("books-pnl"));
    rerender(view("books-cashflow"));
    await cashflow.release();
    expect(screen.getByText("Net Movement").parentElement).toHaveTextContent("245.00");
    // The P&L the user left answers last; it must neither replace Cash flow nor leave it loading.
    await pnl.release();
    expect(boundaryText()).toBeNull();
    expect(screen.queryByText(/Loading ledger data/), "Cash flow is not sent back to loading").toBeNull();
    expect(screen.queryByText("Gross Profit"), "the late P&L is not drawn").toBeNull();
    expect(screen.getByText("Net Movement").parentElement).toHaveTextContent("245.00");
  });

  it("TAB-06 (COR MINOR-2): the first commit after a tab switch, before any effect runs, already says loading (never blank)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetchLedgerPnl).mockResolvedValue({ data: PNL, error: null } as never);
    const cashflow = slow(CASHFLOW);
    vi.mocked(fetchLedgerCashflow).mockReturnValue(cashflow.answer as never);
    const seen: string[] = [];

    const { rerender } = render(viewFor("biz_tabs", "books-pnl", <Probe seen={seen} />));
    expect(await screen.findByText("Gross Profit")).toBeInTheDocument();
    const before = seen.length;
    rerender(viewFor("biz_tabs", "books-cashflow", <Probe seen={seen} />));
    const firstCommit = seen[before];
    expect(firstCommit, "a commit was recorded for the switch").toBeDefined();
    expect(firstCommit, "the first commit under Cash flow says it is loading").toMatch(/Loading ledger data/);
    expect(firstCommit, "and draws no P&L").not.toMatch(/Gross Profit/);
    await cashflow.release();
    expect(screen.getByText("Net Movement")).toBeInTheDocument();
  });

  it("TAB-07 (SEC M2): the business goes away while a report is on the way: the view stops saying it is loading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pnl = slow(PNL);
    vi.mocked(fetchLedgerPnl).mockReturnValue(pnl.answer as never);

    const { rerender } = render(viewFor("biz_tabs", "books-pnl"));
    expect(screen.getByText(/Loading ledger data/)).toBeInTheDocument();
    rerender(viewFor(null, "books-pnl"));
    expect(screen.queryByText(/Loading ledger data/), "no business, nothing loading").toBeNull();
    await pnl.release();
    expect(boundaryText()).toBeNull();
    expect(screen.queryByText(/Loading ledger data/)).toBeNull();
    expect(screen.queryByText("Gross Profit"), "the answer for the business that went away is not drawn").toBeNull();
  });
});

describe("/app/finance is a server redirect to /app/financial-flow", () => {
  const PAGE = resolve(__dirname, "../../../finance/page.tsx");

  it("FIN-REDIRECT-01: finance/page.tsx is not a client component and redirects to /app/financial-flow", async () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source, "no 'use client' directive: a client redirect renders the error page").not.toMatch(/^\s*["']use client["']/m);
    expect(source).toMatch(/redirect\(\s*["']\/app\/financial-flow["']\s*\)/);
    const mod = (await import("../../../finance/page")) as { default: () => unknown };
    mod.default();
    expect(redirect).toHaveBeenCalledWith("/app/financial-flow");
  });
});
