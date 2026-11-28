/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 19 (review of f0d0a54, D-303, D-315): clip()'s conditions rule.
 *
 *   R19-1  linear time: a run of conditions markers is skipped once and the grapheme before it decided once, so a
 *          lone run of 40 stars clips in well under 50 ms (f0d0a54 doubled the time with every marker)
 *   R19-2  a marker keeps punctuation before it only when that punctuation is itself attached (sentence punctuation
 *          whose run reaches back to a word or a kept mark: "Free!*", "Free!!*"); never an opening bracket or quote,
 *          or a dash; after a lone mark it goes with it ("Shop (*", "Shop —*", "Say “*", "Shop !*", "Shop ,*",
 *          "Shop &!*" give "Shop..." and "Say...")
 *   R19-3  the oracles: a lone run of always- or lone-dropped characters at the end; "€" and a „-closing "“" as
 *          holders; the fuzz's marked() makes "lone always-dropped mark + marker" shapes
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipConditionsTokens, clipConditionsViolation, clipEndViolation, clipKeepViolation, hasWordOrEmoji } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);

describe("R19-1: linear time", () => {
  it("40 lone stars at the cut, in under 50 ms", () => {
    const t = `Shop ${"*".repeat(40)} more text here`;
    const t0 = performance.now();
    const out = clip(t, 49);
    const dt = performance.now() - t0;
    expect(out).toBe("Shop...");
    expect(dt).toBeLessThan(50);
  });
  it("attached runs of 40, and of markers broken by marks, in under 50 ms each", () => {
    for (const t of [`Free${"*".repeat(40)} more text`, `Free!${"*".repeat(40)} more text`, `Shop ${"*&".repeat(20)} more text`, `Shop ${"!*".repeat(20)} more text`]) {
      const t0 = performance.now();
      const out = clip(t, G(t).length - 7);
      const dt = performance.now() - t0;
      expect(out.endsWith("..."), t).toBe(true);
      expect(dt, t).toBeLessThan(50);
    }
  });
  it("fuzz: inputs up to 500 graphemes, heavy in markers and marks, each in under 10 ms (best of 3 per input; measured worst under 1 ms)", () => {
    const PARTS = ["*", "*", "*", "†", "‡", "!", ".", ",", "(", "—", "“", "&", "€", "%", ")", " ", " ", "a", "5"];
    let seed = 0x3119;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Warm up first, so the bound measures clip() (linear: about 0.4 ms at 1,600 graphemes), not the JIT.
    for (let w = 0; w < 50; w++) clip(`Shop ${"*•!&(€".repeat(40)} x more`, 100 + w);
    let worst = 0;
    for (let n = 0; n < 300; n++) {
      const len = 50 + Math.floor(rand() * 450);
      const t = Array.from({ length: len }, () => PARTS[Math.floor(rand() * PARTS.length)]).join("");
      const max = 4 + Math.floor(rand() * len);
      // Best of 3, so a garbage-collection pause is not taken for clip()'s time.
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        clip(t, max);
        best = Math.min(best, performance.now() - t0);
      }
      worst = Math.max(worst, best);
    }
    console.info(`R19-1 worst clip() time over 300 inputs of 50-500 graphemes: ${worst.toFixed(2)} ms`);
    expect(worst).toBeLessThan(10);
  });
});

describe("R19-2: a marker after a lone mark goes with it", () => {
  it("the review's six", () => {
    expect(clip("Shop (* more", 10)).toBe("Shop...");
    expect(clip("Shop —* more", 10)).toBe("Shop...");
    expect(clip("Say “* more", 9)).toBe("Say...");
    expect(clip("Shop !* more", 10)).toBe("Shop...");
    expect(clip("Shop ,* more", 10)).toBe("Shop...");
    expect(clip("Shop &!* more", 11)).toBe("Shop...");
  });
  it("attached sentence punctuation keeps it", () => {
    expect(clip("Free!* gifts", 9)).toBe("Free!*...");
    expect(clip("Free.* gifts", 9)).toBe("Free.*...");
    expect(clip("Wow!* terms", 9)).toBe("Wow!*...");
    expect(clip("Free!!* gifts", 10)).toBe("Free!!*...");
    expect(clip("Free,* gifts", 9)).toBe("Free,*...");
  });
  it("an opening bracket or quote, or a dash, never holds it, even attached", () => {
    expect(clip("Free(* gifts", 9)).toBe("Free...");
    expect(clip("Free—* gifts", 9)).toBe("Free...");
    expect(clip("Free“* gifts", 9)).toBe("Free...");
  });
  it("R18's kept forms still keep it", () => {
    expect(clip("Get 50 %* off all items", 12)).toBe("Get 50 %*...");
    expect(clip("( sale )* today only", 12)).toBe("( sale )*...");
    expect(clip("Was 5 €* now less", 11)).toBe("Was 5 €*...");
    expect(clip("Sale „Big“* now", 14)).toBe("Sale „Big“*...");
    expect(clip("Free** delivery", 9)).toBe("Free**...");
    expect(clip("Shop •* more", 10)).toBe("Shop...");
    expect(clip("Pay €* now less", 9)).toBe("Pay...");
  });
});

