/**
 * SWP-FIN-CASH-SOURCES, web half (journeys H/I; BUG-023, BUG-110; owner rulings D-13, D-135, D-100).
 *
 * WHY this test exists: GET /ai/businesses/:businessId/ai/cash-flow-forecast
 * (AiAdvisorService.predictCashFlow, server half merged in M19 at 9ea7c223) now
 * opens on CashPositionService's ledger cash: booked entries up to now, in the
 * business currency, with cashBasis 'ledger', the business currency as
 * `currency` (a three-letter code only, omitted when Business.currency is free
 * text), the cash held in other currencies as `otherCurrencyCash` (unconverted,
 * at most five codes) and `otherCurrencyCashNotListed` (how many amounts are
 * held but not listed). The Reports cash-flow view ignored all of it:
 *   - it labelled every figure with its `currency` prop, "TTD" by default (the
 *     page's no-report branch passes none), whatever the business currency;
 *   - it never said what the balance is based on;
 *   - it showed none of the other-currency cash, nor that more is held;
 *   - its chart recomputed the balance from the rounded daily rates, so the
 *     chart's 90th day disagreed with the server's projectedBalance.
 * Now the view labels its figures with the server's code (and with no code,
 * says they are in the business currency, never a guessed or free-text one),
 * says the balance is booked ledger cash, lists other-currency cash apart and
 * unconverted, never added to the balance (D-135), says when more is held than
 * is listed, and draws the chart between the server's two figures.
 *
 * Member scope is unchanged (D-57, D-100): a 403 still shows the revenue-access
 * notice and no figure (CF-REF-01 in cash-flow-forecast-refusal.test.tsx, and
 * CF-LC-07 below for the new lines).
 *
 * The view and client.ts are real; only the API transport (@/lib/api apiGet)
 * is stubbed, and recharts is reduced to elements that carry their data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});

vi.mock("recharts", async () => {
  const React = await import("react");
  const h = React.createElement;
  type Props = { children?: React.ReactNode; data?: unknown[]; dataKey?: string };
  const pass = ({ children }: Props) => h(React.Fragment, null, children);
  const chart = (testId: string) => ({ children, data }: Props) =>
    h(
      "div",
      { "data-testid": testId, "data-points": JSON.stringify(data ?? []) },
      React.Children.toArray(children).filter((c) => React.isValidElement(c) && typeof c.type !== "string"),
    );
  const series = ({ dataKey }: Props) => h("div", { "data-testid": `series-${dataKey}` });
  const none = () => null;
  return {
    ResponsiveContainer: pass,
    LineChart: chart("line-chart"),
    AreaChart: chart("area-chart"),
    Line: series,
    Area: series,
    XAxis: none,
    YAxis: none,
    Tooltip: none,
    Legend: none,
    ReferenceLine: none,
  };
});

import { CashFlowForecastView } from "../cash-flow-forecast-view";

/** The server's answer for a business that keeps USD, with no other-currency cash. */
const USD_FORECAST = {
  currentBalance: 350,
  projectedBalance: 1350,
  daysUntilNegative: null,
  trend: "growing",
  alerts: [],
  dailyRevenueRate: 11.11,
  dailyExpenseRate: 0,
  projectionDays: 90,
  cashBasis: "ledger",
  currency: "USD",
  otherCurrencyCash: [],
};

/** A TTD business holding 550 USD and 200 EUR besides its 350 TTD. */
const TTD_WITH_OTHERS = {
  ...USD_FORECAST,
  currency: "TTD",
  projectedBalance: 350,
  dailyRevenueRate: 0,
  trend: "stable",
  otherCurrencyCash: [
    { currency: "EUR", amount: 200 },
    { currency: "USD", amount: 550 },
  ],
};

/** The chart's points as the stubbed AreaChart received them. */
function points(): Array<{ day: string; balance: number }> {
  return JSON.parse(screen.getByTestId("area-chart").getAttribute("data-points") ?? "[]");
}

