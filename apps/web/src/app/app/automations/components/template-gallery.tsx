"use client";

import { useState, useMemo, useEffect } from "react";
import { Zap, Play, Eye, X, ArrowDown, Search, CheckCircle, Sparkles, Workflow, Star } from "lucide-react";
import { createPlaybook, fetchPlaybooks } from "@/lib/client";
import {
  AUTOMATION_TEMPLATES, COVERAGE_MODULES, getTriggerLabel, getActionLabel,
  MODULE_COLORS, type AutomationTemplate, type FlowComplexity,
} from "./automation-constants";

const CATEGORY_STYLES: Record<string, string> = {
  Commerce: "hsl(var(--kf-accent1))",
  Bookings: "hsl(var(--kf-accent2))",
  CRM: "hsl(var(--kf-info))",
  Marketing: "hsl(var(--kf-success))",
  "Time-Based": "hsl(var(--kf-warning))",
};

const COMPLEXITY_BADGE: Record<FlowComplexity, { label: string; color: string }> = {
  easy: { label: "Easy", color: "hsl(var(--kf-success))" },
  medium: { label: "Medium", color: "hsl(var(--kf-warning))" },
  advanced: { label: "Advanced", color: "hsl(var(--kf-accent1))" },
};

interface TemplateGalleryProps {
  onSelect: (template: AutomationTemplate) => void;
  businessId?: string | null;
}

type FilterModule = "all" | "Commerce" | "Bookings" | "CRM" | "Marketing" | "Time-Based";
type FilterComplexity = "all" | FlowComplexity;
type SortMode = "relevance" | "category" | "complexity";

function computeRelevanceScore(template: AutomationTemplate, activeTriggers: Set<string>): number {
  let score = 0;

  if (!activeTriggers.has(template.trigger)) {
    score += 30;
  }

  const triggerModule = COVERAGE_MODULES.find((m) => m.triggers.includes(template.trigger));
  if (triggerModule) {
    const moduleCoverage = triggerModule.triggers.filter((t) => activeTriggers.has(t)).length / triggerModule.triggers.length;
    if (moduleCoverage < 0.25) score += 25;
    else if (moduleCoverage < 0.5) score += 15;
  }

  if (template.complexity === "easy") score += 20;
  else if (template.complexity === "medium") score += 10;

  if (template.modulesTouched.length >= 3) score += 10;

  const criticalTriggers = ["invoice.overdue", "booking.cancelled", "contact.inactive", "form.submitted"];
  if (criticalTriggers.includes(template.trigger)) score += 15;

  return Math.min(score, 100);
}

