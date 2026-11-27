/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 11 (reviews of 164bd19, D-315 "no compromise"), under D-303.
 *
 *   R11-M  with what is on the store not known (the store graph or the storefront config not read), no copy states a
 *          total ("N items", "| N Item(s)"), a title naming the whole offer by its nouns ("— Service Online"), or
 *          "just getting started": only what is known, the counted services; in the hub, the AI Content panel and
 *          the AI Hero Copy panel
 *   R11-1  services not known (storeServices null: the config not read) are not counted, and the hub says nothing
 *          about what is on the store
 *   R11-2  "set up for your store but not showing on it" is true for each cause: out of stock, hidden by the
 *          storefront, a category /book does not draw, a mapping not live
 *   R11-c  clip(): never "..." alone (kept part all punctuation or whitespace: a hard cut of the first characters
 *          that are not whitespace); max 3 or less a plain cut; a whitespace-only text gives ""; a fuzz property
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

import { clip, liveProducts, bookableServices, offerWords } from "../storefront-counts";
import { AiContentPanel } from "../components/ai-content-panel";
import { AiHeroCopyPanel } from "../components/ai-hero-copy-panel";
import { MerchandisingMode } from "../components/merchandising-mode";
import { DesignMode } from "../components/design-mode";
import { useStoreAiHub, generateStoreSuggestions } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(/Generating/);
  await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}
