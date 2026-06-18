"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { BusinessIntelligenceInsight } from "@/lib/api/intelligence";

interface IntelligencePriorityListProps {
  priorities: BusinessIntelligenceInsight[];
}

export function IntelligencePriorityList({ priorities }: IntelligencePriorityListProps) {
  const router = useRouter();

  if (priorities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}>
        <p className="text-sm text-muted-foreground">No high-priority items right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {priorities.map((insight) => (
        <div
          key={insight.id}
          className="flex items-start gap-3 rounded-lg p-3"
          style={{ background: "hsl(var(--kf-muted) / 0.08)" }}
        >
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background:
                insight.priority === "CRITICAL"
                  ? "hsl(var(--kf-destructive) / 0.1)"
                  : insight.priority === "HIGH"
                    ? "hsl(var(--kf-warning) / 0.1)"
                    : "hsl(var(--kf-accent1) / 0.08)",
            }}
          >
            <AlertTriangle
              className="w-3.5 h-3.5"
              style={{
                color:
                  insight.priority === "CRITICAL"
                    ? "hsl(var(--kf-destructive))"
                    : insight.priority === "HIGH"
                      ? "hsl(var(--kf-warning))"
                      : "hsl(var(--kf-accent1))",
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-foreground truncate">{insight.title}</h4>
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                style={{
                  color:
                    insight.priority === "CRITICAL"
                      ? "hsl(var(--kf-destructive))"
                      : insight.priority === "HIGH"
                        ? "hsl(var(--kf-warning))"
                        : "hsl(var(--kf-accent1))",
                  background:
                    insight.priority === "CRITICAL"
                      ? "hsl(var(--kf-destructive) / 0.08)"
                      : insight.priority === "HIGH"
                        ? "hsl(var(--kf-warning) / 0.08)"
                        : "hsl(var(--kf-accent1) / 0.08)",
                }}
              >
                {insight.priority}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{insight.finding}</p>
          </div>
          {insight.recommendedAction?.href && (
            <button
              onClick={() => router.push(insight.recommendedAction!.href!)}
              className="flex-shrink-0 p-1.5 rounded-md hover:bg-muted/50 transition-colors"
              style={{ color: "hsl(var(--kf-accent1))" }}
              aria-label={insight.recommendedAction.label}
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
