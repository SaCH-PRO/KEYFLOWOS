/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 16 (reviews of 386318a, D-308, D-315), under D-303: clip().
 *
 *   R16-1  a lone straight quote or apostrophe at the cut stays (it may close what the kept part opened)
 *   R16-2  fuzz: a token in the room ending in "%", "+", a closing bracket or quote, followed by a space, is kept
 *   R16-3  a symbol's run stops at sentence punctuation, so a symbol after it is lone and goes with it
 *   R16-4  a trailing run is decided whole, once: "Was 5 €€..." (the currency-after-number rule, for the run)
 *   R16-5  "…" (U+2026, not \p{Sentence_Terminal}) is dropped at the cut, attached or not
 *   R16-6  a cut inside a word whose kept part is a symbol alone falls back to the hard cut, deliberately
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipEndViolation, clipKeepViolation, hasWordOrEmoji } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);

describe("R16-1: a lone straight quote or apostrophe at the cut stays", () => {
  it("each", () => {
    expect(clip('Say " hello " to all', 16)).toBe('Say " hello "...');
    expect(clip("Say ' hello ' to all", 16)).toBe("Say ' hello '...");
  });
});

describe("R16-3: a symbol after sentence punctuation is lone, and goes with it", () => {
  it("the review's three", () => {
    expect(clip("Hello!!& more", 11)).toBe("Hello...");
    expect(clip("Shop.★ more", 9)).toBe("Shop...");
    expect(clip("日本、& more", 7)).toBe("日本...");
  });
  it("the security reviewer's two: what the rule gives", () => {
    expect(clip("Wow!* terms", 9)).toBe("Wow...");
    // A closing bracket is never dropped, so it ends the drop, and the "&" before it is not reached.
    expect(clip("Shop &) more", 11)).toBe("Shop &)...");
  });
});

describe("R16-4: a trailing run is decided whole", () => {
  it("a currency run after a number and a space stays whole", () => {
    expect(clip("Was 5 €€ now less today", 11)).toBe("Was 5 €€...");
  });
  it("(control) attached, whole; lone, gone whole", () => {
    expect(clip("Was 5€€ now less today", 10)).toBe("Was 5€€...");
    expect(clip("Pay €€ now less today", 9)).toBe("Pay...");
  });
});

describe("R16-5: '…' goes at the cut", () => {
  it("attached and lone", () => {
    expect(clip("Wait… more soon", 8)).toBe("Wait...");
    expect(clip("Wait … more soon", 9)).toBe("Wait...");
  });
});

describe("R16-6: a symbol alone before a cut inside a word: the hard cut", () => {
  it("'™ Brand here ok' @8", () => {
    // Deliberate: the cut lands inside "Brand"; the part before that word is "™" alone, which goes, leaving nothing,
    // so the text is cut hard from its start (its first non-whitespace), which holds a word.
    expect(clip("™ Brand here ok", 8)).toBe("™ Bra...");
  });
});

describe("R16-2: fuzz, with the retention property", () => {
  it("independent properties, end and keep", () => {
    const ALPHABET = [
      "a", "é", "5", "C", "日", " ", " ", String.fromCharCode(0xa0), ",", ".", "—", "!", "…", "%", "+", "(", ")", "]", '"', "'", "“", "”",
      "&", "•", "/", "*", "#", "★", "$", "€", "©", "™", "→", "。", "、", "！",
      "🎉", "👍🏽", "#️⃣", "🇹🇹", "❤️",
    ];
    let seed = 0x3116;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 10000; n++) {
      const t = Array.from({ length: Math.floor(rand() * 22) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
      const max = Math.floor(rand() * 18);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      const gt = G(t);
      if (gt.length <= max) {
        expect(out, at).toBe(t);
        continue;
      }
      if (max <= 3 || t.trim() === "") continue;
      const kept = out.slice(0, -3);
      expect(G(out).length, at).toBeLessThanOrEqual(max);
      expect(clipEndViolation(t, kept), at).toBeNull();
      expect(clipKeepViolation(t, max, kept), at).toBeNull();
      if (hasWordOrEmoji(t)) expect(hasWordOrEmoji(kept), at).toBe(true);
    }
  });
});
