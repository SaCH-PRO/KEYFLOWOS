/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 2 (round-1 confirmations at 1328234, MINORs), the owner's store editor.
 *
 *   R2-2  the FAQ suggestions (AI content panel and the store AI hub's FAQ Generator) do not say payments are
 *         processed "securely"
 *   R2-3  the Social Proof panel's Guarantee Text placeholder suggests no guarantee
 *   R2-4  "Trusted by Customers", "Real results, real reviews" and "Trusted by customers across the region" are
 *         suggested only when the store has testimonials. Round 3 (review of 7485784, deliberately, under D-303):
 *         "Trusted by customers across the region", "Fast, Reliable Service" and "Real Human Support" are no longer
 *         suggested at all; the assertions that kept them are now that they are gone
 *   R2-5  the storefront preview's trust row shows the store's own trust lines
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
import { SocialProofPanel } from "../components/social-proof-panel";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const UNEARNED_PRAISE = /Trusted by Customers|Real results, real reviews|Trusted by customers across the region/i;

async function panelAction(label: string, props: React.ComponentProps<typeof AiContentPanel>, ready: RegExp) {
  render(<AiContentPanel {...props} />);
  fireEvent.click(screen.getByText(label));
  await screen.findByText(ready, undefined, { timeout: 4000 });
}

function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool;
}

describe("R2-2: FAQ suggestions", () => {
  it("the AI content panel's payment FAQ does not say 'securely'", async () => {
    await panelAction("Generate FAQ", { storeName: "Pepper Co", productsCount: 2 }, /What payment methods do you accept\?/);
    expect(text()).toMatch(/processed at checkout/);
    expect(text()).not.toMatch(/securely/i);
  });

  it("the store AI hub's FAQ Generator does not say 'securely'", async () => {
    const out = await hubTool("faq-generator").execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", products: [{ id: "p1" }] } });
    const json = JSON.stringify(out);
    expect(json).toMatch(/What payment methods do you accept\?/);
    expect(json).toMatch(/processed at checkout/);
    expect(json).not.toMatch(/securely/i);
  });
});

describe("R2-3: the Social Proof panel", () => {
  it("its Guarantee Text placeholder suggests no guarantee", () => {
    render(<SocialProofPanel storefrontConfig={{ socialProof: {} } as never} configSaving={false} onConfigChange={vi.fn()} onSaveConfig={vi.fn()} />);
    const input = screen.getByText("Guarantee Text").parentElement!.querySelector("input")!;
    expect(input.getAttribute("placeholder") ?? "").not.toMatch(/guarantee|100%|satisfaction/i);
  });
});

describe("R2-4: praise only with testimonials", () => {
  it("the panel's Trust Copy, with no testimonials, suggests none of it (and, since round 3, no service claims)", async () => {
    await panelAction("Trust Copy", { storeName: "Pepper Co", productsCount: 2, testimonialCount: 0 }, /No trust copy yet/);
    expect(text()).not.toMatch(UNEARNED_PRAISE);
    expect(text()).not.toMatch(/Fast, Reliable Service|Real Human Support/);
  });

  it("the panel's Trust Copy, with 3 testimonials, suggests it", async () => {
    await panelAction("Trust Copy", { storeName: "Pepper Co", productsCount: 2, testimonialCount: 3 }, /3\+ Happy Customers/);
    expect(text()).toMatch(/Real results, real reviews/);
    expect(text()).not.toMatch(/Trusted by customers across the region/); // round 3: testimonials show no reach
  });

  it("the hub's Trust Copy Generator, with no testimonials, suggests none of it; with testimonials, it does", async () => {
    const tool = hubTool("trust-copy-generator");
    const none = JSON.stringify(await tool.execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", testimonials: [] } }));
    expect(none).not.toMatch(UNEARNED_PRAISE);
    expect(none).not.toMatch(/Fast, Reliable Service|Real Human Support/); // round 3
    const some = JSON.stringify(await tool.execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", testimonials: [1, 2, 3] } }));
    expect(some).toMatch(/Real results, real reviews/);
    expect(some).not.toMatch(/Trusted by customers across the region/); // round 3
  });
});

describe("R2-5: the storefront preview", () => {
  it("shows the store's own trust lines", () => {
    render(<StorefrontPreview businessData={{ name: "Pepper Co" }} services={[]} commerceProducts={[]} config={{} as never} slug="pepper-co" previewMode="desktop" />);
    for (const label of ["Orders completed", "Payments by your gateway", "Today's hours"]) {
      expect(screen.getAllByText(label).length, `the preview shows '${label}'`).toBeGreaterThan(0);
    }
  });
});
