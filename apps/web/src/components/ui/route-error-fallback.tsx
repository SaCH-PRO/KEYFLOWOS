"use client";

import { logError } from "@/lib/logger";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface RouteErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}

export function RouteErrorFallback({
  error,
  reset,
  title = "Something went wrong",
  description = "An unexpected error occurred. You can try refreshing or go back to the dashboard.",
}: RouteErrorFallbackProps) {
  useEffect(() => {
    logError("Route error", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "hsl(var(--kf-background))" }}>
      <div
        className="max-w-md w-full kf-card-glass kf-radius-xl p-8 text-center space-y-6"
        role="alert"
      >
        <div
          className="mx-auto w-16 h-16 kf-radius-xl flex items-center justify-center"
          style={{ background: "hsl(var(--kf-error) / 0.1)" }}
        >
          <AlertTriangle
            className="w-8 h-8"
            style={{ color: "hsl(var(--kf-error))" }}
            aria-hidden="true"
          />
        </div>
        <div>
          <h2 className="kf-text-title font-semibold mb-2">{title}</h2>
          <p className="kf-text-body" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {description}
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="kf-btn-primary kf-radius-lg kf-text-emphasis font-medium inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try Again
          </button>
          <a
            href="/app"
            className="kf-btn-secondary kf-radius-lg kf-text-emphasis font-medium inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
