/**
 * WA-HELPER (whatsapp ruling D-153): on the customer pages the WhatsApp
 * buttons open a chat with the business's own number, built by
 * lib/whatsapp.ts. Recorded exception to "customer pages after
 * SWP-INV-PUBLIC-LINK": only the link construction changes here (no payload,
 * route, copy or layout change).
 *
 * Before this packet the contact section built `https://wa.me/<digits as
 * typed>`, so a business that saved its WhatsApp as '868-755-0123' sent every
 * customer to wa.me/8687550123, a dead chat (no country code).
 *
 * The business's own country decides a local number: the storefront's
 * public payload (GET /identity/businesses/slug/:slug, PUBLIC_BUSINESS_FIELDS)
 * serves Business.country, as pay/link's does. Repair (review of 087b0365,
 * WAH-CR-3): the storefront ignored it and read every business number with
 * the default market (TT, +1 868), so a Jamaican business's '555-0123' sent
 * its customers to a Trinidad stranger (/pay/link opened the business's own
 * chat). With no country the default market applies; the visitor's own
 * signed-in workspace (if they run a business too) never decides it.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

import { ContactSection } from "../components/contact-section";
import { BusinessHero } from "../components/business-hero";
import { ShareButtons } from "../components/share-buttons";
import type { Business } from "../components/types";
import { setCachedBusiness } from "@/lib/workspace";

beforeAll(() => {
  // jsdom has no IntersectionObserver; the section only uses it to fade in.
  class NoopObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
});

afterEach(() => {
  cleanup();
  setCachedBusiness({ id: "biz_visitor", name: "Visitor's own business" });
});

function business(whatsapp: string | null, country?: string | null): Business {
  return {
    id: "biz_wa_public",
    name: "Sweet Treats",
    slug: "sweet-treats",
    timezone: "America/Port_of_Spain",
    currency: "TTD",
    whatsapp,
    // The public slug payload's country (PUBLIC_BUSINESS_FIELDS.country).
    ...(country !== undefined ? ({ country } as Partial<Business>) : {}),
  };
}

function contactWhatsApp(whatsapp: string | null, country?: string | null): string | null {
  render(<ContactSection business={business(whatsapp, country)} primaryColor="#111" secondaryColor="#222" />);
  const link = screen.queryAllByRole("link").find((a) => /wa\.me/.test(a.getAttribute("href") ?? ""));
  return link ? link.getAttribute("href") : null;
}

describe("WA-HELPER customer pages: WhatsApp opens the business's own number", () => {
  it.each(["755-0123", "868-755-0123", "(868) 755-0123", "+1 868 755 0123"])(
    "the business's WhatsApp saved as %j: wa.me/18687550123, with the section's own message",
    (typed) => {
      const href = contactWhatsApp(typed);
      expect(href).not.toBeNull();
      const url = new URL(href!);
      expect(url.origin + url.pathname).toBe("https://wa.me/18687550123");
      expect(url.searchParams.get("text")).toBe("Hi Sweet Treats, I'd like to get in touch.");
    },
  );

  it("the visitor's own workspace country never decides the business's number", () => {
    setCachedBusiness({ id: "biz_visitor", name: "Visitor's own business", country: "United Kingdom" } as Parameters<typeof setCachedBusiness>[0]);
    expect(new URL(contactWhatsApp("755-0123")!).pathname).toBe("/18687550123");
  });

  // WAH-CR-3 (RED at 087b0365: wa.me/18685550123, a Trinidad number, not the business).
  it("a Jamaican business's '555-0123' opens the business's own chat (+1 876), as /pay/link does", () => {
    const href = contactWhatsApp("555-0123", "Jamaica");
    expect(new URL(href!).origin + new URL(href!).pathname).toBe("https://wa.me/18765550123");
  });

  it("the hero's WhatsApp reads the business's number with its own country too", () => {
    render(<BusinessHero business={business("555-0123", "Jamaica")} primaryColor="#111" secondaryColor="#222" accentColor="#333" />);
    const link = screen.getByRole("link", { name: "WhatsApp" });
    expect(link.getAttribute("href")).toBe("https://wa.me/18765550123");
  });

  it("a business in a country the helper does not know never sends its customers to a Trinidad stranger", () => {
    const href = contactWhatsApp("555-0123", "Other Caribbean");
    expect(new URL(href!).pathname).toBe("/");
  });

  it("the share buttons still open WhatsApp's chooser with the page's title, description and link", () => {
    render(<ShareButtons url="https://app.keyflow.test/book/sweet-treats" title="Sweet Treats" description="Cakes to order" />);
    const share = screen.queryAllByRole("link").find((a) => /wa\.me/.test(a.getAttribute("href") ?? ""));
    expect(share?.getAttribute("href")).toBe(
      `https://wa.me/?text=${encodeURIComponent("Sweet Treats - Cakes to order\nhttps://app.keyflow.test/book/sweet-treats")}`,
    );
  });
});
