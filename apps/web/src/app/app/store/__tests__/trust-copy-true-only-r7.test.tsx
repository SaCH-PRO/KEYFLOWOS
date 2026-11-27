/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 7 (reviews of cc16d7a), under D-303: the copy names and counts the store
 * the way /book shows it, and every save that writes FAQ entries with placeholders says so.
 *
 *   R7-1  nouns: /book draws a commerce product by its category: PRODUCT a product, PACKAGE a package, SERVICE (the
 *         default) a service, bought, not booked; a bookable service is booked. The copy names each kind so, and its
 *         verbs follow: "2 services. Buy online." for 2 default-category products, never "2 products"
 *   R7-2  hiding: a SERVICE-category product with a bookable service's name, a tracked product out of stock with
 *         behaviour "hide" (the default), and an item the storefront's catalog override hides are not counted
 *   R7-3  the analysis tools read the whole catalog: "Empty Catalog" only when it is empty; with items but none on the
 *         store, "add them to your store"; "N Items Missing Images" over the catalog
 *   R7-4  singular and plural for every count-bearing string
 *   R7-5  the AI Hero Copy panel: "1 option"; "Explore Collection" and "Shop Now" never for services only
 *   R7-7  FAQ answers: no "Book Now" (/book has none; a service is added and its time chosen at checkout), no
 *         "processed at checkout" (cash or manual payment is always offered)
 *   R7-8  the allowlist over a large store, a store with a description and tagline, and every mix of kinds
 *   R7-9  the write paths: Add All copies the answers as generated; the FAQ Manager's warning counts a realistic
 *         Add All; the Save Policies and Design saves warn too, without blocking the save
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

import { offerOf, offerWords, storefrontOffer, liveProducts, counted, type StockByProduct } from "../storefront-counts";
import { AiContentPanel } from "../components/ai-content-panel";
import { AiHeroCopyPanel } from "../components/ai-hero-copy-panel";
import { DesignMode } from "../components/design-mode";
import { FaqManager } from "../components/faq-manager";
import { MerchandisingMode } from "../components/merchandising-mode";
import { PolicyEditor } from "../components/policy-editor";
import { useStoreAiHub, generateStoreSuggestions } from "../hooks/use-store-ai-hub";
import { ALLOWED, strings, textNodes } from "./trust-copy-allowlist";

afterEach(() => cleanup());

const LONG = 60_000;
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(/Generating/);
  await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}
function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool;
}
type Data = Record<string, unknown>;
const hub = async (id: string, data: Data) => hubTool(id).execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", ...data } });
const hubText = async (id: string, data: Data) => JSON.stringify(await hub(id, data));
const products = (n: number, category?: string, prefix = "p") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} item ${i}`, price: 10, ...(category ? { category } : {}) }));
const bookable = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Session ${i}`, price: 20 }));
const COPY_TOOLS = ["faq-generator", "seo-generator", "launch-campaign-generator", "hero-copy-generator", "trust-copy-generator"];

const merch = (props: { commerceProducts: unknown[]; live: string[]; services?: unknown[]; stock?: StockByProduct | null; config?: Data }) =>
  render(
    <MerchandisingMode
      businessData={{ name: "Pepper Co" }}
      services={(props.services ?? []) as never}
      commerceProducts={props.commerceProducts as never}
      liveProductIds={new Set(props.live)}
      stockByProduct={props.stock}
      storefrontConfig={(props.config ?? {}) as never}
      onConfigChange={vi.fn()}
      onSaveConfig={vi.fn(async () => {})}
      configSaving={false}
      publicUrl="https://example.test/book/pepper-co"
      hasTestimonials={false}
    />,
  );

