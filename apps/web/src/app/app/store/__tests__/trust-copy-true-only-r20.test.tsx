/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 20 (reviews of 7153016, D-303, D-315): a conditions marker after
 * attached sentence punctuation stays whenever what that punctuation is attached to stays.
 *
 *   R20-1  the reach-back before sentence punctuation asks one "does it stay" question: content, a kept mark, a
 *          „-closing "“", a number's currency run, a held marker ("Free*!†"), or a mark whose run reaches content
 *          ("C#!*", "5™?†", "Off&！‡"); R19-2's lone shapes still go
 *   R20-2  ";" and ":" never hold a marker ("Free;*", "Free:*" give "Free...")
 *   R20-3  the run and currency look-ups are exact for every position (computed per position, not cached by range)
 *   fuzz   the conditions property with the oracle's own "stays" predicate (trust-copy-allowlist.ts oracleHeld)
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipConditionsTokens, clipConditionsViolation, clipEndViolation, clipKeepViolation, hasWordOrEmoji } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);
/** The prefix `p` as the kept part: `p + " more words"` cut at |p| + 3, so the room ends at the space after `p`. */
const atEnd = (p: string) => clip(`${p} more words here`, G(p).length + 4);

describe("R20-1: the marker stays while what its sentence punctuation is attached to stays", () => {
  it("a number's currency run", () => {
    expect(atEnd("Save 5 €!*")).toBe("Save 5 €!*...");
    expect(atEnd("Only 1$.*")).toBe("Only 1$.*...");
    expect(atEnd("1€，†")).toBe("1€，†...");
    expect(atEnd("1$。*")).toBe("1$。*...");
    expect(atEnd("50$!††")).toBe("50$!††...");
  });
  it("a „-closing “, as English ” does", () => {
    expect(atEnd("Sale „Big“!*")).toBe("Sale „Big“!*...");
    expect(atEnd("Sale “Big”!*")).toBe("Sale “Big”!*...");
  });
  it("a mark whose run reaches a word", () => {
    expect(atEnd("Shop C#!*")).toBe("Shop C#!*...");
    expect(atEnd("Shop C#.*")).toBe("Shop C#.*...");
    expect(atEnd("Off&！‡")).toBe("Off&！‡...");
    expect(atEnd("C$?*")).toBe("C$?*...");
    expect(atEnd("5™?†")).toBe("5™?†...");
    expect(atEnd("🎉•，†")).toBe("🎉•，†...");
    expect(atEnd("Shop C#*")).toBe("Shop C#*...");
  });
  it("a held marker (the chain)", () => {
    expect(atEnd("Free*!†")).toBe("Free*!†...");
    expect(atEnd("Free!†")).toBe("Free!†...");
  });
  it("(controls) R19-2's lone shapes still go", () => {
    expect(clip("Shop (* more", 10)).toBe("Shop...");
    expect(clip("Shop —* more", 10)).toBe("Shop...");
    expect(clip("Say “* more", 9)).toBe("Say...");
    expect(clip("Shop !* more", 10)).toBe("Shop...");
    expect(clip("Shop ,* more", 10)).toBe("Shop...");
    expect(clip("Shop &!* more", 11)).toBe("Shop...");
    expect(clip("Free (* more", 10)).toBe("Free...");
    expect(clip("Shop „* more", 10)).toBe("Shop...");
    expect(clip("Shop -* more", 10)).toBe("Shop...");
    expect(clip("Free [* more", 10)).toBe("Free...");
    expect(clip("Free(* gifts", 9)).toBe("Free...");
    expect(clip("Free—* gifts", 9)).toBe("Free...");
    expect(clip("Free“* gifts", 9)).toBe("Free...");
    expect(clip("Wait …* more soon", 10)).toBe("Wait...");
    expect(clip("Shop •* more", 10)).toBe("Shop...");
    expect(clip("Pay €* now less", 9)).toBe("Pay...");
    // A lone mark's run does not reach a word, so sentence punctuation after it holds nothing.
    expect(atEnd("Shop •!*")).toBe("Shop...");
    expect(atEnd("Pay €!*")).toBe("Pay...");
  });
});

describe("R20-2: ';' and ':' never hold a marker", () => {
  it("each", () => {
    expect(clip("Free;* more", 9)).toBe("Free...");
    expect(clip("Free:* more", 9)).toBe("Free...");
  });
});

describe("R20-3: exact per-position look-ups", () => {
  it("runs of different kinds back to back are each decided on their own", () => {
    // A run reaching a word, sentence punctuation, then a lone run: the lone run's start is not the first run's.
    expect(atEnd("C#!* &*")).toBe("C#!*...");
    expect(atEnd("5 €!* •*")).toBe("5 €!*...");
    expect(atEnd("Off&! &&")).toBe("Off&...");
  });
});

describe("fuzz: the conditions property, with the oracle's stays predicate", () => {
  it("a held marker is never dropped at the cut; lone shapes are", () => {
    let seed = 0x3220;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const word = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(["a", "e", "C", "5", "日", "🎉"])).join("");
    const mark = () => pick(["*", "**", "†", "‡", "*†"]);
    const pre = () => pick(["", "€", "$", "#", "&", "™", "•", "“", "”", "%", ")", "*", "!", ".", "(", "—", "„"]);
    const punct = () => pick(["", "!", ".", "?", "…", ",", "，", "！", "。", ";", ":", "!!"]);
    const shaped = () => `${pick(["", word()])}${pre()}${punct()}${mark()}`;
    const N = 12000;
    let fired = 0;
    for (let n = 0; n < N; n++) {
      const t = Array.from({ length: 2 + Math.floor(rand() * 5) }, () => pick([word, shaped, shaped, () => `${word()} ${pick(["€", "$"])}`])()).join(pick([" ", " ", "  "]));
      const max = 6 + Math.floor(rand() * 18);
      const out = clip(t, max);
      const at = `${JSON.stringify(t)} @${max} -> ${JSON.stringify(out)}`;
      if (G(t).length <= max) {
        expect(out, at).toBe(t);
        continue;
      }
      if (t.trim() === "") continue;
      const kept = out.slice(0, -3);
      expect(clipConditionsViolation(t, max, kept), at).toBeNull();
      expect(clipEndViolation(t, kept), at).toBeNull();
      expect(clipKeepViolation(t, max, kept), at).toBeNull();
      if (hasWordOrEmoji(t)) expect(hasWordOrEmoji(kept), at).toBe(true);
      if (clipConditionsTokens(t, max, kept).length > 0) fired++;
    }
    console.info(`R20 conditions property (oracle stays) fired in ${fired} of ${N}`);
    expect(fired / N).toBeGreaterThanOrEqual(0.15);
  });
});
