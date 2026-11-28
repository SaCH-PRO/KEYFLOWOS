"use client";

import type { FaqEntry } from "@/lib/client";
import { unfilledFaqEntries } from "../storefront-counts";

/**
 * P231 r7-r8: the warning shown by every Save that writes the FAQ entries (each save writes the whole storefront
 * config) while some still hold a [bracketed] part: how many, and where to fill them in. It does not block the save.
 * One per tab, by the tab's saves, so it shows whichever section is open:
 * - "faq-manager": the FAQ Manager on its own, by its Save;
 * - "merchandising": the Merchandising tab (Featured, Social Proof, SEO, FAQ and Policies saves), where the FAQ is;
 * - "elsewhere": another tab (Design, Operations, Catalog).
 *
 * r9: `saves` names the tab's saves that write the config (the clause before "it as it is"), so the warning is not
 * over-broad (the Operations tab's Hours save does not write it).
 */
export function FaqPlaceholderWarning({
  entries,
  where,
  saves = "saving here saves",
}: {
  entries: FaqEntry[] | null | undefined;
  where: "faq-manager" | "merchandising" | "elsewhere";
  saves?: string;
}) {
  const n = unfilledFaqEntries(entries).length;
  if (n === 0) return null;
  const one = n === 1;
  const lead = `${one ? "1 FAQ entry still has" : `${n} FAQ entries still have`} a [bracketed] part`;
  const kept = `saves ${one ? "it as it is" : "them as they are"}`;
  const fill = `Fill ${one ? "it" : "them"} in`;
  return (
    <p role="alert" className="text-xs font-semibold" style={{ color: "hsl(var(--kf-warning))" }}>
      {where === "faq-manager"
        ? `${one ? "1 entry still has" : `${n} entries still have`} a [bracketed] part: fill it in with your own policy before you save, or your customers will see it.`
        : where === "merchandising"
          ? `${lead}: every Save on this tab ${kept}. ${fill} under FAQ & Policies, below.`
          : `${lead}: ${saves} ${kept.replace(/^saves /, "")}. ${fill} under Merchandising → FAQ & Policies.`}
    </p>
  );
}
