import * as React from "react";
import { cn } from "../lib/utils";

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className={cn(
          "relative w-full max-w-lg overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] p-5 shadow-[var(--kf-shadow)]",
        )}
      >
        <div className="relative space-y-3">
          <div className="flex items-center justify-between">
            {title && <h3 className="text-base font-semibold text-[hsl(var(--kf-foreground))]">{title}</h3>}
            {onClose && (
              <button
                className="rounded-full border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-muted))] px-2.5 py-1 text-xs text-[hsl(var(--kf-muted-foreground))] hover:text-[hsl(var(--kf-foreground))]"
                onClick={onClose}
              >
                Close
              </button>
            )}
          </div>
          <div className="text-sm text-[hsl(var(--kf-foreground))]">{children}</div>
        </div>
      </div>
    </div>
  );
}
