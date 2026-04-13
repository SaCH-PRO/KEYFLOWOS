"use client";

import { useEffect } from "react";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Root error:", error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
      <div style={{ maxWidth: "28rem", width: "100%", textAlign: "center", padding: "2rem", borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(15,17,23,0.9)" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem", color: "#e2e8f0" }}>!</div>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem", color: "#e2e8f0" }}>Something went wrong</h2>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginBottom: "1.5rem" }}>
          An unexpected error occurred. Please try again.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{ padding: "0.625rem 1rem", borderRadius: "0.5rem", backgroundColor: "#f97316", color: "white", border: "none", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500 }}
          >
            Try Again
          </button>
          <a
            href="/"
            style={{ padding: "0.625rem 1rem", borderRadius: "0.5rem", backgroundColor: "rgba(255,255,255,0.1)", color: "#e2e8f0", textDecoration: "none", fontSize: "0.875rem", fontWeight: 500 }}
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}
