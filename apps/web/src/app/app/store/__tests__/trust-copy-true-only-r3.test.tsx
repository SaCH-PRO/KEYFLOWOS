/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 3 (round-2 review at 7485784), the Trust Copy suggestions.
 *
 *   R3-1  with no testimonials, no social-proof copy at all: no "Join our growing community of satisfied customers"
 *   R3-2  the badge is "N+ Happy Customers" for N testimonials, or nothing: at 0, trustBadges is [] and no text says
 *         "Happy Customers" (not even "0+ Happy Customers")
 *   R3-3  the store's real testimonial count drives it: the merchandising view's panel, rendered with 0 and with 2
 *         testimonials in the storefront config
 *   R3-4  under D-303, no "Trusted by customers across the region", "Fast, Reliable Service" or "Real Human Support"
 *         (the product checks none of them), with or without testimonials
 *
 * Round 4 (round-3 confirmations at ddedabe, deliberately, under D-303): the badge is "N customer reviews", not
 * "N+ Happy Customers", and the copy "Read N reviews from our customers", not "Join N+ satisfied customers" (a count
 * of testimonials says nothing about their rating); "Real results … keep coming back" is gone. The assertions that
 * kept the old wording now pin the new (see trust-copy-true-only-r4).
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
import { MerchandisingMode } from "../components/merchandising-mode";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const UNCHECKED = /Trusted by customers across the region|Fast, Reliable Service|Real Human Support/i;
const UNBACKED = /satisfied customers|Happy Customers|Real results, real reviews/i;

/** Clicks Trust Copy and waits for the panel's 1 s "generating" to end. */
async function generateTrustCopy() {
  fireEvent.click(screen.getByText("Trust Copy"));
  await screen.findByText(/Generating Trust Copy/);
  await waitFor(() => expect(screen.queryByText(/Generating Trust Copy/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50)); // the result animates in
}

async function hubTrust(testimonials: unknown[]) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === "trust-copy-generator")!;
  return (await tool.execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", testimonials } })) as {
    trustBadges: string[]; socialProofCopy: string[];
  };
}

describe("the AI content panel's Trust Copy", () => {
  it("with no testimonials: no social proof, no badge, no unchecked service claim", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} testimonialCount={0} />);
    await generateTrustCopy();
    expect(text()).not.toMatch(UNBACKED);
    expect(text()).not.toMatch(UNCHECKED);
  });

  // Round 4 (D-303): the count of reviews, not that the customers are happy or satisfied or come back.
  it("with 3 testimonials: '3 customer reviews' and copy that points to them, still no unchecked claim", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} testimonialCount={3} />);
    await generateTrustCopy();
    expect(text()).toMatch(/3 customer reviews/);
    expect(text()).toMatch(/Read 3 reviews from our customers/);
    expect(text()).not.toMatch(UNBACKED);
    expect(text()).not.toMatch(UNCHECKED);
  });
});

describe("the store AI hub's Trust Copy Generator", () => {
  it("with no testimonials: every list is empty", async () => {
    const out = await hubTrust([]);
    expect(out.trustBadges).toEqual([]);
    expect(out.socialProofCopy).toEqual([]);
    expect(out).not.toHaveProperty("guarantees"); // round 5: the hub returns no guarantees key at all
    expect(JSON.stringify(out)).not.toMatch(UNBACKED);
    expect(JSON.stringify(out)).not.toMatch(UNCHECKED);
  });

  it("with 3 testimonials: one '3 customer reviews' badge, copy that points to them, no unchecked claim", async () => {
    const out = await hubTrust([1, 2, 3]);
    expect(out.trustBadges).toEqual(["3 customer reviews"]); // round 4
    expect(out.socialProofCopy.join(" ")).toMatch(/Read 3 reviews from our customers/); // round 4
    expect(JSON.stringify(out)).not.toMatch(UNBACKED); // round 4
    expect(JSON.stringify(out)).not.toMatch(UNCHECKED);
  });
});

describe("the merchandising view passes the store's real testimonial count", () => {
  function mount(testimonials: unknown[]) {
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={[]}
        commerceProducts={[]}
        liveProductIds={new Set()}
        storefrontConfig={{ socialProof: { testimonials } } as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials={testimonials.length > 0}
      />,
    );
    fireEvent.click(screen.getByText("AI Content Intelligence"));
  }

  it("with none in the config, the panel suggests no 'Happy Customers'", async () => {
    mount([]);
    await generateTrustCopy();
    expect(text()).not.toMatch(/Happy Customers|satisfied customers/i);
  });

  it("with 2 in the config, the panel suggests '2 customer reviews'", async () => {
    mount([{ id: "t1", name: "Ann", text: "Great", rating: 5 }, { id: "t2", name: "Bo", text: "Hot!", rating: 5 }]);
    await generateTrustCopy();
    expect(text()).toMatch(/2 customer reviews/); // round 4
  });
});
