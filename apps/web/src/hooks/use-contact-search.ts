"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchContacts } from "@/lib/client";

interface Contact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
  tags?: string[];
}

interface UseContactSearchOptions {
  businessId: string | null;
  initialContacts?: Contact[];
  debounceMs?: number;
}

export function useContactSearch({
  businessId,
  initialContacts,
  debounceMs = 300,
}: UseContactSearchOptions) {
  const [results, setResults] = useState<Contact[]>(initialContacts ?? []);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const doSearch = useCallback(
    async (query: string) => {
      if (initialContacts) {
        const q = query.toLowerCase().trim();
        if (!q) {
          setResults(initialContacts);
          return;
        }
        setResults(
          initialContacts.filter((c) => {
            const name = [c.firstName, c.lastName].filter(Boolean).join(" ").toLowerCase();
            const email = (c.email ?? "").toLowerCase();
            const phone = (c.phone ?? "").toLowerCase();
            return name.includes(q) || email.includes(q) || phone.includes(q);
          }),
        );
        return;
      }

      if (!businessId) return;

      setLoading(true);
      try {
        const res = await fetchContacts(businessId, {
          search: query.trim() || undefined,
          take: 20,
        });
        if (mountedRef.current) {
          setResults((res.data as Contact[]) ?? []);
        }
      } catch {
        /* silent */
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [businessId, initialContacts],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doSearch(search);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [search, debounceMs, doSearch]);

  useEffect(() => {
    doSearch("");
  }, [doSearch]);

  return { results, search, setSearch, loading };
}
