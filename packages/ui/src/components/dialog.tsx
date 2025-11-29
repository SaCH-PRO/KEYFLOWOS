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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={cn(
          "relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--kf-border)] bg-[rgba(10,12,18,0.85)] p-4 shadow-glass",
          "before:absolute before:inset-0 before:bg-gradient-to-br before:from-[rgba(78,168,255,0.08)] before:via-transparent before:to-[rgba(163,116,255,0.08)]",
        )}
      >
        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between">
            {title && <h3 className="text-base font-semibold text-[var(--kf-text)]">{title}</h3>}
            {onClose && (
              <button
                className="rounded-full border border-[var(--kf-border)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-xs text-[var(--kf-text-muted)] hover:text-[var(--kf-text)]"
                onClick={onClose}
              >
                Close
              </button>
            )}
          </div>
          <div className="text-sm text-[var(--kf-text)]">{children}</div>
        </div>
      </div>
    </div>
  );
}
