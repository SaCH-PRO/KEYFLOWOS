"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Target,
  Plus,
  Trash2,
  Save,
  Loader2,
  GripVertical,
  BarChart3,
  CheckCircle2,
  Sparkles,
  Upload,
  Users,
  TrendingUp,
} from "lucide-react";
import {
  fetchQualificationConfig,
  updateQualificationConfig,
  fetchQualificationAnalytics,
  type QualificationFlowConfig,
  type QualificationQuestion,
  type QualificationJourneyAnalytics,
  type Product,
} from "@/lib/client";
import { toast } from "sonner";
import { formatPrice } from "@/lib/format";

type Props = {
  businessId: string;
  products: Product[];
};

const EXECUTION_MODELS = [
  { value: "DIY", label: "DIY Kit" },
  { value: "AI_ASSISTED", label: "AI-Assisted" },
  { value: "HYBRID", label: "Hybrid Support" },
  { value: "FULL_SERVICE", label: "Full Service" },
];

const DEFAULT_INTAKE_FIELDS = [
  { id: "brand_name", label: "Brand / Business Name", type: "text" as const, required: true },
  { id: "brand_colors", label: "Brand Colors", type: "text" as const },
  { id: "primary_color", label: "Primary Brand Color", type: "color" as const },
  { id: "logo_url", label: "Logo URL", type: "text" as const },
  { id: "style_references", label: "Style References", type: "textarea" as const },
  { id: "target_audience", label: "Target Audience", type: "textarea" as const },
  { id: "platforms", label: "Target Platforms", type: "text" as const },
  { id: "additional_notes", label: "Additional Notes", type: "textarea" as const },
];

