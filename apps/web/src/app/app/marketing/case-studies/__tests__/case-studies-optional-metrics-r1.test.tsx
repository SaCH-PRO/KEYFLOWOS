/**
 * P230 repair round 1 (acceptance reviews at 6d9412a), the marketing case-studies page.
 *
 *   partial presence  a value present with its prior figure absent shows no "undefined prior 60d"; a growth value
 *                     absent with its value present shows no "undefined"/"NaN" delta
 *   formatCurrency    a real 0 is "TTD 0" (not "—": no falsy guard); Infinity and NaN never render NaN or ∞ ("—")
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

function study(metrics: Record<string, unknown>) {
  return {
    id: "cs_r1",
    businessId: "biz_cs",
    headline: "Doubles Co case study",
    location: "Port of Spain",
    industry: "Food",
    status: "draft" as const,
    consent: false,
    consentedAt: null,
    consentedBy: null,
    generatedAt: "2026-11-20T00:00:00.000Z",
    publishedAt: null,
    metrics: { windowDays: 60, currency: "TTD", recentBookings: 3, priorBookings: 2, bookingGrowthPct: 50, topService: "Catering", ...metrics },
  };
}

beforeEach(() => apiGet.mockReset());
afterEach(() => cleanup());

const text = () => document.body.textContent ?? "";
/** The tile whose label is `label`, as text. */
const tile = (label: RegExp) => screen.getByText(label).closest("div")?.parentElement?.textContent ?? "";

async function mount(metrics: Record<string, unknown>) {
  apiGet.mockResolvedValue({ data: [study(metrics)], error: null });
  render(<CaseStudiesPage />);
  await screen.findByText("Doubles Co case study");
}

describe("partial presence", () => {
  it("recentOrders without priorOrders: no 'undefined prior 60d'", async () => {
    await mount({ recentOrders: 5, orderGrowthPct: 25 });
    expect(screen.getByText(/^Orders \(60d\)$/)).toBeTruthy();
    expect(text()).not.toMatch(/undefined/);
    expect(tile(/^Orders \(60d\)$/)).not.toMatch(/(?<!vs )prior 60d/); // the prior-value line, not the "+x% vs prior 60d" delta
  });

  it("recentRevenue without priorRevenue: no 'undefined' and no '— prior 60d'", async () => {
    await mount({ recentRevenue: 800, revenueGrowthPct: 10 });
    expect(screen.getByText(/^Revenue \(60d\)$/)).toBeTruthy();
    expect(text()).not.toMatch(/undefined|NaN/);
    expect(tile(/^Revenue \(60d\)$/)).not.toMatch(/(?<!vs )prior 60d/); // the prior-value line, not the "+x% vs prior 60d" delta
  });

  it("a value present with its growth absent: no 'undefined' or NaN delta", async () => {
    await mount({ recentOrders: 5, priorOrders: 4, recentRevenue: 800, priorRevenue: 700 });
    expect(text()).not.toMatch(/undefined|NaN/);
    expect(tile(/^Orders \(60d\)$/)).toMatch(/4 prior 60d/);
    // No delta line at all: an undefined {delta} renders empty, so a stray "% vs prior 60d" would leave no NaN behind.
    expect(tile(/^Orders \(60d\)$/)).not.toMatch(/vs prior 60d/);
    expect(tile(/^Revenue \(60d\)$/)).not.toMatch(/vs prior 60d/);
    expect(tile(/^Bookings \(60d\)$/)).toMatch(/vs prior 60d/); // the control: Bookings has its growth
  });
});

describe("formatCurrency", () => {
  it("a real 0 is 'TTD 0', not '—'", async () => {
    await mount({ recentRevenue: 0, priorRevenue: 0 });
    expect(tile(/^Revenue \(60d\)$/)).toMatch(/TTD\s?0(?![\d,])/);
    expect(tile(/^Revenue \(60d\)$/)).not.toMatch(/—/);
  });

  it.each([Infinity, -Infinity, NaN])("%s never renders NaN or ∞", async (v) => {
    await mount({ recentRevenue: v, priorRevenue: v });
    const t = tile(/^Revenue \(60d\)$/);
    expect(t).not.toMatch(/NaN|∞/);
    expect(t).toMatch(/—/);
  });
});
