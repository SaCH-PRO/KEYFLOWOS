"use client";

import { useState, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

export interface ResolvedEntity {
  type: string;
  id: string;
  label: string;
  subtitle?: string;
  href?: string;
  workspace?: string;
}

export function useEntityResolver(businessId: string | null | undefined) {
  const [cache, setCache] = useState<Map<string, ResolvedEntity>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const resolve = useCallback(
    async (type: string, id: string): Promise<ResolvedEntity | null> => {
      if (!businessId) return null;
      const key = `${type}:${id}`;
      if (cache.has(key)) return cache.get(key)!;

      setLoading((prev) => new Set(prev).add(key));
      try {
        const res = await apiGet<ResolvedEntity>(
          `/intelligence/businesses/${encodeURIComponent(businessId)}/entities/resolve?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`
        );
        if (res.data) {
          setCache((prev) => {
            const next = new Map(prev);
            next.set(key, res.data!);
            return next;
          });
          return res.data;
        }
        return null;
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [businessId, cache]
  );

  const resolveMany = useCallback(
    async (entities: Array<{ type: string; id: string }>): Promise<ResolvedEntity[]> => {
      if (!businessId || entities.length === 0) return [];

      const missing = entities.filter((e) => !cache.has(`${e.type}:${e.id}`));
      const found = entities
        .filter((e) => cache.has(`${e.type}:${e.id}`))
        .map((e) => cache.get(`${e.type}:${e.id}`)!);

      if (missing.length > 0) {
        const res = await apiPost<ResolvedEntity[]>({
          path: `/intelligence/businesses/${encodeURIComponent(businessId)}/entities/resolve-many`,
          body: { entities: missing },
        });
        if (res.data) {
          setCache((prev) => {
            const next = new Map(prev);
            for (const e of res.data!) {
              next.set(`${e.type}:${e.id}`, e);
            }
            return next;
          });
          return [...found, ...res.data];
        }
      }
      return found;
    },
    [businessId, cache]
  );

  const getCached = useCallback(
    (type: string, id: string): ResolvedEntity | undefined => {
      return cache.get(`${type}:${id}`);
    },
    [cache]
  );

  return { resolve, resolveMany, getCached, loading };
}
