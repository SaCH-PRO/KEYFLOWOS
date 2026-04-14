"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

interface ModuleErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  moduleName: string;
  reassurance?: string;
}

const DEFAULT_REASSURANCE: Record<string, string> = {
  CRM: "Your contacts and deals are safe.",
  "CRM Pipeline": "Your contacts pipeline data is safe.",
  Bookings: "Your appointments are safe.",
  Projects: "Your tasks and playbooks are safe.",
  Expenses: "Your records are safe.",
  Marketing: "Your campaigns, social posts, and forms are safe.",
  Commerce: "Your data is safe.",
  Store: "Your store configuration is safe.",
  Community: "Your data is safe.",
  Reports: "Your data is safe.",
  Documents: "Your documents are safe.",
  Profile: "Your data is safe.",
  MasterClass: "Your progress is safe.",
};

export function ModuleErrorBoundary({
  error,
  reset,
  moduleName,
  reassurance,
}: ModuleErrorBoundaryProps) {
  useEffect(() => {
    console.error(`${moduleName} module error:`, error);
  }, [error, moduleName]);

  const message = reassurance ?? DEFAULT_REASSURANCE[moduleName] ?? "Your data is safe.";

  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <div className="max-w-md w-full kf-card kf-radius-xl p-8 text-center space-y-5" role="alert">
        <div
          className="mx-auto w-14 h-14 kf-radius-xl flex items-center justify-center"
          style={{ background: "hsl(var(--kf-error) / 0.1)" }}
        >
          <AlertTriangle
            className="w-7 h-7"
            style={{ color: "hsl(var(--kf-error))" }}
            aria-hidden="true"
          />
        </div>
        <div>
          <h2 className="kf-text-title font-semibold mb-1">{moduleName} Error</h2>
          <p className="kf-text-body" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Something went wrong loading {moduleName}. {message}
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
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
