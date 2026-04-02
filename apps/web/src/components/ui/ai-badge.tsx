"use client";

import { Sparkles, ShieldCheck } from "lucide-react";
import { InfoBadge } from "./info-badge";

interface AiBadgeProps {
  label?: string;
  confidence?: number;
  explanation?: string;
  compact?: boolean;
}

export function AiBadge({
  label = "AI",
  confidence,
  explanation,
  compact = false,
}: AiBadgeProps) {
  const confColor = confidence
    ? confidence >= 70
      ? "--kf-success"
      : confidence >= 40
        ? "--kf-warning"
        : "--kf-error"
    : "--kf-accent1";

  const confLabel = confidence
    ? confidence >= 70
      ? "High"
      : confidence >= 40
        ? "Medium"
        : "Low"
    : null;

  const badge = (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
      style={{
        background: "hsl(var(--kf-accent1) / 0.1)",
        color: "hsl(var(--kf-accent1))",
      }}
    >
      <Sparkles className="w-2.5 h-2.5" />
      {!compact && label}
      {confidence !== undefined && (
        <span
          className="inline-flex items-center gap-0.5 ml-0.5 px-1 py-px rounded-full"
          style={{
            background: `hsl(var(${confColor}) / 0.15)`,
            color: `hsl(var(${confColor}))`,
          }}
        >
          <ShieldCheck className="w-2 h-2" />
          {confidence}% {confLabel}
        </span>
      )}
    </span>
  );

  if (explanation) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {badge}
        <InfoBadge
          title="AI-Powered"
          body={explanation}
          iconSize={10}
          side="bottom"
        />
      </span>
    );
  }

  return badge;
}
