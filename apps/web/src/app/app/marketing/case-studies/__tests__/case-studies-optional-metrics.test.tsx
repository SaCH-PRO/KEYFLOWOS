/**
 * P230 FU-CASE-STUDY-WEB-OPTIONAL-METRICS (follow-up of server P139 FU-CASE-STUDY-REVENUE).
 *
 * The server now omits seven case-study metrics for members below revenue:read and on booking-only drafts:
 * recentRevenue, priorRevenue, revenueGrowthPct, recentOrders, priorOrders, orderGrowthPct, topProduct. This page
 * typed them as required and rendered "TTD NaN" and "undefined prior 60d". With them absent it renders no NaN and no
 * "undefined", does not throw, and leaves out the Orders and Revenue tiles; with them present it is unchanged.
 *
 * Mounted on the real page; only the workspace, the api client and sonner are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

const apiGet = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: vi.fn(async () => "biz_cs"),
  getStoredBusinessId: () => "biz_cs",
  getCachedBusiness: () => ({ id: "biz_cs", name: "Doubles Co", currency: "TTD" }),
}));
vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(async () => ({ data: null, error: null })),
}));

import CaseStudiesPage from "../page";

const base = {
  id: "cs_1",
  businessId: "biz_cs",
  headline: "Doubles Co grew bookings 40%",
  location: "Port of Spain",
  industry: "Food",
  status: "draft" as const,
  consent: false,
  consentedAt: null,
  consentedBy: null,
  generatedAt: "2026-11-20T00:00:00.000Z",
  publishedAt: null,
};

const BOOKINGS_ONLY = {
  ...base,
  metrics: {
    windowDays: 60,
    currency: "TTD",
    recentBookings: 14,
    priorBookings: 10,
    bookingGrowthPct: 40,
    topService: "Catering",
  },
};

const FULL = {
  ...base,
  metrics: {
    ...BOOKINGS_ONLY.metrics,
    recentOrders: 12,
    priorOrders: 8,
    orderGrowthPct: 50,
    recentRevenue: 1200,
    priorRevenue: 900,
    revenueGrowthPct: 33,
    topProduct: "Doubles",
  },
};

beforeEach(() => apiGet.mockReset());
afterEach(() => cleanup());

const text = () => document.body.textContent ?? "";

describe("the marketing case-studies page with the revenue and order metrics withheld", () => {
  it("renders no NaN and no 'undefined', leaves out the Orders and Revenue tiles, and keeps Bookings", async () => {
    apiGet.mockResolvedValue({ data: [BOOKINGS_ONLY], error: null });
    render(<CaseStudiesPage />);
    await screen.findByText(BOOKINGS_ONLY.headline);
    expect(text()).not.toMatch(/NaN/);
    expect(text()).not.toMatch(/undefined/);
    expect(screen.queryByText(/^Orders \(60d\)$/)).toBeNull();
    expect(screen.queryByText(/^Revenue \(60d\)$/)).toBeNull();
    expect(screen.getByText(/^Bookings \(60d\)$/)).toBeTruthy();
    expect(screen.getByText("Catering")).toBeTruthy();
  });

  it("with the metrics present, Orders and Revenue show as before", async () => {
    apiGet.mockResolvedValue({ data: [FULL], error: null });
    render(<CaseStudiesPage />);
    await screen.findByText(FULL.headline);
    expect(screen.getByText(/^Orders \(60d\)$/)).toBeTruthy();
    expect(screen.getByText(/^Revenue \(60d\)$/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("8 prior 60d")).toBeTruthy();
    expect(text()).toMatch(/1,200/);
    expect(text()).toMatch(/900 prior 60d/);
    expect(screen.getByText("Doubles")).toBeTruthy();
    expect(text()).not.toMatch(/NaN|undefined/);
  });
});
