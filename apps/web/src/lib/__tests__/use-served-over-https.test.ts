/**
 * P238 (D-331): the scheme check behind every "SSL Encrypted" claim is one function. P231 wrote it in the storefront's
 * trust-bar.tsx and P238 in src/lib (P231 was still in the merge queue); with both on main, the storefront uses the
 * src/lib one, so the homepage and the customer pages can never disagree about when the claim is true.
 */
import { describe, it, expect } from "vitest";

import { useServedOverHttps } from "../use-served-over-https";
import { useServedOverHttps as storefrontCheck } from "@/app/book/[slug]/components/trust-bar";

describe("P238: one scheme check for every 'SSL Encrypted' claim", () => {
  it("the storefront's useServedOverHttps is the src/lib one", () => {
    expect(storefrontCheck, "the storefront has its own copy of the scheme check").toBe(useServedOverHttps);
  });
});