describe("R7-1: each kind named as /book names it, with its verbs", () => {
  it("offerOf: PRODUCT, PACKAGE and SERVICE (the default) products, and bookable services", () => {
    const list = [{ category: "PRODUCT" }, { category: "PACKAGE" }, { category: "SERVICE", name: "Massage" }, { name: "Facial" }, { category: "OTHER" }];
    expect(offerOf(list, [{ name: "Haircut" }])).toEqual({ products: 1, packages: 1, services: 1, orderableServices: 2 });
  });

  it("offerWords for every mix", () => {
    const cases: [Data, string, string, { shops: boolean; books: boolean; buys: boolean }][] = [
      [{ products: 2 }, "2 products", "Buy online.", { shops: true, books: false, buys: true }],
      [{ products: 1 }, "1 product", "Buy online.", { shops: true, books: false, buys: true }],
      [{ packages: 1 }, "1 package", "Buy online.", { shops: true, books: false, buys: true }],
      [{ packages: 3 }, "3 packages", "Buy online.", { shops: true, books: false, buys: true }],
      [{ orderableServices: 2 }, "2 services", "Buy online.", { shops: false, books: false, buys: true }],
      [{ orderableServices: 1 }, "1 service", "Buy online.", { shops: false, books: false, buys: true }],
      [{ services: 2 }, "2 services", "Book online.", { shops: false, books: true, buys: false }],
      [{ services: 1, orderableServices: 1 }, "2 services", "Book or buy online.", { shops: false, books: true, buys: true }],
      [{ products: 1, packages: 2, services: 3 }, "1 product, 2 packages and 3 services", "Book or buy online.", { shops: true, books: true, buys: true }],
      [{ products: 2, orderableServices: 1 }, "2 products and 1 service", "Buy online.", { shops: true, books: false, buys: true }],
      [{}, "", "", { shops: false, books: false, buys: false }],
    ];
    for (const [o, want, action, flags] of cases) {
      const w = offerWords(o);
      expect(w.counted, JSON.stringify(o)).toBe(want);
      expect(w.action, JSON.stringify(o)).toBe(action);
      expect({ shops: w.shops, books: w.books, buys: w.buys }, JSON.stringify(o)).toEqual(flags);
    }
  });

  it("the panel, given 2 live default-category products: '2 services', bought, no product, shop or book", async () => {
    for (const label of ["Generate SEO", "Launch Posts"]) {
      merch({ commerceProducts: products(2), live: ["p0", "p1"] });
      fireEvent.click(screen.getByText("AI Content Intelligence"));
      await generate(label);
      // the AI panel's own text (the merchandising view around it has its own catalog stats)
      const t = (screen.getByText("Generate FAQ").closest(".rounded-2xl")?.textContent ?? "").replace(/\s+/g, " ");
      if (label === "Generate SEO") expect(t).toMatch(/Browse 2 services at Pepper Co\. Buy online\./);
      expect(t, label).not.toMatch(/\bproducts?\b(?! Descriptions)|\bshop\b|\bbook/i);
      cleanup();
    }
  }, LONG);

  it("the panel, given a package: '1 package'", async () => {
    merch({ commerceProducts: products(1, "PACKAGE"), live: ["p0"] });
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate SEO");
    expect(text()).toMatch(/Browse 1 package at Pepper Co\. Buy online\./);
  });

  it("the hub, for every mix", async () => {
    const mixes: [Data, RegExp][] = [
      [{ products: products(2) }, /Browse 2 services at Pepper Co\. Buy online\./],
      [{ products: products(2, "PRODUCT") }, /Browse 2 products at Pepper Co\. Buy online\./],
      [{ products: products(1, "PACKAGE") }, /Browse 1 package at Pepper Co\. Buy online\./],
      [{ products: [...products(1, "PRODUCT"), ...products(2, "PACKAGE", "k")], services: bookable(1) }, /Browse 1 product, 2 packages and 1 service at Pepper Co\. Book or buy online\./],
      [{ products: products(1, "SERVICE"), services: bookable(1) }, /Browse 2 services at Pepper Co\. Book or buy online\./],
    ];
    for (const [data, want] of mixes) expect(await hubText("seo-generator", data), JSON.stringify(data)).toMatch(want);
    const services = await hubText("hero-copy-generator", { products: products(2) });
    expect(services).not.toMatch(/Shop|Explore Collection|\bproducts?\b|\bbook/i);
    expect(services).toMatch(/Discover 2 services from Pepper Co/);
  });

  it("the hero panel, through the Design tab, given 2 live default-category products", async () => {
    render(
      <DesignMode
        businessData={{ name: "Pepper Co" }}
        services={[]}
        commerceProducts={products(2) as never}
        liveProductIds={new Set(["p0", "p1"])}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        slug="pepper-co"
      />,
    );
    fireEvent.click(screen.getAllByText("AI Hero Copy")[0]);
    const button = (await screen.findByText("Generate")).closest("button")!;
    const panel = button.parentElement!.parentElement!;
    fireEvent.click(button);
    await waitFor(() => expect(within(panel).queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
    for (const b of within(panel).queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 300));
    const t = (panel.textContent ?? "").replace(/\s+/g, " ");
    expect(t).toMatch(/Browse 2 services\. Buy online\./);
    expect(t).not.toMatch(/Shop Now|Explore Collection|\bproducts?\b|Book Today/);
  }, LONG);
});

describe("R7-2: what /book hides is not counted", () => {
  it("'Haircut' as a bookable service and as a SERVICE-category product counts once", () => {
    const services = [{ id: "s_hair", name: "Haircut" }, { id: "s_l", name: "Haircut", sourceProductId: "p_hair" }];
    const offer = storefrontOffer(services, [{ id: "p_hair", name: "Haircut", category: "SERVICE" }], new Set(["p_hair"]));
    expect(offerWords(offer).total).toBe(1);
    expect(offerWords(offer).counted).toBe("1 service");
    expect(offerWords(offer).action).toBe("Book online.");
  });

  it("3 live products, 1 tracked and out of stock (behaviour 'hide', the default): 2; shown out of stock or on backorder: 3", () => {
    const list = [...products(3, "PRODUCT")];
    const live = new Set(["p0", "p1", "p2"]);
    const stock: StockByProduct = new Map([["p2", { quantity: 1, reserved: 1 }]]);
    expect(offerWords(storefrontOffer([], list, live, { stock })).total).toBe(2);
    const tracked = list.map((p) => (p.id === "p1" ? { ...p, inventoryMode: "tracked" } : p));
    expect(offerWords(storefrontOffer([], tracked, live, { stock: new Map() })).total).toBe(2);
    for (const behaviour of ["show_oos", "allow_backorder"]) {
      const shown = list.map((p) => (p.id === "p2" ? { ...p, outOfStockBehavior: behaviour } : p));
      expect(offerWords(storefrontOffer([], shown, live, { stock })).total, behaviour).toBe(3);
    }
    expect(offerWords(storefrontOffer([], list, live, { stock: new Map([["p2", { quantity: 3, reserved: 1 }]]) })).total).toBe(3);
    expect(offerWords(storefrontOffer([], list, live, { stock: null })).total).toBe(3);
  });

  it("an item the storefront's catalog override hides is not counted, product or service", () => {
    const config = { catalog: { itemOverrides: { p1: { visibilityRule: "hidden" }, s0: { visibilityRule: "hidden" } } } } as never;
    const offer = storefrontOffer(bookable(2), products(2, "PRODUCT"), new Set(["p0", "p1"]), { storefrontConfig: config });
    expect(offer).toEqual({ products: 1, packages: 0, services: 1, orderableServices: 0 });
  });

  it("liveProducts leaves out a category /book does not draw", () => {
    expect(liveProducts([{ id: "a", category: "OTHER" }, { id: "b", category: "PACKAGE" }], new Set(["a", "b"])).map((p) => p.id)).toEqual(["b"]);
  });

  it("the panel, through the merchandising view, counts with the stock: 3 live, 1 hidden for stock, says 2", async () => {
    merch({ commerceProducts: products(3, "PRODUCT"), live: ["p0", "p1", "p2"], stock: new Map([["p2", { quantity: 0, reserved: 0 }]]) });
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate SEO");
    expect(text()).toMatch(/Browse 2 products at Pepper Co\./);
  });

  it("the hub's copy tools, given the store page's lists", async () => {
    const services = [{ id: "s_hair", name: "Haircut" }];
    expect(await hubText("seo-generator", { products: [], services: [], storeProducts: [{ id: "p_hair", name: "Haircut", category: "SERVICE" }], storeServices: services })).toMatch(/Browse 1 service at Pepper Co\. Book online\./);
  });
});

describe("R7-3: the analysis reads the whole catalog", () => {
  const suggest = (data: Data) => generateStoreSuggestions({ businessId: "biz_1", activeView: "catalog", customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, ...data } } as never);
  const titles = async (data: Data) => (await suggest(data)).map((s) => s.title);

  it("'Empty Catalog' only when the catalog is empty", async () => {
    expect(await titles({ products: [], services: [], storeProducts: [], storeServices: [] })).toContain("Empty Catalog");
    const some = await suggest({ products: products(3, "PRODUCT"), services: [], storeProducts: [], storeServices: [] });
    expect(some.map((s) => s.title)).not.toContain("Empty Catalog");
    const none = some.find((s) => s.title === "Nothing on Your Store Yet");
    expect(none?.description).toMatch(/Your catalog has 3 items, but none is on your store yet\. Add them to your store/);
    expect(none?.actionLabel).toBe("Add them to your store");
  });

  it("no 'Nothing on Your Store' when something is on it, or when the store's view is not given", async () => {
    expect(await titles({ products: products(3, "PRODUCT"), services: [], storeProducts: products(1, "PRODUCT"), storeServices: [] })).not.toContain("Nothing on Your Store Yet");
    expect(await titles({ products: products(3, "PRODUCT"), services: [], storeProducts: [], storeServices: bookable(1) })).not.toContain("Nothing on Your Store Yet");
    expect(await titles({ products: products(3, "PRODUCT"), services: [] })).not.toContain("Nothing on Your Store Yet");
  });

  it("'N Items Missing Images' counts the catalog, singular for one", async () => {
    expect(await titles({ products: products(3, "PRODUCT"), storeProducts: [] })).toContain("3 Items Missing Images");
    expect(await titles({ products: products(1, "PRODUCT"), storeProducts: [] })).toContain("1 Item Missing Images");
  });

  it("the Pricing Advisor reads the catalog's prices, not only what is on the store", async () => {
    const out = await hubText("pricing-advisor", { products: products(3, "PRODUCT"), storeProducts: [] });
    expect(out).not.toMatch(/No priced products found/);
  });
});

