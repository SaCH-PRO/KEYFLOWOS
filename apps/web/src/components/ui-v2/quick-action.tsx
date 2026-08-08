import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuickActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  label: string;
  variant?: "default" | "accent";
}

export const QuickAction = React.forwardRef<HTMLButtonElement, QuickActionProps>(
  ({ icon: Icon, label, variant = "default", className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-all focus-ring min-h-[44px]",
          variant === "default" &&
            "border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/5",
          variant === "accent" &&
            "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15",
          className,
        )}
        {...props}
      >
        {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
        <span>{label}</span>
      </button>
    );
  },
);
QuickAction.displayName = "QuickAction";
