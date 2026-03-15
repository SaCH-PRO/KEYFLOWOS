import { type HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";

type CardVariant = "default" | "glass" | "outlined";
type CardPadding = "sm" | "md" | "lg" | "none";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  badge?: string;
  children: ReactNode;
  className?: string;
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
}

const variantStyles: Record<CardVariant, string> = {
  default: "bg-[hsl(var(--kf-card,240_5%_8%))] border border-[hsl(var(--kf-border,240_4%_14%))]",
  glass: "bg-[hsl(var(--kf-card,240_5%_8%)/0.85)] backdrop-blur-xl border border-[hsl(var(--kf-border,240_4%_14%))]",
  outlined: "bg-transparent border border-[hsl(var(--kf-border,240_4%_14%))]",
};

const paddingStyles: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export function Card({
  title,
  badge,
  children,
  className,
  variant = "default",
  padding = "md",
  interactive = false,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden transition-all duration-150",
        variantStyles[variant],
        interactive ? "cursor-pointer hover:border-[hsl(var(--kf-accent1,24_95%_53%)/0.2)] hover:shadow-[var(--kf-elevation-2)]" : undefined,
        className,
      )}
      {...rest}
    >
      <div className={cn(paddingStyles[padding])}>
        {(title || badge) && (
          <div className="flex items-center justify-between mb-3">
            {title && <h3 className="text-sm font-semibold text-[hsl(var(--kf-foreground,0_0%_95%))]">{title}</h3>}
            {badge && (
              <span className="rounded-full bg-[hsl(var(--kf-accent1,24_95%_53%)/0.1)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--kf-accent1,24_95%_53%))]">
                {badge}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