export function TemplateGallery({ onSelect, businessId }: TemplateGalleryProps) {
  const [activating, setActivating] = useState<string | null>(null);
  const [activated, setActivated] = useState<Set<string>>(new Set());
  const [previewTemplate, setPreviewTemplate] = useState<AutomationTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState<FilterModule>("all");
  const [complexityFilter, setComplexityFilter] = useState<FilterComplexity>("all");
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
  const [activeTriggers, setActiveTriggers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      fetchPlaybooks(businessId),
      import("@/lib/client").then((mod) => mod.fetchCrossModuleWorkflows(businessId)),
    ]).then(([pbRes, wfRes]) => {
      const triggers = new Set<string>();
      if (pbRes.data) {
        for (const p of pbRes.data) {
          if (p.enabled) triggers.add(p.triggerEvent);
        }
      }
      if (wfRes.data) {
        for (const w of wfRes.data) {
          if (w.enabled) triggers.add(w.triggerEvent);
        }
      }
      setActiveTriggers(triggers);
    });
  }, [businessId]);

  const categories = useMemo(() => Array.from(new Set(AUTOMATION_TEMPLATES.map((t) => t.category))), []);

  const templatesWithScores = useMemo(() => {
    return AUTOMATION_TEMPLATES.map((t) => ({
      template: t,
      relevance: computeRelevanceScore(t, activeTriggers),
    }));
  }, [activeTriggers]);

  const filteredTemplates = useMemo(() => {
    let result = templatesWithScores;
    if (moduleFilter !== "all") {
      result = result.filter((t) => t.template.category === moduleFilter);
    }
    if (complexityFilter !== "all") {
      result = result.filter((t) => t.template.complexity === complexityFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.template.name.toLowerCase().includes(q) ||
          t.template.description.toLowerCase().includes(q) ||
          t.template.businessProblem.toLowerCase().includes(q)
      );
    }

    if (sortMode === "relevance") {
      result = [...result].sort((a, b) => b.relevance - a.relevance);
    } else if (sortMode === "complexity") {
      const order: Record<string, number> = { easy: 0, medium: 1, advanced: 2 };
      result = [...result].sort((a, b) => (order[a.template.complexity] ?? 0) - (order[b.template.complexity] ?? 0));
    }

    return result;
  }, [templatesWithScores, moduleFilter, complexityFilter, searchQuery, sortMode]);

  const groupedTemplates = useMemo(() => {
    if (sortMode !== "category") {
      return { "All Templates": filteredTemplates };
    }
    const groups: Record<string, typeof filteredTemplates> = {};
    for (const t of filteredTemplates) {
      const cat = t.template.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }
    return groups;
  }, [filteredTemplates, sortMode]);

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

  function getRelevanceBadge(score: number) {
    if (score >= 60) return { label: "High Match", color: "hsl(var(--kf-success))" };
    if (score >= 30) return { label: "Good Fit", color: "hsl(var(--kf-accent2))" };
    return null;
  }

  const sortButtons: { key: SortMode; label: string }[] = [
    { key: "relevance", label: "By Relevance" },
    { key: "category", label: "By Category" },
    { key: "complexity", label: "By Complexity" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <p className="text-sm text-muted-foreground">
          Strategic flow templates organized by business problem. Templates are <strong>ranked by relevance</strong> to your current coverage gaps. <strong>Activate</strong> to create instantly, or click to customize.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-input pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground/50 min-h-[36px]"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", ...categories] as FilterModule[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setModuleFilter(cat)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors min-h-[32px]"
              style={{
                background: moduleFilter === cat ? "hsl(var(--kf-accent1) / 0.15)" : "transparent",
                color: moduleFilter === cat ? "hsl(var(--kf-accent1))" : undefined,
              }}
            >
              {cat === "all" ? "All" : cat}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {(["all", "easy", "medium", "advanced"] as FilterComplexity[]).map((cx) => {
            const badge = cx !== "all" ? COMPLEXITY_BADGE[cx] : null;
            return (
              <button
                key={cx}
                onClick={() => setComplexityFilter(cx)}
                className="text-[11px] font-medium px-2 py-1 rounded-lg transition-colors min-h-[32px]"
                style={{
                  background: complexityFilter === cx ? (badge ? `${badge.color}15` : "hsl(var(--kf-accent1) / 0.15)") : "transparent",
                  color: complexityFilter === cx ? (badge?.color ?? "hsl(var(--kf-accent1))") : undefined,
                }}
              >
                {cx === "all" ? "Any" : cx.charAt(0).toUpperCase() + cx.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {sortButtons.map((sb) => (
          <button
            key={sb.key}
            onClick={() => setSortMode(sb.key)}
            className="text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors min-h-[28px]"
            style={{
              background: sortMode === sb.key ? "hsl(var(--kf-info) / 0.15)" : "transparent",
              color: sortMode === sb.key ? "hsl(var(--kf-info))" : undefined,
            }}
          >
            {sb.label}
          </button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">{filteredTemplates.length} templates</span>
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <p className="text-sm font-medium mb-1">No matching templates</p>
          <p className="text-xs text-muted-foreground">Try adjusting your filters or search.</p>
        </div>
      ) : (
        Object.entries(groupedTemplates).map(([category, templates]) => (
          <div key={category} className="space-y-3">
            {sortMode === "category" && (
              <div className="flex items-center gap-2 px-1">
                <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_STYLES[category] ?? "hsl(var(--kf-accent1))" }} />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{category}</span>
                <span className="text-[10px] text-muted-foreground/50">{templates.length} templates</span>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {templates.map(({ template, relevance }) => {
                const isActivated = activated.has(template.id);
                const catColor = CATEGORY_STYLES[template.category] ?? "hsl(var(--kf-accent1))";
                const cx = COMPLEXITY_BADGE[template.complexity];
                const relevanceBadge = getRelevanceBadge(relevance);
                return (
                  <div
                    key={template.id}
                    onClick={() => onSelect(template)}
                    className="rounded-2xl border border-border/60 bg-card p-4 text-left hover:border-primary/40 transition-all group cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") onSelect(template); }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: "hsl(var(--muted) / 0.5)" }}
                      >
                        <Workflow className="w-4 h-4" style={{ color: catColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold group-hover:text-primary transition-colors truncate">{template.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0" style={{ background: `${cx.color}15`, color: cx.color }}>
                            {cx.label}
                          </span>
                          {relevanceBadge && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0 inline-flex items-center gap-0.5" style={{ background: `${relevanceBadge.color}15`, color: relevanceBadge.color }}>
                              <Star className="w-2.5 h-2.5" />
                              {relevanceBadge.label}
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "hsl(var(--kf-warning))" }}>
                          <Sparkles className="w-3 h-3 inline mr-1" />
                          {template.businessProblem}
                        </p>

                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{template.description}</p>

                        <div className="mt-2 flex items-center gap-1 flex-wrap">
                          {template.modulesTouched.map((mod) => (
                            <span
                              key={mod}
                              className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                              style={{
                                background: `${MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))"}15`,
                                color: MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))",
                              }}
                            >
                              {mod}
                            </span>
                          ))}
                        </div>

                        {template.prerequisites.length > 0 && (
                          <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                            Requires: {template.prerequisites.join(", ")}
                          </p>
                        )}

                        <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                          <CheckCircle className="w-3 h-3 inline mr-0.5" style={{ color: "hsl(var(--kf-success))" }} />
                          {template.expectedOutcome}
                        </p>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setPreviewTemplate(template); }}
                            className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-colors min-h-[28px]"
                            style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                          >
                            <Eye className="w-3 h-3" />
                            Preview
                          </button>
                          <button
                            onClick={(e) => handleActivate(template, e)}
                            disabled={activating === template.id || isActivated}
                            className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-colors min-h-[28px]"
                            style={{
                              background: isActivated ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-accent1) / 0.15)",
                              color: isActivated ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
                            }}
                          >
                            <Play className="w-3 h-3" />
                            {activating === template.id ? "..." : isActivated ? "Activated" : "Activate"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-lg shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-border/40 sticky top-0 bg-card z-10">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Eye className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                Flow Preview
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

              <div className="rounded-lg p-3 space-y-1" style={{ background: "hsl(var(--kf-warning) / 0.06)", border: "1px solid hsl(var(--kf-warning) / 0.15)" }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "hsl(var(--kf-warning))" }}>Solves</p>
                <p className="text-sm">{previewTemplate.businessProblem}</p>
              </div>

              <div className="rounded-lg p-3 space-y-1" style={{ background: "hsl(var(--kf-success) / 0.06)", border: "1px solid hsl(var(--kf-success) / 0.15)" }}>
                <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "hsl(var(--kf-success))" }}>Expected Outcome</p>
                <p className="text-sm">{previewTemplate.expectedOutcome}</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Modules:</span>
                {previewTemplate.modulesTouched.map((mod) => (
                  <span
                    key={mod}
                    className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                    style={{
                      background: `${MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))"}15`,
                      color: MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))",
                    }}
                  >
                    {mod}
                  </span>
                ))}
                <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium ml-auto" style={{ background: `${COMPLEXITY_BADGE[previewTemplate.complexity].color}15`, color: COMPLEXITY_BADGE[previewTemplate.complexity].color }}>
                  {COMPLEXITY_BADGE[previewTemplate.complexity].label}
                </span>
              </div>

              {previewTemplate.prerequisites.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <strong>Requires:</strong> {previewTemplate.prerequisites.join(", ")}
                </div>
              )}

              <div className="space-y-0">
                <div className="flex items-center gap-3 py-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
                    <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Trigger</p>
                    <p className="text-sm font-medium">{getTriggerLabel(previewTemplate.trigger)}</p>
                  </div>
                </div>

                {previewTemplate.actions.map((action, i) => (
                  <div key={i}>
                    <div className="flex justify-center py-1">
                      <ArrowDown className="w-3 h-3 text-muted-foreground/30" />
                    </div>
                    <div className="flex items-center gap-3 py-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-success) / 0.15)" }}>
                        <span className="text-xs font-bold" style={{ color: "hsl(var(--kf-success))" }}>{i + 1}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Action {i + 1}</p>
                        <p className="text-sm font-medium">{getActionLabel(action.type)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 p-5 pt-0 sticky bottom-0 bg-card">
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
