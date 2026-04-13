"use client";

import { useMemo } from "react";
import { Lightbulb, Zap } from "lucide-react";
import { AUTOMATION_TEMPLATES, MODULE_COLORS, type AutomationTemplate } from "./automation-constants";

interface RecommendedFlowsProps {
  activeTriggers: Set<string>;
  onSelect: (template: AutomationTemplate) => void;
}

interface Recommendation {
  template: AutomationTemplate;
  reason: string;
}

const COMPLEXITY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy", color: "hsl(var(--kf-success))" },
  medium: { label: "Medium", color: "hsl(var(--kf-warning))" },
  advanced: { label: "Advanced", color: "hsl(var(--kf-accent1))" },
};

export function RecommendedFlows({ activeTriggers, onSelect }: RecommendedFlowsProps) {
  const recommendations = useMemo(() => {
    const recs: Recommendation[] = [];

    const hasFormTrigger = activeTriggers.has("form.submitted");
    const hasOverdueTrigger = activeTriggers.has("invoice.overdue");
    const hasBookingCompleteTrigger = activeTriggers.has("booking.completed");
    const hasCancelledTrigger = activeTriggers.has("booking.cancelled");
    const hasInactiveContactTrigger = activeTriggers.has("contact.inactive") || activeTriggers.has("contact.no_activity_30d");

    if (!hasFormTrigger) {
      const t = AUTOMATION_TEMPLATES.find((t) => t.id === "lead-nurture");
      if (t) recs.push({ template: t, reason: "You have no form-to-CRM automation — leads may go unfollowed" });
    }

    if (!hasOverdueTrigger) {
      const t = AUTOMATION_TEMPLATES.find((t) => t.id === "overdue-followup");
      if (t) recs.push({ template: t, reason: "Overdue invoices have no automatic reminder — protect your cash flow" });
    }

    if (!hasBookingCompleteTrigger) {
      const t = AUTOMATION_TEMPLATES.find((t) => t.id === "booking-followup");
      if (t) recs.push({ template: t, reason: "Completed bookings generate no feedback — you're missing reviews" });
    }

    if (!hasCancelledTrigger) {
      const t = AUTOMATION_TEMPLATES.find((t) => t.id === "booking-cancelled-reengagement");
      if (t) recs.push({ template: t, reason: "Cancelled bookings have no recovery flow — revenue is being lost" });
    }

    if (!hasInactiveContactTrigger) {
      const t = AUTOMATION_TEMPLATES.find((t) => t.id === "inactive-contact-reminder");
      if (t) recs.push({ template: t, reason: "Inactive contacts get no outreach — clients may silently churn" });
    }

    if (!activeTriggers.has("contact.created")) {
      const t = AUTOMATION_TEMPLATES.find((t) => t.id === "welcome-email");
      if (t) recs.push({ template: t, reason: "New contacts receive no welcome — first impressions are lost" });
    }

    return recs.slice(0, 3);
  }, [activeTriggers]);

  if (recommendations.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}>
          <Lightbulb className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended Flows</span>
        <span className="text-[10px] text-muted-foreground ml-auto">Based on your current coverage gaps</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {recommendations.map((rec) => {
          const cx = COMPLEXITY_LABELS[rec.template.complexity] ?? COMPLEXITY_LABELS.easy;
          return (
            <button
              key={rec.template.id}
              onClick={() => onSelect(rec.template)}
              className="rounded-lg p-3 text-left transition-all hover:ring-1 hover:ring-primary/30 group"
              style={{ background: "hsl(var(--muted) / 0.15)", border: "1px solid hsl(var(--border) / 0.4)" }}
            >
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
                  <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold group-hover:text-primary transition-colors truncate">{rec.template.name}</div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{rec.reason}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: `${cx.color}15`, color: cx.color }}>
                      {cx.label}
                    </span>
                    <div className="flex gap-1">
                      {rec.template.modulesTouched.slice(0, 3).map((mod) => (
                        <span
                          key={mod}
                          className="text-[9px] px-1 py-0.5 rounded"
                          style={{ background: `${MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))"}15`, color: MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))" }}
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
