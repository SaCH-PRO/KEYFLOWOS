/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 13 (reviews of c972de8, D-308, D-315), under D-303.
 *
 *   R13-1  only storeProducts given (storeServices absent): the services are not known, so the copy is partial: no
 *          whole total ("offers N services online", "N items"), no title naming the offer ("— Service Online"), the
 *          SERVICE-category products counted "to buy"
 *   R13-2  clip(): what is dropped before the "..." is whitespace, punctuation and symbols, except a "%", a "+",
 *          closing punctuation (a closing bracket or quote), a straight quote, and an emoji: "Shop &...", "Shop •...",
 *          "a/b/..." are no more; the R12 guarantees hold; a fuzz property
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/app/store",
  useParams: () => ({}),
}));

import { clip, liveProducts } from "../storefront-counts";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";
import { endsInLoneDropped } from "./trust-copy-allowlist";

function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  return result.current.tools.find((t) => t.id === id)!;
}
const COPY_TOOLS = ["seo-generator", "launch-campaign-generator", "hero-copy-generator", "faq-generator"];

const TASTING = { id: "s_t", name: "Tasting", price: 5, currency: "TTD" };
const FACIAL = { id: "p_f", name: "Facial", category: "SERVICE", isActive: true, price: 5, currency: "TTD" };
const FACIAL_LISTING = { id: "s_l_f", name: "Facial", sourceProductId: "p_f" };
const ON_BOOK = liveProducts([FACIAL], new Set(["p_f"]), { services: [TASTING, FACIAL_LISTING] });
const CATALOG = { storeName: "Pepper Co", products: [{ id: "p0", category: "PRODUCT" }, { id: "p1", category: "PRODUCT" }], services: [TASTING] };

describe("R13-1: only storeProducts given: the services are not known", () => {
  const data = { ...CATALOG, storeProducts: ON_BOOK };

  it("(the input) has no storeServices key", () => {
    expect("storeServices" in data).toBe(false);
    expect(ON_BOOK.map((p) => p.id)).toEqual(["p_f"]);
  });

  it("the copy is partial: no whole total, no title naming the offer, the bought services 'to buy'", async () => {
    for (const id of COPY_TOOLS) {
      const out = JSON.stringify(await hubTool(id).execute({ businessId: "biz_1", customData: data }));
      expect(out, id).not.toMatch(/\b\d+ [Ii]tems?(?![a-z])|getting started/);
      expect(out, id).not.toMatch(/— (Products?|Services?|Packages?)(?![a-z])[^|.]* Online/);
      expect(out, id).not.toMatch(/\b\d+ services?(?! to buy)(?![a-z])/);
    }
    const seo = (await hubTool("seo-generator").execute({ businessId: "biz_1", customData: data })) as { titles: string[] };
    expect(JSON.stringify(seo)).toMatch(/Pepper Co offers 1 service to buy online\. Buy online\./);
    expect(JSON.stringify(seo)).not.toMatch(/offers 1 service online/);
    expect(JSON.stringify(seo)).toContain("Pepper Co — Now Online");
    expect(JSON.stringify(seo)).not.toMatch(/Book online/);
  });
});

/** A letter, a digit, a mark, or an emoji: what makes a kept part more than punctuation and symbols. */
const CONTENT = /[^\s\p{P}\p{S}]|\p{Extended_Pictographic}/u;

describe("R13-2: clip() drops trailing punctuation and symbols, but for those that close or mean something", () => {
  it("the symbols the review found are dropped at the cut", () => {
    expect(clip("Shop & Book Online", 12)).toBe("Shop...");
    expect(clip("Shop • Book now", 12)).toBe("Shop...");
    // r14 (R14-1): a "/" attached to the word before it is that word's, and stays; a lone one goes ("4.5 /" below).
    expect(clip("a/b/c dee", 7)).toBe("a/b/...");
    expect(clip("Rated 4.5 / 5 by all", 14)).toBe("Rated 4.5...");
    expect(clip("Sauce * Rubs today", 12)).toBe("Sauce...");
    expect(clip("Hot # Spicy today", 10)).toBe("Hot...");
    expect(clip("Mail @ Pepper Co", 10)).toBe("Mail...");
    expect(clip("Que ¿ Sabor today", 10)).toBe("Que...");
    expect(clip("Hola ¡ Amigos now", 11)).toBe("Hola...");
    expect(clip("Er sagt „ hallo", 12)).toBe("Er sagt...");
    expect(clip("Less < More today", 10)).toBe("Less...");
    expect(clip("Pay $ less today", 9)).toBe("Pay...");
  });

  it("the SEO title template '| Shop & Book Online', clipped, never ends in '&...'", () => {
    const title = `${"Pepper Co Hot Sauces and Rubs of Trinidad and Tobago"} | Shop & Book Online`;
    expect(title.length).toBe(73);
    // Cut right after the "&": before r13, "... | Shop &...".
    expect(clip(title, 64)).toBe("Pepper Co Hot Sauces and Rubs of Trinidad and Tobago | Shop...");
  });

  it("the R12 guarantees hold", () => {
    expect(clip("Get 50% off today", 10)).toBe("Get 50%...");
    expect(clip("Open (weekdays) only now", 18)).toBe("Open (weekdays)...");
    expect(clip('Say "hello" to all', 14)).toBe('Say "hello"...');
    expect(clip("Hot “sauce” for all", 14)).toBe("Hot “sauce”...");
    expect(clip("Over 500+ happy clients", 12)).toBe("Over 500+...");
    expect(clip("Party 🎉 tonight only", 11)).toBe("Party 🎉...");
    expect(clip("!!!!!!!!!!!!", 5)).toBe("!!...");
    expect(clip("&&&&&&&&&&", 5)).toBe("&&...");
    expect(clip("<<<<<<<<<<", 5)).toBe("<<...");
    expect(clip("— a—!!", 5)).toBe("a...");
    expect(clip("&& / abcdef", 7)).toBe("abcd...");
  });

  it("fuzz: the kept part never ends in a dropped character, never in whitespace, and holds content when the text does", () => {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);
    const ALPHABET = ["a", "é", "5", "🌶️", "🎉", " ", String.fromCharCode(0xa0), "\t", ",", ".", "—", "!", "%", "+", "(", ")", '"', "“", "”", "&", "•", "/", "*", "#", "@", "¿", "¡", "„", "<", "$", "|"];
    let seed = 0x3113;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 6000; n++) {
      const t = Array.from({ length: Math.floor(rand() * 20) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
      const max = Math.floor(rand() * 16);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      expect(G(out).length, at).toBeLessThanOrEqual(max);
      if (G(t).length <= max) {
        expect(out, at).toBe(t);
        continue;
      }
      if (max <= 3 || t.trim() === "") continue;
      expect(out.endsWith("..."), at).toBe(true);
      const kept = out.slice(0, -3);
      expect(kept, at).not.toBe("");
      expect(kept, at).not.toMatch(/\s$/u);
      expect(t.includes(kept), at).toBe(true);
      if (CONTENT.test(t)) {
        expect(kept, at).toMatch(CONTENT);
        // r14 (R14-1, R14-2): by graphemes, and a symbol attached to the word before it stays.
        expect(endsInLoneDropped(kept), at).toBeNull();
      }
    }
  });
});
