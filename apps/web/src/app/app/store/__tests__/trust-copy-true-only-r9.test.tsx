/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 9 (reviews of 262f78e), under D-303.
 *
 *   R9-1  a catalog with no products and no bookable services is empty, even with listing rows (a deleted product's):
 *         "Empty Catalog", never "Your catalog has 0 items, but every one is switched off"
 *   R9-2  the Catalog tab's product reorder writes the whole storefront config: it shows the placeholder warning,
 *         scoped to that save
 *   R9-3  pins: the de-dupe names leave out listing rows (F2); every product off with a bookable service the storefront
 *         hides: "Add it…" (F3, M20); the "..." boundary at 80 and 81 characters (F4)
 *   R9-4  text is cut at a word, with "...", whenever any is dropped: the panel's and the hub's SEO titles and
 *         descriptions, and the hero panel's description subheadline
 *   R9-5  "Nothing on Your Store Yet" agrees with its count, and does not tell a listed product that is only off, out
 *         of stock or hidden to be "added to your store"
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
vi.mock("../components/catalog-manager", () => ({ CatalogManager: () => null }));
vi.mock("../components/hours-editor", () => ({ HoursEditor: () => null }));

import { storefrontOffer, clip } from "../storefront-counts";
import { AiContentPanel } from "../components/ai-content-panel";
import { AiHeroCopyPanel } from "../components/ai-hero-copy-panel";
import { CatalogMode } from "../components/catalog-mode";
import { useStoreAiHub, generateStoreSuggestions } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(/Generating/);
  await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}
const suggestions = (data: Record<string, unknown>) =>
  generateStoreSuggestions({ businessId: "biz_1", activeView: "catalog", customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, storeProducts: [], storeServices: [], ...data } } as never);
const nothing = async (data: Record<string, unknown>) => (await suggestions(data)).find((s) => s.title === "Nothing on Your Store Yet");
const product = (id: string, isActive = true) => ({ id, name: `Item ${id}`, category: "PRODUCT", isActive });

describe("R9-1: listing rows alone are an empty catalog", () => {
  it("no products, one orphan listing row: 'Empty Catalog', and no '0 items'", async () => {
    const out = await suggestions({ products: [], services: [{ id: "s_l", name: "Old sauce", sourceProductId: "deleted_p" }] });
    expect(out.map((s) => s.title)).toContain("Empty Catalog");
    expect(out.map((s) => s.title)).not.toContain("Nothing on Your Store Yet");
    expect(JSON.stringify(out)).not.toMatch(/\b0 items\b/);
  });

  it("no products and no services: 'Empty Catalog'", async () => {
    expect((await suggestions({ products: [], services: [] })).map((s) => s.title)).toContain("Empty Catalog");
  });
});

