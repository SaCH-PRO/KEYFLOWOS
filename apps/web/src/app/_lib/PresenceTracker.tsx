"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { initPresence, trackPageView } from "./presence-sdk";
import { API_BASE } from "@/lib/api";

/**
 * Drop-in client component for any public page. Initializes the
 * presence SDK once, then emits exactly one `page_view` per
 * `(businessId, pathname)` pair so SPA navigations within the same
 * mounted layout (e.g. swapping between sections of a presence site)
 * still produce one event per route — no double-fires, no misses.
 *
 * Pass `businessId` when known (storefront, booking, intake). Pages
 * that don't yet know which business is being viewed can omit it —
 * the SDK just won't emit until set.
 */
export function PresenceTracker({ businessId }: { businessId?: string | null }) {
  const pathname = usePathname();
  const lastFiredRef = useRef<string | null>(null);

  useEffect(() => {
    initPresence({ apiBase: API_BASE });
    if (!businessId) return;
    const key = `${businessId}::${pathname ?? ""}`;
    if (lastFiredRef.current === key) return;
    lastFiredRef.current = key;
    trackPageView(businessId);
  }, [businessId, pathname]);
  return null;
}
