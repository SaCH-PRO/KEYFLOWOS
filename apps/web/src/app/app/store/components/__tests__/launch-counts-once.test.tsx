/**
 * CATALOG-1, the web half (SWP-STORE-LISTING-WEB, BUG-106): Your page > Launch counts each store item once.
 *
 * WHY this test exists: 'Add to store' keeps a product on the store with a listing service (a Service row whose
 * sourceProductId names the product; the storelisting ruling D-185: only products added with 'Add to store' show).
 * Launch's "Catalog Items" and its "At least 3 products/services" check added the business's services to all of
 * its products, so a product on the store was counted twice (as the product and as its listing service) and a
 * product never added to the store was counted as if the customer could see it.
 *
 * What the customer sees on /book/<slug> is each bookable service (no sourceProductId) once and each product added
 * to the store once; that is the count.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Product, Service } from "@/lib/client";

const api = vi.hoisted(() => ({ apiGet: vi.fn(async () => ({ data: null, error: null })), apiPost: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});

import { LaunchMode } from "../launch-mode";

beforeAll(() => {
  class NoopObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
});

afterEach(() => cleanup());

const product = (id: string, name: string): Product => ({ id, name, price: 35, currency: "TTD", category: "PRODUCT", isActive: true } as Product);
const service = (id: string, name: string, sourceProductId: string | null): Service =>
  ({ id, name, price: 35, durationMins: 30, sourceProductId } as Service & { sourceProductId: string | null });

function mount(services: Service[], commerceProducts: Product[]) {
  render(
    <LaunchMode
      businessId="biz_launch_1"
      storeEnabled
      slug="pepper-co"
      currentSlug="pepper-co"
      publicUrl="https://app.keyflow.test/book/pepper-co"
      onSlugChange={() => {}}
      onSaveSlug={async () => {}}
      slugSaving={false}
      businessData={{ name: "Pepper Co", slug: "pepper-co" }}
      services={services}
      commerceProducts={commerceProducts}
      hasHeroImage={false}
      hoursConfigured={false}
      hasTestimonials={false}
      onModeChange={() => {}}
    />,
  );
}

/** The value under the "Catalog Items" label of Launch's metric strip. */
function catalogItems(): string {
  const label = screen.getByText("Catalog Items");
  return label.nextElementSibling?.textContent?.trim() ?? "";
}

describe("BUG-106 Launch counts each store item once", () => {
  it("a product on the store (its listing service) counts once, a product never added counts not at all, a bookable service once", () => {
    const pepper = product("prod_pepper", "Pepper sauce");
    const notListed = product("prod_other", "Not listed");
    mount(
      [service("svc_listing_pepper", "Pepper sauce", pepper.id), service("svc_haircut", "Haircut", null)],
      [pepper, notListed],
    );
    expect(catalogItems()).toBe("2");
  });

  it("two listing services for the same product (a double 'Add to store') still count that product once", () => {
    const pepper = product("prod_pepper", "Pepper sauce");
    mount([service("svc_listing_1", "Pepper sauce", pepper.id), service("svc_listing_2", "Pepper sauce", pepper.id)], [pepper]);
    expect(catalogItems()).toBe("1");
  });

  it("the trust checklist's 'At least 3 products/services' reads the same count (2 store items: not met)", () => {
    const pepper = product("prod_pepper", "Pepper sauce");
    mount(
      [service("svc_listing_pepper", "Pepper sauce", pepper.id), service("svc_haircut", "Haircut", null)],
      [pepper, product("prod_other", "Not listed")],
    );
    fireEvent.click(screen.getByRole("button", { name: /trust & conversion checklist/i }));
    const check = screen.getByText("At least 3 products/services");
    // The checklist strikes a met check through; with 2 store items it is not met and still Required.
    expect(check).not.toHaveClass("line-through");
    expect(check.parentElement).toHaveTextContent(/required/i);
  });

  it("a product on the store that is no longer active is not counted (the store does not show it)", () => {
    const pepper = { ...product("prod_pepper", "Pepper sauce"), isActive: false } as Product;
    mount([service("svc_listing_pepper", "Pepper sauce", pepper.id), service("svc_haircut", "Haircut", null)], [pepper]);
    expect(catalogItems()).toBe("1");
  });

  it("control: bookable services and no products count each service", () => {
    mount([service("svc_a", "Haircut", null), service("svc_b", "Beard trim", null), service("svc_c", "Shave", null)], []);
    expect(catalogItems()).toBe("3");
  });
});