describe("R7-4: singular and plural for every count-bearing string", () => {
  it("counted()", () => {
    expect(counted(1, "item")).toBe("1 item");
    expect(counted(2, "item")).toBe("2 items");
    expect(counted(1, "FAQ entry", "FAQ entries")).toBe("1 FAQ entry");
    expect(counted(7, "FAQ entry", "FAQ entries")).toBe("7 FAQ entries");
  });

  it("the hub's hero summary", async () => {
    const empty = (await hub("hero-copy-generator", {})) as { summary: string };
    expect(empty.summary).toBe("Generated 1 headline option, 1 subheadline, 3 ribbon options, and 1 CTA for Pepper Co.");
    const both = (await hub("hero-copy-generator", { products: products(2, "PRODUCT"), services: bookable(1) })) as { summary: string };
    expect(both.summary).toBe("Generated 2 headline options, 2 subheadlines, 3 ribbon options, and 4 CTAs for Pepper Co.");
  });

  it("the hub's FAQ, SEO, launch, trust and hero counts, 1 and 2", async () => {
    const faq = (await hub("faq-generator", {})) as { summary: string };
    expect(faq.summary).toMatch(/^Generated 3 FAQ entries for/);
    for (const [n, item, Item] of [[1, "1 item", "1 Item"], [2, "2 items", "2 Items"]] as const) {
      const data = { products: products(n, "PRODUCT") };
      expect(await hubText("launch-campaign-generator", data)).toMatch(new RegExp(`Browse our ${item}\\.`));
      expect(await hubText("launch-campaign-generator", data)).toMatch(new RegExp(`We have ${item} available\\.`));
      expect(await hubText("hero-copy-generator", data)).toMatch(new RegExp(`${item}, online\\.`));
      expect(await hubText("seo-generator", data)).toMatch(new RegExp(`Pepper Co \\| ${Item}"`));
      expect(await hubText("seo-generator", data)).toMatch(new RegExp(`Browse ${n} products?(?!s) at`));
    }
    for (const [n, word] of [[1, "testimonial"], [2, "testimonials"]] as const) {
      const out = (await hub("trust-copy-generator", { testimonials: Array.from({ length: n }, (_, i) => ({ id: `t${i}` })) })) as { summary: string; trustBadges: string[]; socialProofCopy: string[] };
      expect(out.summary).toMatch(new RegExp(`from its ${n} ${word}\\.`));
      expect(out.trustBadges).toEqual([n === 1 ? "1 customer review" : "2 customer reviews"]);
      expect(out.socialProofCopy).toEqual([n === 1 ? "Read 1 review from our customers." : "Read 2 reviews from our customers."]);
    }
  });

  it("the panel's counts, 1 and 2", async () => {
    for (const [n, item, Item] of [[1, "1 item", "1 Item"], [2, "2 items", "2 Items"]] as const) {
      render(<AiContentPanel storeName="Pepper Co" productsCount={n} />);
      await generate("Launch Posts");
      expect(text()).toMatch(new RegExp(`Browse our ${item}\\.`));
      cleanup();
      render(<AiContentPanel storeName="Pepper Co" productsCount={n} />);
      await generate("Generate SEO");
      expect(text()).toMatch(new RegExp(`Pepper Co \\| ${Item}(?!s)`));
      expect(text()).toMatch(new RegExp(`Browse ${n} products?(?!s) at`));
      cleanup();
    }
  }, LONG);

  it("the save warning outside the FAQ Manager, 1 and 2", () => {
    const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, question: `Q${i}?`, answer: "[your refund policy]", order: i }));
    render(<PolicyEditor config={{ faqEntries: entries(1) } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);
    expect(screen.getByRole("alert").textContent).toBe("1 FAQ entry still has a [bracketed] part: saving here saves it as it is. Fill it in in the FAQ Manager (Merchandising → FAQ & Policies).");
    cleanup();
    render(<PolicyEditor config={{ faqEntries: entries(2) } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);
    expect(screen.getByRole("alert").textContent).toBe("2 FAQ entries still have a [bracketed] part: saving here saves them as they are. Fill them in in the FAQ Manager (Merchandising → FAQ & Policies).");
  });
});

