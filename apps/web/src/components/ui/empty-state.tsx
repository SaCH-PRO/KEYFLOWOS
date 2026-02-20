"use client";

import { Plus } from "lucide-react";

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon = Plus,
  onAction,
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
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <ActionIcon className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
