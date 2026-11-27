/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 6 (reviews of f805944), under D-303: stores that are not empty, and the AI
 * Hero Copy panel, get only true copy too.
 *
 *   R6-1  a count is only paired with the noun it counts: 2 products and 3 services is "2 products and 3 services",
 *         never "5 Sauces"; no category name or type code (a commerce product's `category` is PRODUCT, SERVICE or
 *         PACKAGE) is attached to a count; singulars ("1 product", "1 service"); no "Service" label for products; the
 *         SEO title's verb follows what is offered; no "Your go-to for"
 *   R6-2  the counts are what the storefront shows: products live on the store (not every product in the catalog), and
 *         bookable services (a service with a sourceProductId is a product's store listing)
 *   R6-3  the AI Hero Copy panel follows the same rules: none of its old claims, counts from the store, placeholders
 *   R6-4  FAQ answers do not assert a policy the store may not have: rescheduling, cancelling and refunds are the
 *         merchant's whole policy as a placeholder, and contact details are a placeholder
 *   R6-5  the [bracketed]-part warning follows any bracketed part, and sits where the merchant fills in and saves: in
 *         the FAQ Manager by each such entry and by Save; the panel's note, once the answers are added, points there
 *   R6-6  an empty store's hero still gets its one true subheadline
 *   R6-7  structural: for products-only, services-only, both, delivery on, and 1-item stores, every generator's output
 *         (panel, hub, hero panel) holds only the business name, real counts, placeholders and the allowed strings
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

import { AiContentPanel } from "../components/ai-content-panel";
import { AiHeroCopyPanel } from "../components/ai-hero-copy-panel";
import { FaqManager } from "../components/faq-manager";
import { MerchandisingMode } from "../components/merchandising-mode";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";
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

/** Every option of every list the hero panel offers, opened. */
async function heroAll(props: { productsCount?: number; servicesCount?: number }) {
  render(<AiHeroCopyPanel storeName="Pepper Co" onApply={() => {}} {...props} />);
  await generate("Generate");
  for (const b of screen.queryAllByText(/^\d+ options?$/)) fireEvent.click(b);
  await new Promise((r) => setTimeout(r, 300));
}

function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool;
}
type Data = Record<string, unknown>;
const store = (products: number, services: number, extra: Data = {}): Data => ({
  storeName: "Pepper Co",
  products: Array.from({ length: products }, (_, i) => ({ id: `p${i}`, category: i % 2 ? "Sauces" : "PRODUCT" })),
  services: Array.from({ length: services }, (_, i) => ({ id: `s${i}`, category: "Tasting" })),
  ...extra,
});
const run = async (id: string, data: Data) => JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: data }));
const COPY_TOOLS = ["faq-generator", "seo-generator", "launch-campaign-generator", "hero-copy-generator", "trust-copy-generator"];

