/**
 * P230 repair round 1 (acceptance reviews at 6d9412a), the public case-studies section.
 *
 *   partial presence  a value present with its growth absent shows no "undefined"/"NaN" delta
 *   formatCurrency    a real 0 is "TTD 0" (not "—": no falsy guard); Infinity and NaN never render NaN or ∞ ("—")
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import CaseStudiesSection, { type PublicCaseStudy } from "../case-studies-section";

afterEach(() => cleanup());

function study(metrics: Record<string, unknown>): PublicCaseStudy {
  return {
    id: "cs_pub_r1",
    headline: "Doubles Co case study",
    location: "Port of Spain",
    industry: "Food",
    publishedAt: "2026-11-21T00:00:00.000Z",
    metrics: { windowDays: 60, currency: "TTD", recentBookings: 3, bookingGrowthPct: 50, topService: "Catering", ...metrics },
  } as unknown as PublicCaseStudy;
}

const text = () => document.body.textContent ?? "";
const tile = (label: RegExp) => screen.getByText(label).closest("div")?.textContent ?? "";

describe("partial presence", () => {
  it("values present with their growth absent: no 'undefined' or NaN delta", () => {
    render(<CaseStudiesSection studies={[study({ recentOrders: 5, recentRevenue: 800 })]} />);
    expect(screen.getByText(/^Orders \(60d\)$/)).toBeTruthy();
    expect(screen.getByText(/^Revenue$/)).toBeTruthy();
    expect(text()).not.toMatch(/undefined|NaN/);
    expect(text()).not.toMatch(/vs prior 60d.*vs prior 60d.*vs prior 60d/); // only Bookings has a delta
  });
});

describe("formatCurrency", () => {
  it("a real 0 is 'TTD 0', not '—'", () => {
    render(<CaseStudiesSection studies={[study({ recentOrders: 0, recentRevenue: 0 })]} />);
    expect(tile(/^Revenue$/)).toMatch(/TTD\s?0(?![\d,])/);
    expect(tile(/^Revenue$/)).not.toMatch(/—/);
  });

  it.each([Infinity, -Infinity, NaN])("%s never renders NaN or ∞", (v) => {
    render(<CaseStudiesSection studies={[study({ recentOrders: 1, recentRevenue: v })]} />);
    const t = tile(/^Revenue$/);
    expect(t).not.toMatch(/NaN|∞/);
    expect(t).toMatch(/—/);
  });
});
