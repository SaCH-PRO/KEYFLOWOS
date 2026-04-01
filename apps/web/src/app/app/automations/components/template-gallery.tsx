"use client";

import { useState } from "react";
import { Zap, Play } from "lucide-react";
import { createPlaybook } from "@/lib/client";
import { AUTOMATION_TEMPLATES, getTriggerLabel, getActionLabel, type AutomationTemplate } from "./automation-constants";

const CATEGORY_STYLES: Record<string, string> = {
  Commerce: "hsl(var(--kf-accent1))",
  Bookings: "hsl(var(--kf-accent2))",
  CRM: "hsl(var(--kf-info))",
  Marketing: "hsl(var(--kf-success))",
  "Time-Based": "hsl(var(--kf-warning))",
};

interface TemplateGalleryProps {
  onSelect: (template: AutomationTemplate) => void;
  businessId?: string | null;
}

export function TemplateGallery({ onSelect, businessId }: TemplateGalleryProps) {
  const [activating, setActivating] = useState<string | null>(null);
  const [activated, setActivated] = useState<Set<string>>(new Set());

  const categories = Array.from(new Set(AUTOMATION_TEMPLATES.map((t) => t.category)));

  async function handleActivate(template: AutomationTemplate, e: React.MouseEvent) {
    e.stopPropagation();
    setActivating(template.id);
    const { data } = await createPlaybook({
      name: template.name,
      triggerEvent: template.trigger,
      actions: template.actions,
      businessId: businessId ?? undefined,
    });
    setActivating(null);
    if (data) {
      setActivated((prev) => new Set(prev).add(template.id));
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Start quickly with a pre-built template. Click <strong>Activate</strong> to create it instantly, or click the card to customize before creating.
        </p>
      </div>

      {categories.map((category) => (
        <div key={category} className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_STYLES[category] ?? "hsl(var(--kf-accent1))" }} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{category}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {AUTOMATION_TEMPLATES.filter((t) => t.category === category).map((template) => {
              const isActivated = activated.has(template.id);
              const catColor = CATEGORY_STYLES[category] ?? "hsl(var(--kf-accent1))";
              return (
                <div
                  key={template.id}
                  onClick={() => onSelect(template)}
                  className="rounded-2xl border border-border/60 bg-card p-4 text-left hover:border-primary/40 transition-colors group cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") onSelect(template); }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: "hsl(var(--muted) / 0.5)" }}
                    >
                      <Zap className="w-4 h-4" style={{ color: catColor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold group-hover:text-primary transition-colors">{template.name}</div>
                      <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{template.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                        >
                          {getTriggerLabel(template.trigger)}
                        </span>
                        {template.actions.map((a, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded-md"
                            style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                          >
                            {getActionLabel(a.type)}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={(e) => handleActivate(template, e)}
                          disabled={activating === template.id || isActivated}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
                          style={{
                            background: isActivated ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-accent1) / 0.15)",
                            color: isActivated ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
                          }}
                        >
                          <Play className="w-3 h-3" />
                          {activating === template.id ? "Activating..." : isActivated ? "Activated" : "Activate"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
