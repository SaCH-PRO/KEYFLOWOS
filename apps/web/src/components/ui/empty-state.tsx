"use client";

import { Plus, Lightbulb } from "lucide-react";

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  secondaryAction?: { label: string; onClick: () => void };
  tip?: string;
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
}: EmptyStateProps) {
  return (
    <div className="kf-card rounded-xl p-12 text-center">
      <Icon className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-60" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          {description}
        </p>
      )}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="kf-btn-primary min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2"
          >
            <ActionIcon className="w-4 h-4" />
            {actionLabel}
          </button>
        )}
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="kf-btn-secondary min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium"
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
          <p className="kf-text-caption text-muted-foreground">{tip}</p>
        </div>
      )}
    </div>
  );
}
