"use client";

import React from "react";
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
  breadcrumbs?: React.ReactNode;
  iconColor?: string;
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
  breadcrumbs,
  iconColor,
}: PageHeaderProps) {
  const color = iconColor ?? "hsl(var(--kf-accent1))";
  const bgColor = `color-mix(in srgb, ${color} 10%, transparent)`;

  return (
    <div className="mb-6">
      {breadcrumbs && <div className="mb-3">{breadcrumbs}</div>}

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        {/* Left: icon + title + subtitle */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: bgColor }}
          >
            <Icon className="w-[18px] h-[18px]" style={{ color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold tracking-tight text-foreground truncate">{title}</h1>
              {titleExtra}
            </div>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-xl">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {rightSlot}
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
              {...(actionDataAttr ? { "data-walkthrough": actionDataAttr } : {})}
            >
              <ActionIcon className="w-3.5 h-3.5" />
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
