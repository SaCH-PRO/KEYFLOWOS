/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 6b (orchestrator, on the round-6 scope questions), under D-303: the AI
 * Content panel, the store AI hub and the AI Hero Copy panel count the storefront the same way, through one helper.
 *
 *   R6B-1  the helper: products live on the store (and active), and bookable services (a service with a
 *          sourceProductId is a product's store listing, not a service to book)
 *   R6B-2  the Design tab's AI Hero Copy panel counts with it: 12 catalog products with none live, and product-listing
 *          service rows, give no buy, book, order or shop claim and no count; 2 live give "2 products"
 *   R6B-3  a products-only store with product-listing service rows does not say "Book", in the panel, the hub and the
 *          hero panel
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, renderHook, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/app/store",
  useParams: () => ({}),
}));

import { liveProducts, bookableServices } from "../storefront-counts";
import { DesignMode } from "../components/design-mode";
import { AiContentPanel } from "../components/ai-content-panel";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const LONG = 60_000;
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(/Generating/);
  await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}

const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Sauce ${i}`, price: 1 }));
const listings = [{ id: "s_l0", name: "Sauce 0", price: 1, sourceProductId: "p0" }, { id: "s_l1", name: "Sauce 1", price: 1, sourceProductId: "p1" }];

describe("R6B-1: the storefront-count helper", () => {
  it("keeps only products live on the store and active", () => {
    const products = [{ id: "a" }, { id: "b", isActive: true }, { id: "c", isActive: false }, { id: "d" }];
    expect(liveProducts(products, new Set(["a", "b", "c"])).map((p) => p.id)).toEqual(["a", "b"]);
    expect(liveProducts(products, new Set())).toEqual([]);
    expect(liveProducts(products, undefined)).toEqual([]);
  });

  it("keeps only bookable services, not a product's store listing", () => {
    const services = [{ id: "s1" }, { id: "s2", sourceProductId: null }, { id: "s3", sourceProductId: "p1" }];
    expect(bookableServices(services).map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("R6B-2: the Design tab's AI Hero Copy panel counts the storefront", () => {
  const design = (live: string[], services: unknown[]) =>
    render(
      <DesignMode
        businessData={{ name: "Pepper Co" }}
        services={services as never}
        commerceProducts={twelve as never}
        liveProductIds={new Set(live)}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        slug="pepper-co"
      />,
    );
  /** The hero panel's own text (the Design tab also renders a storefront preview of the store's items). */
  const heroText = async () => {
    fireEvent.click(screen.getAllByText("AI Hero Copy")[0]);
    const button = (await screen.findByText("Generate")).closest("button")!;
    const panel = button.parentElement!.parentElement!;
    fireEvent.click(button);
    await screen.findByText(/Generating/);
    await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
    for (const b of within(panel).queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 300));
    return (panel.textContent ?? "").replace(/\s+/g, " ");
  };

  it("12 catalog products, none live, with their listing service rows: no buy, book, order or shop claim, no count", async () => {
    design([], listings);
    const t = await heroText();
    expect(t).not.toMatch(/\bbuy\b|\bbook|\border|\bshop\b|\b12\b|Browse/i);
    expect(t).toMatch(/Pepper Co, now online\./);
  }, LONG);

  it("2 of them live, with their listing service rows: '2 products', and no book claim", async () => {
    design(["p0", "p1"], listings);
    const t = await heroText();
    expect(t).toMatch(/Browse 2 products\. Buy online\./);
    expect(t).not.toMatch(/\bbook|service/i);
  }, LONG);
});

describe("R6B-3: products only, with listing service rows, never says 'Book'", () => {
  it("the hub", async () => {
    const { result } = renderHook(() => useStoreAiHub());
    const data = { storeName: "Pepper Co", products: twelve.slice(0, 2), services: listings };
    for (const id of ["seo-generator", "launch-campaign-generator", "hero-copy-generator", "faq-generator"]) {
      const tool = result.current.tools.find((t) => t.id === id)!;
      expect(JSON.stringify(await tool.execute({ businessId: "biz_1", customData: data })), id).not.toMatch(/\bbook/i);
    }
  });

  it("the panel, counted with the helper", async () => {
    render(
      <AiContentPanel
        storeName="Pepper Co"
        productsCount={liveProducts(twelve, new Set(["p0", "p1"])).length}
        servicesCount={bookableServices(listings).length}
      />,
    );
    await generate("Launch Posts");
    expect(text()).not.toMatch(/\bbook/i);
    expect(text()).toMatch(/Browse our 2 items\./);
  });
});
