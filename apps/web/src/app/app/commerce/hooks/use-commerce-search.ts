"use client";

import { useMemo } from "react";

export function useCommerceSearch<T>(
  items: T[],
  searchableFields: (item: T) => string,
  query: string,
): { filtered: T[]; resultCount: number; totalCount: number; hasQuery: boolean } {
  const searchIndex = useMemo(() => {
    const map = new Map<number, string>();
    items.forEach((item, idx) => {
      map.set(idx, searchableFields(item).toLowerCase());
    });
    return map;
  }, [items, searchableFields]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return items;
    const terms = trimmed.split(/\s+/);
    return items.filter((_, idx) => {
      const text = searchIndex.get(idx) ?? "";
      return terms.every((t) => text.indexOf(t) !== -1);
    });
  }, [items, query, searchIndex]);

  return {
    filtered,
    resultCount: filtered.length,
    totalCount: items.length,
    hasQuery: query.trim().length > 0,
  };
}
