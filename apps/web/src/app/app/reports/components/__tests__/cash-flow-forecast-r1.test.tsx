/**
 * SWP-FIN-CASH-SOURCES web, repair round 1 (reviews COR-1, COR-2, SEC-CFW-1, SEC-CFW-2; D-135, D-100).
 *
 * WHY this test exists, beside cash-flow-forecast-ledger-cash.test.tsx:
 *   - COR-2(a): the chart's hover label had no test (Tooltip was stubbed to nothing). Here the stub
 *     renders what the view's formatter gives for a figure, so the hover label follows the same rule
 *     as the cards: the server's code, or no code at all, never TTD by default.
 *   - COR-1 / SEC-CFW-1: with no currency code the basis line said "Your business currency is not set
 *     as a three-letter code". The web cannot tell that apart from a failed forecast (the server
 *     answers 200 with zeros, cashBasis 'ledger' and no currency), so the line states no cause:
 *     "No currency code was given, so amounts carry no code."
 *   - The basis line for an older server that sends no cashBasis: it claims no ledger basis.
 *   - SEC-CFW-2: a Refresh answered by a 5xx or a network error left the earlier figures up as if
 *     current, with nothing said. Now the figures are cleared and an error with Retry is shown.
 *
 * The view and client.ts are real; only the API transport (@/lib/api apiGet) is stubbed, and
 * recharts is reduced to elements that carry their data (and the Tooltip to its formatter's answer).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});

vi.mock("recharts", async () => {
  const React = await import("react");
  const h = React.createElement;
  type Props = { children?: React.ReactNode; data?: unknown[]; dataKey?: string };
  type TooltipProps = { formatter?: (value: unknown, name?: unknown) => unknown };
  const pass = ({ children }: Props) => h(React.Fragment, null, children);
  const chart = (testId: string) => ({ children, data }: Props) =>
    h(
      "div",
      { "data-testid": testId, "data-points": JSON.stringify(data ?? []) },
      React.Children.toArray(children).filter((c) => React.isValidElement(c) && typeof c.type !== "string"),
    );
  const series = ({ dataKey }: Props) => h("div", { "data-testid": `series-${dataKey}` });
  // The hover label the view's formatter gives a balance of 1350.
  const tooltip = ({ formatter }: TooltipProps) => {
    const answer = formatter ? formatter(1350, "balance") : null;
    const label = Array.isArray(answer) ? answer[0] : answer;
    return h("div", { "data-testid": "tooltip-sample" }, label == null ? "" : String(label));
  };
  const none = () => null;
  return {
    ResponsiveContainer: pass,
    LineChart: chart("line-chart"),
    AreaChart: chart("area-chart"),
    Line: series,
    Area: series,
    XAxis: none,
    YAxis: none,
    Tooltip: tooltip,
    Legend: none,
    ReferenceLine: none,
  };
});

import { CashFlowForecastView } from "../cash-flow-forecast-view";

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

/** What the server answers when its forecast fails (ai-advisor.service.ts predictCashFlow catch). */
const FAILED_FORECAST = {
  currentBalance: 0,
  projectedBalance: 0,
  daysUntilNegative: null,
  trend: "stable",
  alerts: ["Unable to compute cash flow forecast at this time."],
  dailyRevenueRate: 0,
  dailyExpenseRate: 0,
  projectionDays: 90,
  cashBasis: "ledger",
  otherCurrencyCash: [],
};

const NEUTRAL = "No currency code was given, so amounts carry no code.";

function withoutKey<T extends Record<string, unknown>>(o: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...o };
  delete copy[key];
  return copy;
}

/** The view's own refresh button (the first button it renders). */
function refreshButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector("button");
  if (!button) throw new Error("no refresh button");
  return button as HTMLButtonElement;
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

