/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 8 (reviews of 93d125f), under D-303.
 *
 *   R8-1  the name de-dupe is /book's: against every public service, even one the catalog override hides; so a hidden
 *         "Haircut" service and a live SERVICE-category "Haircut" product are nothing on the store
 *   R8-2  "Nothing on Your Store Yet" counts the products and the bookable services (a listing row is not a second
 *         item), and says to switch them on when every one is off
 *   R8-3  one placeholder warning per tab, by its saves, whichever section is open: the Merchandising tab (Featured,
 *         Social Proof, SEO, FAQ and Policies saves), Operations, Design; not twice with the FAQ Manager and
 *         PolicyEditor open; no "Fill them in in"
 *   R8-4  the panel's third meta description ends "..." only when the description was cut
 *   R8-5  a store with only bought services: no booking question in the panel's FAQ; the hub's SEO keywords say "buy
 *         online"
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

import { storefrontOffer, offerWords, liveProducts, offerOf } from "../storefront-counts";
import { AiContentPanel } from "../components/ai-content-panel";
import { MerchandisingMode } from "../components/merchandising-mode";
import { FaqManager } from "../components/faq-manager";
import { PolicyEditor } from "../components/policy-editor";
import { useStoreAiHub, generateStoreSuggestions } from "../hooks/use-store-ai-hub";
import { onStore } from "./trust-copy-allowlist";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(/Generating/);
  await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}
const PLACEHOLDERS = [
  { id: "a", question: "Refunds?", answer: "[your refund policy]", order: 0 },
  { id: "b", question: "Pay?", answer: "We accept [your payment methods].", order: 1 },
  { id: "c", question: "Open?", answer: "Yes, daily.", order: 2 },
];
const merch = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  render(
    <MerchandisingMode
      businessData={{ name: "Pepper Co" }}
      services={[]}
      commerceProducts={[]}
      liveProductIds={new Set()}
      storefrontConfig={config as never}
      onConfigChange={vi.fn()}
      onSaveConfig={vi.fn(async () => {})}
      configSaving={false}
      publicUrl="https://example.test/book/pepper-co"
      hasTestimonials={false}
      {...extra}
    />,
  );

describe("R8-1: the name de-dupe is /book's", () => {
  const services = [{ id: "s_hair", name: "Haircut" }, { id: "s_l", name: "Haircut", sourceProductId: "p_hair" }];
  const products = [{ id: "p_hair", name: "Haircut", category: "SERVICE" }];
  const config = { catalog: { itemOverrides: { s_hair: { visibilityRule: "hidden" } } } } as never;

  it("a hidden 'Haircut' service and a live SERVICE-category 'Haircut' product: 0 services", () => {
    const offer = storefrontOffer(services, products, new Set(["p_hair"]), { storefrontConfig: config });
    expect(offer).toEqual({ products: 0, packages: 0, services: 0, orderableServices: 0 });
    expect(offerWords(offer).counted).toBe("");
  });

  it("liveProducts itself drops the 'Haircut' product against the hidden 'Haircut' service", () => {
    expect(liveProducts(products, new Set(["p_hair"]), { services, storefrontConfig: config })).toEqual([]);
  });

  it("offerOf de-dupes against the services it is given (the hub's copy tools, given no store view)", () => {
    expect(offerOf(products, [{ name: "Haircut" }])).toEqual({ products: 0, packages: 0, services: 1, orderableServices: 0 });
  });

  it("the panel, through the merchandising view, says no 'Browse 1 service'", async () => {
    merch(config as never, { services, commerceProducts: products, liveProductIds: new Set(["p_hair"]) });
    fireEvent.click(screen.getByText("AI Content Intelligence"));
    await generate("Generate SEO");
    expect(text()).not.toMatch(/Browse 1 service/);
    expect(text()).toMatch(/Visit Pepper Co online\./);
  });
});

describe("R8-2: 'Nothing on Your Store Yet'", () => {
  const suggest = async (data: Record<string, unknown>) =>
    (await generateStoreSuggestions({ businessId: "biz_1", activeView: "catalog", customData: { storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true, storeProducts: [], storeServices: [], ...data } } as never)).find((s) => s.title === "Nothing on Your Store Yet");
  const products = (n: number, off = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, category: "PRODUCT", isActive: i >= off }));

  // r9: the count is of the items to add; a listing row (here a deleted product's) is not an item.
  it("counts the products, not listing rows", async () => {
    const out = await suggest({ products: products(3), services: [{ id: "s_lx", sourceProductId: "gone_1" }, { id: "s_ly", sourceProductId: "gone_2" }] });
    expect(out?.description).toBe("3 items in your catalog are not on your store yet. Add them to your store so visitors have something to browse and buy.");
    expect(out?.actionLabel).toBe("Add them to your store");
  });

  it("1 item, singular", async () => {
    const out = await suggest({ products: products(1), services: [] });
    expect(out?.description).toBe("1 item in your catalog is not on your store yet. Add it to your store so visitors have something to browse and buy.");
    expect(out?.actionLabel).toBe("Add it to your store");
  });

  it("every one switched off: says to switch them on", async () => {
    const out = await suggest({ products: products(2, 2), services: [] });
    expect(out?.description).toBe("Your catalog has 2 items, but every one is switched off. Switch them on, then add them to your store so visitors have something to browse and buy.");
    expect(out?.actionLabel).toBe("Switch them on");
  });

  it("some switched off: says to add them", async () => {
    expect((await suggest({ products: products(3, 1), services: [] }))?.actionLabel).toBe("Add them to your store");
  });
});

