"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * D-303 (P231, P238): true only in a browser that loaded this page over https; false on the server render, so no
 * "SSL Encrypted" claim is made before the browser can tell. The one check for the homepage and the customer pages:
 * the storefront's trust-bar.tsx re-exports it (P238, after P231 merged).
 */
export function useServedOverHttps(): boolean {
  return useSyncExternalStore(noSubscribe, () => window.location.protocol === "https:", () => false);
}
