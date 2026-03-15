"use client";

type StatusVariant = "filled" | "outline";
type StatusSize = "sm" | "md";

type StatusType =
  | "active" | "inactive" | "lead" | "prospect" | "customer" | "churned"
  | "confirmed" | "pending" | "cancelled" | "completed" | "no_show"
  | "draft" | "sent" | "paid" | "overdue" | "partial" | "void"
  | "scheduled" | "running" | "paused" | "ended"
  | "open" | "closed" | "won" | "lost"
  | "success" | "warning" | "error" | "info" | "neutral";

const STATUS_COLOR_MAP: Record<StatusType, string> = {
  active: "var(--kf-success)",
  inactive: "var(--kf-neutral)",
  lead: "var(--kf-info)",
  prospect: "var(--kf-accent2)",
  customer: "var(--kf-success)",
  churned: "var(--kf-error)",

  confirmed: "var(--kf-success)",
  pending: "var(--kf-warning)",
  cancelled: "var(--kf-error)",
  completed: "var(--kf-success)",
  no_show: "var(--kf-neutral)",

  draft: "var(--kf-neutral)",
  sent: "var(--kf-info)",
  paid: "var(--kf-success)",
  overdue: "var(--kf-error)",
  partial: "var(--kf-warning)",
  void: "var(--kf-neutral)",

  scheduled: "var(--kf-info)",
  running: "var(--kf-success)",
  paused: "var(--kf-warning)",
  ended: "var(--kf-neutral)",

  open: "var(--kf-info)",
  closed: "var(--kf-neutral)",
  won: "var(--kf-success)",
  lost: "var(--kf-error)",

  success: "var(--kf-success)",
  warning: "var(--kf-warning)",
  error: "var(--kf-error)",
  info: "var(--kf-info)",
  neutral: "var(--kf-neutral)",
};

interface StatusBadgeProps {
  status: StatusType | (string & {});
  label?: string;
  variant?: StatusVariant;
  size?: StatusSize;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  variant = "filled",
  size = "sm",
  dot = false,
  className = "",
}: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase().replace(/[\s-]/g, "_") as StatusType;
  const colorVar = STATUS_COLOR_MAP[normalizedStatus] || "var(--kf-neutral)";
  const displayLabel = label || status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const sizeClasses = size === "sm"
    ? "kf-text-micro px-1.5 py-px"
    : "kf-text-micro px-2 py-0.5";

  const variantStyles = variant === "filled"
    ? { background: `hsl(${colorVar} / 0.1)`, color: `hsl(${colorVar})` }
    : { border: `1px solid hsl(${colorVar} / 0.3)`, color: `hsl(${colorVar})` };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium leading-none whitespace-nowrap ${sizeClasses} ${className}`}
      style={variantStyles}
    >
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: `hsl(${colorVar})` }}
        />
      )}
      {displayLabel}
    </span>
  );
}

export type { StatusType, StatusVariant, StatusSize };
