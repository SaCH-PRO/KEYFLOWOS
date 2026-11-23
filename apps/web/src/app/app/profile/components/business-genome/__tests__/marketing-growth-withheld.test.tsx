/**
 * FU-GENOME-SURFACES-REVENUE round 3 (security MAJOR-3; D-234). For a member without revenue read the server serves the
 * marketing-growth snapshot's CAC, lead volume, conversion, diversification score, overall risk and budget shares, and
 * each channel's budget, target CAC and conversion target, as null (named in withheldForRevenue). The panel renders
 * them as withheld; it threw on `channelDiversificationScore.toFixed` and `overallRisk.toLowerCase` before.
 *
 *   MGW-01  a withheld snapshot and withheld channels render without a crash, with "Withheld" and no "null"/"NaN"
 *   MGW-02  a revenue reader's figures render as before
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  snapshot: null as unknown,
  channels: [] as unknown[],
}));

vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));
vi.mock("@/lib/api/business-genome", () => ({
  getGenomeMarketingGrowthSnapshot: async () => ({ data: api.snapshot }),
  fetchGenomeGrowthChannels: async () => ({ data: api.channels }),
  fetchGenomeContentStrategies: async () => ({ data: [] }),
  computeGenomeMarketingGrowthSnapshot: async () => ({ data: api.snapshot }),
  createGenomeContentStrategy: async () => ({ data: null }),
  createGenomeGrowthChannel: async () => ({ data: null }),
  deleteGenomeContentStrategy: async () => ({ data: null }),
  deleteGenomeGrowthChannel: async () => ({ data: null }),
  generateGenomeMarketingGrowthRecommendations: async () => ({ data: [] }),
  generateGenomeMarketingGrowthSignals: async () => ({ data: [] }),
}));

import { KeyGenomeMarketingGrowthPanel } from "../key-genome-marketing-growth-panel";

afterEach(cleanup);

const BASE = {
  id: "s1", businessId: "biz_1", period: null, contentConsistencyScore: 60, missingInputs: [], warnings: [], recommendations: [],
  computedAt: new Date().toISOString(),
};
const CHANNEL = {
  id: "c1", businessId: "biz_1", key: "ads", label: "Paid ads", channelType: "paid", status: "ACTIVE", currency: "TTD",
  assumptions: {}, evidenceIds: [], confidence: 0.5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

describe("FU-GENOME-SURFACES-REVENUE round 3: the marketing-growth panel's withheld state", () => {
  it("MGW-01 renders a withheld snapshot and channels as withheld", async () => {
    api.snapshot = {
      ...BASE, blendedCac: null, leadVolumeEstimate: null, funnelConversionEstimate: null, channelDiversificationScore: null,
      overallRisk: null, channelMix: [{ channelKey: "ads", label: "Paid ads", channelType: "paid", sharePercent: null, status: "ACTIVE" }],
      withheldForRevenue: ["blendedCac", "leadVolumeEstimate", "funnelConversionEstimate", "channelDiversificationScore", "overallRisk"],
    };
    api.channels = [{ ...CHANNEL, monthlyBudget: null, targetCac: null, targetConversionRate: null, withheldForRevenue: ["monthlyBudget", "targetCac", "targetConversionRate"] }];
    const { container } = render(<KeyGenomeMarketingGrowthPanel />);
    await waitFor(() => expect(container.textContent).toMatch(/Marketing & Growth Genome/));
    const text = container.textContent ?? "";
    expect(text).toMatch(/Withheld/);
    expect(text).not.toMatch(/null|NaN|undefined/);
    expect(text).toMatch(/60%/);
  });

  it("MGW-02 renders a revenue reader's figures as before", async () => {
    api.snapshot = {
      ...BASE, blendedCac: 148, leadVolumeEstimate: 12, funnelConversionEstimate: 0.1, channelDiversificationScore: 35, overallRisk: "HIGH",
      channelMix: [{ channelKey: "ads", label: "Paid ads", channelType: "paid", sharePercent: 80.4, status: "ACTIVE" }],
    };
    api.channels = [{ ...CHANNEL, monthlyBudget: 1234.5, targetCac: 87.65, targetConversionRate: 0.137 }];
    const { container } = render(<KeyGenomeMarketingGrowthPanel />);
    await waitFor(() => expect(container.textContent).toMatch(/Marketing & Growth Genome/));
    const text = container.textContent ?? "";
    expect(text).toMatch(/35%/);
    expect(text).toMatch(/\$148/);
    expect(text).not.toMatch(/Withheld/);
  });
});
