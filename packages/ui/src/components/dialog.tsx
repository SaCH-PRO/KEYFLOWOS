import * as React from "react";
import { cn } from "../lib/utils";

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--kf-border)] bg-[rgba(10,12,18,0.85)] p-4 shadow-glass kf-dialog-enter",
          "before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-to-r before:from-[hsl(var(--kf-accent1))] before:to-[hsl(var(--kf-accent2))] before:z-20 before:rounded-t-2xl",
          "after:absolute after:inset-0 after:bg-gradient-to-br after:from-[rgba(78,168,255,0.08)] after:via-transparent after:to-[rgba(163,116,255,0.08)]",
        )}
      >
        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between">
            {title && <h3 id={titleId} className="text-lg font-semibold text-[var(--kf-text)]">{title}</h3>}
            {onClose && (
              <button
                aria-label="Close dialog"
                className="flex items-center justify-center w-8 h-8 rounded-full border border-[var(--kf-border)] bg-[rgba(255,255,255,0.03)] text-[var(--kf-text-muted)] hover:text-[var(--kf-text)] hover:bg-[rgba(255,255,255,0.08)] transition-all duration-150"
                onClick={onClose}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className="text-sm text-[var(--kf-text)]">{children}</div>
        </div>
      </div>
    </div>
  );
}