describe("SWP-FIN-CASH-SOURCES web, repair round 1", () => {
  it("R1-01 (COR-2a): the chart's hover label carries the server's code (USD), never TTD", async () => {
    api.apiGet.mockResolvedValue({ data: USD_FORECAST, error: null });
    render(<CashFlowForecastView businessId="biz_r1" />);

    expect(await screen.findByTestId("tooltip-sample")).toHaveTextContent("USD 1,350.00");
    expect(screen.getByTestId("tooltip-sample").textContent).not.toMatch(/TTD/);
  });

  it("R1-02 (COR-2a): with no code from the server, the hover label carries no code either", async () => {
    api.apiGet.mockResolvedValue({ data: withoutKey(USD_FORECAST, "currency"), error: null });
    render(<CashFlowForecastView businessId="biz_r1" />);

    const sample = await screen.findByTestId("tooltip-sample");
    expect(sample.textContent).toMatch(/^1,350\.00$/);
  });

  it("R1-03 (COR-1, SEC-CFW-1): with no code, the basis line says so neutrally and blames no setting", async () => {
    api.apiGet.mockResolvedValue({ data: withoutKey(USD_FORECAST, "currency"), error: null });
    render(<CashFlowForecastView businessId="biz_r1" />);

    const basis = await screen.findByTestId("cash-basis");
    expect(basis).toHaveTextContent(NEUTRAL);
    expect(basis.textContent).not.toMatch(/not set|your business currency is/i);
  });

  it("R1-04 (COR-1, SEC-CFW-1): on the server's failure answer (200, zeros, no code) the line is the same neutral one", async () => {
    api.apiGet.mockResolvedValue({ data: FAILED_FORECAST, error: null });
    render(<CashFlowForecastView businessId="biz_r1" />);

    const basis = await screen.findByTestId("cash-basis");
    expect(basis).toHaveTextContent(NEUTRAL);
    expect(basis.textContent).not.toMatch(/not set|your business currency is/i);
    // The server's own alert is still shown as it sends it.
    expect(screen.getByText("Unable to compute cash flow forecast at this time.")).toBeInTheDocument();
  });

  it("R1-05 (c): an older server that sends no cashBasis gets no ledger claim, only the currency", async () => {
    api.apiGet.mockResolvedValue({ data: withoutKey(USD_FORECAST, "cashBasis"), error: null });
    render(<CashFlowForecastView businessId="biz_r1" />);

    const basis = await screen.findByTestId("cash-basis");
    expect(basis.textContent?.trim()).toBe("Amounts in USD.");
    expect(basis.textContent).not.toMatch(/ledger|future-dated/i);
  });

  it("R1-06 (c): no cashBasis and no code: no ledger claim, the business currency, and the neutral line", async () => {
    const old = withoutKey(withoutKey(USD_FORECAST, "cashBasis"), "currency");
    api.apiGet.mockResolvedValue({ data: old, error: null });
    render(<CashFlowForecastView businessId="biz_r1" />);

    const basis = await screen.findByTestId("cash-basis");
    expect(basis.textContent).toMatch(/^Amounts in the business currency\./);
    expect(basis).toHaveTextContent(NEUTRAL);
    expect(basis.textContent).not.toMatch(/ledger/i);
  });

  it("R1-07 (SEC-CFW-2): a Refresh answered by a 5xx clears the earlier figures and shows an error with Retry, which loads again", async () => {
    api.apiGet.mockResolvedValueOnce({ data: USD_FORECAST, error: null });
    const { container } = render(<CashFlowForecastView businessId="biz_r1" />);
    expect(await screen.findByText("USD 350.00")).toBeInTheDocument();

    api.apiGet.mockResolvedValueOnce({ data: null, error: "Internal Server Error", status: 500 });
    fireEvent.click(refreshButton(container));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText("USD 350.00")).toBeNull();
    expect(screen.queryByText("Current Balance")).toBeNull();
    expect(container.textContent).not.toMatch(/\d\.\d{2}/);

    api.apiGet.mockResolvedValueOnce({ data: USD_FORECAST, error: null });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("USD 350.00")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.apiGet).toHaveBeenCalledTimes(3);
  });

  it("R1-08 (SEC-CFW-2): a Refresh that throws (network) clears the figures and shows the error with Retry", async () => {
    api.apiGet.mockResolvedValueOnce({ data: USD_FORECAST, error: null });
    const { container } = render(<CashFlowForecastView businessId="biz_r1" />);
    expect(await screen.findByText("USD 350.00")).toBeInTheDocument();

    api.apiGet.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(refreshButton(container));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("USD 350.00")).toBeNull();
  });

  it("R1-09 (SEC-CFW-2): a first load that fails says so, rather than rendering nothing", async () => {
    api.apiGet.mockResolvedValueOnce({ data: null, error: "Bad Gateway", status: 502 });
    render(<CashFlowForecastView businessId="biz_r1" />);
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("R1-11 (SEC-CFW-2): while a Retry is still loading, the figures from before the failure do not come back", async () => {
    api.apiGet.mockResolvedValueOnce({ data: USD_FORECAST, error: null });
    const { container } = render(<CashFlowForecastView businessId="biz_r1" />);
    expect(await screen.findByText("USD 350.00")).toBeInTheDocument();

    api.apiGet.mockResolvedValueOnce({ data: null, error: "Internal Server Error", status: 500 });
    fireEvent.click(refreshButton(container));
    await settle();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // The retry's answer never arrives in this test: the view stays loading.
    api.apiGet.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await settle();
    expect(screen.queryByText("USD 350.00")).toBeNull();
    expect(screen.queryByText("Current Balance")).toBeNull();
    expect(container.textContent).not.toMatch(/\d\.\d{2}/);
  });

  it("R1-10 (D-57, D-100, control): a 403 is still the revenue-access notice with no Retry and no error", async () => {
    api.apiGet.mockResolvedValue({ data: null, error: "Forbidden", status: 403 });
    render(<CashFlowForecastView businessId="biz_r1" />);

    expect(await screen.findByText("Cash flow forecast needs revenue access.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await settle();
    expect(api.apiGet).toHaveBeenCalledTimes(1);
  });
});
