/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 14 (reviews of daa0830, D-308, D-315), under D-303: clip().
 *
 *   R14-1  a symbol or punctuation mark attached to the word before it is that word's, and stays: "C#", "5★", "20°",
 *          "Free*" (the conditions asterisk is part of the claim); a currency sign after a number ("5 €"); only a
 *          lone one goes ("Shop &", "Shop •", "4.5 /"); sentence punctuation still goes ("Fresh,")
 *   R14-2  the drop is by grapheme: an emoji with a skin tone, a keycap, a flag, a family is never split
 *   R14-3  a straight apostrophe stays ("Sizes 5'...")
 *   R14-4  fuzz: the kept part is a run of whole graphemes of the text; no lone dropped character at its end
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipEndViolation } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);

describe("R14-1: an attached symbol stays, a lone one goes", () => {
  it("attached to the word before it: kept", () => {
    expect(clip("Learn C# today", 11)).toBe("Learn C#...");
    expect(clip("Rated 5★ by all", 11)).toBe("Rated 5★...");
    expect(clip("Temp 20° now", 11)).toBe("Temp 20°...");
    expect(clip("Free* delivery on orders", 8)).toBe("Free*...");
    expect(clip("Only 5€ each today", 10)).toBe("Only 5€...");
    expect(clip("Use @pepper or #hot sauce", 14)).toBe("Use @pepper...");
  });

  it("a currency sign after a number and a space is the number's: kept", () => {
    expect(clip("Ab 5 € pro Stück", 9)).toBe("Ab 5 €...");
  });

  it("alone (after whitespace): dropped", () => {
    expect(clip("Shop & Book Online", 12)).toBe("Shop...");
    expect(clip("Shop • Book now", 12)).toBe("Shop...");
    expect(clip("Rated 4.5 / 5 by all", 14)).toBe("Rated 4.5...");
    expect(clip("Pay $ less today", 9)).toBe("Pay...");
    expect(clip("Shop && Book", 10)).toBe("Shop...");
  });

  it("sentence punctuation, dashes, opening brackets and quotes go even when attached", () => {
    expect(clip("Fresh, hot sauces", 10)).toBe("Fresh...");
    expect(clip("Wait! More soon", 8)).toBe("Wait...");
    expect(clip("Hot— spicy rubs", 7)).toBe("Hot...");
  });
});

describe("R14-2: the drop is by grapheme", () => {
  it("an emoji with a skin tone is never split", () => {
    expect(clip("Thumbs 👍🏽 up from all", 12)).toBe("Thumbs 👍🏽...");
  });
  it("a keycap, a flag, a family stay whole", () => {
    expect(clip("Press #️⃣ to call us", 11)).toBe("Press #️⃣...");
    expect(clip("Made in 🇹🇹 with love", 13)).toBe("Made in 🇹🇹...");
    expect(clip("For 👨‍👩‍👧 and friends", 9)).toBe("For 👨‍👩‍👧...");
  });
});

describe("R14-3: a straight apostrophe stays", () => {
  it("Sizes 5'...", () => {
    expect(clip("Sizes 5' and 6' in stock", 12)).toBe("Sizes 5'...");
  });
  it("after punctuation, where only its exception keeps it (the mutant without it drops it): straight quotes stay", () => {
    expect(clip("'Wow!' she said it", 9)).toBe("'Wow!'...");
    expect(clip('"Wow!" she said it', 9)).toBe('"Wow!"...');
  });
});

describe("R12-R13 guarantees, kept", () => {
  it("each one", () => {
    expect(clip("Get 50% off today", 10)).toBe("Get 50%...");
    expect(clip("Open (weekdays) only now", 18)).toBe("Open (weekdays)...");
    expect(clip('Say "hello" to all', 14)).toBe('Say "hello"...');
    expect(clip("Over 500+ happy clients", 12)).toBe("Over 500+...");
    expect(clip("Party 🎉 tonight only", 11)).toBe("Party 🎉...");
    expect(clip("!!!!!!!!!!!!", 5)).toBe("!!...");
    expect(clip("Shop & Book Online", 12)).toBe("Shop...");
    expect(clip("— a—!!", 5)).toBe("a...");
  });
});

describe("R14-4: fuzz", () => {
  it("the kept part is a run of whole graphemes of the text, with no whitespace and no lone dropped character at its end", () => {
    const ALPHABET = [
      "a", "é", "5", "C", " ", String.fromCharCode(0xa0), "\t", ",", ".", "—", "!", "%", "+", "(", ")", '"', "'", "“", "”",
      "&", "•", "/", "*", "#", "@", "¿", "¡", "„", "<", "$", "€", "°", "★", "|",
      "🎉", "🌶️", "👍🏽", "#️⃣", "1️⃣", "🇹🇹", "🇺🇸", "👨‍👩‍👧", "🏳️‍🌈",
    ];
    const content = /[^\s\p{P}\p{S}]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
    let seed = 0x3114;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 8000; n++) {
      const t = Array.from({ length: Math.floor(rand() * 20) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
      const max = Math.floor(rand() * 16);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      const gt = G(t);
      expect(G(out).length, at).toBeLessThanOrEqual(max);
      if (gt.length <= max) {
        expect(out, at).toBe(t);
        continue;
      }
      if (max <= 3) {
        expect(out, at).toBe(gt.slice(0, max).join(""));
        continue;
      }
      if (t.trim() === "") continue;
      expect(out.endsWith("..."), at).toBe(true);
      const kept = out.slice(0, -3);
      expect(kept, at).not.toBe("");
      // A run of whole graphemes of the text: some start i where the text's graphemes from i join to kept.
      const gk = G(kept);
      const runs = gt.map((_, i) => gt.slice(i, i + gk.length).join("") === kept && gt.slice(i, i + gk.length).length === gk.length);
      expect(runs.some(Boolean), at).toBe(true);
      expect(kept, at).not.toMatch(/\s$/u);
      if (content.test(t)) {
        expect(kept, at).toMatch(content);
        expect(clipEndViolation(t, kept), at).toBeNull();
      }
    }
  });
});