describe("R6-1: a count goes with the noun it counts", () => {
  it("the hub, for 2 products and 3 services: '2 products and 3 services', never '5 Sauces', no category or type code", async () => {
    for (const id of ["seo-generator", "hero-copy-generator"]) {
      const out = await run(id, store(2, 3));
      expect(out, id).toMatch(/Browse 2 products and 3 services/);
      expect(out, id).not.toMatch(/\b5 (?!items\b)\w+/i); // 5 is only ever the item total ("5 Items", "5 items")
      expect(out, id).not.toMatch(/Sauces|Tasting|PRODUCT|SERVICE/);
    }
    expect(await run("hero-copy-generator", store(2, 3))).toMatch(/Discover 2 products and 3 services from Pepper Co/);
    expect(await run("seo-generator", store(2, 3))).toMatch(/Pepper Co offers 2 products and 3 services online\./);
  });

  it("the panel, for 2 products and 3 services", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={3} />);
    await generate("Generate SEO");
    expect(text()).toMatch(/Browse 2 products and 3 services at Pepper Co\./);
    expect(text()).toMatch(/2 products and 3 services available online\./);
  });

  it("singulars: '1 product', '1 service', never '1 products' or '1 services'", async () => {
    for (const [p, s, want] of [[1, 0, /Browse 1 product\b(?!s)/], [0, 1, /Browse 1 service\b(?!s)/], [1, 1, /1 product and 1 service\b(?!s)/]] as const) {
      for (const id of ["seo-generator", "hero-copy-generator"]) {
        const out = await run(id, store(p, s));
        expect(out, `${id} ${p}/${s}`).toMatch(want);
        expect(out, `${id} ${p}/${s}`).not.toMatch(/\b1 (products|services)\b/);
      }
    }
    render(<AiContentPanel storeName="Pepper Co" productsCount={1} servicesCount={1} />);
    await generate("Generate SEO");
    expect(text()).toMatch(/Browse 1 product and 1 service at Pepper Co\./);
    expect(text()).not.toMatch(/\b1 (products|services)\b/);
  });

  it("a products-only store is not called a service, and its SEO title shops; a services-only store's title books", async () => {
    for (const id of ["seo-generator", "hero-copy-generator"]) expect(await run(id, store(5, 0)), id).not.toMatch(/service/i);
    const products = JSON.parse(await run("seo-generator", store(2, 0))) as { metaTitleOptions: string[] };
    expect(products.metaTitleOptions).toContain("Pepper Co | Shop Online");
    const services = JSON.parse(await run("seo-generator", store(0, 2))) as { metaTitleOptions: string[] };
    expect(services.metaTitleOptions).toContain("Pepper Co | Book Online");
    expect(services.metaTitleOptions.join(" ")).not.toMatch(/\bShop\b/);
    const both = JSON.parse(await run("seo-generator", store(2, 1))) as { metaTitleOptions: string[] };
    expect(both.metaTitleOptions).toContain("Pepper Co | Shop & Book Online");
  });

  it("no 'Your go-to for'", async () => {
    for (const data of [store(2, 0), store(0, 2), store(2, 3)]) expect(await run("hero-copy-generator", data)).not.toMatch(/go-to/i);
  });
});

describe("R6-2: the counts are what the storefront shows", () => {
  const merch = (commerceProducts: { id: string; isActive?: boolean }[], live: string[], services: { id: string; sourceProductId?: string | null }[]) =>
    render(
      <MerchandisingMode
        businessData={{ name: "Pepper Co" }}
        services={services as never}
        commerceProducts={commerceProducts as never}
        liveProductIds={new Set(live)}
        storefrontConfig={{} as never}
        onConfigChange={vi.fn()}
        onSaveConfig={vi.fn(async () => {})}
        configSaving={false}
        publicUrl="https://example.test/book/pepper-co"
        hasTestimonials={false}
      />,
    );
  const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));

  it("12 products with none live on the store: no buy, order or shop claim and no count", async () => {
    for (const label of ["Generate SEO", "Launch Posts"]) {
      merch(twelve, [], []);
      fireEvent.click(screen.getByText("AI Content Intelligence"));
      await generate(label);
      expect(text(), label).not.toMatch(/\bbuy\b|\border|\bshop\b|\b12\b|Browse our/i);
      cleanup();
    }
  }, LONG);

  it("12 products with 2 live (and 1 more live but inactive): the count is 2", async () => {
    merch([...twelve, { id: "off", isActive: false }], ["p0", "p1", "off"], []);
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Launch Posts");
    expect(text()).toMatch(/Browse our 2 items\./);
  });

  it("a product's store-listing service is not a bookable service: no book claim, and it is not counted", async () => {
    merch([{ id: "p0" }], ["p0"], [{ id: "s_listing", sourceProductId: "p0" }]);
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate SEO");
    expect(text()).not.toMatch(/\bbook/i);
    expect(text()).toMatch(/Browse 1 product at Pepper Co\. Buy online\./);
  });

  it("the hub does not count a product's store-listing service either", async () => {
    const data = { storeName: "Pepper Co", products: [{ id: "p0" }], services: [{ id: "s_listing", sourceProductId: "p0" }] };
    for (const id of ["seo-generator", "launch-campaign-generator", "hero-copy-generator", "faq-generator"]) {
      expect(await run(id, data), id).not.toMatch(/\bbook/i);
    }
    expect(await run("launch-campaign-generator", data)).toMatch(/Browse our 1 item\./);
  });
});

