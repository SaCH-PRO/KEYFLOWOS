"use client";

import { ChevronRight } from "lucide-react";

interface SectionCardProps {
  title?: string;
  subtitle?: string;
  icon?: React.ElementType;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ElementType;
  };
  headerRight?: React.ReactNode;
  noPadding?: boolean;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  action,
  headerRight,
  noPadding = false,
  compact = false,
  className = "",
  children,
}: SectionCardProps) {
  const hasHeader = !!(title || headerRight || action);
  const ActionIcon = action?.icon ?? ChevronRight;

  return (
    <div
      className={`kf-card kf-radius-lg overflow-hidden ${className}`}
    >
      {hasHeader && (
        <div
          className={`flex items-center justify-between gap-3 ${compact ? "px-3 py-2" : "px-4 py-3"} border-b`}
          style={{ borderColor: "hsl(var(--kf-border) / 0.5)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {Icon && (
              <div
                className="w-7 h-7 kf-radius-md flex items-center justify-center flex-shrink-0"
                style={{ background: "hsl(var(--kf-accent1) / 0.08)" }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className={`font-semibold truncate ${compact ? "kf-text-caption" : "kf-text-body"}`}>
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="kf-text-micro truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerRight}
            {action && (
              <button
                onClick={action.onClick}
                className="inline-flex items-center gap-1 kf-text-micro font-medium transition-colors"
                style={{ color: "hsl(var(--kf-accent1))" }}
              >
                {action.label}
                <ActionIcon className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className={noPadding ? "" : compact ? "p-3" : "p-4"}>
        {children}
      </div>
    </div>
  );
}

export type { SectionCardProps };
