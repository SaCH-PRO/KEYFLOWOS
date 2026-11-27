/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 1 (acceptance reviews at bed0f8f), the owner's store editor.
 *
 *   MINOR-2  the storefront preview's trust row matches the store: no "Secure", "Instant" or "Safe Pay" placeholders
 *   MINOR-3  the Trust Copy suggestions (the AI content panel and the store AI hub's Trust Copy Generator) offer no
 *            paste-in guarantee or unverified badge: no "100% Satisfaction Guarantee", "Secure, Encrypted Checkout",
 *            "Verified Business", "Secure Payments", "5-Star Rated", "Quality Guaranteed" or "satisfaction guarantee"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, renderHook } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/app/store",
  useParams: () => ({}),
}));

import { StorefrontPreview } from "../components/storefront-preview";
import { AiContentPanel } from "../components/ai-content-panel";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const UNVERIFIED = /100% Satisfaction Guarantee|Secure, Encrypted Checkout|Verified Business|Secure Payments|5-Star Rated|Quality Guaranteed|satisfaction guarantee/i;

describe("MINOR-2: the storefront preview", () => {
  it("previews no 'Secure', 'Instant' or 'Safe Pay' trust placeholders", () => {
    render(<StorefrontPreview businessData={{ name: "Pepper Co" }} services={[]} commerceProducts={[]} config={{} as never} slug="pepper-co" previewMode="desktop" />);
    expect(text()).toContain("Pepper Co");
    for (const label of ["Secure", "Instant", "Safe Pay"]) {
      expect(screen.queryAllByText(new RegExp(`^${label}$`)), `the preview shows '${label}'`).toEqual([]);
    }
  });
});

describe("MINOR-3: Trust Copy suggestions", () => {
  it("the AI content panel's Trust Copy offers no guarantee or unverified badge", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} testimonialCount={3} />);
    fireEvent.click(screen.getByText("Trust Copy"));
    // The panel "generates" for 1 s, then its loading row animates out.
    // Round 4 (D-303): the copy counts the reviews; it no longer says the customers are satisfied.
    expect(await screen.findByText(/Read 3 reviews from our customers/, undefined, { timeout: 4000 })).toBeTruthy();
    expect(text()).not.toMatch(UNVERIFIED);
  });

  it("the store AI hub's Trust Copy Generator returns no guarantee or unverified badge", async () => {
    const { result } = renderHook(() => useStoreAiHub());
    const tool = result.current.tools.find((t) => t.id === "trust-copy-generator");
    expect(tool).toBeTruthy();
    const out = await tool!.execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", testimonials: [1, 2, 3], businessDescription: "Hot sauces" } });
    expect(JSON.stringify(out)).toMatch(/Read 3 reviews from our customers/); // round 4
    expect(JSON.stringify(out)).not.toMatch(UNVERIFIED);
  });
});
