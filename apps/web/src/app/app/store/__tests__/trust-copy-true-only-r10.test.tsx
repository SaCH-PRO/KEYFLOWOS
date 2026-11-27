/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 10 (WEDGE review of 684ea85), under D-303.
 *
 *   R10-M   the hub given storeProducts null (the store graph not read) says nothing about what is on the store, and
 *           its copy counts no product
 *   R10-1   no "Empty Catalog" with 0 products and a bookable service (m1)
 *   R10-2   "then add" counts the switched-off products not listed (m2)
 *   R10-3   a bookable service the storefront hides is told to unhide it (m3)
 *   R10-4   the not-showing count is of what is listed and on, not every product (m4)
 *   R10-5   every clip limit, at the limit and one past it (m5)
 *   R10-6   clip() breaks on any whitespace; a single long word is cut hard; leading whitespace is not a break (m6)
 *   R10-7   clip() cuts by grapheme: no lone surrogate, no split emoji (m7)
 *   R10-8   clip() keeps a word that ends at the cut; under 3, a cut of the text (m8)
 *   R10-9   some products listed and on, some on and not listed, none showing: add the unlisted ones (m9)
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

import { clip } from "../storefront-counts";
import { AiContentPanel } from "../components/ai-content-panel";
import { AiHeroCopyPanel } from "../components/ai-hero-copy-panel";
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
const listing = (pid: string) => ({ id: `s_l_${pid}`, sourceProductId: pid });
function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  return result.current.tools.find((t) => t.id === id)!;
}
/** A store name of exactly `n` characters, of whole words. */
const nameOf = (n: number) => {
  let s = "";
  while (s.length < n) s += (s ? " " : "") + "Pepper";
  s = s.slice(0, n);
  return s.endsWith(" ") ? `${s.slice(0, -1)}x` : s;
};

describe("R10-M: what is on the store not known", () => {
  it("no 'Nothing on Your Store Yet', whatever the catalog", async () => {
    for (const data of [
      { products: [product("p0"), product("p1")], services: [listing("p0"), listing("p1")] },
      { products: [product("p0", false)], services: [] },
      { products: [], services: [{ id: "s0", name: "Tasting" }] },
    ]) {
      const out = await suggestions({ ...data, storeProducts: null, storeServices: [] });
      expect(out.map((s) => s.title), JSON.stringify(data)).not.toContain("Nothing on Your Store Yet");
    }
  });

  it("the copy counts no product (never the whole catalog as if it were live)", async () => {
    const res = (await hubTool("seo-generator").execute({ businessId: "biz_1", customData: { storeName: "Pepper Co", products: [product("p0"), product("p1")], services: [], storeProducts: null, storeServices: [] } })) as Record<string, unknown>;
    // the copy (titles, descriptions, keywords, summary), not the analysis of the catalog ("Some products lack descriptions")
    const out = JSON.stringify([res.metaTitleOptions, res.metaDescOptions, res.keywords, res.summary]);
    expect(out).not.toMatch(/\bproducts?\b|Shop|buy online/i);
    expect(out).toMatch(/Visit Pepper Co online\./);
  });
});

describe("R10-1..4: 'Empty Catalog' and 'Nothing on Your Store Yet'", () => {
  it("m1: 0 products and a bookable service: no 'Empty Catalog'", async () => {
    const out = await suggestions({ products: [], services: [{ id: "s0", name: "Tasting" }], storeServices: [{ id: "s0", name: "Tasting" }] });
    expect(out.map((s) => s.title)).not.toContain("Empty Catalog");
  });

  it("m2: 1 off and not listed, 1 off and listed: switch them on, then add the one not on your store yet", async () => {
    const out = await nothing({ products: [product("p0", false), product("p1", false)], services: [listing("p1")] });
    expect(out?.description).toBe("Your catalog has 2 items, but every one is switched off. Switch them on, then add the one not on your store yet so visitors have something to browse and buy.");
  });

  it("m2: 1 off and not listed, 2 off and listed: the one; 2 not listed, 1 listed: the 2", async () => {
    expect((await nothing({ products: [product("p0", false), product("p1", false), product("p2", false)], services: [listing("p1"), listing("p2")] }))?.description).toMatch(/Switch them on, then add the one not on your store yet so/);
    expect((await nothing({ products: [product("p0", false), product("p1", false), product("p2", false)], services: [listing("p2")] }))?.description).toMatch(/Switch them on, then add the 2 not on your store yet so/);
    expect((await nothing({ products: [product("p0", false), product("p1", false)], services: [] }))?.description).toMatch(/Switch them on, then add them to your store so/);
  });

  it("m3: a bookable service the storefront hides: unhide it", async () => {
    const out = await nothing({ products: [], services: [{ id: "s0", name: "Tasting" }], storeServices: [] });
    expect(out?.description).toBe("1 service is on your store but hidden. Unhide it in the catalog so visitors can book it.");
    expect(out?.actionLabel).toBe("Unhide it");
  });

  it("m4: a listed product that is on, and a switched-off one: the 1 that is not showing", async () => {
    const out = await nothing({ products: [product("p0"), product("p1", false)], services: [listing("p0")] });
    expect(out?.description).toBe("1 item is on your store but not showing: it is out of stock or hidden. Check its stock and visibility in the catalog.");
  });

  it("a listed product on and not showing, and a hidden service: 2 not showing", async () => {
    const out = await nothing({ products: [product("p0")], services: [listing("p0"), { id: "s0", name: "Tasting" }], storeServices: [] });
    expect(out?.description).toMatch(/^2 items are on your store but not showing/);
  });
});

