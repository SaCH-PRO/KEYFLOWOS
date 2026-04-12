"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

export default function ProfileError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Profile] Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <div
        className="max-w-md w-full rounded-2xl p-8 text-center space-y-5"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-error) / 0.3)",
        }}
        role="alert"
      >
        <div
          className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "hsl(var(--kf-error) / 0.1)" }}
        >
          <AlertTriangle className="w-7 h-7" style={{ color: "hsl(var(--kf-error))" }} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-1" style={{ color: "hsl(var(--kf-foreground))" }}>
            Profile Error
          </h2>
          <p className="text-sm" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Something went wrong loading your profile. Your data is safe.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors min-h-[44px]"
            style={{
              background: "hsl(var(--kf-accent1))",
              color: "white",
            }}
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try Again
          </button>
          <a
            href="/app"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              color: "hsl(var(--kf-foreground))",
            }}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