describe("R8-3: one placeholder warning per tab, by its saves", () => {
  it("the Merchandising tab: one, with no section open, and still one with FAQ & Policies open", () => {
    merch({ faqEntries: PLACEHOLDERS });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe("2 FAQ entries still have a [bracketed] part: every Save on this tab saves them as they are. Fill them in under FAQ & Policies, below.");
    fireEvent.click(screen.getByText("FAQ & Policies"));
    expect(screen.getByText("Save FAQ")).toBeTruthy();
    expect(screen.getByText("Save Policies")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByText("Fill in the [bracketed] part: click edit.").length).toBeGreaterThan(0);
  });

  it("the Merchandising tab: the warning sits above the sections whose saves it covers", () => {
    merch({ faqEntries: PLACEHOLDERS.slice(0, 1) });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("1 FAQ entry still has a [bracketed] part: every Save on this tab saves it as it is. Fill it in under FAQ & Policies, below.");
    for (const section of ["Social Proof", "FAQ & Policies"]) {
      const el = screen.getByText(section);
      expect(alert.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, section).toBeTruthy();
    }
  });

  it("no warning on the tab when no entry holds a placeholder", () => {
    merch({ faqEntries: PLACEHOLDERS.slice(2) });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("PolicyEditor and the FAQ Manager in the tab do not add a second", () => {
    render(<PolicyEditor config={{ faqEntries: PLACEHOLDERS } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    render(<FaqManager config={{ faqEntries: PLACEHOLDERS } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} saveWarning={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("Fill in the [bracketed] part: click edit.")).toHaveLength(2);
    cleanup();
    render(<FaqManager config={{ faqEntries: PLACEHOLDERS } as never} onConfigChange={vi.fn()} onSave={vi.fn(async () => {})} saving={false} />);
    expect(screen.getByRole("alert").textContent).toMatch(/^2 entries still have a \[bracketed\] part/);
  });

  it("no warning reads 'Fill it in in' or 'Fill them in in'", () => {
    merch({ faqEntries: PLACEHOLDERS });
    expect(text()).not.toMatch(/in in\b/);
  });
});

describe("R8-4: '...' only when the description was cut", () => {
  it("a short description ends with its own full stop", async () => {
    render(<AiContentPanel storeName="Pepper Co" businessDescription="Small-batch hot sauces." />);
    await generate("Generate SEO");
    expect(text()).toContain("Discover Pepper Co online. Small-batch hot sauces.");
    expect(text()).not.toMatch(/\.\.\.\./);
    expect(text()).not.toMatch(/sauces\.\.\./);
  });

  it("a long one is cut at 80 and ends '...'", async () => {
    const long = "We make small-batch hot sauces from peppers we grow ourselves, in five heat levels, mild to wild, every week.";
    render(<AiContentPanel storeName="Pepper Co" businessDescription={long} />);
    await generate("Generate SEO");
    // r9: cut at a word boundary, at most 80 characters with the "...".
    expect(text()).toContain("Discover Pepper Co online. We make small-batch hot sauces from peppers we grow ourselves, in five heat...");
  });
});

describe("R8-5: a store with only bought services", () => {
  it("the panel's FAQ asks no booking question", async () => {
    render(<AiContentPanel storeName="Pepper Co" orderableServicesCount={2} />);
    await generate("Generate FAQ");
    expect(text()).not.toMatch(/How do I book|reschedule/i);
    expect(text()).toMatch(/What payment methods do you accept\?/);
  });

  it("the hub's SEO keywords say 'buy online', and not 'book online'", async () => {
    const { result } = renderHook(() => useStoreAiHub());
    const tool = result.current.tools.find((t) => t.id === "seo-generator")!;
    const out = (await tool.execute({ businessId: "biz_1", customData: onStore({ storeName: "Pepper Co", products: [{ id: "v0", name: "Massage", category: "SERVICE" }, { id: "v1", name: "Facial", category: "SERVICE" }] }) })) as { keywords: string[] };
    expect(out.keywords).toContain("buy online");
    expect(out.keywords).not.toContain("book online");
  });
});
