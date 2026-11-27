/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263, D-304), repair round 2: an item marked notForSale (the store checkout is
 * not offered) has no buy button in the detail modal or the featured strip. It is still shown (D-304: the listing
 * stays).
 *
 *   WHS2-21  detail modal: no Add to Cart for a notForSale item; Add to Cart otherwise
 *   WHS2-22  featured strip: no add button for a notForSale item; one otherwise
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ItemDetailModal } from "../item-detail-modal";
import { FeaturedSection } from "../featured-section";
import type { CatalogItem } from "../types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const ITEM: CatalogItem = {
  id: "prod_whs2_b", name: "Pepper sauce", description: "Hot", price: 35, currency: "TTD", duration: null, imageUrl: null,
  itemType: "product", requiresBooking: false, purchasable: true,
};

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

function modal(item: CatalogItem, addToCart = vi.fn()) {
  render(
    <ItemDetailModal
      item={item} primaryColor="#f97316" secondaryColor="#14b8a6" accentColor="#a78bfa" isInCart={false}
      addToCart={addToCart} removeFromCart={vi.fn()} relatedItems={[]} onClose={vi.fn()} onSelectItem={vi.fn()}
    />,
  );
  return addToCart;
}
function featured(item: CatalogItem, addToCart = vi.fn()) {
  render(
    <FeaturedSection
      items={[item]} primaryColor="#f97316" secondaryColor="#14b8a6" accentColor="#a78bfa" isInCart={() => false}
      addToCart={addToCart} onItemClick={vi.fn()}
    />,
  );
  return addToCart;
}

describe("WEDGE-HIDE-STORE part 2: a notForSale item has no buy button", () => {
  it("WHS2-21 detail modal: Add to Cart for an item on sale, none for a notForSale item", () => {
    const add = modal(ITEM);
    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
    expect(add).toHaveBeenCalledTimes(1);
    cleanup();

    modal({ ...ITEM, notForSale: true });
    expect(screen.getAllByText(ITEM.name).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /add to cart|in cart/i })).toBeNull();
  });

  it("WHS2-22 featured strip: an add button for an item on sale, none for a notForSale item", () => {
    const add = featured(ITEM);
    fireEvent.click(screen.getByRole("button", { name: `Add ${ITEM.name} to cart` }));
    expect(add).toHaveBeenCalledTimes(1);
    cleanup();

    featured({ ...ITEM, notForSale: true });
    expect(screen.getAllByText(ITEM.name).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /to cart/i })).toBeNull();
  });
});
