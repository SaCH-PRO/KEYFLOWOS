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
  sm: "shadow-sm hover:shadow-md",
  md: "shadow-md hover:shadow-lg",
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
        "relative overflow-hidden rounded-xl border border-[var(--kf-border)] bg-[var(--kf-glass)] backdrop-blur-md transition-transform duration-200 ease-flow",
        shadowStyles[shadow],
        "hover:-translate-y-[1px]",
        className,
      )}
      {...rest}
    >
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-[rgba(78,168,255,0.06)] via-transparent to-[rgba(163,116,255,0.06)]" />
      <div className={cn("relative space-y-2", paddingStyles[padding])}>
        {(title || badge) && (
          <div className="flex items-center justify-between">
            {title && <h3 className="text-base font-semibold text-[var(--kf-text)]">{title}</h3>}
            {badge && (
              <span className="rounded-full border border-[var(--kf-electric)] bg-[rgba(78,168,255,0.08)] px-2 py-1 text-xs text-[var(--kf-electric)]">
                {badge}
              </span>
            )}
          </div>
        )}
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}
