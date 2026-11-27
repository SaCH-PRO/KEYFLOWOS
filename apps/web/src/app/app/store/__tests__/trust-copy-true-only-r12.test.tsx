/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 12 (reviews of 27e275b, D-315 "no compromise"), under D-303.
 *
 *   R12-M  a partial count names only what it counts: with the products not known, the services counted are the
 *          bookable ones, and a SERVICE-category product (a service, bought) may be on the store too: "1 service to
 *          book", never "1 service" for a store offering 2; with the services not known, the bought ones: "1 service
 *          to buy"; in the hub, the AI Content panel and the AI Hero Copy panel
 *   R12-4  the Design and Merchandising tabs pass servicesKnown through: the config not read, no services count
 *   R12-5  a store view not given (storeProducts, storeServices undefined) is not known, as null is: never the whole
 *          catalog counted in its place
 *   R12-c  clip(): a "%", a closing bracket or quote stay before the "..." (only whitespace, sentence punctuation and
 *          an opening bracket or quote are dropped); the hard-cut fallback leaves no whitespace before the "...", and
 *          no punctuation-only part unless the text has nothing else; a fuzz property
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

import { clip, liveProducts, bookableServices } from "../storefront-counts";
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
const COPY_TOOLS = ["seo-generator", "launch-campaign-generator", "hero-copy-generator", "faq-generator"];
/** A count of services that does not say which: "1 service", "2 services", not followed by "to book" or "to buy". */
const BARE_SERVICES = /\b\d+ services?(?! to (book|buy))(?![a-z])/;
const ANY_SERVICES = /\b\d+ services?(?![a-z])/;

const TASTING = { id: "s_t", name: "Tasting", price: 5, currency: "TTD" };
const FACIAL = { id: "p_f", name: "Facial", category: "SERVICE", isActive: true, price: 5, currency: "TTD" };
const FACIAL_LISTING = { id: "s_l_f", name: "Facial", sourceProductId: "p_f" };
// /book shows both: 1 bookable service (Tasting) and 1 SERVICE-category product, bought (Facial): 2 services.
const ON_BOOK = liveProducts([FACIAL], new Set(["p_f"]), { services: [TASTING, FACIAL_LISTING] });

describe("R12-M: a partial count names only what it counts", () => {
  it("(control) /book shows the 2: 1 bookable service and 1 bought", () => {
    expect(ON_BOOK.map((p) => p.id)).toEqual(["p_f"]);
    expect(bookableServices([TASTING, FACIAL_LISTING]).map((s) => s.id)).toEqual(["s_t"]);
  });

  it("the hub, products not known (the graph not read): '1 service to book', never '1 service' for a store offering 2", async () => {
    const data = { storeName: "Pepper Co", products: [FACIAL], services: [TASTING, FACIAL_LISTING], storeProducts: null, storeServices: [TASTING] };
    for (const id of COPY_TOOLS) expect(JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: data })), id).not.toMatch(BARE_SERVICES);
    const seo = JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: data }));
    expect(seo).toMatch(/Pepper Co offers 1 service to book online\. Book online\./);
    const launch = (await hubTool("launch-campaign-generator").execute({ businessId: "biz_1", customData: data })) as { emailBody: string };
    expect(JSON.stringify(launch)).toMatch(/Browse our 1 service to book\./);
    expect(launch.emailBody).toMatch(/We have 1 service to book available\./);
  });

  it("the hub, services not known (the config not read), products known: '1 service to buy', never '1 service'", async () => {
    const data = { storeName: "Pepper Co", products: [FACIAL], services: [TASTING, FACIAL_LISTING], storeProducts: ON_BOOK, storeServices: null };
    for (const id of COPY_TOOLS) expect(JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: data })), id).not.toMatch(BARE_SERVICES);
    const seo = JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: data }));
    expect(seo).toMatch(/Pepper Co offers 1 service to buy online\. Buy online\./);
    expect(seo).not.toMatch(/Book online/);
  });

  it("(control) both known: '2 services', the whole count", async () => {
    const data = { storeName: "Pepper Co", products: [FACIAL], services: [TASTING, FACIAL_LISTING], storeProducts: ON_BOOK, storeServices: [TASTING] };
    expect(JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: data }))).toMatch(/Pepper Co offers 2 services online\. Book or buy online\./);
  });

  for (const [name, known, words] of [
    ["products not known", { productsKnown: false }, "1 service to book"],
    ["services not known", { servicesKnown: false }, "1 service to buy"],
  ] as const) {
    it(`the AI Content panel, ${name}: '${words}'`, async () => {
      for (const label of ["Generate SEO", "Launch Posts"]) {
        render(<AiContentPanel storeName="Pepper Co" servicesCount={1} orderableServicesCount={1} {...known} />);
        await generate(label);
        expect(text(), label).not.toMatch(BARE_SERVICES);
        expect(text(), label).toContain(words);
        cleanup();
      }
    }, 30_000);

    it(`the AI Hero Copy panel, ${name}: '${words}'`, async () => {
      render(<AiHeroCopyPanel storeName="Pepper Co" servicesCount={1} orderableServicesCount={1} {...known} onApply={() => {}} />);
      await generate("Generate");
      for (const b of screen.queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
      await new Promise((r) => setTimeout(r, 300));
      expect(text()).not.toMatch(BARE_SERVICES);
      expect(text()).toMatch(new RegExp(`Discover ${words} from Pepper Co`));
    });
  }
});

