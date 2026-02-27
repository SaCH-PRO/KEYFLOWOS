import * as React from "react";
import { cn } from "../lib/utils";

interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex transition-opacity duration-200",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div
        className="flex-1 bg-black/50 backdrop-blur-sm"
        role="button"
        tabIndex={-1}
        aria-label="Close drawer"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose?.(); }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-[380px] max-w-full border-l border-[var(--kf-border)] bg-[rgba(10,12,18,0.9)] shadow-glass backdrop-blur-xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]" />
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            {title && <h3 id={titleId} className="text-lg font-semibold text-[var(--kf-text)]">{title}</h3>}
            {onClose && (
              <button
                aria-label="Close drawer"
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
