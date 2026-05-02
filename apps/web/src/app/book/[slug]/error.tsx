"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function BookingPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams();
  const slug = params?.slug as string | undefined;

  useEffect(() => {
    console.error("Booking page error:", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "hsl(0 0% 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "28rem",
          width: "100%",
          textAlign: "center",
          padding: "2.5rem",
          borderRadius: "1.5rem",
          border: "1px solid rgba(0,0,0,0.08)",
          background: "#ffffff",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            width: "4rem",
            height: "4rem",
            borderRadius: "1rem",
            backgroundColor: "rgba(239,68,68,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.25rem",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827", marginBottom: "0.5rem" }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "1.5rem", lineHeight: 1.6 }}>
          {slug
            ? `We couldn't load the store for "${slug}". Please try again.`
            : "We couldn't load this store page. Please try again."}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.75rem",
              backgroundColor: "#f97316",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Try Again
          </button>
          <Link
            href="/"
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.75rem",
              backgroundColor: "rgba(0,0,0,0.05)",
              color: "#374151",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Go Home
          </Link>
        </div>
      </div>
    </main>
  );
}
