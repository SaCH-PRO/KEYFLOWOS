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
 * The public payload carries no country for the storefront, so a local
 * number reads with the default market (TT, +1 868); the visitor's own
 * signed-in workspace (if they run a business too) never decides it.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

import { ContactSection } from "../components/contact-section";
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

function business(whatsapp: string | null): Business {
  return {
    id: "biz_wa_public",
    name: "Sweet Treats",
    slug: "sweet-treats",
    timezone: "America/Port_of_Spain",
    currency: "TTD",
    whatsapp,
  };
}

function contactWhatsApp(whatsapp: string | null): string | null {
  render(<ContactSection business={business(whatsapp)} primaryColor="#111" secondaryColor="#222" />);
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

  it("the share buttons still open WhatsApp's chooser with the page's title, description and link", () => {
    render(<ShareButtons url="https://app.keyflow.test/book/sweet-treats" title="Sweet Treats" description="Cakes to order" />);
    const share = screen.queryAllByRole("link").find((a) => /wa\.me/.test(a.getAttribute("href") ?? ""));
    expect(share?.getAttribute("href")).toBe(
      `https://wa.me/?text=${encodeURIComponent("Sweet Treats - Cakes to order\nhttps://app.keyflow.test/book/sweet-treats")}`,
    );
  });
});