export function QualificationConfig({ businessId, products }: Props) {
  const [config, setConfig] = useState<QualificationFlowConfig>({
    enabled: false,
    title: "Find Your Perfect Package",
    subtitle: "Answer a few questions and we'll recommend the best fit for you.",
    showBudgetQuestion: true,
    showUrgencyQuestion: true,
    showExecutionPreference: true,
    questions: [],
    packageMappings: [],
    intakeChecklist: DEFAULT_INTAKE_FIELDS,
  });
  const [analytics, setAnalytics] = useState<QualificationJourneyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<"flow" | "intake" | "analytics">("flow");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [configRes, analyticsRes] = await Promise.all([
      fetchQualificationConfig(businessId),
      fetchQualificationAnalytics(businessId),
    ]);
    if (configRes.data) {
      setConfig({
        enabled: configRes.data.enabled ?? false,
        title: configRes.data.title ?? "Find Your Perfect Package",
        subtitle: configRes.data.subtitle ?? "Answer a few questions and we'll recommend the best fit for you.",
        showBudgetQuestion: configRes.data.showBudgetQuestion ?? true,
        showUrgencyQuestion: configRes.data.showUrgencyQuestion ?? true,
        showExecutionPreference: configRes.data.showExecutionPreference ?? true,
        questions: configRes.data.questions ?? [],
        packageMappings: configRes.data.packageMappings ?? [],
        intakeChecklist: configRes.data.intakeChecklist ?? DEFAULT_INTAKE_FIELDS,
      });
    }
    if (analyticsRes.data) setAnalytics(analyticsRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    const res = await updateQualificationConfig(businessId, config);
    if (res.error) {
      toast.error("Failed to save qualification config");
    } else {
      toast.success("Qualification flow saved!");
    }
    setSaving(false);
  };

  const addQuestion = () => {
    const newQ: QualificationQuestion = {
      id: `q_${Date.now()}`,
      label: "",
      type: "single",
      options: [{ value: "option_1", label: "" }],
    };
    setConfig(prev => ({
      ...prev,
      questions: [...(prev.questions ?? []), newQ],
    }));
  };

  const updateQuestion = (idx: number, updates: Partial<QualificationQuestion>) => {
    setConfig(prev => ({
      ...prev,
      questions: (prev.questions ?? []).map((q, i) => i === idx ? { ...q, ...updates } : q),
    }));
  };

  const removeQuestion = (idx: number) => {
    setConfig(prev => ({
      ...prev,
      questions: (prev.questions ?? []).filter((_, i) => i !== idx),
    }));
  };

  const addOption = (qIdx: number) => {
    const questions = [...(config.questions ?? [])];
    const q = { ...questions[qIdx] };
    q.options = [...q.options, { value: `option_${q.options.length + 1}`, label: "" }];
    questions[qIdx] = q;
    setConfig(prev => ({ ...prev, questions }));
  };

  const updateOption = (qIdx: number, oIdx: number, label: string) => {
    const questions = [...(config.questions ?? [])];
    const q = { ...questions[qIdx] };
    q.options = q.options.map((o, i) => i === oIdx ? { ...o, label, value: label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || o.value } : o);
    questions[qIdx] = q;
    setConfig(prev => ({ ...prev, questions }));
  };

  const removeOption = (qIdx: number, oIdx: number) => {
    const questions = [...(config.questions ?? [])];
    const q = { ...questions[qIdx] };
    q.options = q.options.filter((_, i) => i !== oIdx);
    questions[qIdx] = q;
    setConfig(prev => ({ ...prev, questions }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-sm text-muted-foreground">Loading qualification config...</span>
      </div>
    );
  }

  const sections = [
    { key: "flow" as const, label: "Guided Flow", icon: Target },
    { key: "intake" as const, label: "Asset Intake", icon: Upload },
    { key: "analytics" as const, label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Qualification Engine</h3>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted-foreground">{config.enabled ? "Active" : "Inactive"}</span>
            <button
              onClick={() => setConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
              className="relative w-9 h-5 rounded-full transition-colors"
              style={{ background: config.enabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted))" }}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: config.enabled ? "calc(100% - 18px)" : "2px" }}
              />
            </button>
          </label>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
            style={{ background: "hsl(var(--kf-accent1))" }}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--kf-muted)/0.3)" }}>
        {sections.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all flex-1 justify-center"
            style={{
              background: activeSection === s.key ? "hsl(var(--kf-card))" : "transparent",
              color: activeSection === s.key ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
              boxShadow: activeSection === s.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <s.icon className="w-3 h-3" />
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === "flow" && (
        <div className="space-y-4">
          <div className="kf-card p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Flow Settings</h4>
            <div className="space-y-2">
              <input
                type="text"
                value={config.title ?? ""}
                onChange={e => setConfig(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Flow title..."
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={config.subtitle ?? ""}
                onChange={e => setConfig(prev => ({ ...prev, subtitle: e.target.value }))}
                placeholder="Flow subtitle..."
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                { key: "showBudgetQuestion" as const, label: "Budget Question" },
                { key: "showUrgencyQuestion" as const, label: "Urgency Question" },
                { key: "showExecutionPreference" as const, label: "Execution Preference" },
              ].map(toggle => (
                <label key={toggle.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config[toggle.key] ?? true}
                    onChange={e => setConfig(prev => ({ ...prev, [toggle.key]: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-xs">{toggle.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="kf-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Custom Questions ({(config.questions ?? []).length})
              </h4>
              <button
                onClick={addQuestion}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}
              >
                <Plus className="w-3 h-3" /> Add Question
              </button>
            </div>

            {(config.questions ?? []).map((q, qIdx) => (
              <div key={q.id} className="rounded-lg border p-3 space-y-2" style={{ borderColor: "hsl(var(--kf-border)/0.5)" }}>
                <div className="flex items-center gap-2">
                  <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                  <input
                    type="text"
                    value={q.label}
                    onChange={e => updateQuestion(qIdx, { label: e.target.value })}
                    placeholder="Question text..."
                    className="flex-1 text-sm font-medium bg-transparent border-none outline-none"
                  />
                  <button onClick={() => removeQuestion(qIdx)} className="p-1 text-muted-foreground/40 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="pl-5 space-y-1.5">
                  {q.options.map((opt, oIdx) => (
                    <div key={oIdx} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: "hsl(var(--kf-border))" }} />
                      <input
                        type="text"
                        value={opt.label}
                        onChange={e => updateOption(qIdx, oIdx, e.target.value)}
                        placeholder="Option label..."
                        className="flex-1 text-xs bg-transparent border-none outline-none"
                      />
                      {q.options.length > 1 && (
                        <button onClick={() => removeOption(qIdx, oIdx)} className="p-0.5 text-muted-foreground/30 hover:text-red-400">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => addOption(qIdx)}
                    className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 pl-5"
                  >
                    <Plus className="w-2.5 h-2.5" /> Add option
                  </button>
                </div>
              </div>
            ))}

            {(config.questions ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No custom questions yet. The built-in budget, urgency, and execution preference questions will be shown automatically.
              </p>
            )}
          </div>

          <div className="kf-card p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Execution Models
            </h4>
            <p className="text-xs text-muted-foreground">
              Assign execution models to products so the guided flow can match customer preferences.
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {products.filter(p => p.isActive).map(product => {
                const current = (product as { executionModel?: string }).executionModel ?? "";
                return (
                  <div key={product.id} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block">{product.name}</span>
                      <span className="text-[10px] text-muted-foreground">{formatPrice(product.price, product.currency)}</span>
                    </div>
                    <select
                      value={current}
                      onChange={() => {}}
                      className="text-[11px] rounded-lg border px-2 py-1"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                      title="Execution model is set on the product directly"
                      disabled
                    >
                      <option value="">Not set</option>
                      {EXECUTION_MODELS.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Tip: Set execution models when editing products in the Catalog tab.
            </p>
          </div>
        </div>
      )}

      {activeSection === "intake" && (
        <div className="kf-card p-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Asset Intake Checklist
          </h4>
          <p className="text-xs text-muted-foreground">
            Customize what brand assets and details to collect from customers after they select a package.
          </p>
          <div className="space-y-2">
            {(config.intakeChecklist ?? []).map((field, idx) => (
              <div key={field.id} className="flex items-center gap-2 py-1">
                <GripVertical className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                <input
                  type="text"
                  value={field.label}
                  onChange={e => {
                    const checklist = [...(config.intakeChecklist ?? [])];
                    checklist[idx] = { ...checklist[idx], label: e.target.value };
                    setConfig(prev => ({ ...prev, intakeChecklist: checklist }));
                  }}
                  className="flex-1 text-xs bg-transparent border-none outline-none"
                  placeholder="Field label..."
                />
                <select
                  value={field.type}
                  onChange={e => {
                    const checklist = [...(config.intakeChecklist ?? [])];
                    checklist[idx] = { ...checklist[idx], type: e.target.value as 'text' | 'file' | 'color' | 'textarea' };
                    setConfig(prev => ({ ...prev, intakeChecklist: checklist }));
                  }}
                  className="text-[10px] rounded border px-1.5 py-0.5"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                >
                  <option value="text">Text</option>
                  <option value="textarea">Textarea</option>
                  <option value="color">Color</option>
                  <option value="file">File</option>
                </select>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required ?? false}
                    onChange={e => {
                      const checklist = [...(config.intakeChecklist ?? [])];
                      checklist[idx] = { ...checklist[idx], required: e.target.checked };
                      setConfig(prev => ({ ...prev, intakeChecklist: checklist }));
                    }}
                    className="rounded w-3 h-3"
                  />
                  <span className="text-[10px] text-muted-foreground">Req</span>
                </label>
                <button
                  onClick={() => {
                    setConfig(prev => ({
                      ...prev,
                      intakeChecklist: (prev.intakeChecklist ?? []).filter((_, i) => i !== idx),
                    }));
                  }}
                  className="p-0.5 text-muted-foreground/30 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              setConfig(prev => ({
                ...prev,
                intakeChecklist: [
                  ...(prev.intakeChecklist ?? []),
                  { id: `field_${Date.now()}`, label: "", type: "text" as const },
                ],
              }));
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium"
            style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" /> Add Field
          </button>
        </div>
      )}

      {activeSection === "analytics" && (
        <div className="space-y-4">
          {analytics ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Journeys", value: analytics.total, icon: Users },
                  { label: "Completion Rate", value: `${analytics.completionRate}%`, icon: TrendingUp },
                  { label: "Packages Selected", value: analytics.conversionFunnel.packageSelected, icon: CheckCircle2 },
                  { label: "Fully Converted", value: analytics.conversionFunnel.converted, icon: Sparkles },
                ].map(stat => (
                  <div key={stat.label} className="kf-card p-3 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <stat.icon className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                      <span className="text-[10px] text-muted-foreground">{stat.label}</span>
                    </div>
                    <div className="text-lg font-bold">{stat.value}</div>
                  </div>
                ))}
              </div>

              <div className="kf-card p-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversion Funnel</h4>
                {[
                  { label: "Started Flow", count: analytics.conversionFunnel.started },
                  { label: "Got Recommendations", count: analytics.conversionFunnel.recommended },
                  { label: "Selected Package", count: analytics.conversionFunnel.packageSelected },
                  { label: "Completed Intake", count: analytics.conversionFunnel.intakeCompleted },
                  { label: "Fully Converted", count: analytics.conversionFunnel.converted },
                ].map((stage, i, arr) => {
                  const maxCount = arr[0].count || 1;
                  const pct = Math.round((stage.count / maxCount) * 100);
                  return (
                    <div key={stage.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{stage.label}</span>
                        <span className="font-medium">{stage.count} ({pct}%)</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.3)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: "hsl(var(--kf-accent1))",
                            opacity: 0.4 + (pct / 100) * 0.6,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {analytics.recentJourneys.length > 0 && (
                <div className="kf-card p-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Journeys</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {analytics.recentJourneys.map(j => (
                      <div key={j.id} className="flex items-center justify-between py-1.5 border-b last:border-b-0" style={{ borderColor: "hsl(var(--kf-border)/0.3)" }}>
                        <div className="min-w-0">
                          <span className="text-xs font-medium block truncate">{j.customerName || j.customerEmail || "Anonymous"}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(j.createdAt).toLocaleDateString()}</span>
                        </div>
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            background: j.status === "converted" ? "hsl(var(--kf-success)/0.1)" : "hsl(var(--kf-muted)/0.3)",
                            color: j.status === "converted" ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))",
                          }}
                        >
                          {j.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground/20 mb-2" />
              <p className="text-sm text-muted-foreground">No qualification data yet</p>
              <p className="text-xs text-muted-foreground/60">Analytics will appear once customers use the guided flow</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
