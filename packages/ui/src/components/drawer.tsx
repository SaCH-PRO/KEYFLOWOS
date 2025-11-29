import * as React from "react";
import { cn } from "../lib/utils";

interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex transition-opacity duration-200",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
    >
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "w-[380px] max-w-full border-l border-[var(--kf-border)] bg-[rgba(10,12,18,0.9)] shadow-glass backdrop-blur-xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="p-4 space-y-3">
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