describe("R10-9 (m9): some listed and on, some on and not listed, none showing", () => {
  it("add the unlisted ones, in their number", async () => {
    const out = await nothing({ products: [product("p0"), product("p1"), product("p2")], services: [listing("p0"), listing("p1")] });
    expect(out?.description).toBe("1 item in your catalog is not on your store yet. Add it to your store so visitors have something to browse and buy.");
    expect(out?.actionLabel).toBe("Add it to your store");
  });
});

describe("R10-5 (m5): every clip limit, at the limit and one past it", () => {
  const seo = async (name: string, tagline = "") =>
    (await hubTool("seo-generator").execute({ businessId: "biz_1", customData: { storeName: name, businessTagline: tagline } })) as { metaTitleOptions: string[]; metaDescOptions: string[] };

  it("the hub's titles: 60 whole, 61 cut", async () => {
    const at = nameOf(53);
    expect((await seo(at)).metaTitleOptions).toContain(`${at} Online`);
    const past = nameOf(54);
    const out = await seo(past);
    expect(out.metaTitleOptions).toContain(clip(`${past} Online`, 60));
    expect(out.metaTitleOptions).not.toContain(`${past} Online`);
  });

  it("the hub's first description: 160 whole, 161 cut", async () => {
    const at = nameOf(146);
    expect((await seo(at)).metaDescOptions[0]).toBe(`Visit ${at} online.`);
    const past = nameOf(147);
    expect((await seo(past)).metaDescOptions[0]).toBe(clip(`Visit ${past} online.`, 160));
  });

  it("the hub's third description: 160 whole, 161 cut", async () => {
    const at = nameOf(147);
    expect((await seo(at)).metaDescOptions[2]).toBe(`${at}. Now online.`);
    const past = nameOf(148);
    expect((await seo(past)).metaDescOptions[2]).toBe(clip(`${past}. Now online.`, 160));
  });

  it("the panel's first and third descriptions: 160 whole, 161 cut", async () => {
    for (const [n, first, third] of [[146, true, false], [147, false, false], [143, true, true], [144, true, false]] as const) {
      const name = nameOf(n);
      render(<AiContentPanel storeName={name} />);
      await generate("Generate SEO");
      const firstText = `Visit ${name} online.`;
      const thirdText = `Discover ${name} online.`;
      expect(text(), `first ${n}`).toContain(first ? firstText : clip(firstText, 160));
      if (third) expect(text(), `third ${n}`).toContain(thirdText);
      else expect(text(), `third ${n}`).toContain(clip(thirdText, 160));
      cleanup();
    }
  }, 30_000);

  it("the hero panel's description: 100 whole, 101 cut", async () => {
    const d100 = nameOf(100);
    render(<AiHeroCopyPanel storeName="Pepper Co" businessDescription={d100} onApply={() => {}} />);
    await generate("Generate");
    expect(text()).toContain(d100);
    cleanup();
    const d101 = nameOf(101);
    render(<AiHeroCopyPanel storeName="Pepper Co" businessDescription={d101} onApply={() => {}} />);
    await generate("Generate");
    expect(text()).toContain(clip(d101, 100));
    expect(text()).not.toContain(d101);
  });
});

describe("R10-6..8: clip()", () => {
  it("m6: breaks on any whitespace (a no-break space, a tab)", () => {
    expect(clip("aaaa bbbbbb", 9)).toBe("aaaa...");
    expect(clip("aaaa\tbbbbbb", 9)).toBe("aaaa...");
    expect(clip("aaaa\nbbbbbb", 9)).toBe("aaaa...");
  });

  it("m6: a single word longer than the room is cut hard, then '...'", () => {
    expect(clip("abcdefghijkl", 8)).toBe("abcde...");
  });

  it("m6: leading whitespace is not a break: never a bare '...'", () => {
    expect(clip("   abcdefghij", 8)).toBe("   ab...");
    expect(clip(" abcdefghij", 8)).toBe(" abcd...");
  });

  it("m7: cuts by grapheme: no lone surrogate, no split emoji", () => {
    const peppers = "🌶️🌶️🌶️🌶️🌶️🌶️";
    expect(clip(peppers, 5)).toBe("🌶️🌶️...");
    const family = "👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧";
    expect(clip(family, 4)).toBe("👨‍👩‍👧...");
    expect(clip(family, 5)).toBe(family);
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const s of [clip(peppers, 4), clip(`ab ${peppers}`, 6), clip("😀😀😀😀😀", 4)]) expect(lone.test(s), s).toBe(false);
  });

  it("m8: a word that ends where the room ends is kept", () => {
    expect(clip("aaa bbb ccc", 10)).toBe("aaa bbb...");
    expect(clip("aaa bbb ccc", 11)).toBe("aaa bbb ccc");
  });

  it("m8: under 3, a cut of the text", () => {
    expect(clip("abcdef", 2)).toBe("ab");
    expect(clip("abcdef", 1)).toBe("a");
    expect(clip("abcdef", 0)).toBe("");
    expect(clip("ab", 2)).toBe("ab");
  });
});
