import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "status" | "level" | "achievement" | "notification";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  color?: "orange" | "teal" | "violet" | "gold" | "rose" | "mint" | "sky" | "muted";
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "status", color = "muted", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "badge-v2",
          color === "orange" && "bg-primary/10 text-primary",
          color === "teal" && "bg-secondary/10 text-secondary",
          color === "violet" && "bg-violet/10 text-violet",
          color === "gold" && "bg-gold/15 text-gold-foreground",
          color === "rose" && "bg-rose/10 text-rose",
          color === "mint" && "bg-mint/10 text-mint",
          color === "sky" && "bg-sky/10 text-sky",
          color === "muted" && "bg-muted text-muted-foreground",
          variant === "achievement" && "border border-gold/30",
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  },
);
Badge.displayName = "Badge";
