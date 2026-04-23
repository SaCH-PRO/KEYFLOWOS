"use client";

import { AlertCircle, LogIn, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

interface WorkspaceErrorProps {
  title?: string;
  description?: string;
}

export function WorkspaceError({
  title = "Workspace not found",
  description = "We couldn't locate your workspace. This usually means your session has expired.",
}: WorkspaceErrorProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="kf-card kf-radius-xl p-10 max-w-md w-full text-center space-y-5" role="alert">
        <div
          className="w-14 h-14 kf-radius-xl mx-auto flex items-center justify-center"
          style={{ background: "hsl(var(--kf-warning) / 0.1)" }}
        >
          <AlertCircle className="w-7 h-7" style={{ color: "hsl(var(--kf-warning))" }} aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h2 className="kf-text-title font-semibold">{title}</h2>
          <p className="kf-text-body leading-relaxed" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{description}</p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => window.location.reload()}
            className="kf-btn-secondary kf-radius-lg kf-text-emphasis font-medium inline-flex items-center gap-2 min-h-[44px] px-4 py-2"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
          <button
            onClick={() => router.push("/auth/login")}
            className="kf-btn-primary kf-radius-lg kf-text-emphasis font-medium inline-flex items-center gap-2 min-h-[44px] px-4 py-2"
          >
            <LogIn className="w-4 h-4" aria-hidden="true" />
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
