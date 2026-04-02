"use client";

import { useState } from "react";
import { Zap, Play, Eye, X, ArrowRight, Filter } from "lucide-react";
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
  const [previewTemplate, setPreviewTemplate] = useState<AutomationTemplate | null>(null);

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

  function handlePreview(template: AutomationTemplate, e: React.MouseEvent) {
    e.stopPropagation();
    setPreviewTemplate(template);
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
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={(e) => handlePreview(template, e)}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
                          style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                        >
                          <Eye className="w-3 h-3" />
                          Preview
                        </button>
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

      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-border/40">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Eye className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                Template Preview
              </h3>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <p className="text-base font-semibold">{previewTemplate.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{previewTemplate.description}</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
                  >
                    <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Trigger</p>
                    <p className="text-sm font-medium">{getTriggerLabel(previewTemplate.trigger)}</p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <ArrowRight className="w-4 h-4 text-muted-foreground/40 rotate-90" />
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "hsl(var(--muted) / 0.5)" }}
                  >
                    <Filter className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Condition</p>
                    <p className="text-sm text-muted-foreground italic">No condition (always run)</p>
                  </div>
                </div>

                <div className="flex justify-center">
                  <ArrowRight className="w-4 h-4 text-muted-foreground/40 rotate-90" />
                </div>

                {previewTemplate.actions.map((action, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: "hsl(var(--kf-success) / 0.15)" }}
                      >
                        <span className="text-xs font-bold" style={{ color: "hsl(var(--kf-success))" }}>{i + 1}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Action {i + 1}</p>
                        <p className="text-sm font-medium">{getActionLabel(action.type)}</p>
                      </div>
                    </div>
                    {i < previewTemplate.actions.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground/30 rotate-90" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 p-5 pt-0">
              <button
                onClick={() => setPreviewTemplate(null)}
                className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
              >
                Close
              </button>
              <button
                onClick={() => {
                  onSelect(previewTemplate);
                  setPreviewTemplate(null);
                }}
                className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors min-h-[44px]"
                style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
              >
                Customize &amp; Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
