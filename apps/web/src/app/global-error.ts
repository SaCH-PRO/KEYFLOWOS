"use client";

/*
 * IMPORTANT: This file uses the .ts extension (NOT .tsx) intentionally.
 *
 * Next 16 + Turbopack + React 19 has a recurring HMR bug where the
 * `react/jsx-dev-runtime` module factory gets evicted from the dev cache
 * during Fast Refresh cycles. Because root error boundaries are loaded
 * on-demand (only when an error actually occurs), they almost always
 * try to instantiate AFTER the runtime factory has been dropped,
 * surfacing the dreaded "module factory is not available" error.
 *
 * SWC auto-injects `import "react/jsx-dev-runtime"` into every .tsx file
 * (regardless of whether JSX is actually used in the source). Renaming
 * the file to .ts disables that injection entirely, since .ts files do
 * not support JSX syntax.
 *
 * As a result this file uses React.createElement directly.
 *
 * Do NOT rename back to .tsx. Do NOT add JSX. See apps/web/README.md
 * Troubleshooting and Tasks #216, #225, #226.
 *
 * The root-level error.tsx file was deleted entirely for the same
 * reason — global-error.ts (this file) catches all the cases it would
 * have caught.
 */

import { createElement as h, useEffect } from "react";

const KNOWN_NEXTJS_FRAMEWORK_ERRORS = [
  "Rendered more hooks than during the previous render",
  "Cannot use 'in' operator to search for 'headCacheNode' in null",
  "Should not already be working",
];

function isKnownFrameworkError(error: Error & { digest?: string }) {
  const msg = error?.message || "";
  const stack = error?.stack || "";
  return (
    typeof msg === "string" &&
    KNOWN_NEXTJS_FRAMEWORK_ERRORS.some((known) => msg.includes(known)) &&
    typeof stack === "string" &&
    (stack.includes("app-router.js") || stack.includes("next/dist"))
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);

    // Dev-only auto-recovery for known Next.js 16 + React 19 App Router bugs.
    // These are transient framework races; one reload usually clears them.
    // See vercel/next.js#78396 and facebook/react#33556.
    if (process.env.NODE_ENV !== "production" && isKnownFrameworkError(error)) {
      if (!sessionStorage.getItem("__kfFrameworkErrorReloaded")) {
        console.warn("[GlobalError] Known Next.js framework race; reloading once...");
        sessionStorage.setItem("__kfFrameworkErrorReloaded", "1");
        window.location.reload();
      }
    }
  }, [error]);

  return h(
    "html",
    { lang: "en" },
    h(
      "body",
      {
        style: {
          margin: 0,
          backgroundColor: "#0a0c12",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        },
      },
      h(
        "div",
        {
          style: {
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
          },
        },
        h(
          "div",
          {
            style: {
              maxWidth: "28rem",
              width: "100%",
              textAlign: "center",
              padding: "2rem",
              borderRadius: "1rem",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(15,17,23,0.9)",
            },
          },
          h("div", { style: { fontSize: "2.5rem", marginBottom: "1rem" } }, "!"),
          h(
            "h2",
            {
              style: {
                fontSize: "1.25rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
              },
            },
            "Something went wrong",
          ),
          h(
            "p",
            {
              style: {
                fontSize: "0.875rem",
                color: "#94a3b8",
                marginBottom: "1.5rem",
              },
            },
            "An unexpected error occurred. Please try again.",
          ),
          h(
            "div",
            {
              style: {
                display: "flex",
                gap: "0.75rem",
                justifyContent: "center",
              },
            },
            h(
              "button",
              {
                onClick: reset,
                style: {
                  padding: "0.625rem 1rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#f97316",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                },
              },
              "Try Again",
            ),
            h(
              "a",
              {
                href: "/",
                style: {
                  padding: "0.625rem 1rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "rgba(255,255,255,0.1)",
                  color: "#e2e8f0",
                  textDecoration: "none",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                },
              },
              "Home",
            ),
          ),
        ),
      ),
    ),
  );
}
