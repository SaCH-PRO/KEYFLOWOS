/**
 * FU-SITE-ANALYTICS-REVENUE-SCOPE (owner rulings D-100, D-234; review CR minor 1): StoreAnalyticsDashboard
 * with the analytics a member without revenue read now receives (no `revenue`, no `invoices`).
 *
 * Required: it renders (main's version threw a TypeError reading analytics.revenue.inPeriod), shows no
 * revenue tile and no invoice rows, and keeps its bookings and catalog figures; a revenue reader still
 * sees "Revenue (Period)" and the invoice rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const client = vi.hoisted(() => ({ fetchStoreAnalytics: vi.fn() }));
vi.mock("@/lib/client", () => client);

import { StoreAnalyticsDashboard } from "../store-analytics";
import { formatPrice } from "@/lib/format";

const STOREFRONT_ONLY = {
  period: { days: 30, since: "2026-10-23T00:00:00.000Z" },
  bookings: { total: 9, inPeriod: 7, last7Days: 2 },
  catalog: { products: 3, services: 2 },
  storefrontEvents: { page_view: 321 },
};

beforeEach(() => client.fetchStoreAnalytics.mockReset());
afterEach(() => cleanup());

describe("StoreAnalyticsDashboard: revenue and invoice tiles follow revenue read", () => {
  it("[WEB-FSAR-03] RED-BEFORE: without revenue and invoices it renders, with no revenue tile and no invoice rows", async () => {
    client.fetchStoreAnalytics.mockResolvedValue({ data: STOREFRONT_ONLY, error: null });
    render(<StoreAnalyticsDashboard businessId="biz_1" />);
    expect(await screen.findByText("Total Bookings")).toBeTruthy();
    expect(screen.getByText("Catalog Items")).toBeTruthy();
    expect(screen.getByText("Last 7 Days Bookings")).toBeTruthy();
    expect(screen.queryByText("Revenue (Period)")).toBeNull();
    expect(screen.queryByText("Invoices (Period)")).toBeNull();
    expect(screen.queryByText("Invoices (Total)")).toBeNull();
    expect(document.body.textContent).not.toContain(formatPrice(0));
  });

  it("[WEB-FSAR-04] a revenue reader sees the revenue tile and the invoice rows", async () => {
    client.fetchStoreAnalytics.mockResolvedValue({
      data: { ...STOREFRONT_ONLY, invoices: { total: 3, inPeriod: 2 }, revenue: { inPeriod: 400 } },
      error: null,
    });
    render(<StoreAnalyticsDashboard businessId="biz_1" />);
    expect(await screen.findByText("Revenue (Period)")).toBeTruthy();
    expect(screen.getByText(formatPrice(400))).toBeTruthy();
    expect(screen.getByText("Invoices (Period)")).toBeTruthy();
    expect(screen.getByText("Invoices (Total)")).toBeTruthy();
  });
});
