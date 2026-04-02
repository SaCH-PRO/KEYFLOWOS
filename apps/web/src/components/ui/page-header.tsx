"use client";

import { Plus } from "lucide-react";

interface PageHeaderProps {
  icon: React.ElementType;
  title: string;
  subtitle?: React.ReactNode;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  rightSlot?: React.ReactNode;
  titleExtra?: React.ReactNode;
  actionDataAttr?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actionLabel,
  actionIcon: ActionIcon = Plus,
  onAction,
  rightSlot,
  titleExtra,
  actionDataAttr,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-8 h-8 kf-radius-md flex items-center justify-center flex-shrink-0"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        >
          <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="kf-text-title font-semibold tracking-tight truncate">{title}</h1>
            {titleExtra}
          </div>
          {subtitle && (
            <p className="kf-text-caption" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {rightSlot}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="kf-btn-primary inline-flex items-center gap-1.5 kf-text-caption !py-1.5 !px-3"
            {...(actionDataAttr ? { "data-walkthrough": actionDataAttr } : {})}
          >
            <ActionIcon className="w-3.5 h-3.5" />
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
