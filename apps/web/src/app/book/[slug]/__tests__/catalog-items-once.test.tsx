/**
 * CATALOG-1, the web half (SWP-STORE-LISTING-WEB, BUG-054; journey B4 and G read the same page): /book/<slug>
 * names each store item once.
 *
 * WHY this test exists: 'Add to store' keeps a product on the store with a listing service (a Service whose
 * sourceProductId names the product). The public services list used to return that listing service too, so the
 * page drew the product twice: once as a product card and once as a bookable "service" with the product's name
 * and a 30 min duration (BUG-054). SWP-STORE-LISTING-SERVER (5dbaceb2, on main) took listing services out of
 * GET /bookings/public/businesses/:id/services and keeps a product off GET /commerce/public/businesses/:id/products
 * until it is added (ruling D-185). This pins the page half over those two answers: what they return, the page
 * draws once.
 *
 * Mounted on the real page; only lib/api's apiGet/apiPost (the HTTP edge) and the router are stubbed, and the
 * stubbed answers are the shapes the server's public projections return (PUBLIC_SERVICE_SELECT,
 * PUBLIC_PRODUCT_SELECT plus availability).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({ data: null, error: null })) }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: SLUG }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/book/${SLUG}`,
}));

import PublicBookingPage from "../page";

const SLUG = "pepper-co";
const BUSINESS = { id: "biz_book_once_1", name: "Pepper Co", slug: SLUG, currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };

type PublicService = { id: string; name: string; description: string | null; duration: number; price: number };
type PublicProduct = {
  id: string; name: string; description: string | null; price: number; currency: string; category: string; imageUrl: string | null;
  isActive: boolean; availableQuantity: number | null; stockStatus: string; purchasable: boolean;
};

let services: PublicService[] = [];
let products: PublicProduct[] = [];

const publicProduct = (id: string, name: string, category = "PRODUCT"): PublicProduct => ({
  id, name, description: null, price: 35, currency: "TTD", category, imageUrl: null, isActive: true,
  availableQuantity: null, stockStatus: "untracked", purchasable: true,
});

beforeAll(() => {
  class NoopObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
});

beforeEach(() => {
  window.localStorage.clear();
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path === `/site/storefront/public/${SLUG}`) return { data: { storefront: {} }, error: null };
    if (path === `/bookings/public/businesses/${BUSINESS.id}/services`) return { data: services, error: null };
    if (path === `/bookings/public/businesses/${BUSINESS.id}/staff`) return { data: [], error: null };
    if (path === `/commerce/public/businesses/${BUSINESS.id}/products`) return { data: products, error: null };
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mountAndCount(...names: string[]): Promise<Record<string, number>> {
  render(<PublicBookingPage />);
  await screen.findAllByText(names[0], { exact: true });
  const counts: Record<string, number> = {};
  for (const n of names) counts[n] = screen.queryAllByText(n, { exact: true }).length;
  return counts;
}

describe("BUG-054 /book/<slug> names each store item once", () => {
  it("a product added to the store and a bookable service are each named once", async () => {
    products = [publicProduct("prod_pepper", "Pepper sauce")];
    services = [{ id: "svc_haircut", name: "Haircut", description: null, duration: 30, price: 120 }];
    expect(await mountAndCount("Pepper sauce", "Haircut")).toEqual({ "Pepper sauce": 1, Haircut: 1 });
  });

  it("a SERVICE-category product with the same name as a bookable service is named once", async () => {
    products = [publicProduct("prod_consult", "Consultation", "SERVICE")];
    services = [{ id: "svc_consult", name: "Consultation", description: null, duration: 60, price: 300 }];
    expect(await mountAndCount("Consultation")).toEqual({ Consultation: 1 });
  });

  it("two products and two services: each named once", async () => {
    products = [publicProduct("prod_pepper", "Pepper sauce"), publicProduct("prod_sorrel", "Sorrel drink", "PACKAGE")];
    services = [
      { id: "svc_haircut", name: "Haircut", description: null, duration: 30, price: 120 },
      { id: "svc_shave", name: "Shave", description: null, duration: 15, price: 60 },
    ];
    expect(await mountAndCount("Pepper sauce", "Sorrel drink", "Haircut", "Shave")).toEqual({
      "Pepper sauce": 1, "Sorrel drink": 1, Haircut: 1, Shave: 1,
    });
  });
});
