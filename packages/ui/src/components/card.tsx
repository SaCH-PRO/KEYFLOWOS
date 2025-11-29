import { ReactNode } from "react";
import { cn } from "../lib/utils";

interface CardProps {
  title?: string;
  badge?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, badge, children, className }: CardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-[var(--kf-border)] bg-[var(--kf-glass)] backdrop-blur-md",
        "shadow-glass transition-transform duration-200 ease-flow hover:-translate-y-1 hover:shadow-neon",
        className,
      )}
    >
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-[rgba(78,168,255,0.08)] via-transparent to-[rgba(163,116,255,0.08)]" />
      <div className="relative p-4 space-y-2">
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