describe("R12-4: the tabs pass servicesKnown through: the config not read, no services count", () => {
  const TWO = [TASTING, { id: "s_m", name: "Massage", price: 5, currency: "TTD" }];
  const NOT_READ = { productsKnown: false, servicesKnown: false };

  it("the Merchandising tab's AI Content panel", async () => {
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={TWO as never}
        commerceProducts={[]}
        liveProductIds={new Set()}
        storeView={NOT_READ}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials={false}
      />,
    );
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    for (const label of ["Generate SEO", "Launch Posts"]) {
      await generate(label);
      const panel = (screen.getByText("Generate FAQ").closest(".rounded-2xl")?.textContent ?? "").replace(/\s+/g, " ");
      expect(panel, label).not.toMatch(ANY_SERVICES);
      expect(panel, label).toMatch(/Pepper Co/);
    }
  }, 30_000);

  it("the Design tab's AI Hero Copy panel", async () => {
    render(
      <DesignMode
        businessData={{ name: "Pepper Co" }}
        services={TWO as never}
        commerceProducts={[]}
        liveProductIds={new Set()}
        storeView={NOT_READ}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        slug="pepper-co"
      />,
    );
    fireEvent.click(screen.getByText("AI Hero Copy"));
    await generate("Generate");
    for (const b of screen.queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 300));
    const panel = (screen.getByText("Apply to Hero Section").closest(".rounded-2xl")?.textContent ?? text()).replace(/\s+/g, " ");
    expect(panel).toMatch(/Pepper Co/);
    expect(panel).not.toMatch(ANY_SERVICES);
  });
});

