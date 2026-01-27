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
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "w-[380px] max-w-full border-l border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] shadow-[var(--kf-shadow)] transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="p-4 space-y-3">
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