/** The figure a metric card shows, read from the card that carries the label. */
function cardValue(label: string): string {
  const card = screen.getByText(label).closest("div")?.parentElement as HTMLElement;
  return card.textContent ?? "";
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  api.apiGet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SWP-FIN-CASH-SOURCES (D-135): the Reports cash-flow forecast shows the server's ledger cash", () => {
  it("CF-LC-01: the figures carry the business currency the server names (USD), never the TTD default", async () => {
    api.apiGet.mockResolvedValue({ data: USD_FORECAST, error: null });
    const { container } = render(<CashFlowForecastView businessId="biz_lc" />);

    expect(await screen.findByText("Current Balance")).toBeInTheDocument();
    expect(cardValue("Current Balance")).toContain("USD 350.00");
    expect(cardValue("Projected (90d)")).toContain("USD 1,350.00");
    expect(container.textContent).not.toMatch(/TTD/);
  });

  it("CF-LC-02: it says the balance is booked ledger cash in that currency, up to today", async () => {
    api.apiGet.mockResolvedValue({ data: USD_FORECAST, error: null });
    render(<CashFlowForecastView businessId="biz_lc" />);

    const basis = await screen.findByTestId("cash-basis");
    expect(basis.textContent).toMatch(/ledger/i);
    expect(basis.textContent).toMatch(/USD/);
    expect(basis.textContent).toMatch(/future-dated entries are not counted/i);
  });

  it("CF-LC-03: other-currency cash is listed apart, unconverted, and never added to the balance or the chart", async () => {
    api.apiGet.mockResolvedValue({ data: TTD_WITH_OTHERS, error: null });
    const { container } = render(<CashFlowForecastView businessId="biz_lc" />);

    const other = await screen.findByTestId("other-currency-cash");
    expect(other.textContent).toMatch(/not converted/i);
    expect(other.textContent).toMatch(/not (included|counted)/i);
    const rows = within(other).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["EUR 200.00", "USD 550.00"]);

    // The balance is the TTD cash alone: 350, not 350 + 550 + 200 (1,100), nor any part sum.
    expect(cardValue("Current Balance")).toContain("TTD 350.00");
    expect(container.textContent).not.toMatch(/1,100\.00|900\.00|550\.00 TTD|TTD 550\.00|TTD 750\.00/);
    expect(points()[0].balance).toBe(350);
    expect(points().every((p) => p.balance === 350)).toBe(true);
  });

  it("CF-LC-04: when more is held than is listed, it says so", async () => {
    api.apiGet.mockResolvedValue({ data: { ...TTD_WITH_OTHERS, otherCurrencyCashNotListed: 2 }, error: null });
    render(<CashFlowForecastView businessId="biz_lc" />);

    const other = await screen.findByTestId("other-currency-cash");
    expect(other.textContent).toMatch(/2 more amounts .*not listed/i);
  });

  it("CF-LC-05: with no listed currency but amounts not listed, the section still says cash is held apart", async () => {
    api.apiGet.mockResolvedValue({
      data: { ...TTD_WITH_OTHERS, otherCurrencyCash: [], otherCurrencyCashNotListed: 1 },
      error: null,
    });
    render(<CashFlowForecastView businessId="biz_lc" />);

    const other = await screen.findByTestId("other-currency-cash");
    expect(other.textContent).toMatch(/1 more amount .*not listed/i);
    expect(within(other).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("CF-LC-06: with no currency code from the server, the figures carry no code and say they are in the business currency", async () => {
    const { currency: _omitted, ...noCurrency } = USD_FORECAST;
    api.apiGet.mockResolvedValue({ data: noCurrency, error: null });
    const { container } = render(<CashFlowForecastView businessId="biz_lc" />);

    expect(await screen.findByText("Current Balance")).toBeInTheDocument();
    expect(cardValue("Current Balance")).toContain("350.00");
    expect(container.textContent).not.toMatch(/TTD|USD/);
    expect(screen.getByTestId("cash-basis").textContent).toMatch(/business currency/i);
  });

  it("CF-LC-06b: a currency that is not a three-letter code is never shown, as the server's rule (SEC-W10LR-1)", async () => {
    api.apiGet.mockResolvedValue({
      data: {
        ...USD_FORECAST,
        currency: "TT dollars <b>",
        otherCurrencyCash: [{ currency: "my stash", amount: 40 }, { currency: "EUR", amount: 10 }],
      },
      error: null,
    });
    const { container } = render(<CashFlowForecastView businessId="biz_lc" />);

    expect(await screen.findByText("Current Balance")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/TT dollars|my stash|TTD/);
    expect(screen.getByTestId("cash-basis").textContent).toMatch(/business currency/i);
    const other = screen.getByTestId("other-currency-cash");
    expect(within(other).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["EUR 10.00"]);
    // The amount under the label is not dropped silently: it is counted as not listed.
    expect(other.textContent).toMatch(/1 more amount .*not listed/i);
  });

  it("CF-LC-07: the chart opens on the server's currentBalance and ends on its projectedBalance (no recomputation from rounded rates)", async () => {
    api.apiGet.mockResolvedValue({ data: USD_FORECAST, error: null });
    render(<CashFlowForecastView businessId="biz_lc" />);

    await screen.findByText("Current Balance");
    const data = points();
    expect(data[0].balance).toBe(350);
    // 350 + 11.11 * 90 = 1349.9: the rounded rate disagrees with the server's 1350.
    expect(data[data.length - 1].balance).toBe(1350);
  });

  it("CF-LC-08 (D-57, D-100, control): a member without revenue read still sees no figure, no basis line and no other-currency cash", async () => {
    api.apiGet.mockResolvedValue({ data: null, error: "Forbidden", status: 403 });
    const { container } = render(<CashFlowForecastView businessId="biz_lc" />);

    expect(await screen.findByText("Cash flow forecast needs revenue access.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d\.\d{2}/);
    expect(screen.queryByTestId("cash-basis")).toBeNull();
    expect(screen.queryByTestId("other-currency-cash")).toBeNull();
    await settle();
    expect(api.apiGet).toHaveBeenCalledTimes(1);
  });
});
