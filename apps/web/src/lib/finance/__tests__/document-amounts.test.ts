/**
 * SWP-INV-MATH (BUG-018, BUG-019; taxorder ruling D-164: nothing changes until the accountant answers, so the
 * server's order stands): every web preview of an invoice or quote computes its amounts exactly as the server saves
 * them, through one lib/finance/document-amounts.ts.
 *
 * The server rule is apps/server/src/modules/commerce/money.ts computeDocumentAmounts: each line rounded to cents,
 * subtotal the sum, tax = taxRate percent of the subtotal BEFORE the discount, discount = percent of the subtotal or
 * a fixed amount, total = subtotal + tax - discount, all in exact integer cents. The web previews took tax after the
 * discount (new and edit invoice) and multiplied floats (every preview), so the preview disagreed with the saved total.
 *
 * This spec pins the web module to the server function itself (imported from the server source, which has no
 * imports of its own), on fixed cases and on seeded random documents, and pins the form-string reader the screens use.
 *
 *   DA-01  RED-BEFORE  the module exists and exports computeDocumentAmounts and documentAmountsFromForm
 *   DA-02  RED-BEFORE  fixed cases equal the server: tax before discount (1066.00, not 1053.00), cent-exact lines
 *                      (3 x 1.115 = 3.35, 7 x 0.145 = 1.02), FIXED discount, no tax, a cleared tax rate
 *   DA-03  RED-BEFORE  2,000 seeded random documents equal the server field for field
 *   DA-04  RED-BEFORE  the form reader parses the strings the forms hold: blank or invalid quantity, price, tax rate
 *                      or discount count as 0, a blank discount means none
 */
import { describe, it, expect } from "vitest";
import { computeDocumentAmounts as serverAmounts } from "../../../../../server/src/modules/commerce/money";

type Amounts = { lineTotals: number[]; subtotal: number; taxAmount: number; discountAmount: number; total: number };
type Input = { lines: number[]; taxRate?: number | null; discountType?: string | null; discountValue?: number | null };
type FormInput = {
  items: Array<{ quantity: string; unitPrice: string }>;
  taxRate: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
};
type Mod = {
  computeDocumentAmounts?: (input: Input) => Amounts;
  documentAmountsFromForm?: (form: FormInput) => Amounts;
  lineAmount?: (quantity: number, unitPrice: number) => number;
};

async function load(): Promise<Mod> {
  try {
    // The path is a variable so the file loads (and names what is missing) before the module exists.
    const path = "../document-amounts";
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return {};
  }
}

/** A seeded generator (mulberry32), so a failing case reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SWP-INV-MATH: one document-amounts module, equal to the server", () => {
  it("DA-01 RED-BEFORE: the module exports computeDocumentAmounts, documentAmountsFromForm and lineAmount", async () => {
    const mod = await load();
    expect(typeof mod.computeDocumentAmounts, "computeDocumentAmounts").toBe("function");
    expect(typeof mod.documentAmountsFromForm, "documentAmountsFromForm").toBe("function");
    expect(typeof mod.lineAmount, "lineAmount").toBe("function");
  });

  it("DA-02 RED-BEFORE: fixed cases equal the server rule", async () => {
    const mod = await load();
    expect(typeof mod.computeDocumentAmounts).toBe("function");
    const cases: Input[] = [
      // Journey D's quote: a TTD 800 cake and 24 cupcakes at 10, 12.5% tax, 10% off: tax on 1040 before the discount.
      { lines: [800, 240], taxRate: 12.5, discountType: "PERCENT", discountValue: 10 },
      { lines: [100, 100, 50], taxRate: null, discountType: null, discountValue: null },
      { lines: [99.99], taxRate: 12.5, discountType: "FIXED", discountValue: 5 },
      { lines: [0.1, 0.2], taxRate: 0, discountType: "PERCENT", discountValue: 0 },
      { lines: [8.36], taxRate: 12.5, discountType: null, discountValue: null },
    ];
    for (const c of cases) expect(mod.computeDocumentAmounts!(c), JSON.stringify(c)).toEqual(serverAmounts(c));
    expect(mod.computeDocumentAmounts!(cases[0]!).total).toBe(1066);
    expect(mod.lineAmount!(3, 1.115)).toBe(3.35);
    expect(mod.lineAmount!(7, 0.145)).toBe(1.02);
  });

  it("DA-03 RED-BEFORE: 2,000 seeded random documents equal the server field for field", async () => {
    const mod = await load();
    expect(typeof mod.computeDocumentAmounts).toBe("function");
    const r = rng(20261124);
    const money = () => Math.round(r() * 500000) / 100; // 0.00 .. 5000.00
    const qty = () => (r() < 0.7 ? 1 + Math.floor(r() * 30) : Math.round(r() * 2000) / 100); // whole or two-decimal
    const rates = [0, 12.5, 15, 7.5, 10, 0.5];
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(r() * 6);
      const lineInputs = Array.from({ length: n }, () => [qty(), money()] as const);
      const lines = lineInputs.map(([q, p]) => mod.lineAmount!(q, p));
      const pick = r();
      const input: Input = {
        lines,
        taxRate: rates[Math.floor(r() * rates.length)]!,
        discountType: pick < 0.4 ? "PERCENT" : pick < 0.7 ? "FIXED" : null,
        discountValue: pick < 0.4 ? Math.round(r() * 5000) / 100 : pick < 0.7 ? Math.round(r() * 20000) / 100 : null,
      };
      expect(mod.computeDocumentAmounts!(input), `case ${i}: ${JSON.stringify(input)}`).toEqual(serverAmounts(input));
    }
  });

  it("DA-04 RED-BEFORE: the form reader parses the strings the forms hold", async () => {
    const mod = await load();
    expect(typeof mod.documentAmountsFromForm).toBe("function");
    const form: FormInput = {
      items: [
        { quantity: "1", unitPrice: "800" },
        { quantity: "24", unitPrice: "10" },
        { quantity: "", unitPrice: "50" }, // blank quantity: 0, as the screens read it
        { quantity: "2", unitPrice: "abc" }, // invalid price: 0
      ],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "10",
    };
    expect(mod.documentAmountsFromForm!(form)).toEqual(
      serverAmounts({ lines: [800, 240, 0, 0], taxRate: 12.5, discountType: "PERCENT", discountValue: 10 }),
    );
    // A cleared tax rate and a blank discount: no tax, no discount.
    expect(mod.documentAmountsFromForm!({ ...form, taxRate: "", discountValue: "" })).toEqual(
      serverAmounts({ lines: [800, 240, 0, 0], taxRate: 0, discountType: null, discountValue: null }),
    );
    expect(mod.documentAmountsFromForm!({ items: [{ quantity: "3", unitPrice: "1.115" }], taxRate: "", discountType: "FIXED", discountValue: "" }).total).toBe(3.35);
  });
});
