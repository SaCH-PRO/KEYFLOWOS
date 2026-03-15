"use client";

import { Plus } from "lucide-react";
import { MissionsButton } from "./missions-button";

interface PageHeaderProps {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  rightSlot?: React.ReactNode;
  titleExtra?: React.ReactNode;
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
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        >
          <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
            {titleExtra}
            <MissionsButton />
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {rightSlot}
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="kf-btn-primary inline-flex items-center gap-1.5 !text-xs !py-1.5 !px-3"
          >
            <ActionIcon className="w-3.5 h-3.5" />
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
