"use client";

/*
 * IMPORTANT: This file intentionally uses React.createElement instead of JSX.
 *
 * Next 16 + Turbopack + React 19 has a recurring HMR bug where the
 * `react/jsx-dev-runtime` module factory gets evicted from the dev cache
 * during Fast Refresh cycles. Because error.tsx is loaded on-demand (only
 * when an error actually occurs), it almost always tries to instantiate
 * AFTER the runtime factory has been dropped, surfacing:
 *
 *   "Module react/jsx-dev-runtime was instantiated because it was required
 *    from module apps/web/src/app/error.tsx, but the module factory is not
 *    available. It might have been deleted in an HMR update."
 *
 * Avoiding JSX in this single file means Turbopack never compiles a
 * jsx-dev-runtime import for it, so the broken link in the chain
 * disappears. Do NOT convert this back to JSX. See apps/web/README.md
 * Troubleshooting and Tasks #216, #225, #226.
 */

import { createElement as h, useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root error:", error);
  }, [error]);

  return h(
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
      h(
        "div",
        {
          style: {
            fontSize: "2.5rem",
            marginBottom: "1rem",
            color: "#e2e8f0",
          },
        },
        "!",
      ),
      h(
        "h2",
        {
          style: {
            fontSize: "1.25rem",
            fontWeight: 600,
            marginBottom: "0.5rem",
            color: "#e2e8f0",
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
  );
}
