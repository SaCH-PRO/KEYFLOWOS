import * as React from "react";
import { cn } from "@/lib/utils";

export type SurfaceVariant = "default" | "elevated" | "glass" | "accent" | "interactive";

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  as?: React.ElementType;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant = "default", as: Component = "div", ...props }, ref) => {
    return (
      <Component
        ref={ref as React.Ref<HTMLElement>}
        className={cn(
          "rounded-2xl border border-border transition-colors",
          variant === "default" && "bg-card",
          variant === "elevated" && "bg-card shadow-md",
          variant === "glass" && "surface-glass",
          variant === "accent" && "surface-accent",
          variant === "interactive" && "surface-interactive",
          className,
        )}
        {...props}
      />
    );
  },
);
Surface.displayName = "Surface";