describe("R6-3: the AI Hero Copy panel", () => {
  const OLD = /Quality You Can Trust|Premium|\d+\+ Items|curated|in seconds|delivered to you|all in one place|New Arrivals|First-Time Customer|Everything you need|available online, anytime/i;

  it("makes none of its old claims, for any store", async () => {
    for (const [p, s] of [[0, 0], [3, 0], [0, 3], [2, 1]]) {
      await heroAll({ productsCount: p, servicesCount: s });
      expect(text(), `${p}/${s}`).not.toMatch(OLD);
      cleanup();
    }
  }, LONG);

  it("counts from the store: products only are not offered booking, services only are not offered buying", async () => {
    await heroAll({ productsCount: 2, servicesCount: 0 });
    expect(text()).not.toMatch(/\bbook/i);
    expect(text()).toMatch(/Browse 2 products\. Buy online\./);
    cleanup();
    await heroAll({ productsCount: 0, servicesCount: 2 });
    expect(text()).not.toMatch(/\bbuy\b|\bshop\b|\border/i);
    expect(text()).toMatch(/Discover 2 services from Pepper Co/);
    cleanup();
    await heroAll({ productsCount: 1, servicesCount: 0 });
    expect(text()).toMatch(/1 item, online\./);
    expect(text()).not.toMatch(/\b1 (items|products)\b/);
  }, LONG);

  it("the merchant's news and offer are placeholders, and an empty store's recommendation shops nothing", async () => {
    await heroAll({});
    expect(text()).toContain("✨ [your latest news]");
    expect(text()).toContain("🔥 [your offer]");
    expect(text()).not.toMatch(/Shop Now|Book Today/);
    expect(text()).toMatch(/Pepper Co, now online\./);
  });
});

describe("R6-4: no FAQ answer asserts a policy the store may not have", () => {
  const POLICY = /\bYes\b|We offer refunds|refunds within|contact section|contact details listed|initiate a refund|vary by location/i;

  it("the panel's FAQ", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={1} hasDelivery />);
    await generate("Generate FAQ");
    expect(text()).not.toMatch(POLICY);
    for (const p of ["[your reschedule and cancellation policy]", "[your refund policy]", "[your contact details]"]) expect(text(), p).toContain(p);
  });

  it("the hub's FAQ Generator", async () => {
    const out = JSON.parse(await run("faq-generator", store(2, 1, { activeDeliveryCount: 1 }))) as { faqs: { question: string; answer: string }[] };
    expect(JSON.stringify(out)).not.toMatch(POLICY);
    const answer = (q: RegExp) => out.faqs.find((f) => q.test(f.question))?.answer;
    expect(answer(/reschedule/)).toBe("[your reschedule and cancellation policy]");
    expect(answer(/refund/)).toBe("[your refund policy]");
    expect(answer(/contact/)).toBe("Reach us at [your contact details]. We respond within [your response time].");
  });
});

