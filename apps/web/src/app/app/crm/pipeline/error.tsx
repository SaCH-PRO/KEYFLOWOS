"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

export default function CrmPipelineError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("CRM Pipeline error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <div className="max-w-md w-full kf-card border border-border/60 p-8 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">CRM Pipeline Error</h2>
          <p className="text-sm text-muted-foreground">
            Something went wrong loading the contacts pipeline. Your data is safe.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/90 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <a
            href="/app"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
