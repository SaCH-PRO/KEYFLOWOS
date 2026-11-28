/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 15 (reviews of 8d6cc4e, D-308, D-315), under D-303: clip().
 *
 *   R15-1  a run of symbols attached to the word before it stays whole ("4★★", "Free**", "C##"); a lone run goes
 *   R15-2  CJK and full-width sentence punctuation goes at the cut, as ASCII does ("Hello！", "日本語、")
 *   R15-3  only a real emoji is kept as one: ©, ®, ™, ‼ and ↔ (text-style, though Extended_Pictographic) go when lone;
 *          ❤️ (with U+FE0F) stays
 *   R15-4  the never-dropped marks stay when lone too: "50 %", "1 +", a spaced closing bracket, a closing quote
 *   R15-5  fuzz, against properties independent of clip()'s own rules (trust-copy-allowlist.ts clipEndViolation)
 */
import { describe, it, expect } from "vitest";
import { clip } from "../storefront-counts";
import { clipEndViolation, hasWordOrEmoji } from "./trust-copy-allowlist";

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const G = (t: string) => Array.from(seg.segment(t), (s) => s.segment);

describe("R15-1: a run of attached symbols stays whole", () => {
  it("attached runs", () => {
    expect(clip("Rated 4★★ by all", 12)).toBe("Rated 4★★...");
    expect(clip("Free** delivery", 9)).toBe("Free**...");
    expect(clip("C## rocks", 7)).toBe("C##...");
  });
  it("a lone run goes", () => {
    expect(clip("Shop && more", 10)).toBe("Shop...");
    expect(clip("Shop ★★ more", 10)).toBe("Shop...");
  });
});

describe("R15-2: CJK and full-width sentence punctuation goes", () => {
  it("each", () => {
    expect(clip("Hello！ there", 10)).toBe("Hello...");
    expect(clip("日本語、テスト です", 7)).toBe("日本語...");
    expect(clip("今日は。 明日も", 7)).toBe("今日は...");
    expect(clip("Hello， there", 10)).toBe("Hello...");
    expect(clip("Hello？ there", 10)).toBe("Hello...");
    expect(clip("Note： more", 8)).toBe("Note...");
  });
});

describe("R15-3: only a real emoji is kept as one", () => {
  it("text-style ©, ™, ↔ (and ®, ‼) go when lone, as → does", () => {
    expect(clip("Shop © 2025", 10)).toBe("Shop...");
    expect(clip("Swipe ↔ to see more", 11)).toBe("Swipe...");
    expect(clip("Swipe → to see more", 11)).toBe("Swipe...");
    expect(clip("Brand ™ sauce", 11)).toBe("Brand...");
    expect(clip("Brand ® sauce", 11)).toBe("Brand...");
    expect(clip("Wow ‼ more", 9)).toBe("Wow...");
  });
  it("attached, they are the word's: kept", () => {
    expect(clip("Pepper™ sauce", 11)).toBe("Pepper™...");
  });
  it("an emoji stays: ❤️ (U+FE0F), 🎉, 👍🏽, a flag", () => {
    expect(clip("We ❤️ hot sauce", 9)).toBe("We ❤️...");
    expect(clip("Party 🎉 tonight only", 11)).toBe("Party 🎉...");
    expect(clip("Thumbs 👍🏽 up from all", 12)).toBe("Thumbs 👍🏽...");
    expect(clip("Made in 🇹🇹 with love", 13)).toBe("Made in 🇹🇹...");
  });
});

describe("R15-4: the never-dropped marks stay when lone", () => {
  it("a lone '%' (a discount keeps its percent sign)", () => {
    expect(clip("Up to 50 % off all", 13)).toBe("Up to 50 %...");
  });
  it("a lone '+'", () => {
    expect(clip("Buy 1 + 1 free", 10)).toBe("Buy 1 +...");
  });
  it("a spaced closing bracket and a closing quote: they close what the kept part opened", () => {
    expect(clip("Open ( weekdays ) only now", 20)).toBe("Open ( weekdays )...");
    expect(clip("Say “ hello ” to all", 16)).toBe("Say “ hello ”...");
  });
});

describe("R12-R14 guarantees, kept", () => {
  it("each one", () => {
    expect(clip("Get 50% off today", 10)).toBe("Get 50%...");
    expect(clip("Open (weekdays) only now", 18)).toBe("Open (weekdays)...");
    expect(clip('Say "hello" to all', 14)).toBe('Say "hello"...');
    expect(clip("Over 500+ happy clients", 12)).toBe("Over 500+...");
    expect(clip("!!!!!!!!!!!!", 5)).toBe("!!...");
    expect(clip("Shop & Book Online", 12)).toBe("Shop...");
    expect(clip("Learn C# today", 11)).toBe("Learn C#...");
    expect(clip("Ab 5 € pro Stück", 9)).toBe("Ab 5 €...");
    expect(clip("'Wow!' she said it", 9)).toBe("'Wow!'...");
    expect(clip("Fresh, hot sauces", 10)).toBe("Fresh...");
  });
});

describe("R15-5: fuzz, against independent properties", () => {
  it("whole graphemes of the text; no whitespace, no always-dropped mark, no lone symbol before the '...'; words kept", () => {
    const ALPHABET = [
      "a", "é", "5", "C", "日", " ", String.fromCharCode(0xa0), "\t", ",", ".", "—", "!", "%", "+", "(", ")", '"', "'", "“", "”",
      "&", "•", "/", "*", "#", "@", "¿", "¡", "„", "<", "$", "€", "°", "★", "|", "©", "®", "™", "↔", "→", "‼",
      "。", "、", "，", "！", "？", "；", "：",
      "🎉", "🌶️", "👍🏽", "#️⃣", "1️⃣", "🇹🇹", "🇺🇸", "👨‍👩‍👧", "🏳️‍🌈", "❤️",
    ];
    let seed = 0x3115;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 10000; n++) {
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
      const gk = G(kept);
      expect(gt.some((_, i) => gt.slice(i, i + gk.length).join("") === kept), at).toBe(true);
      expect(clipEndViolation(t, kept), at).toBeNull();
      if (hasWordOrEmoji(t)) expect(hasWordOrEmoji(kept), at).toBe(true);
    }
  });
});
