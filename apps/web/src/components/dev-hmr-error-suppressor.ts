"use client";

/*
 * IMPORTANT: This file uses the .ts extension (NOT .tsx) intentionally,
 * for the same reason documented in apps/web/src/app/global-error.ts —
 * SWC auto-injects `react/jsx-dev-runtime` into every .tsx file in dev,
 * and that import is the source of the recurring HMR factory-drop error.
 *
 * What this hook does
 * -------------------
 * Next 16 + Turbopack + React 19 has a recurring dev-only bug where the
 * `react/jsx-dev-runtime` module factory is evicted from Turbopack's
 * cache during Fast Refresh cycles. The next time any client module
 * with an auto-injected jsx-dev-runtime import re-evaluates, Next's
 * dev error overlay surfaces:
 *
 *   "Module react/jsx-dev-runtime was instantiated because it was
 *    required from module <some "use client" file>, but the module
 *    factory is not available. It might have been deleted in an HMR
 *    update."
 *
 * The page itself renders correctly — only the dev overlay is showing
 * a stale internal-state warning. Tasks #216, #225, #226 fixed every
 * config-level cause we control; what remains is a framework-level bug.
 *
 * This hook intercepts the specific error pattern in dev only and
 * prevents it from reaching the Next.js error overlay. Real errors
 * (different messages) pass through untouched. The interception is
 * a no-op outside development.
 *
 * Remove this once Next.js / Turbopack ships a fix for the upstream
 * HMR factory-drop bug.
 */

import { useEffect } from "react";

const FACTORY_DROP_PATTERN = /module factory is not available/i;

function shouldSuppress(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return FACTORY_DROP_PATTERN.test(message);
}

export function useSuppressTurbopackHmrFactoryError(): void {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;

    const originalConsoleError = console.error;
    console.error = function patchedConsoleError(...args: unknown[]) {
      const first = args[0];
      const firstStr =
        typeof first === "string"
          ? first
          : first instanceof Error
            ? first.message
            : "";
      if (shouldSuppress(firstStr)) {
        // Known-benign Turbopack HMR cache stale-reference; page works.
        return;
      }
      originalConsoleError.apply(console, args);
    };

    const handleError = (event: ErrorEvent) => {
      if (shouldSuppress(event.message) || shouldSuppress(event.error?.message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        typeof reason === "string"
          ? reason
          : reason instanceof Error
            ? reason.message
            : "";
      if (shouldSuppress(msg)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("error", handleError, true);
    window.addEventListener("unhandledrejection", handleRejection, true);

    return () => {
      console.error = originalConsoleError;
      window.removeEventListener("error", handleError, true);
      window.removeEventListener("unhandledrejection", handleRejection, true);
    };
  }, []);
}
