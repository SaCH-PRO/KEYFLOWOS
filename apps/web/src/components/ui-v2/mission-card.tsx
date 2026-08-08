import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";
import { ProgressRing } from "./progress-ring";

export interface MissionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ElementType;
  title: string;
  description?: string;
  status?: "ready" | "attention" | "locked" | "progress";
  progress?: number;
  badge?: string;
  onClick?: () => void;
}

export function MissionCard({
  icon: Icon,
  title,
  description,
  status = "ready",
  progress,
  badge,
  className,
  onClick,
  ...props
}: MissionCardProps) {
  const statusColor =
    status === "ready" ? "mint" : status === "attention" ? "rose" : status === "locked" ? "muted" : "orange";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "mission-card group",
        onClick && "cursor-pointer",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="mission-icon">
          <Icon className="h-5 w-5" />
        </div>
        {typeof progress === "number" ? (
          <ProgressRing value={progress} size={44} thickness={5} color={status === "ready" ? "teal" : "orange"} />
        ) : badge ? (
          <Badge color={statusColor as never}>{badge}</Badge>
        ) : null}
      </div>
      <div>
        <h3 className="font-display text-heading font-semibold text-foreground group-hover:text-accent1 transition-colors">
          {title}
        </h3>
        {description && <p className="text-caption text-muted-foreground mt-1 line-clamp-2">{description}</p>}
      </div>
    </div>
  );
}
