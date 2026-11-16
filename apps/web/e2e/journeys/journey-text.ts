/**
 * Readers of what a journey's page shows, shared by the journey specs, with no
 * Playwright runtime (pinned by src/__tests__/journey-specs-a-f.test.ts). The
 * browser side of each check collects the text; these decide what it says.
 */

/**
 * The first amount shown after a label in a block of text, with its sign, or
 * null when none follows within about 40 characters.
 *
 * Reads the totals layout the app's documents use (the invoice public page,
 * the invoice detail, the PDF templates): "Revenue TTD 400.00" -> 400,
 * "Tax (12.5%) TTD 130.00" -> 130 (a rate after the label, bracketed or not,
 * is part of the label), "Discount -TTD 104.00" -> -104 (a minus before the
 * currency or the figure is the amount's sign; compare a discount by its
 * size), "Tax TTD 130.00 (12.5%)" -> 130 (a figure followed by % is a rate,
 * never the amount).
 */
export function amountAfter(text: string, label: RegExp): number | null {
  const flags = label.flags.includes("i") ? "i" : "";
  const rateAfterLabel = String.raw`(?:\s*\(\s*-?[0-9][0-9.,]*\s*%\s*\)|\s*\([^)0-9]{1,40}\)|\s*-?[0-9][0-9.,]*\s*%)?`;
  const re = new RegExp(
    `(?:${label.source})${rateAfterLabel}[^0-9-]{0,40}?(-)?\\s*(?:[A-Za-z]{3}\\s*|[$€£]\\s*)?(-)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)(?![0-9]|[.,][0-9]|\\s*%)`,
    flags,
  );
  const m = text.match(re);
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, ""));
  return m[1] || m[2] ? -value : value;
}

/** A visible text naming KEY outside the manual onboarding form, as A3's browser side collects it. */
export interface KeyTextCandidate {
  /** The text node's text. */
  text: string;
  /** Its element's top, in viewport pixels. */
  top: number;
  /**
   * True when it sits on a button or link inside the app header (<header> or
   * role=banner): the header's KEY door, which journey K requires ('KEY opens
   * only from the header button'), not a KEY card.
   */
  headerDoor: boolean;
  /** Where it is, for the report (the nearest control's tag and classes). */
  where: string;
}

/**
 * A3's rule (no KEY card above the manual form): every KEY text above the
 * form's top that is not the header's KEY door, one line each.
 */
export function keyCardsAboveForm(candidates: readonly KeyTextCandidate[], formTop: number): string[] {
  return candidates
    .filter((c) => !c.headerDoor && c.top < formTop)
    .map((c) => `"${c.text.replace(/\s+/g, " ").trim().slice(0, 60)}" at y=${Math.round(c.top)} (form at y=${Math.round(formTop)}) inside ${c.where}`);
}

const METHOD_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/\bbank transfer\b/i, "bank transfer"],
  [/\bcash\b/i, "cash"],
  [/\bpaypal\b/i, "paypal"],
  [/\bwipay\b/i, "wipay"],
  [/\bstripe\b/i, "stripe"],
  [/\bCard\b/, "card"],
];

/**
 * The payment methods a checkout's Payment step names, each once, in one
 * spelling, sorted: "bank transfer", "card", "cash", "paypal", "stripe",
 * "wipay". "Card" counts only as a method's own name (capitalised), not the
 * word inside another's description ("Pay with credit/debit card via WiPay").
 */
export function offeredPaymentMethods(text: string): string[] {
  return METHOD_NAMES.filter(([re]) => re.test(text))
    .map(([, name]) => name)
    .sort();
}
