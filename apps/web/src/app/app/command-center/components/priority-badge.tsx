"use client";

import type { CommandCenterPriority } from "@/lib/api/business-command-center";

const styles: Record<CommandCenterPriority, { label: string; color: string; bg: string }> = {
  CRITICAL: { label: "Critical", color: "hsl(var(--kf-danger))", bg: "hsl(var(--kf-danger) / 0.1)" },
  HIGH: { label: "High", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
  MEDIUM: { label: "Medium", color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
  LOW: { label: "Low", color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted) / 0.15)" },
};

interface PriorityBadgeProps {
  priority: CommandCenterPriority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const style = styles[priority];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ color: style.color, background: style.bg }}
    >
      {style.label}
    </span>
  );
}
