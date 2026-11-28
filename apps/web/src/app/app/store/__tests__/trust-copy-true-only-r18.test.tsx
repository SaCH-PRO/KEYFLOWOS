/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 18 (reviews of c65f437, D-303, D-315): a conditions marker is never
 * dropped while the claim it qualifies stays.
 *
 *   R18-1  "*", "†", "‡" (and a run of them) attached to what stays before it (a word, a kept mark, a kept currency
 *          run) stay: "50 %*", "1 +*", "( sale )*", "5 €*"; after whitespace, or a lone symbol that goes, they go
 *   R18-2  after sentence punctuation too ("Free!*", "Free.*"), a correction of R16-3 for conditions markers only:
 *          other symbols after sentence punctuation still go ("Hello!!&", "Yahoo!™")
 *   R18-3  a "“" closing a „ (German, Polish) is a closing quote: "Sale „Big“*..."; English “ still opens
 *   fuzz   the conditions property (trust-copy-allowlist.ts clipConditionsViolation), with * † ‡ weighted
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipConditionsTokens, clipConditionsViolation, clipEndViolation, clipKeepViolation, hasWordOrEmoji } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);

describe("R18-1: a conditions marker attached to what stays, stays", () => {
  it("the review's five", () => {
    expect(clip("Get 50 %* off all items", 12)).toBe("Get 50 %*...");
    expect(clip("1 +* more today", 7)).toBe("1 +*...");
    expect(clip("( sale )* today only", 12)).toBe("( sale )*...");
    expect(clip("Win 1 %* of all", 11)).toBe("Win 1 %*...");
    expect(clip("Was 5 €* now less", 11)).toBe("Was 5 €*...");
  });
  it("attached to a word", () => {
    expect(clip("50%* off selected", 7)).toBe("50%*...");
    expect(clip("Free* delivery on orders", 8)).toBe("Free*...");
    expect(clip("Free† delivery on orders", 8)).toBe("Free†...");
    expect(clip("Free‡ delivery on orders", 8)).toBe("Free‡...");
    expect(clip("Free** delivery", 9)).toBe("Free**...");
  });
  it("lone (after whitespace, or after a lone symbol that goes): gone", () => {
    expect(clip("Shop * more", 9)).toBe("Shop...");
    expect(clip("Shop † more", 9)).toBe("Shop...");
    expect(clip("Shop •* more", 10)).toBe("Shop...");
    expect(clip("Pay €* now less", 9)).toBe("Pay...");
  });
});

describe("R18-2: after sentence punctuation, a conditions marker stays; other symbols still go", () => {
  it("conditions markers stay", () => {
    expect(clip("Free!* gifts", 9)).toBe("Free!*...");
    expect(clip("Free.* gifts", 9)).toBe("Free.*...");
    expect(clip("Wow!* terms", 9)).toBe("Wow!*...");
  });
  it("other symbols still go", () => {
    expect(clip("Hello!!& more", 11)).toBe("Hello...");
    expect(clip("Yahoo!™ xyz", 10)).toBe("Yahoo...");
    expect(clip("Shop.★ more", 9)).toBe("Shop...");
  });
});

describe("R18-3: a „ closed by “", () => {
  it("German: the “ closes, and stays, with its conditions marker", () => {
    expect(clip("Sale „Big“* now", 14)).toBe("Sale „Big“*...");
    expect(clip("Sale „Big“ now on", 13)).toBe("Sale „Big“...");
    expect(clip("Sale ‚Big‘ now on", 13)).toBe("Sale ‚Big‘...");
  });
  it("English: “ opens, and goes when lone; ” closes, and stays", () => {
    expect(clip("Say “ hello there", 9)).toBe("Say...");
    expect(clip("Say “hi” to all", 12)).toBe("Say “hi”...");
  });
});

describe("fuzz: the conditions property", () => {
  it("a conditions marker attached to what qualifies it is never dropped at the cut", () => {
    const ALPHABET = [
      ..."aaaaeeeo555", "C", "日", ..."          ", ..."******††‡‡", ..."%+)\"'", "”", "„", "“", "‚", "‘",
      ",", ".", "!", "…", "—", "(", "&", "•", "#", "★", "€", "$", "™", "。", "🎉", "👍🏽",
    ];
    let seed = 0x3118;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const N = 12000;
    let fired = 0;
    for (let n = 0; n < N; n++) {
      // Words, often with a marker on them (after a letter, a kept mark or sentence punctuation), and junk, by spaces.
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
      const junk = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(ALPHABET)).join("");
      const word = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(["a", "e", "o", "5", "C", "日"])).join("");
      const marked = () => `${word()}${pick(["", "%", "+", ")", "”", "!", ".", "€", "•", "&"])}${pick(["*", "**", "†", "‡", "*†"])}`;
      const t = Array.from({ length: 2 + Math.floor(rand() * 6) }, () => pick([word, marked, marked, junk])()).join(pick([" ", " ", "  ", String.fromCharCode(0xa0)]));
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
      expect(clipConditionsViolation(t, max, kept), at).toBeNull();
      expect(clipEndViolation(t, kept), at).toBeNull();
      expect(clipKeepViolation(t, max, kept), at).toBeNull();
      if (hasWordOrEmoji(t)) expect(hasWordOrEmoji(kept), at).toBe(true);
      if (clipConditionsTokens(t, max, kept).length > 0) fired++;
    }
    console.info(`R18 conditions property fired in ${fired} of ${N} cases (${((fired / N) * 100).toFixed(1)}%)`);
    expect(fired / N).toBeGreaterThanOrEqual(0.15);
  });
});