function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  return result.current.tools.find((t) => t.id === id)!;
}
const product = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Item ${id}`, category: "PRODUCT", isActive: true, ...extra });
const listing = (pid: string) => ({ id: `s_l_${pid}`, sourceProductId: pid });
const SERVICE = { id: "s_t", name: "Tasting" };
/** 2 live products and 1 bookable service, the graph refused: what the store page gives the hub. */
const REFUSED = { storeName: "Pepper Co", products: [product("p0"), product("p1")], services: [listing("p0"), listing("p1"), SERVICE], storeProducts: null, storeServices: [SERVICE] };
// No trailing \b: a panel's text runs its options together ("| 1 ItemPepper Co Online").
const TOTAL = /\b\d+ [Ii]tems?(?![a-z])|getting started|— (Products?|Services?|Packages?)(?![a-z])[^|.]* Online|targeting its/;
const COPY_TOOLS = ["seo-generator", "launch-campaign-generator", "hero-copy-generator", "faq-generator"];

describe("R11-M: what is on the store not known: no total, only what is known", () => {
  it("the hub's copy tools, the graph not read: no total, only the 1 service", async () => {
    for (const id of COPY_TOOLS) {
      const out = JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: REFUSED }));
      expect(out, id).not.toMatch(TOTAL);
      expect(out, id).not.toMatch(/Pepper Co \| 1 Item|Browse our 1 item/);
    }
    expect(JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: REFUSED }))).toMatch(/Browse 1 service at Pepper Co\. Book online\./);
    expect(JSON.stringify(await hubTool("launch-campaign-generator").execute({ businessId: "biz_1", customData: REFUSED }))).toMatch(/Browse our 1 service\./);
    const email = ((await hubTool("launch-campaign-generator").execute({ businessId: "biz_1", customData: REFUSED })) as { emailBody: string }).emailBody;
    expect(email).toMatch(/We have 1 service available\./);
    expect(email).not.toMatch(/\n\n\n/);
  });

  it("the hub, nothing known: no count at all, no 'getting started'", async () => {
    const data = { ...REFUSED, storeServices: null };
    for (const id of COPY_TOOLS) {
      const out = JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: data }));
      expect(out, id).not.toMatch(TOTAL);
      expect(out, id).not.toMatch(/\b\d+ (services?|products?)\b/);
    }
    const email = ((await hubTool("launch-campaign-generator").execute({ businessId: "biz_1", customData: data })) as { emailBody: string }).emailBody;
    expect(email).not.toMatch(/We have|getting started|\n\n\n/);
  });

  it("known stores keep their totals (control)", async () => {
    const known = { ...REFUSED, storeProducts: [product("p0"), product("p1")] };
    expect(JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: known }))).toMatch(/Pepper Co \| 3 Items/);
    const email = ((await hubTool("launch-campaign-generator").execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", products: [], services: [], storeProducts: [], storeServices: [] } })) as { emailBody: string }).emailBody;
    expect(email).toMatch(/We're just getting started\./);
  });

  it("the AI Content panel, products not known: no total", async () => {
    for (const label of ["Generate SEO", "Launch Posts"]) {
      render(<AiContentPanel storeName="Pepper Co" servicesCount={1} productsCount={0} productsKnown={false} />);
      await generate(label);
      expect(text(), label).not.toMatch(TOTAL);
      cleanup();
    }
    render(<AiContentPanel storeName="Pepper Co" servicesCount={1} productsKnown={false} />);
    await generate("Launch Posts");
    expect(text()).toMatch(/Browse our 1 service\./);
  }, 30_000);

  it("the AI Hero Copy panel, products not known: no total", async () => {
    render(<AiHeroCopyPanel storeName="Pepper Co" servicesCount={1} productsKnown={false} onApply={() => {}} />);
    await generate("Generate");
    for (const b of screen.queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 300));
    expect(text()).not.toMatch(TOTAL);
    expect(text()).toMatch(/Discover 1 service from Pepper Co/);
  });

  it("the Merchandising tab, given the store view not known, passes it to the AI panel", async () => {
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={[SERVICE] as never}
        commerceProducts={[]}
        liveProductIds={new Set()}
        storeView={{ productsKnown: false, servicesKnown: true }}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials={false}
      />,
    );
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate SEO");
    const panel = (screen.getByText("Generate FAQ").closest(".rounded-2xl")?.textContent ?? "").replace(/\s+/g, " ");
    expect(panel).not.toMatch(TOTAL);
    expect(panel).toMatch(/Browse 1 service at Pepper Co\./);
  });
  it("the Design tab, given the store view not known, passes it to the AI Hero Copy panel", async () => {
    render(
      <DesignMode
        businessData={{ name: "Pepper Co" }}
        services={[{ ...SERVICE, price: 5, currency: "TTD" }] as never}
        commerceProducts={[product("p0", { price: 5, currency: "TTD" })] as never}
        liveProductIds={new Set(["p0"])}
        storeView={{ productsKnown: false, servicesKnown: true }}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        slug="pepper-co"
      />,
    );
    fireEvent.click(screen.getByText("AI Hero Copy"));
    await generate("Generate");
    expect(text()).not.toMatch(TOTAL);
    expect(text()).toMatch(/Browse 1 service\. Book online\./);
  });
});

describe("R11-M: offerWords counts only what is known", () => {
  const ALL = { products: 2, packages: 1, services: 3, orderableServices: 4 };
  it("products not known: no product, package or bought service is counted", () => {
    const w = offerWords({ ...ALL, productsKnown: false });
    expect([w.partial, w.total, w.counted, w.shops, w.buys, w.books]).toEqual([true, 3, "3 services", false, false, true]);
  });
  it("services not known: no booked service is counted", () => {
    const w = offerWords({ ...ALL, servicesKnown: false });
    expect([w.partial, w.total, w.counted, w.books, w.buys]).toEqual([true, 7, "2 products, 1 package and 4 services", false, true]);
  });
  it("neither known: nothing counted; both known: everything (control)", () => {
    const none = offerWords({ ...ALL, productsKnown: false, servicesKnown: false });
    expect([none.partial, none.total, none.counted, none.action]).toEqual([true, 0, "", ""]);
    const all = offerWords(ALL);
    expect([all.partial, all.total, all.counted]).toEqual([false, 10, "2 products, 1 package and 7 services"]);
  });
});

describe("R11-1: services not known", () => {
  it("the copy counts none of them, and the hub says nothing about what is on the store", async () => {
    const data = { storeName: "Pepper Co", products: [], services: [SERVICE], storeProducts: [], storeServices: null };
    expect(JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: data }))).not.toMatch(/\b1 service\b|Book online/);
    const out = await generateStoreSuggestions({ businessId: "biz_1", activeView: "catalog", customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, ...data } } as never);
    expect(out.map((s) => s.title)).not.toContain("Nothing on Your Store Yet");
  });
});

describe("R11-2: 'set up for your store but not showing on it', true for each cause", () => {
  const WANT = "1 item is set up for your store but not showing on it. Check its status, category, stock and visibility in the catalog.";
  const causes: { name: string; product: Record<string, unknown>; live: string[]; stock?: Map<string, { quantity: number; reserved: number }>; config?: Record<string, unknown> }[] = [
    { name: "out of stock", product: product("p0", { inventoryMode: "tracked" }), live: ["p0"], stock: new Map() },
    { name: "hidden by the storefront", product: product("p0"), live: ["p0"], config: { catalog: { itemOverrides: { p0: { visibilityRule: "hidden" } } } } },
    { name: "a category /book does not draw", product: product("p0", { category: "OTHER" }), live: ["p0"] },
    { name: "a mapping not live (draft)", product: product("p0"), live: [] },
  ];
  for (const c of causes) {
    it(c.name, async () => {
      const services = [listing("p0")];
      const storeProducts = liveProducts([c.product as never], new Set(c.live), { services, stock: c.stock, storefrontConfig: c.config as never });
      expect(storeProducts).toEqual([]);
      const out = await generateStoreSuggestions({
        businessId: "biz_1",
        activeView: "catalog",
        customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, products: [c.product], services, storeProducts, storeServices: bookableServices(services, c.config as never) },
      } as never);
      expect(out.find((s) => s.title === "Nothing on Your Store Yet")?.description).toBe(WANT);
    });
  }
});

describe("R11-c: clip()", () => {
  it("never '...' alone", () => {
    expect(clip("—— Supercalifragilistic", 10)).toBe("—— Supe...");
    expect(clip("!!!!!!!!!!!!", 5)).toBe("!!...");
    expect(clip("          ", 5)).toBe("");
  });

  it("max 3 or less: a plain cut", () => {
    expect(clip("abcdef", 3)).toBe("abc");
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("ab cd", 3)).toBe("ab ");
  });

  it("fuzz: at most max characters, whole when it fits, never '...' alone, no lone surrogate, from the text", () => {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);
    const ALPHABET = ["a", "b", "é", "🌶️", "👨‍👩‍👧", " ", String.fromCharCode(0xa0), String.fromCharCode(0x3000), "\t", ",", ".", "—", "!"];
    let seed = 0x2a31;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (let n = 0; n < 3000; n++) {
      const t = Array.from({ length: Math.floor(rand() * 24) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
      const max = Math.floor(rand() * 16);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      expect(G(out).length, at).toBeLessThanOrEqual(max);
      expect(lone.test(out), at).toBe(false);
      if (G(t).length <= max) {
        expect(out, at).toBe(t);
        continue;
      }
      if (max <= 3) {
        expect(out, at).toBe(G(t).slice(0, max).join(""));
        continue;
      }
      if (t.trim() === "") {
        expect(out, at).toBe("");
        continue;
      }
      expect(out.endsWith("..."), at).toBe(true);
      const kept = out.slice(0, -3);
      expect(kept.trim(), at).not.toBe("");
      expect(t.includes(kept), at).toBe(true);
    }
  });
});
