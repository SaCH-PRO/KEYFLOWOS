"use client";

import { useState, useCallback, useEffect } from "react";

const WISHLIST_KEY_PREFIX = "kf_wishlist_";

export type WishlistItem = {
  id: string;
  name: string;
  price: number;
  currency: string;
  imageUrl?: string | null;
  itemType: string;
};

function getStorageKey(slug: string) {
  return `${WISHLIST_KEY_PREFIX}${slug}`;
}

function loadWishlist(slug: string): WishlistItem[] {
  try {
    const raw = localStorage.getItem(getStorageKey(slug));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWishlist(slug: string, items: WishlistItem[]) {
  try {
    localStorage.setItem(getStorageKey(slug), JSON.stringify(items));
  } catch {}
}

export function useWishlist(slug: string) {
  const [items, setItems] = useState<WishlistItem[]>([]);

  useEffect(() => {
    setItems(loadWishlist(slug));
  }, [slug]);

  const toggle = useCallback(
    (item: WishlistItem) => {
      setItems((prev) => {
        const exists = prev.some((w) => w.id === item.id);
        const next = exists ? prev.filter((w) => w.id !== item.id) : [...prev, item];
        saveWishlist(slug, next);
        return next;
      });
    },
    [slug]
  );

  const remove = useCallback(
    (itemId: string) => {
      setItems((prev) => {
        const next = prev.filter((w) => w.id !== itemId);
        saveWishlist(slug, next);
        return next;
      });
    },
    [slug]
  );

  const isWishlisted = useCallback(
    (itemId: string) => items.some((w) => w.id === itemId),
    [items]
  );

  return { items, toggle, remove, isWishlisted, count: items.length };
}
