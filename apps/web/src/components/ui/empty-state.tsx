"use client";

import { Plus, Lightbulb } from "lucide-react";

type EmptyStateVariant = "default" | "compact" | "inline";

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  secondaryAction?: { label: string; onClick: () => void };
  tip?: string;
  variant?: EmptyStateVariant;
  iconColor?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon = Plus,
  onAction,
  secondaryAction,
  tip,
  variant = "default",
  iconColor,
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <div className="flex items-center gap-3 py-6 px-4">
        <div
          className="w-10 h-10 kf-radius-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `color-mix(in srgb, ${iconColor || "hsl(var(--kf-muted-foreground))"} 10%, transparent)` }}
        >
          <Icon
            className="w-5 h-5"
            style={{ color: iconColor ?? "hsl(var(--kf-muted-foreground))", opacity: 0.6 }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="kf-text-body font-semibold">{title}</h3>
          {description && (
            <p className="kf-text-caption" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {description}
            </p>
          )}
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="kf-btn-primary kf-text-caption !py-1.5 !px-3 inline-flex items-center gap-1.5 flex-shrink-0"
          >
            <ActionIcon className="w-3.5 h-3.5" />
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  const isCompact = variant === "compact";

  return (
    <div className={`kf-card kf-radius-lg ${isCompact ? "p-8" : "p-12"} text-center`}>
      <div
        className={`${isCompact ? "w-12 h-12" : "w-14 h-14"} kf-radius-xl mx-auto flex items-center justify-center mb-4`}
        style={{ background: `color-mix(in srgb, ${iconColor || "hsl(var(--kf-muted-foreground))"} 10%, transparent)` }}
      >
        <Icon
          className={`${isCompact ? "w-6 h-6" : "w-7 h-7"}`}
          style={{ color: iconColor ?? "hsl(var(--kf-muted-foreground))", opacity: 0.5 }}
        />
      </div>
      <h3 className={`${isCompact ? "kf-text-body" : "text-lg"} font-semibold mb-2`}>{title}</h3>
      {description && (
        <p
          className={`${isCompact ? "kf-text-caption" : "text-sm"} mb-4 max-w-md mx-auto leading-relaxed`}
          style={{ color: "hsl(var(--kf-muted-foreground))" }}
        >
          {description}
        </p>
      )}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="kf-btn-primary min-h-[44px] px-4 py-2 kf-radius-lg text-sm font-medium inline-flex items-center gap-2"
          >
            <ActionIcon className="w-4 h-4" />
            {actionLabel}
          </button>
        )}
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="kf-btn-secondary min-h-[44px] px-4 py-2 kf-radius-lg text-sm font-medium"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
      {tip && (
        <div
          className="mt-6 mx-auto max-w-sm flex items-start gap-2 text-left px-4 py-3 kf-radius-md"
          style={{
            background: "hsl(var(--kf-warning) / 0.06)",
            border: "1px solid hsl(var(--kf-warning) / 0.12)",
          }}
        >
          <Lightbulb
            className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
            style={{ color: "hsl(var(--kf-warning))" }}
          />
          <p className="kf-text-caption" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{tip}</p>
        </div>
      )}
    </div>
  );
}
