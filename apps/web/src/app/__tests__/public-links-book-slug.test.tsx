/**
 * CUSTOMER-PAGE-HONESTY, repair round 1 (MIN-2): /site/<slug> is now a 307 to /book/<slug>, so the public links that
 * still pointed at /site/<slug> (every sitemap entry and the directory's Visit button) send visitors and crawlers
 * through a redirect. They link to /book/<slug> directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

import sitemap from "../sitemap";
import DirectoryPage from "../directory/page";

const ITEM = {
  slug: "pepper-co",
  name: "Pepper Co",
  logoUrl: null,
  tagline: "Hot sauces",
  headline: null,
  industry: "Food",
  city: "Port of Spain",
  country: "TT",
  website: null,
  publishedAt: "2026-11-01T00:00:00Z",
};

function serveDirectory() {
  const body = { items: [ITEM], total: 1, page: 1, pageSize: 24, pageCount: 1, filters: { industries: [], cities: [] } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public links name /book/<slug>, not /site/<slug>", () => {
  it("the sitemap lists each published business at /book/<slug>", async () => {
    serveDirectory();
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.filter((u) => u.includes("/site/")), "sitemap entries that redirect").toEqual([]);
    expect(urls.some((u) => u.endsWith("/book/pepper-co"))).toBe(true);
  });

  it("the directory's Visit button opens /book/<slug>", async () => {
    serveDirectory();
    render(<DirectoryPage />);
    const visit = await screen.findByRole("link", { name: /visit/i });
    expect(visit.getAttribute("href")).toBe("/book/pepper-co");
  });
});
