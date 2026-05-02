"use client";

/*
 * IMPORTANT: This file intentionally uses React.createElement instead of JSX.
 * Same reason as apps/web/src/app/error.tsx — see the comment at the top of
 * that file. Do NOT convert this back to JSX.
 */

import { createElement as h, useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
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
