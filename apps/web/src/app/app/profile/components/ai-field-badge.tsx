"use client";

import { Sparkles } from "lucide-react";

interface AiFieldBadgeProps {
  label?: string;
  onClick?: () => void;
}

export function AiFieldBadge({ label, onClick }: AiFieldBadgeProps) {
  const content = (
    <>
      <Sparkles className="h-2.5 w-2.5" />
      {label || "AI"}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold transition-all hover:scale-105"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))",
          color: "hsl(var(--kf-accent1))",
          border: "1px solid hsl(var(--kf-accent1) / 0.2)",
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))",
        color: "hsl(var(--kf-accent1))",
        border: "1px solid hsl(var(--kf-accent1) / 0.2)",
      }}
    >
      {content}
    </span>
  );
}

export function DataUsageHint({ text }: { text: string }) {
  return (
    <p className="text-[10px] mt-1 opacity-60">{text}</p>
  );
}
