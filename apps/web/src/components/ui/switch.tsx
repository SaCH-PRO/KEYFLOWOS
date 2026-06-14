"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <label
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-[hsl(var(--kf-accent1))]" : "bg-muted",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          ref={ref}
          {...props}
        />
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </label>
    );
  },
);
Switch.displayName = "Switch";
