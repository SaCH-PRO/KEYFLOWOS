/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 4 (round-3 confirmations at ddedabe, MINORs), under D-303: Trust Copy and
 * FAQ suggestions state only what the product knows.
 *
 *   R4-1  the counts say how many reviews there are, never that the customers are happy or satisfied: "N customer
 *         reviews" and "Read N reviews from our customers", true at any rating (pinned with 3 one-star testimonials)
 *   R4-2  no unchecked copy: the hub's aboutCopy ("… is committed to delivering quality …") and "Real results … keep
 *         coming back" are gone; the FAQ suggestions (panel and hub) leave the refund window, the response time, the
 *         delivery time and the cancellation notice as marked placeholders for the merchant, not invented facts
 *   R4-3  the panel's Trust Copy follows the testimonial count after it was generated: removing them clears it, adding
 *         some makes it suggest them
 *   R4-5  with no testimonials there are no Trust Badges or Social Proof Copy headings; the hub's summary, description
 *         and instruction mention no guarantee
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
import { onStore } from "./trust-copy-allowlist";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
/** What a count of testimonials does not show: that the customers were happy, satisfied, or come back. */
const SENTIMENT = /Happy Customers|satisfied customers|Real results|keep coming back/i;
/** Operational facts the product cannot know about the merchant. */
const INVENTED_FACTS = /7 days|1 business day|3[–-]5 business days|24 hours/i;
// r6: the refund and cancellation answers are the merchant's whole policy, not a window or a notice inside a policy
// the product does not know the store has.
const PLACEHOLDERS = ["[your refund policy]", "[your response time]", "[your delivery time]", "[your reschedule and cancellation policy]"];

async function generate(label: string, waiting: RegExp) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(waiting);
  await waitFor(() => expect(screen.queryByText(waiting)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50)); // the result animates in
}
const generateTrustCopy = () => generate("Trust Copy", /Generating Trust Copy/);

function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool;
}
type TrustOut = { summary: string; instruction: string; trustBadges: string[]; socialProofCopy: string[] } & Record<string, unknown>;
const hubTrust = async (testimonials: unknown[]) =>
  (await hubTool("trust-copy-generator").execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", testimonials, businessDescription: "Hot sauces" } })) as TrustOut;

const ONE_STAR = [1, 2, 3].map((i) => ({ id: `t${i}`, name: `Critic ${i}`, text: "Not good.", rating: 1 }));

describe("R4-1: the counts say how many reviews, at any rating", () => {
  it("the panel, given 3 one-star testimonials through the merchandising view, says '3 customer reviews'", async () => {
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={[]}
        commerceProducts={[]}
        liveProductIds={new Set()}
        storefrontConfig={{ socialProof: { testimonials: ONE_STAR } } as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials
      />,
    );
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generateTrustCopy();
    expect(text()).toMatch(/3 customer reviews/);
    expect(text()).toMatch(/Read 3 reviews from our customers\./);
    expect(text()).not.toMatch(SENTIMENT);
  });

  it("the panel says '1 customer review' for one", async () => {
    render(<AiContentPanel storeName="Pepper Co" testimonialCount={1} />);
    await generateTrustCopy();
    expect(text()).toMatch(/1 customer review(?!s)/);
    expect(text()).toMatch(/Read 1 review from our customers\./);
  });

  it("the hub, given 3 one-star testimonials, says '3 customer reviews' and nothing about sentiment", async () => {
    const out = await hubTrust(ONE_STAR);
    expect(out.trustBadges).toEqual(["3 customer reviews"]);
    expect(out.socialProofCopy).toEqual(["Read 3 reviews from our customers."]);
    expect(JSON.stringify(out)).not.toMatch(SENTIMENT);
  });
});

describe("R4-2: no unchecked copy", () => {
  it("the hub's Trust Copy Generator returns no aboutCopy and no 'committed to delivering quality'", async () => {
    for (const testimonials of [[], ONE_STAR]) {
      const out = await hubTrust(testimonials);
      expect(out).not.toHaveProperty("aboutCopy");
      expect(JSON.stringify(out)).not.toMatch(/committed to delivering quality/i);
    }
  });

  it("the panel's FAQ leaves the refund window, response time, delivery time and cancellation notice to the merchant", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={1} hasDelivery />);
    await generate("Generate FAQ", /Generating Generate FAQ/);
    expect(text()).not.toMatch(INVENTED_FACTS);
    for (const p of PLACEHOLDERS) expect(text(), p).toContain(p);
  });

  it("the hub's FAQ Generator does the same", async () => {
    const out = await hubTool("faq-generator").execute({
      businessId: "biz_1",
      customData: onStore({ storeName: "Pepper Co", products: [{ id: "p1" }], services: [{ id: "s1" }], activeDeliveryCount: 1 }),
    });
    const all = JSON.stringify(out);
    expect(all).not.toMatch(INVENTED_FACTS);
    for (const p of PLACEHOLDERS) expect(all, p).toContain(p);
  });
});

describe("R4-3: the panel's Trust Copy follows the testimonial count", () => {
  it("generated with 2, then the testimonials are removed: no '2 customer reviews' is left", async () => {
    const view = render(<AiContentPanel storeName="Pepper Co" testimonialCount={2} />);
    await generateTrustCopy();
    expect(text()).toMatch(/2 customer reviews/);
    view.rerender(<AiContentPanel storeName="Pepper Co" testimonialCount={0} />);
    await waitFor(() => expect(text()).not.toMatch(/2 customer reviews|Read 2 reviews/));
  });

  it("generated with 0, then 2 are added: it suggests them, not 'No trust copy yet'", async () => {
    const view = render(<AiContentPanel storeName="Pepper Co" testimonialCount={0} />);
    await generateTrustCopy();
    expect(text()).toMatch(/No trust copy yet/);
    view.rerender(<AiContentPanel storeName="Pepper Co" testimonialCount={2} />);
    await waitFor(() => expect(text()).toMatch(/2 customer reviews/));
    expect(text()).not.toMatch(/No trust copy yet/);
  });
});

describe("R4-5: what is shown with no testimonials, and the hub's own words", () => {
  it("with no testimonials there are no Trust Badges or Social Proof Copy headings", async () => {
    render(<AiContentPanel storeName="Pepper Co" testimonialCount={0} />);
    await generateTrustCopy();
    expect(text()).toMatch(/No trust copy yet/);
    expect(screen.queryByText("Trust Badges")).toBeNull();
    expect(screen.queryByText("Social Proof Copy")).toBeNull();
  });

  it("the hub's summary, description and instruction mention no guarantee", async () => {
    const tool = hubTool("trust-copy-generator");
    expect(tool.description).not.toMatch(/guarantee/i);
    for (const testimonials of [[], ONE_STAR]) {
      const out = await hubTrust(testimonials);
      expect(out.summary).not.toMatch(/guarantee/i);
      expect(out.instruction).not.toMatch(/guarantee/i);
    }
  });
});