describe("R12-5: a store view not given is not known", () => {
  const CATALOG = { storeName: "Pepper Co", products: [{ id: "p0", category: "PRODUCT" }, { id: "p1", category: "PRODUCT" }], services: [TASTING] };

  it("the hub's copy tools count none of the catalog", async () => {
    for (const id of COPY_TOOLS) {
      const out = JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: CATALOG }));
      expect(out, id).not.toMatch(/\b\d+ (products?|services?|packages?|items?|Items?)(?![a-z])|getting started/);
    }
  });

  it("only storeServices given: the bookable ones counted, by their own noun, and no total", async () => {
    const out = JSON.stringify(await hubTool("seo-generator").execute({ businessId: "biz_1", customData: { ...CATALOG, storeServices: [TASTING] } }));
    expect(out).toMatch(/1 service to book/);
    expect(out).not.toMatch(/\b\d+ (products?|items?|Items?)(?![a-z])|\b\d+ services?(?! to book)/);
  });

  it("the hub says nothing about what is on the store", async () => {
    // (control) with both lists given and nothing on the store, it does
    const known = await generateStoreSuggestions({ businessId: "biz_1", activeView: "catalog", customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, products: [{ id: "p0", category: "PRODUCT", isActive: true }], services: [], storeProducts: [], storeServices: [] } } as never);
    expect(known.map((s) => s.title)).toContain("Nothing on Your Store Yet");
    for (const view of [{}, { storeProducts: [] }, { storeServices: [] }]) {
      const out = await generateStoreSuggestions({ businessId: "biz_1", activeView: "catalog", customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, products: [{ id: "p0", category: "PRODUCT", isActive: true }], services: [], ...view } } as never);
      // A catalog that is not empty, so the "Empty Catalog" tip does not stand in front of the one under test.
      expect(out.map((s) => s.title), JSON.stringify(view)).not.toContain("Empty Catalog");
      expect(out.map((s) => s.title), JSON.stringify(view)).not.toContain("Nothing on Your Store Yet");
    }
  });
});

describe("R12-c: clip()", () => {
  it("a '%', a closing bracket or quote stay before the '...'", () => {
    expect(clip("Get 50% off today", 10)).toBe("Get 50%...");
    expect(clip("Sale (50% off) now", 17)).toBe("Sale (50% off)...");
    expect(clip('She said "go" today', 16)).toBe('She said "go"...');
    expect(clip("Hot “sauce” for all", 14)).toBe("Hot “sauce”...");
  });

  it("whitespace, sentence punctuation and an opening bracket or quote are dropped", () => {
    expect(clip("Deals ( today only", 10)).toBe("Deals...");
    expect(clip("Deals “ today only", 10)).toBe("Deals...");
    expect(clip("Fresh, hot sauces", 10)).toBe("Fresh...");
    expect(clip("Wait! — More", 10)).toBe("Wait...");
  });

  it("the hard-cut fallback: no whitespace and no punctuation-only part before the '...' unless the text has nothing else", () => {
    expect(clip("— a—!!", 5)).toBe("a...");
    expect(clip("!!!!!! abc", 6)).toBe("abc...");
    expect(clip("—— Supercal", 6)).toBe("Sup...");
    expect(clip("—— Supercalifragilistic", 10)).toBe("—— Supe...");
    expect(clip("!!!! !!!!", 6)).toBe("!!!...");
    expect(clip("— —— —— ", 7)).toBe("— ——...");
    expect(clip("——  ———", 6)).toBe("——...");
  });

  it("fuzz: no whitespace before the '...'; a part with a letter, digit or symbol whenever the text has one", () => {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);
    const ALPHABET = ["a", "é", "5", "🌶️", " ", String.fromCharCode(0xa0), "\t", ",", ".", "—", "!", "%", "(", ")", '"', "“", "”"];
    const content = /[^\s\p{P}]/u;
    let seed = 0x3112;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 4000; n++) {
      const t = Array.from({ length: Math.floor(rand() * 20) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
      const max = 4 + Math.floor(rand() * 12);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      expect(G(out).length, at).toBeLessThanOrEqual(max);
      if (G(t).length <= max || t.trim() === "") continue;
      expect(out.endsWith("..."), at).toBe(true);
      const kept = out.slice(0, -3);
      expect(kept, at).not.toMatch(/\s$/u);
      expect(t.includes(kept), at).toBe(true);
      if (content.test(t)) {
        expect(kept, at).toMatch(content);
        expect(kept, at).not.toMatch(/[.,;:!?…—–\-([{“‘«]$/u);
      } else {
        expect(kept, at).not.toBe("");
      }
    }
  });
});