describe("R9-2: the Catalog tab's reorder save", () => {
  const catalog = (faqEntries: unknown[]) =>
    render(
      <CatalogMode
        commerceProducts={[]}
        liveProductIds={new Set()}
        graphProductToServiceMap={new Map()}
        storeItemCount={0}
        processingItems={new Set()}
        confirmRemove={null}
        onToggleItem={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onConfirmRemoveChange={vi.fn()}
        onDeleteFromStore={vi.fn()}
        services={[]}
        businessHours={{}}
        onHoursChange={vi.fn()}
        onSaveHours={vi.fn(async () => {})}
        hoursSaving={false}
        onReorderProducts={vi.fn()}
        faqEntries={faqEntries as never}
      />,
    );

  it("warns while FAQ entries hold a placeholder, naming the reorder", () => {
    catalog([{ id: "a", question: "Refunds?", answer: "[your refund policy]", order: 0 }, { id: "b", question: "Pay?", answer: "We accept [your payment methods].", order: 1 }]);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe("2 FAQ entries still have a [bracketed] part: reordering products here saves them as they are. Fill them in under Merchandising → FAQ & Policies.");
  });

  it("no warning without placeholders", () => {
    catalog([{ id: "a", question: "Refunds?", answer: "Within 14 days.", order: 0 }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("R9-3: pins", () => {
  it("F2: the de-dupe names leave out listing rows (a listed SERVICE product whose listing row has its name)", () => {
    const offer = storefrontOffer([{ id: "s_l", name: "Massage", sourceProductId: "p_m" }], [{ id: "p_m", name: "Massage", category: "SERVICE" }], new Set(["p_m"]));
    expect(offer).toEqual({ products: 0, packages: 0, services: 0, orderableServices: 1 });
  });

  // r10 (m3): a bookable service the storefront hides is told to unhide it, as a hidden product is, not to "add it".
  it("F3/M20: every product off, and a bookable service the storefront hides: 'Unhide it'; two: 'Unhide them'", async () => {
    const one = await nothing({ products: [product("p0", false), product("p1", false)], services: [{ id: "s_hidden", name: "Tasting" }], storeServices: [] });
    expect(one?.description).toBe("1 service is on your store but hidden. Unhide it in the catalog so visitors can book it.");
    expect(one?.actionLabel).toBe("Unhide it");
    const two = await nothing({ products: [product("p0", false)], services: [{ id: "s_a", name: "Tasting" }, { id: "s_b", name: "Class" }], storeServices: [] });
    expect(two?.actionLabel).toBe("Unhide them");
    expect(two?.description).not.toMatch(/\badd\b/i);
  });

  it("F4: the meta description's '...' boundary: 80 characters whole, 81 cut", async () => {
    const d80 = `${"Hot sauce ".repeat(7)}made here.`.slice(0, 80);
    expect(d80).toHaveLength(80);
    const d81 = `${d80}!`;
    render(<AiContentPanel storeName="Pepper Co" businessDescription={d80} />);
    await generate("Generate SEO");
    expect(text()).toContain(`Discover Pepper Co online. ${d80}`);
    expect(text()).not.toContain(`${d80}...`);
    cleanup();
    render(<AiContentPanel storeName="Pepper Co" businessDescription={d81} />);
    await generate("Generate SEO");
    expect(text()).toContain(`Discover Pepper Co online. ${clip(d81, 80)}`);
    expect(clip(d81, 80)).toMatch(/\.\.\.$/);
    expect(clip(d81, 80).length).toBeLessThanOrEqual(80);
  });
});

describe("R9-4: cut at a word, with '...', whenever text is dropped", () => {
  const LONG_NAME = "The Extraordinarily Long Named Caribbean Pepper Sauce Company";
  const wordsOf = (s: string) => new Set(s.replace(/\.\.\.$/, "").split(/\s+/));
  const whole = (cut: string, source: string) => {
    const src = new Set(source.split(/\s+/));
    for (const w of wordsOf(cut)) expect(src.has(w) || src.has(`${w}.`) || src.has(`${w},`), `"${w}" in "${cut}"`).toBe(true);
  };

  it("clip()", () => {
    expect(clip("short", 60)).toBe("short");
    expect(clip("one two three four", 12)).toBe("one two...");
    expect(clip("one two, three four", 13)).toBe("one two...");
    expect(clip("abcdefghijklmnop", 10)).toBe("abcdefg...");
  });

  it("the panel's SEO titles and descriptions, for a long name", async () => {
    render(<AiContentPanel storeName={LONG_NAME} productsCount={2} servicesCount={1} businessTagline="Fresh small-batch heat from our kitchen to your table" />);
    await generate("Generate SEO");
    const tagline = "Fresh small-batch heat from our kitchen to your table";
    const titles = [`${LONG_NAME} — Shop Online Today`, `${LONG_NAME} | ${tagline}`, `${LONG_NAME} Online`].map((t) => clip(t, 60));
    for (const t of titles) {
      expect(text(), t).toContain(t);
      expect(t.length).toBeLessThanOrEqual(60);
      whole(t, `${LONG_NAME} — Shop Online Today | ${tagline} Online`);
    }
    expect(titles.filter((t) => t.endsWith("...")).length).toBeGreaterThan(0);
    // the rendered Meta Title options, exactly (two of them clip to the same text, so each is checked in place)
    const label = screen.getByText("Meta Title");
    const shown = [...(label.nextElementSibling?.querySelectorAll("button span.flex-1") ?? [])].map((e) => e.textContent);
    expect(shown).toEqual(titles);
    expect(text()).not.toMatch(new RegExp(`${LONG_NAME} — Shop Online T(?!oday)`));
  });

  it("the hub's SEO titles, for a long name", async () => {
    const { result } = renderHook(() => useStoreAiHub());
    const tool = result.current.tools.find((t) => t.id === "seo-generator")!;
    const out = (await tool.execute({ businessId: "biz_1", customData: { storeName: LONG_NAME, products: [{ id: "p", category: "PRODUCT" }], services: [{ id: "s" }], businessTagline: "Fresh small-batch heat from our kitchen to your table" } })) as { metaTitleOptions: string[] };
    for (const t of out.metaTitleOptions) {
      expect(t.length, t).toBeLessThanOrEqual(60);
      if (t.length >= 57) expect(t, t).toMatch(/\.\.\.$/);
      whole(t, `${LONG_NAME} — Products and Services Online | Shop & Book Online — Fresh small-batch heat from our kitchen to your table`);
    }
    expect(out.metaTitleOptions.some((t) => t.endsWith("..."))).toBe(true);
  });

  it("the hero panel's description subheadline", async () => {
    const description = "We grow every pepper ourselves on a small farm in the hills, and bottle each sauce by hand in batches of fifty, every week.";
    render(<AiHeroCopyPanel storeName="Pepper Co" businessDescription={description} onApply={() => {}} />);
    await generate("Generate");
    expect(text()).toContain(clip(description, 100));
    expect(clip(description, 100)).toMatch(/\.\.\.$/);
    whole(clip(description, 100), description);
  });
});

describe("R9-5: 'Nothing on Your Store Yet' says what is true, in the number it counts", () => {
  it("1 product, off and not listed: 'it is switched off. Switch it on, then add it'", async () => {
    const out = await nothing({ products: [product("p0", false)], services: [] });
    expect(out?.description).toBe("Your catalog has 1 item, but it is switched off. Switch it on, then add it to your store so visitors have something to browse and buy.");
    expect(out?.actionLabel).toBe("Switch it on");
  });

  it("a listed product that is only off: switch it on, not 'add it to your store'", async () => {
    const out = await nothing({ products: [product("p0", false)], services: [{ id: "s_l0", sourceProductId: "p0" }] });
    expect(out?.description).toBe("Your catalog has 1 item, but it is switched off. Switch it on so visitors have something to browse and buy.");
    expect(out?.description).not.toMatch(/add/i);
  });

  it("listed and on, but not showing (out of stock or hidden): check its stock and visibility", async () => {
    const one = await nothing({ products: [product("p0")], services: [{ id: "s_l0", sourceProductId: "p0" }] });
    // r11: worded true for every cause (out of stock, hidden, a category /book does not draw, a mapping not live).
    expect(one?.description).toBe("1 item is set up for your store but not showing on it. Check its status, category, stock and visibility in the catalog.");
    expect(one?.actionLabel).toBe("Check the catalog");
    expect(one?.description).not.toMatch(/add/i);
    const two = await nothing({ products: [product("p0"), product("p1")], services: [{ id: "s_l0", sourceProductId: "p0" }, { id: "s_l1", sourceProductId: "p1" }] });
    expect(two?.description).toBe("2 items are set up for your store but not showing on it. Check their status, category, stock and visibility in the catalog.");
  });

  it("2 products off and not listed: plural", async () => {
    expect((await nothing({ products: [product("p0", false), product("p1", false)], services: [] }))?.actionLabel).toBe("Switch them on");
  });
});
