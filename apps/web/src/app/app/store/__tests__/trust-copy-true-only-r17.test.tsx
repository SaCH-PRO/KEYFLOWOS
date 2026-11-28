/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 17 (reviews of 9b1597e, D-308, D-315), under D-303: clip() pins.
 *
 *   R17-1  a run that holds a never-dropped mark ("%", "+", a closing bracket) is walked over, not stopped at: a
 *          symbol after it is attached to the word before the run, and stays ("50%*", "(sale)*", "A+*")
 *   R17-2  a mixed run after a number is decided grapheme by grapheme (only an all-currency run is decided whole)
 *   R17-3  the retention property fires in at least 15% of the fuzz's cases
 *   R17-4  a mark after sentence punctuation stands alone, and goes ("Yahoo!™" gives "Yahoo")
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipEndViolation, clipKeepTokens, clipKeepViolation, hasWordOrEmoji } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);

describe("R17-1: a never-dropped mark in a run does not stop the walk", () => {
  it("the conditions asterisk after it stays", () => {
    expect(clip("50%* off selected lines", 7)).toBe("50%*...");
    expect(clip("(sale)* today only", 10)).toBe("(sale)*...");
    expect(clip("A+* grade", 6)).toBe("A+*...");
  });
});

describe("R17-2: a mixed run after a number goes grapheme by grapheme", () => {
  it("the '&' goes, the '€' (the number's) stays", () => {
    expect(clip("Was 5 €& now less today", 11)).toBe("Was 5 €...");
    expect(clip("5 €& yyzz", 8)).toBe("5 €...");
  });
  it("a closing quote after sentence punctuation stays, the lone '&' after it goes", () => {
    expect(clip("Hi.»& xzz", 8)).toBe("Hi.»...");
  });
});

describe("R17-4: a mark after sentence punctuation stands alone", () => {
  it("'Yahoo!™ xyz' @10", () => {
    // Deliberate: sentence punctuation is no word, so the "™" after "!" is lone, and goes with the "!".
    expect(clip("Yahoo!™ xyz", 10)).toBe("Yahoo...");
  });
});

describe("R17-3: the retention property fires in at least 15% of cases", () => {
  it("a fuzz weighted towards % + ) \" ' and spaces", () => {
    // Weighted: the marks the property holds, and spaces (it needs a token followed by one), several times each.
    const ALPHABET = [
      ..."aaaaeeoo55", "C", "日", ..."        ", String.fromCharCode(0xa0),
      ..."%%%%++++))))\"\"\"\"''''", "]", "]", "”", "”", "’", "’",
      ",", ".", "!", "…", "—", "(", "“", "&", "•", "*", "#", "★", "€", "$", "™", "。", "🎉", "👍🏽", "🇹🇹",
    ];
    let seed = 0x3117;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const N = 12000;
    let fired = 0;
    for (let n = 0; n < N; n++) {
      const t = Array.from({ length: 8 + Math.floor(rand() * 22) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
      const max = 6 + Math.floor(rand() * 16);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      if (G(t).length <= max) {
        expect(out, at).toBe(t);
        continue;
      }
      if (t.trim() === "") continue;
      const kept = out.slice(0, -3);
      expect(G(out).length, at).toBeLessThanOrEqual(max);
      expect(clipEndViolation(t, kept), at).toBeNull();
      expect(clipKeepViolation(t, max, kept), at).toBeNull();
      if (hasWordOrEmoji(t)) expect(hasWordOrEmoji(kept), at).toBe(true);
      if (clipKeepTokens(t, max, kept).length > 0) fired++;
    }
    const rate = fired / N;
    console.info(`R17-3 retention property fired in ${fired} of ${N} cases (${(rate * 100).toFixed(1)}%)`);
    expect(rate).toBeGreaterThanOrEqual(0.15);
  });
});