describe("R7-5: the AI Hero Copy panel", () => {
  async function hero(props: Data) {
    render(<AiHeroCopyPanel storeName="Pepper Co" onApply={() => {}} {...props} />);
    await generate("Generate");
  }

  it("'1 option' for a list of one, '2 options' for two, never '1 options'", async () => {
    await hero({});
    expect(screen.getAllByText("1 option").length).toBeGreaterThan(0);
    expect(text()).not.toMatch(/\b1 options\b/);
    cleanup();
    await hero({ servicesCount: 2 });
    expect(screen.getAllByText("2 options").length).toBeGreaterThan(0);
  });

  it("never 'Explore Collection' or 'Shop Now' for services only, booked or bought", async () => {
    for (const props of [{ servicesCount: 2 }, { orderableServicesCount: 2 }, { servicesCount: 1, orderableServicesCount: 1 }]) {
      await hero(props);
      for (const b of screen.queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
      await new Promise((r) => setTimeout(r, 300));
      expect(text(), JSON.stringify(props)).not.toMatch(/Explore Collection|Shop Now|Shop Today/);
      cleanup();
    }
  }, LONG);

  it("and offers them for products or packages", async () => {
    for (const props of [{ productsCount: 1 }, { packagesCount: 1 }]) {
      await hero(props);
      fireEvent.click(screen.getAllByText(/^\d+ options?$/).at(-1)!);
      await new Promise((r) => setTimeout(r, 300));
      expect(text(), JSON.stringify(props)).toMatch(/Explore Collection/);
      cleanup();
    }
  }, LONG);
});

describe("R7-7: FAQ answers say what /book does", () => {
  const FALSE = /Book Now|processed at checkout/i;

  it("the panel", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={1} servicesCount={1} hasDelivery />);
    await generate("Generate FAQ");
    expect(text()).not.toMatch(FALSE);
    expect(text()).toContain("Add the service you want, then choose a date and time at checkout to complete your booking.");
    expect(text()).toContain("We accept [your payment methods].");
  });

  it("the hub", async () => {
    const out = (await hub("faq-generator", { products: products(1, "PRODUCT"), services: bookable(1), activeDeliveryCount: 1 })) as { faqs: { question: string; answer: string }[] };
    expect(JSON.stringify(out)).not.toMatch(FALSE);
    const answer = (q: RegExp) => out.faqs.find((f) => q.test(f.question))?.answer;
    expect(answer(/How do I book/)).toBe("Add the service you want, then choose a date and time at checkout to complete your booking.");
    expect(answer(/payment/)).toBe("We accept [your payment methods].");
  });

  it("neither is an allowed string", () => {
    for (const s of ALLOWED) expect(s, s).not.toMatch(FALSE);
  });
});

