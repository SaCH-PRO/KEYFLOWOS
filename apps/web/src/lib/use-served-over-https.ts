"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * D-303 (P231, P238): true only in a browser that loaded this page over https; false on the server render, so no
 * "SSL Encrypted" claim is made before the browser can tell. The same check P231 makes on the customer pages
 * (trust-bar.tsx's useServedOverHttps, on its branch); once both are on main they can share this one.
 */
export function useServedOverHttps(): boolean {
  return useSyncExternalStore(noSubscribe, () => window.location.protocol === "https:", () => false);
}