describe("R6-5: the [bracketed]-part warning, where the merchant fills in and saves", () => {
  const entries = (list: [string, string][]) => list.map(([question, answer], i) => ({ id: `f${i}`, question, answer, order: i }));
  const manager = (list: [string, string][]) =>
    render(<FaqManager config={{ faqEntries: entries(list) } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);

  it("the FAQ Manager notes each entry with any [bracketed] part, including '[Your Store Link]', and none without", () => {
    manager([
      ["Where are you?", "Find us at [Your Store Link]."],
      ["Refunds?", "[your refund policy]"],
      ["Open on Sundays?", "We are closed on Sundays."],
      ["What is [Product Name]?", "Our sauce."],
    ]);
    expect(screen.getAllByText("Fill in the [bracketed] part: click edit.")).toHaveLength(3);
    const sunday = screen.getAllByText("We are closed on Sundays.")[0].parentElement!; // [1] is the Preview
    expect(within(sunday).queryByText(/Fill in the \[bracketed\]/)).toBeNull();
  });

  it("the FAQ Manager warns by Save while any entry still has one, and not once none has", () => {
    manager([["Refunds?", "[your refund policy]"], ["Pay?", "We accept [your payment methods]."]]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/2 entries still have a \[bracketed\] part: fill it in with your own policy before you save/);
    // the alert is the first thing under the header that holds the Save button
    expect(screen.getByText("Save FAQ").closest("button")?.parentElement?.nextElementSibling?.firstElementChild).toBe(alert);
    cleanup();
    manager([["Refunds?", "[your refund policy]"]]);
    expect(screen.getByRole("alert").textContent).toMatch(/^1 entry still has a \[bracketed\] part/);
    cleanup();
    manager([["Refunds?", "Within 14 days of purchase."]]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the panel, once Add All was clicked, points to the FAQ Manager, and says so after the Applied! state ends", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={1} onApplyFaq={() => {}} />);
    await generate("Generate FAQ");
    fireEvent.click(screen.getByText("Add All to FAQ"));
    expect(text()).toMatch(/Added\. Check the FAQ Manager: fill in the \[bracketed\] parts there before you save\./);
    expect(text()).not.toMatch(/fill them in before your customers see them/);
    await new Promise((r) => setTimeout(r, 3100));
    expect(text()).toMatch(/Added\. Check the FAQ Manager/);
  }, LONG);

  it("the panel notes an answer whose placeholder does not start 'your' (any [bracketed] part)", async () => {
    render(<AiContentPanel storeName="Pepper Co" />);
    await generate("Generate FAQ");
    const notes = screen.getAllByText("Fill in the [bracketed] part in the FAQ Manager.");
    const answers = [...document.querySelectorAll("p")].filter((p) => /\[[^\]]+\]/.test(p.textContent ?? "") && !/Fill in|Click 'Add All|Some answers/.test(p.textContent ?? ""));
    expect(notes.length).toBe(answers.length);
  });
});

describe("R6-6: an empty store's hero still gets its one true subheadline", () => {
  it("the hub", async () => {
    const out = JSON.parse(await run("hero-copy-generator", store(0, 0))) as { subheadlines: string[]; recommendation: { subheadline: string } };
    expect(out.subheadlines).toEqual(["Pepper Co, now online."]);
    expect(out.recommendation.subheadline).toBe("Pepper Co, now online.");
  });
});

describe("R6-7: every generator, for stores that are not empty, says only the allowed strings", () => {
  const SHAPES: { name: string; p: number; s: number; t: number; delivery: boolean }[] = [
    { name: "products only", p: 3, s: 0, t: 2, delivery: false },
    { name: "services only", p: 0, s: 3, t: 0, delivery: false },
    { name: "both", p: 2, s: 1, t: 2, delivery: false },
    { name: "delivery on", p: 2, s: 1, t: 1, delivery: true },
    { name: "1 item", p: 1, s: 0, t: 1, delivery: false },
  ];
  const unknown = (list: string[]) => list.filter((x) => !ALLOWED.has(x));

  it("the hub's copy generators", async () => {
    for (const sh of SHAPES) {
      const data = { ...store(sh.p, sh.s), testimonials: Array.from({ length: sh.t }, (_, i) => ({ id: `t${i}` })), activeDeliveryCount: sh.delivery ? 1 : 0 };
      for (const id of COPY_TOOLS) expect(unknown(strings(await hubTool(id).execute({ businessId: "biz_1", customData: data }))), `${sh.name} ${id}`).toEqual([]);
    }
  });

  it("the panel's FAQ, SEO, Trust Copy and Launch Posts", async () => {
    for (const sh of SHAPES) {
      for (const label of ["Generate FAQ", "Generate SEO", "Trust Copy", "Launch Posts"]) {
        render(<AiContentPanel storeName="Pepper Co" productsCount={sh.p} servicesCount={sh.s} testimonialCount={sh.t} hasDelivery={sh.delivery} onApplyFaq={() => {}} onApplySeo={() => {}} />);
        await generate(label);
        expect(unknown(textNodes()), `${sh.name} ${label}`).toEqual([]);
        cleanup();
      }
    }
  }, 120_000);

  it("the AI Hero Copy panel, every option opened (and the empty store)", async () => {
    for (const sh of [...SHAPES, { name: "empty", p: 0, s: 0, t: 0, delivery: false }]) {
      await heroAll({ productsCount: sh.p, servicesCount: sh.s });
      expect(unknown(textNodes()), sh.name).toEqual([]);
      cleanup();
    }
  }, LONG);
});
