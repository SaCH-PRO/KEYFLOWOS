import { type HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";

type CardShadow = "none" | "sm" | "md";
type CardPadding = "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  badge?: string;
  children: ReactNode;
  className?: string;
  shadow?: CardShadow;
  padding?: CardPadding;
}

const shadowStyles: Record<CardShadow, string> = {
  none: "shadow-none",
  sm: "shadow-[var(--kf-shadow)]",
  md: "shadow-[0_24px_50px_rgba(15,23,42,0.12)]",
};

const paddingStyles: Record<CardPadding, string> = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({
  title,
  badge,
  children,
  className,
  shadow = "sm",
  padding = "md",
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] transition-all duration-200 ease-flow",
        "before:absolute before:inset-0 before:pointer-events-none before:bg-[linear-gradient(145deg,rgba(255,255,255,0.04),rgba(0,0,0,0))]",
        shadowStyles[shadow],
        "hover:-translate-y-[1px]",
        className,
      )}
      {...rest}
    >
      <div className={cn("relative space-y-2", paddingStyles[padding])}>
        {(title || badge) && (
          <div className="flex items-center justify-between">
            {title && <h3 className="text-base font-semibold text-[hsl(var(--kf-foreground))]">{title}</h3>}
            {badge && (
              <span className="rounded-full border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-muted))] px-2 py-1 text-xs text-[hsl(var(--kf-foreground))]">
                {badge}
              </span>
            )}
          </div>
        )}
        <div className="relative z-10 text-[hsl(var(--kf-foreground))]">{children}</div>
      </div>
    </div>
  );
}