describe("R19-3: fuzz, with lone always-dropped mark + marker shapes", () => {
  it("the conditions, end and keep properties", () => {
    const ALPHABET = [
      ..."aaaaeeeo555", "C", "日", ..."          ", ..."******††‡‡", ..."%+)\"'", "”", "„", "“", "‚", "‘",
      ",", ".", "!", "…", "—", "(", "&", "•", "#", "★", "€", "$", "™", "。", "🎉", "👍🏽",
    ];
    let seed = 0x3120;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const junk = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(ALPHABET)).join("");
    const word = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(["a", "e", "o", "5", "C", "日"])).join("");
    const mark = () => pick(["*", "**", "†", "‡", "*†"]);
    const marked = () => `${word()}${pick(["", "%", "+", ")", "”", "!", ".", "!!", ",", "€", "•", "&", "(", "—", "“"])}${mark()}`;
    // R19-3: a lone always-dropped (or lone-dropped) mark with a marker, as its own token: "(*", "—*", "!*", "&!*".
    const loneMarked = () => `${pick(["(", "—", "“", "!", ",", ".", "&", "•", "&!", "€"])}${mark()}`;
    const N = 12000;
    let fired = 0;
    let lone = 0;
    for (let n = 0; n < N; n++) {
      const t = Array.from({ length: 2 + Math.floor(rand() * 6) }, () => pick([word, marked, marked, loneMarked, junk])()).join(pick([" ", " ", "  ", String.fromCharCode(0xa0)]));
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
      if (/\s[(—“!,.&•€]+[*†‡]+(\s|$)/u.test(Array.from(G(t)).slice(0, max - 3).join("") + " ")) lone++;
    }
    console.info(`R19-3 conditions property fired in ${fired} of ${N}; a lone mark + marker in the room in ${lone}`);
    expect(fired / N).toBeGreaterThanOrEqual(0.15);
    expect(lone / N).toBeGreaterThanOrEqual(0.1);
  });
});

describe("R19 addendum: near-linear time, more lone shapes, '…'", () => {
  const timed = (t: string, max: number) => {
    const t0 = performance.now();
    const out = clip(t, max);
    return { out, ms: performance.now() - t0 };
  };
  it("the review's timing pins, each in under 50 ms", () => {
    for (const [t, max] of [
      [`Shop ${"*".repeat(150)} x`, 158],
      [`Shop ${"*".repeat(150)} x and more`, 158],
      [`Shop ${"*•".repeat(100)} x`, 205],
      [`Shop ${"*•".repeat(100)} x and more`, 205],
      [`${"*".repeat(200)}${"x".repeat(100)}`, 25],
      [`${"*".repeat(22)}${"x".repeat(100)}`, 25],
      [`Shop ${"*".repeat(40)} more text here`, 49],
    ] as [string, number][]) {
      const { ms } = timed(t, max);
      expect(ms, `${t.slice(0, 30)} @${max}`).toBeLessThan(50);
    }
  });
  it("the cut right after a long run (the review's widths fit whole or cut inside the run), in under 50 ms", () => {
    // At width run + 9 the room ends just past the run's trailing space, so the kept part is "Shop " + the run, and
    // dropTrailing walks all of it: 6,000 stars take a few ms; re-skipping the marker run per marker took ~70 ms at 3,000.
    for (const run of ["*".repeat(6000), "*•".repeat(3000), "*&".repeat(3000), "!*".repeat(3000)]) {
      const t = `Shop ${run} xyz more`;
      timed(t, run.length + 9);
      const { out, ms } = timed(t, run.length + 9);
      expect(out, run.slice(0, 4)).toBe("Shop...");
      expect(ms, run.slice(0, 4)).toBeLessThan(50);
    }
  });
  it("fuzz: long mark-heavy inputs (alternating runs, the fallback), worst under 10 ms", () => {
    const RUNS = ["*", "*•", "*!", "*&", "†.", "*(", "€*", "!*", " *", "**x"];
    let seed = 0x3121;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let w = 0; w < 50; w++) clip(`Shop ${"*•!&(€".repeat(40)} x more`, 100 + w);
    let worst = 0;
    for (let n = 0; n < 200; n++) {
      const run = RUNS[Math.floor(rand() * RUNS.length)].repeat(20 + Math.floor(rand() * 200));
      const t = [`Shop ${run} x more`, `${run}${"x".repeat(100)}`, `Free${run} gifts and more`][n % 3];
      const max = 4 + Math.floor(rand() * G(t).length);
      worst = Math.max(worst, Math.min(timed(t, max).ms, timed(t, max).ms, timed(t, max).ms));
    }
    console.info(`R19 addendum worst clip() time over 200 long mark-heavy inputs: ${worst.toFixed(2)} ms`);
    expect(worst).toBeLessThan(10);
  });
  it("more lone shapes give the base word", () => {
    expect(clip("Free (* more", 10)).toBe("Free...");
    expect(clip("Shop „* more", 10)).toBe("Shop...");
    expect(clip("Shop -* more", 10)).toBe("Shop...");
    expect(clip("Free [* more", 10)).toBe("Free...");
  });
  it("'…' attached holds a marker, as other sentence terminals do; lone, it does not", () => {
    expect(clip("Wait…* more soon", 9)).toBe("Wait…*...");
    expect(clip("Wait …* more soon", 10)).toBe("Wait...");
  });
});
