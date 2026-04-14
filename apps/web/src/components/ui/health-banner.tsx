"use client";

import {
  CheckCircle2, AlertTriangle, AlertCircle, Info,
  X, ChevronRight,
} from "lucide-react";

type Severity = "info" | "success" | "warning" | "critical";

interface HealthBannerProps {
  severity: Severity;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  compact?: boolean;
  className?: string;
}

const SEVERITY_CONFIG: Record<Severity, {
  icon: React.ElementType;
  bg: string;
  border: string;
  iconColor: string;
  titleColor: string;
}> = {
  info: {
    icon: Info,
    bg: "hsl(var(--kf-info) / 0.06)",
    border: "hsl(var(--kf-info) / 0.15)",
    iconColor: "hsl(var(--kf-info))",
    titleColor: "hsl(var(--kf-info))",
  },
  success: {
    icon: CheckCircle2,
    bg: "hsl(var(--kf-success) / 0.06)",
    border: "hsl(var(--kf-success) / 0.15)",
    iconColor: "hsl(var(--kf-success))",
    titleColor: "hsl(var(--kf-success))",
  },
  warning: {
    icon: AlertTriangle,
    bg: "hsl(var(--kf-warning) / 0.06)",
    border: "hsl(var(--kf-warning) / 0.15)",
    iconColor: "hsl(var(--kf-warning))",
    titleColor: "hsl(var(--kf-warning))",
  },
  critical: {
    icon: AlertCircle,
    bg: "hsl(var(--kf-error) / 0.06)",
    border: "hsl(var(--kf-error) / 0.15)",
    iconColor: "hsl(var(--kf-error))",
    titleColor: "hsl(var(--kf-error))",
  },
};

export function HealthBanner({
  severity,
  title,
  description,
  action,
  onDismiss,
  compact = false,
  className = "",
}: HealthBannerProps) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <div
      className={`kf-radius-lg flex items-start gap-3 ${compact ? "px-3 py-2" : "px-4 py-3"} ${className}`}
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
      }}
      role="alert"
    >
      <Icon
        className={`${compact ? "w-4 h-4 mt-0.5" : "w-5 h-5 mt-0.5"} flex-shrink-0`}
        style={{ color: config.iconColor }}
      />
      <div className="flex-1 min-w-0">
        <p
          className={`${compact ? "kf-text-caption" : "kf-text-body"} font-semibold`}
          style={{ color: config.titleColor }}
        >
          {title}
        </p>
        {description && (
          <p
            className={`${compact ? "kf-text-micro" : "kf-text-caption"} mt-0.5 leading-relaxed`}
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          >
            {description}
          </p>
        )}
        {action && (
          <button
            onClick={action.onClick}
            className="inline-flex items-center gap-1 kf-text-micro font-medium mt-1.5 transition-colors"
            style={{ color: config.iconColor }}
          >
            {action.label}
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 kf-radius-sm transition-opacity opacity-60 hover:opacity-100"
          style={{ color: "hsl(var(--kf-muted-foreground))" }}
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

interface WarningCardProps {
  severity: Severity;
  title: string;
  description?: string;
  metric?: { label: string; value: string | number };
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  className?: string;
}

export function WarningCard({
  severity,
  title,
  description,
  metric,
  action,
  onDismiss,
  className = "",
}: WarningCardProps) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  return (
    <div
      className={`kf-card kf-radius-lg overflow-hidden ${className}`}
      style={{ borderLeft: `3px solid ${config.iconColor}` }}
    >
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div
            className="w-8 h-8 kf-radius-md flex items-center justify-center flex-shrink-0"
            style={{ background: config.bg }}
          >
            <Icon className="w-4 h-4" style={{ color: config.iconColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="kf-text-caption font-semibold">{title}</h4>
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="p-0.5 kf-radius-sm transition-opacity opacity-40 hover:opacity-100 flex-shrink-0"
                  style={{ color: "hsl(var(--kf-muted-foreground))" }}
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {description && (
              <p
                className="kf-text-micro mt-0.5 leading-relaxed"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
              >
                {description}
              </p>
            )}
            {metric && (
              <div className="flex items-baseline gap-1.5 mt-1.5">
                <span className="text-lg font-bold" style={{ color: config.iconColor }}>
                  {metric.value}
                </span>
                <span className="kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {metric.label}
                </span>
              </div>
            )}
            {action && (
              <button
                onClick={action.onClick}
                className="inline-flex items-center gap-1 kf-text-micro font-medium mt-2 transition-colors"
                style={{ color: "hsl(var(--kf-accent1))" }}
              >
                {action.label}
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export type { Severity, HealthBannerProps, WarningCardProps };
