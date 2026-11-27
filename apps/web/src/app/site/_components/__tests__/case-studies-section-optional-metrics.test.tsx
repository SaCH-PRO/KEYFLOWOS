/**
 * P230 FU-CASE-STUDY-WEB-OPTIONAL-METRICS (follow-up of server P139 FU-CASE-STUDY-REVENUE).
 *
 * A published booking-only case study omits the revenue and order metrics (recentRevenue, priorRevenue,
 * revenueGrowthPct, recentOrders, priorOrders, orderGrowthPct, topProduct). The public section rendered "NaN" and
 * "undefined". With them absent it renders no NaN and no "undefined", does not throw, and leaves out the Orders and
 * Revenue tiles; with them present it is unchanged.
 *
 * (This component has no importer on main: /site/<slug> redirects to /book/<slug>; recorded under FU-CENSUS-HARDENING.
 * It is guarded here all the same, and not deleted in this packet.)
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import CaseStudiesSection, { type PublicCaseStudy } from "../case-studies-section";

afterEach(() => cleanup());

const BOOKINGS_ONLY = {
  id: "cs_pub",
  headline: "Doubles Co grew bookings 40%",
  location: "Port of Spain",
  industry: "Food",
  publishedAt: "2026-11-21T00:00:00.000Z",
  metrics: {
    windowDays: 60,
    currency: "TTD",
    recentBookings: 14,
    priorBookings: 10,
    bookingGrowthPct: 40,
    topService: "Catering",
  },
} as unknown as PublicCaseStudy;

const FULL = {
  ...BOOKINGS_ONLY,
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
} as unknown as PublicCaseStudy;

const text = () => document.body.textContent ?? "";

describe("the public case-studies section with the revenue and order metrics withheld", () => {
  it("renders no NaN and no 'undefined', leaves out the Orders and Revenue tiles, and keeps Bookings", () => {
    render(<CaseStudiesSection studies={[BOOKINGS_ONLY]} />);
    expect(screen.getByText(BOOKINGS_ONLY.headline)).toBeTruthy();
    expect(text()).not.toMatch(/NaN/);
    expect(text()).not.toMatch(/undefined/);
    expect(screen.queryByText(/^Orders \(60d\)$/)).toBeNull();
    expect(screen.queryByText(/^Revenue$/)).toBeNull();
    expect(screen.getByText(/^Bookings$/)).toBeTruthy();
    expect(text()).toMatch(/Top service:\s*Catering/);
  });

  it("with the metrics present, Orders and Revenue show as before", () => {
    render(<CaseStudiesSection studies={[FULL]} />);
    expect(screen.getByText(/^Orders \(60d\)$/)).toBeTruthy();
    expect(screen.getByText(/^Revenue$/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(text()).toMatch(/1,200/);
    expect(text()).toMatch(/Top product:\s*Doubles/);
    expect(text()).not.toMatch(/NaN|undefined/);
  });
});
