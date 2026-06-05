"use client";

import { useSyncExternalStore } from "react";

/**
 * Returns `true` only after the component has mounted on the client.
 * Use this to guard client-only rendering (dates, localStorage, timers)
 * and prevent React hydration mismatches.
 */
export function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
