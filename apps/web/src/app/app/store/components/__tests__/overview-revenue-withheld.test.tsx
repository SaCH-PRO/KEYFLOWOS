/**
 * FU-SITE-ANALYTICS-REVENUE-SCOPE (owner rulings D-100, D-234): the Your page hub's Overview tab
 * without the revenue figure.
 *
 * GET site/businesses/:b/analytics now leaves `revenue` and `invoices` out (absent, not zero) for a
 * member without revenue read, and GET commerce/.../store/readiness (revenue read) refuses that
 * member, so the hub's readiness is null. Required: the Overview tab renders, shows no
 * "Revenue (30d)" tile and no money figure, and keeps its storefront tiles (orders from bookings,
 * store views); a revenue reader still sees "Revenue (30d)".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/api", () => ({ apiGet: vi.fn().mockResolvedValue({ data: null, error: null }) }));
vi.mock("./../ai-layout-suggestions", () => ({ AiLayoutSuggestions: () => null }));

import { OverviewMode } from "../overview-mode";
import type { StoreAnalytics, StorefrontConfig } from "@/lib/client";
import { formatPrice } from "@/lib/format";

const STOREFRONT_ONLY: StoreAnalytics = {
  period: { days: 30, since: "2026-10-23T00:00:00.000Z" },
  bookings: { total: 9, inPeriod: 7, last7Days: 2 },
  catalog: { products: 1, services: 1 },
  storefrontEvents: { page_view: 321 },
};

function renderOverview(analytics: StoreAnalytics) {
  return render(
    <OverviewMode
      businessId="biz_1"
      storeEnabled
      publicUrl=""
      businessData={null}
      commerceProducts={[]}
      services={[]}
      storefrontConfig={{} as StorefrontConfig}
      analytics={analytics}
      businessHours={{}}
      onModeChange={() => {}}
      activeDeliveryMethodsCount={0}
      storeGraph={null}
      readiness={null}
    />,
  );
}

afterEach(() => cleanup());

describe("Overview tab: the revenue tile follows revenue read", () => {
  it("[WEB-FSAR-01] analytics without revenue (a member without revenue read): no Revenue (30d) tile, storefront tiles kept", () => {
    renderOverview(STOREFRONT_ONLY);
    expect(screen.queryByText("Revenue (30d)")).toBeNull();
    expect(screen.getByText("Orders (30d)")).toBeTruthy();
    expect(screen.getByText("Store Views")).toBeTruthy();
    expect(screen.getAllByText("321").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(formatPrice(0));
    expect(screen.getByText("Trust Score")).toBeTruthy();
  });

  it("[WEB-FSAR-02] analytics with revenue (a revenue reader): the Revenue (30d) tile shows the figure", () => {
    renderOverview({ ...STOREFRONT_ONLY, invoices: { total: 3, inPeriod: 3 }, revenue: { inPeriod: 400 } });
    expect(screen.getByText("Revenue (30d)")).toBeTruthy();
    expect(screen.queryByText("Trust Score")).toBeNull();
    expect(document.body.textContent).toContain(formatPrice(400));
  });
});
