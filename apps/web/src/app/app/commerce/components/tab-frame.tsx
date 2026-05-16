"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

interface TabFrameProps {
  loading: boolean;
  error?: string | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ElementType;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  children: React.ReactNode;
}

export function TabFrame({
  loading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyActionLabel,
  onEmptyAction,
  children,
}: TabFrameProps) {
  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-3">
              <div className="h-3 w-12 mb-2 rounded bg-muted/40 animate-pulse" />
              <div className="h-5 w-20 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 w-full rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="rounded-xl border px-4 py-4 text-sm flex items-start gap-2"
        style={{
          borderColor: "hsl(var(--kf-error) / 0.3)",
          background: "hsl(var(--kf-error) / 0.06)",
          color: "hsl(var(--kf-error))",
        }}
        role="alert"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Couldn&apos;t load this view</p>
          <p className="text-xs mt-1 opacity-80">{error}</p>
        </div>
      </div>
    );
  }
  if (isEmpty && emptyTitle && emptyIcon) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
        variant="compact"
      />
    );
  }
  return <>{children}</>;
}