describe("R7-8: the allowlist over large and described stores, and every mix", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Critic ${i}`, text: "Ok.", rating: 5 }));
  const SHAPES: { name: string; hub: Data; panel: Data; hero: Data }[] = [
    {
      name: "large",
      hub: { products: products(8, "PRODUCT"), services: bookable(4), testimonials: many(12), activeDeliveryCount: 2 },
      panel: { productsCount: 8, servicesCount: 4, testimonialCount: 12, hasDelivery: true },
      hero: { productsCount: 8, servicesCount: 4 },
    },
    {
      name: "described",
      hub: { products: products(2, "PRODUCT"), services: bookable(1), testimonials: many(2), businessDescription: "Small-batch hot sauces.", businessTagline: "Heat with care" },
      panel: { productsCount: 2, servicesCount: 1, testimonialCount: 2, businessDescription: "Small-batch hot sauces.", businessTagline: "Heat with care" },
      hero: { productsCount: 2, servicesCount: 1, businessDescription: "Small-batch hot sauces.", businessTagline: "Heat with care" },
    },
    {
      name: "every kind",
      hub: { products: [...products(1, "PRODUCT"), ...products(2, "PACKAGE", "k"), ...products(1, "SERVICE", "v")], services: bookable(2), testimonials: many(1), activeDeliveryCount: 1 },
      panel: { productsCount: 1, packagesCount: 2, orderableServicesCount: 1, servicesCount: 2, testimonialCount: 1, hasDelivery: true },
      hero: { productsCount: 1, packagesCount: 2, orderableServicesCount: 1, servicesCount: 2 },
    },
    {
      name: "services bought only",
      hub: { products: products(2) },
      panel: { orderableServicesCount: 2 },
      hero: { orderableServicesCount: 2 },
    },
    {
      name: "packages only",
      hub: { products: products(2, "PACKAGE") },
      panel: { packagesCount: 2 },
      hero: { packagesCount: 2 },
    },
  ];
  const unknown = (list: string[]) => list.filter((x) => !ALLOWED.has(x));

  it("the hub's copy generators", async () => {
    for (const sh of SHAPES) for (const id of COPY_TOOLS) expect(unknown(strings(await hub(id, sh.hub))), `${sh.name} ${id}`).toEqual([]);
  });

  it("the panel's actions", async () => {
    for (const sh of SHAPES) {
      for (const label of ["Generate FAQ", "Generate SEO", "Trust Copy", "Launch Posts"]) {
        render(<AiContentPanel storeName="Pepper Co" onApplyFaq={() => {}} onApplySeo={() => {}} {...sh.panel} />);
        await generate(label);
        expect(unknown(textNodes()), `${sh.name} ${label}`).toEqual([]);
        cleanup();
      }
    }
  }, 120_000);

  it("the AI Hero Copy panel, every option opened", async () => {
    for (const sh of SHAPES) {
      render(<AiHeroCopyPanel storeName="Pepper Co" onApply={() => {}} {...sh.hero} />);
      await generate("Generate");
      for (const b of screen.queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
      await new Promise((r) => setTimeout(r, 300));
      expect(unknown(textNodes()), sh.name).toEqual([]);
      cleanup();
    }
  }, LONG);
});

describe("R7-9: the write paths", () => {
  it("Add All copies the answers as generated, and the FAQ Manager then warns for each one with a placeholder", async () => {
    const onConfigChange = vi.fn();
    const existing = [{ id: "f_own", question: "Do you ship abroad?", answer: "No, only locally.", order: 0 }];
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={bookable(1) as never}
        commerceProducts={products(2, "PRODUCT") as never}
        liveProductIds={new Set(["p0", "p1"])}
        storefrontConfig={{ faqEntries: existing } as never}
        onConfigChange={onConfigChange}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials={false}
        activeDeliveryMethodsCount={1}
      />,
    );
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate FAQ");
    fireEvent.click(screen.getByText("Add All to FAQ"));
    const call = onConfigChange.mock.calls.find(([section]) => section === "faqEntries");
    const entries = call?.[1] as unknown as { question: string; answer: string }[];
    expect(entries[0]).toEqual(existing[0]);
    const added = entries.slice(1);
    expect(added.length).toBeGreaterThanOrEqual(4);
    expect(added.length).toBeLessThanOrEqual(7);
    for (const e of added) {
      expect(ALLOWED.has(strings(e.answer)[0]), e.answer).toBe(true);
      expect(e.answer, e.question).not.toMatch(/guarantee/i);
    }
    const withPlaceholder = added.filter((e) => /\[[^\]]+\]/.test(e.answer)).length;
    expect(withPlaceholder).toBeGreaterThanOrEqual(4);
    cleanup();
    render(<FaqManager config={{ faqEntries: entries } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);
    expect(screen.getByRole("alert").textContent).toBe(`${withPlaceholder} entries still have a [bracketed] part: fill it in with your own policy before you save, or your customers will see it.`);
    expect(screen.getAllByText("Fill in the [bracketed] part: click edit.")).toHaveLength(withPlaceholder);
  }, LONG);

  it("each added answer is the generated answer, word for word", async () => {
    const onApplyFaq = vi.fn();
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={1} hasDelivery onApplyFaq={onApplyFaq} />);
    await generate("Generate FAQ");
    fireEvent.click(screen.getByText("Add All to FAQ"));
    const faqs = onApplyFaq.mock.calls[0][0] as { question: string; answer: string }[];
    const onConfigChange = vi.fn();
    cleanup();
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={bookable(1) as never}
        commerceProducts={products(2, "PRODUCT") as never}
        liveProductIds={new Set(["p0", "p1"])}
        storefrontConfig={{} as never}
        onConfigChange={onConfigChange}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials={false}
        activeDeliveryMethodsCount={1}
      />,
    );
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate FAQ");
    fireEvent.click(screen.getByText("Add All to FAQ"));
    const written = onConfigChange.mock.calls.find(([section]) => section === "faqEntries")?.[1] as unknown as { question: string; answer: string }[];
    expect(written.map((e) => [e.question, e.answer])).toEqual(faqs.map((f) => [f.question, f.answer]));
  }, LONG);

  it("Save Policies warns while FAQ entries hold a placeholder, and still saves", () => {
    const onSave = vi.fn(async () => {});
    render(<PolicyEditor config={{ faqEntries: [{ id: "a", question: "Refunds?", answer: "[your refund policy]", order: 0 }, { id: "b", question: "Open?", answer: "Yes.", order: 1 }] } as never} onConfigChange={vi.fn()} onSave={onSave} saving={false} />);
    expect(screen.getByRole("alert").textContent).toMatch(/^1 FAQ entry still has a \[bracketed\] part/);
    fireEvent.click(screen.getByText("Save Policies"));
    expect(onSave).toHaveBeenCalledTimes(1);
    cleanup();
    render(<PolicyEditor config={{ faqEntries: [{ id: "b", question: "Open?", answer: "Yes.", order: 1 }] } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the Design tab warns while FAQ entries hold a placeholder, and not when none does", () => {
    const design = (faqEntries: unknown[]) =>
      render(
        <DesignMode
          businessData={{ name: "Pepper Co" }}
          services={[]}
          commerceProducts={[]}
          storefrontConfig={{ faqEntries } as never}
          onConfigChange={vi.fn()}
          onSaveConfig={vi.fn(async () => {})}
          configSaving={false}
          slug="pepper-co"
        />,
      );
    design([{ id: "a", question: "Where?", answer: "Find us at [Your Store Link].", order: 0 }, { id: "b", question: "Pay?", answer: "We accept [your payment methods].", order: 1 }]);
    expect(screen.getByRole("alert").textContent).toMatch(/^2 FAQ entries still have a \[bracketed\] part: saving here saves them as they are/);
    cleanup();
    design([{ id: "b", question: "Open?", answer: "Yes.", order: 1 }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
