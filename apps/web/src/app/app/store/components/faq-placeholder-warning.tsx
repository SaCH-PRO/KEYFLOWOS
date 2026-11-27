"use client";

import type { FaqEntry } from "@/lib/client";
import { unfilledFaqEntries } from "../storefront-counts";

/**
 * P231 r7: the warning shown by any Save that writes the FAQ entries (the whole storefront config) while some still
 * hold a [bracketed] part: it says how many, and where to fill them in. It does not block the save.
 */
export function FaqPlaceholderWarning({ entries, where }: { entries: FaqEntry[] | null | undefined; where: "faq-manager" | "elsewhere" }) {
  const n = unfilledFaqEntries(entries).length;
  if (n === 0) return null;
  return (
    <p role="alert" className="text-xs font-semibold" style={{ color: "hsl(var(--kf-warning))" }}>
      {where === "faq-manager"
        ? `${n === 1 ? "1 entry still has" : `${n} entries still have`} a [bracketed] part: fill it in with your own policy before you save, or your customers will see it.`
        : `${n === 1 ? "1 FAQ entry still has" : `${n} FAQ entries still have`} a [bracketed] part: saving here saves ${n === 1 ? "it" : "them"} as ${n === 1 ? "it is" : "they are"}. Fill ${n === 1 ? "it" : "them"} in in the FAQ Manager (Merchandising → FAQ & Policies).`}
    </p>
  );
}
