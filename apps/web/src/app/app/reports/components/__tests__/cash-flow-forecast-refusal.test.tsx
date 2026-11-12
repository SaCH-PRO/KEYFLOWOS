/**
 * W11-AI-CASHFLOW-REVENUE (owner rulings D-57, D-100) — the reports cash-flow
 * views answer the server's refusal.
 *
 * WHY this test exists: GET /ai/businesses/:businessId/ai/cash-flow-forecast
 * (client.ts fetchCashFlowForecast) carries the business's cash and revenue
 * figures, so the server now refuses it (403) to a member without revenue
 * read (D-57, D-100; TS-13f in timeline-scope.integration.test.ts). Both views
 * that call it ignored the status: CashFlowForecastView rendered nothing at all
 * (the member saw an empty tab), and RevenueProjectionChart vanished, its
 * historical series (built from its own props) with it. Now:
 *   - CashFlowForecastView shows a small notice, 'Cash flow forecast needs
 *     revenue access.', with no figure and no refresh that asks again;
 *   - RevenueProjectionChart keeps its historical series, draws no projection
 *     line and no milestones, and says why in one line.
 * A 200 forecast renders as before.
 *
 * The views and client.ts are real; only the API transport (@/lib/api apiGet)
 * is stubbed, and recharts is reduced to elements that name their series and
 * points (jsdom gives the real charts no size, so they draw nothing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

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
  // The series only: raw SVG children (the area chart's <defs> gradient) are dropped, as jsdom has no SVG layout.
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
import { RevenueProjectionChart } from "../revenue-projection-chart";

const FORBIDDEN = { data: null, error: "Forbidden", status: 403 };
const FORECAST = {
  currentBalance: 7777,
  projectedBalance: 15554,
  daysUntilNegative: null,
  trend: "growing",
  alerts: [],
  dailyRevenueRate: 86.41,
  dailyExpenseRate: 0,
  projectionDays: 90,
};
const NOTICE = "Cash flow forecast needs revenue access.";
const CHART_NOTE = "Projections need revenue access.";
/** A currency figure as the views format one (report-types formatCurrency). */
const FIGURE = /TTD\s*-?[\d,]+\.\d{2}/;

/** The chart's points as the stubbed LineChart received them. */
function points(): Array<{ label: string; historical: number | null; projected: number | null }> {
  return JSON.parse(screen.getByTestId("line-chart").getAttribute("data-points") ?? "[]");
}

/** Lets pending effects and promises settle, so a repeated request would have been sent. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  api.apiGet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("W11-AI-CASHFLOW-REVENUE (D-57, D-100): the reports cash-flow views answer a 403", () => {
  it("CF-REF-01 (D-57, D-100): CashFlowForecastView on a 403 renders the revenue-access notice, no currency figure and no refresh, and asks once", async () => {
    api.apiGet.mockResolvedValue(FORBIDDEN);
    const { container } = render(<CashFlowForecastView businessId="biz_cf" />);

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(api.apiGet).toHaveBeenCalledWith(expect.stringContaining("/ai/businesses/biz_cf/ai/cash-flow-forecast?days=90"), undefined);
    expect(container.textContent).not.toMatch(FIGURE);
    expect(container.textContent).not.toMatch(/7,?777/);
    expect(screen.queryByText("Current Balance")).toBeNull();
    expect(screen.queryByTestId("area-chart")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    await settle();
    expect(api.apiGet).toHaveBeenCalledTimes(1);
  });

  it("CF-REF-02 (D-57, D-100): RevenueProjectionChart on a 403 keeps its historical series and draws no projection line or milestones, with a one-line note", async () => {
    api.apiGet.mockResolvedValue(FORBIDDEN);
    const { container } = render(
      <RevenueProjectionChart
        businessId="biz_cf"
        currentRevenue={3000}
        periodStart="2026-10-01T00:00:00.000Z"
        periodEnd="2026-10-31T00:00:00.000Z"
      />,
    );

    expect(await screen.findByText(CHART_NOTE)).toBeInTheDocument();
    // The historical series, from the chart's own props: 30 days up to Today's 3000.
    expect(screen.getByTestId("series-historical")).toBeInTheDocument();
    const data = points();
    expect(data[0]).toMatchObject({ label: "-30d", historical: 0 });
    expect(data[data.length - 1]).toMatchObject({ label: "Today", historical: 3000 });
    // No projection: no projected line, no point ahead of today, no projected value.
    expect(screen.queryByTestId("series-projected")).toBeNull();
    expect(data.some((p) => p.label.startsWith("+"))).toBe(false);
    expect(data.every((p) => p.projected === null)).toBe(true);
    // No milestones and no confidence badge.
    for (const label of ["30-Day", "60-Day", "90-Day"]) expect(screen.queryByText(label)).toBeNull();
    expect(container.textContent).not.toMatch(/\d+% (High|Medium|Low)/);

    await settle();
    expect(api.apiGet).toHaveBeenCalledTimes(1);
  });

  it("CF-REF-03 (D-57, D-100): with a 200 forecast, CashFlowForecastView renders 'Current Balance' and its figures, and RevenueProjectionChart its projection and milestones, as before", async () => {
    api.apiGet.mockResolvedValue({ data: FORECAST, error: null });
    render(<CashFlowForecastView businessId="biz_cf" />);

    expect(await screen.findByText("Current Balance")).toBeInTheDocument();
    expect(screen.getByText("TTD 7,777.00")).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    cleanup();

    render(<RevenueProjectionChart businessId="biz_cf" currentRevenue={3000} />);
    expect(await screen.findByText("30-Day")).toBeInTheDocument();
    expect(screen.getByTestId("series-projected")).toBeInTheDocument();
    expect(screen.queryByText(CHART_NOTE)).toBeNull();
    await waitFor(() => expect(points().some((p) => p.label === "+90d")).toBe(true));
  });
});
