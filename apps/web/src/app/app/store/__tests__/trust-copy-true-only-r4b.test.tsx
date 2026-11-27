/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 4b (orchestrator, on 3633c44), under D-303: the panel's and the store AI
 * hub's generated copy states nothing about the merchant's operations that the product does not know.
 *
 *   R4B-1  the three claims noticed in round 4, in the panel's FAQ and the hub's FAQ Generator:
 *          "What makes X different? … committed to quality …", "We accept all major credit and debit cards" and
 *          "Yes, local pickup is available" are a marked placeholder or gone
 *   R4B-2  the sweep of every other generated statement of fact about the merchant's operations:
 *          FAQ "Express options may be available" and "for items in (their) original condition"; SEO "fast
 *          delivery", "Book or buy instantly", "buy instantly, delivered to you", "Quality products and services";
 *          launch "fast response", "N+ items" (more than the store has) and "with more coming soon"; hero "Where
 *          Quality Meets Convenience", "in seconds", "Premium … delivered to you", "New Arrivals Just Added" and the
 *          invented "Limited Time: Free Consultation on First Order" offer
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/app/store",
  useParams: () => ({}),
}));

import { AiContentPanel } from "../components/ai-content-panel";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

/** R4B-1: the three claims noticed in round 4. */
const NOTICED = /committed to quality|pride ourselves on quality|carefully selected|all major credit and debit cards|local pickup is available|Yes! Select local pickup/i;
/** R4B-2: the rest of the sweep. */
const SWEPT = new RegExp(
  [
    "Express options",
    "original condition",
    "fast delivery",
    "instantly",
    "delivered to you",
    "Quality products and services",
    "fast response",
    "\\d+\\+ items",
    "more coming soon",
    "Where Quality Meets Convenience",
    "in seconds",
    "Premium ",
    "New Arrivals Just Added",
    "Free Consultation",
    "Limited Time",
  ].join("|"),
  "i",
);

async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  const waiting = new RegExp(`Generating ${label}`);
  await screen.findByText(waiting);
  await waitFor(() => expect(screen.queryByText(waiting)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}

function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool;
}

const FULL = { storeName: "Pepper Co", products: [{ id: "p1", category: "Sauces" }], services: [{ id: "s1", category: "Tasting" }], activeDeliveryCount: 1 };
const PANEL_PROPS = { storeName: "Pepper Co", productsCount: 2, servicesCount: 1, hasDelivery: true } as const;

describe("R4B-1: the three claims noticed in round 4", () => {
  it("the panel's FAQ makes none of them; payment methods and what sets the store apart are placeholders", async () => {
    render(<AiContentPanel {...PANEL_PROPS} />);
    await generate("Generate FAQ");
    expect(text()).not.toMatch(NOTICED);
    expect(text()).toContain("[your payment methods]");
    expect(text()).toContain("[what makes your business different]");
    expect(text()).not.toMatch(/Do you offer local pickup\?/);
  });

  it("the hub's FAQ Generator makes none of them, with the same placeholders", async () => {
    const all = JSON.stringify(await hubTool("faq-generator").execute({ businessId: "biz_1", customData: FULL }));
    expect(all).not.toMatch(NOTICED);
    expect(all).toContain("[your payment methods]");
    expect(all).toContain("[what makes your business different]");
    expect(all).not.toMatch(/Do you offer local pickup\?/);
  });
});

describe("R4B-2: no other generated statement of fact about the merchant's operations", () => {
  for (const label of ["Generate FAQ", "Generate SEO", "Launch Posts"]) {
    it(`the panel's ${label}`, async () => {
      render(<AiContentPanel {...PANEL_PROPS} businessTagline="" />);
      await generate(label);
      expect(text()).not.toMatch(SWEPT);
      expect(text()).not.toMatch(NOTICED);
    });
  }

  it("the panel's launch posts give the store's real item count, not 'N+'", async () => {
    render(<AiContentPanel {...PANEL_PROPS} />);
    await generate("Launch Posts");
    expect(text()).toMatch(/Browse our 3 items/);
  });

  for (const id of ["faq-generator", "seo-generator", "launch-campaign-generator", "hero-copy-generator"]) {
    it(`the hub's ${id}`, async () => {
      const out = await hubTool(id).execute({ businessId: "biz_1", customData: FULL });
      const all = JSON.stringify(out);
      expect(all).not.toMatch(SWEPT);
      expect(all).not.toMatch(NOTICED);
    });
  }

  it("the hub's hero offer ribbons leave the offer to the merchant", async () => {
    const out = (await hubTool("hero-copy-generator").execute({ businessId: "biz_1", customData: FULL })) as { offerRibbons: string[] };
    expect(out.offerRibbons.join(" ")).toContain("[your offer]");
  });
});
