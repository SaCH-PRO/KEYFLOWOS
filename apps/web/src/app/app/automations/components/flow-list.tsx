"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Power, PowerOff, Brain, Settings2, Clock, Plus, Search, Pencil,
  AlertTriangle, CheckCircle, TrendingUp, Workflow,
} from "lucide-react";
import {
  Playbook, updatePlaybook,
  CrossModuleWorkflow, updateCrossModuleWorkflow,
} from "@/lib/client";
import {
  getTriggerLabel, getActionLabels, getWorkflowActionSummary,
  getFlowModules, MODULE_COLORS,
} from "./automation-constants";
import { PlaybookEditor } from "./playbook-editor";
import type { AutomationTemplate, ActionStep } from "./automation-constants";

interface FlowListProps {
  businessId: string | null;
  templateToUse: AutomationTemplate | null;
  onTemplateClear: () => void;
  playbooks: Playbook[];
  workflows: CrossModuleWorkflow[];
  loading: boolean;
  onPlaybooksChange: (fn: ((prev: Playbook[]) => Playbook[]) | Playbook[]) => void;
  onWorkflowsChange: (fn: ((prev: CrossModuleWorkflow[]) => CrossModuleWorkflow[]) | CrossModuleWorkflow[]) => void;
}

type UnifiedFlow =
  | { kind: "playbook"; data: Playbook }
  | { kind: "workflow"; data: CrossModuleWorkflow };

type FilterStatus = "all" | "active" | "paused" | "needs-attention";

export function FlowList({
  businessId, templateToUse, onTemplateClear,
  playbooks, workflows, loading,
  onPlaybooksChange, onWorkflowsChange,
}: FlowListProps) {
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);
  const [search, setSearch] = useState("");
  const [expandedWf, setExpandedWf] = useState<string | null>(null);
  const [updatingWf, setUpdatingWf] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

  useEffect(() => {
    if (templateToUse) {
      setEditingPlaybook(null);
      setShowEditor(true);
    }
  }, [templateToUse]);

  const unified: UnifiedFlow[] = useMemo(() => [
    ...playbooks.map((p) => ({ kind: "playbook" as const, data: p })),
    ...workflows.map((w) => ({ kind: "workflow" as const, data: w })),
  ], [playbooks, workflows]);

  const filtered = useMemo(() => {
    let result = unified;

    if (statusFilter === "active") {
      result = result.filter((item) => item.data.enabled);
    } else if (statusFilter === "paused") {
      result = result.filter((item) => !item.data.enabled);
    } else if (statusFilter === "needs-attention") {
      result = result.filter((item) => {
        if (item.kind === "playbook") {
          return item.data.enabled && !(item.data.runCount ?? 0) && !item.data.lastRunAt;
        }
        return item.data.enabled && !item.data.runCount && !item.data.lastRunAt;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((item) => item.data.name.toLowerCase().includes(q));
    }

    return result;
  }, [unified, statusFilter, search]);

  const activeCount = playbooks.filter((p) => p.enabled).length + workflows.filter((w) => w.enabled).length;

  async function handleTogglePlaybook(pb: Playbook) {
    const { data, error: err } = await updatePlaybook({
      playbookId: pb.id,
      enabled: !pb.enabled,
      businessId: businessId ?? undefined,
    });
    if (err) setError(err);
    else if (data) onPlaybooksChange((prev: Playbook[]) => prev.map((p) => (p.id === pb.id ? data : p)));
  }

  async function handleToggleWorkflow(wf: CrossModuleWorkflow) {
    setUpdatingWf(wf.key);
    const { error: err } = await updateCrossModuleWorkflow({
      businessId: businessId ?? undefined,
      workflowKey: wf.key,
      enabled: !wf.enabled,
    });
    if (err) setError(err);
    else onWorkflowsChange((prev: CrossModuleWorkflow[]) => prev.map((w) => (w.key === wf.key ? { ...w, enabled: !wf.enabled } : w)));
    setUpdatingWf(null);
  }

  async function handleConfigUpdate(wf: CrossModuleWorkflow, newConfig: Record<string, string | number | boolean | null>) {
    setUpdatingWf(wf.key);
    const { error: err } = await updateCrossModuleWorkflow({
      businessId: businessId ?? undefined,
      workflowKey: wf.key,
      config: newConfig,
    });
    if (err) setError(err);
    else onWorkflowsChange((prev: CrossModuleWorkflow[]) => prev.map((w) => (w.key === wf.key ? { ...w, config: newConfig } : w)));
    setUpdatingWf(null);
  }

  function handleEditorClose() {
    setShowEditor(false);
    setEditingPlaybook(null);
    onTemplateClear();
  }

  function handleEditPlaybook(pb: Playbook) {
    setEditingPlaybook(pb);
    setShowEditor(true);
  }

  function handlePlaybookSaved(pb: Playbook) {
    onPlaybooksChange((prev: Playbook[]) => {
      const exists = prev.find((p) => p.id === pb.id);
      if (exists) return prev.map((p) => (p.id === pb.id ? pb : p));
      return [pb, ...prev];
    });
  }

  function getHealthIndicator(enabled: boolean, lastRunAt: string | null | undefined, runCount: number) {
    if (!enabled) return { label: "Paused", color: "hsl(var(--muted-foreground))", icon: PowerOff };
    if (runCount === 0 && !lastRunAt) return { label: "Never run", color: "hsl(var(--kf-warning))", icon: AlertTriangle };
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (lastRunAt && new Date(lastRunAt).getTime() > weekAgo) {
      return { label: "Healthy", color: "hsl(var(--kf-success))", icon: CheckCircle };
    }
    return { label: "Idle", color: "hsl(var(--muted-foreground))", icon: Clock };
  }

  function getFlowWarnings(enabled: boolean, lastRunAt: string | null | undefined, runCount: number): string[] {
    const warnings: string[] = [];
    if (enabled && runCount === 0 && !lastRunAt) {
      warnings.push("This flow is active but has never run");
    }
    if (enabled && lastRunAt) {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      if (new Date(lastRunAt).getTime() < thirtyDaysAgo) {
        warnings.push("Has not run in over 30 days");
      }
    }
    return warnings;
  }

  const filterButtons: { key: FilterStatus; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "paused", label: "Paused" },
    { key: "needs-attention", label: "Needs Attention" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search flows..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border/60 bg-input pl-9 pr-3 py-2.5 text-sm placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
        <button
          onClick={() => { setEditingPlaybook(null); setShowEditor(true); }}
          className="kf-btn-primary px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2 min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          New Flow
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {filterButtons.map((fb) => (
          <button
            key={fb.key}
            onClick={() => setStatusFilter(fb.key)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
            style={{
              background: statusFilter === fb.key ? "hsl(var(--kf-accent1) / 0.15)" : "transparent",
              color: statusFilter === fb.key ? "hsl(var(--kf-accent1))" : undefined,
            }}
          >
            {fb.label}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{activeCount} active / {unified.length} total</span>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))", border: "1px solid hsl(var(--kf-warning) / 0.3)" }}>
          {error}
        </div>
      )}

      <PlaybookEditor
        open={showEditor}
        onClose={handleEditorClose}
        onSaved={handlePlaybookSaved}
        template={templateToUse}
        editingPlaybook={editingPlaybook}
        businessId={businessId}
      />

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading flows...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
            <Workflow className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <p className="text-sm font-medium mb-1">
            {search.trim() || statusFilter !== "all" ? "No matching flows" : "No flows yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {search.trim() || statusFilter !== "all"
              ? "Try a different search or filter."
              : "Create a flow or use a template to start automating your business."}
          </p>
          {!search.trim() && statusFilter === "all" && (
            <p className="text-[11px] text-muted-foreground/60 mt-3 px-4">
              Tip: Start with a template like "Follow up on paid invoices" or "Remind no-shows" — they're one click to activate.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((item) => {
            if (item.kind === "playbook") {
              const pb = item.data;
              const actions = Array.isArray(pb.actions) ? (pb.actions as ActionStep[]) : [];
              const modules = getFlowModules(pb.triggerEvent, actions);
              const health = getHealthIndicator(pb.enabled, pb.lastRunAt, pb.runCount ?? 0);
              const warnings = getFlowWarnings(pb.enabled, pb.lastRunAt, pb.runCount ?? 0);
              const HealthIcon = health.icon;

              return (
                <div
                  key={`pb-${pb.id}`}
                  className="rounded-2xl border p-4 flex flex-col gap-2.5 text-sm transition-colors"
                  style={{
                    borderColor: pb.enabled ? "hsl(var(--kf-success) / 0.3)" : "hsl(var(--border) / 0.6)",
                    background: pb.enabled ? "hsl(var(--kf-success) / 0.03)" : "hsl(var(--muted) / 0.15)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold flex items-center gap-2 min-w-0">
                      <Zap className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                      <span className="truncate">{pb.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleEditPlaybook(pb)}
                        className="rounded-full p-1.5 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                        style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleTogglePlaybook(pb)}
                        className="rounded-full p-1.5 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                        style={{
                          background: pb.enabled ? "hsl(var(--kf-success) / 0.2)" : "hsl(var(--muted) / 0.5)",
                          color: pb.enabled ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {pb.enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-[11px]">
                    <div className="flex items-center gap-1">
                      <HealthIcon className="w-3 h-3" style={{ color: health.color }} />
                      <span style={{ color: health.color }}>{health.label}</span>
                    </div>
                    {(pb.runCount ?? 0) > 0 && (
                      <span className="text-muted-foreground/60 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> {pb.runCount} runs
                      </span>
                    )}
                    {pb.lastRunAt && (
                      <span className="text-muted-foreground/60">Last: {new Date(pb.lastRunAt).toLocaleDateString()}</span>
                    )}
                  </div>

                  <div className="rounded-lg p-2 space-y-1" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-accent1))" }} />
                      <span className="text-muted-foreground">Trigger:</span>
                      <span className="font-medium">{getTriggerLabel(pb.triggerEvent)}</span>
                    </div>
                    {getActionLabels(pb.actions).map((label, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-success))" }} />
                        <span className="text-muted-foreground">{i === 0 ? "Then:" : "→"}</span>
                        <span className="font-medium">{label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 flex-wrap">
                    {modules.map((mod) => (
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

                  {warnings.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md" style={{ background: "hsl(var(--kf-warning) / 0.08)", color: "hsl(var(--kf-warning))" }}>
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{warnings[0]}</span>
                    </div>
                  )}
                </div>
              );
            }

            const wf = item.data as CrossModuleWorkflow;
            const wfHealth = getHealthIndicator(wf.enabled, wf.lastRunAt, wf.runCount);
            const WfHealthIcon = wfHealth.icon;
            const wfWarnings = getFlowWarnings(wf.enabled, wf.lastRunAt, wf.runCount);

            return (
              <motion.div
                key={`wf-${wf.key}`}
                layout
                className="rounded-2xl border p-4 flex flex-col gap-2.5 text-sm transition-colors"
                style={{
                  borderColor: wf.enabled ? "hsl(var(--kf-success) / 0.3)" : "hsl(var(--border) / 0.6)",
                  background: wf.enabled ? "hsl(var(--kf-success) / 0.03)" : "hsl(var(--muted) / 0.15)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold flex items-center gap-2 min-w-0">
                    <Brain className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
                    <span className="truncate">{wf.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {wf.configSchema.length > 0 && (
                      <button
                        onClick={() => setExpandedWf(expandedWf === wf.key ? null : wf.key)}
                        className="rounded-full p-1.5 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                        style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                      >
                        <Settings2 className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleWorkflow(wf)}
                      disabled={updatingWf === wf.key}
                      className="rounded-full p-1.5 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                      style={{
                        background: wf.enabled ? "hsl(var(--kf-success) / 0.2)" : "hsl(var(--muted) / 0.5)",
                        color: wf.enabled ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground))",
                        opacity: updatingWf === wf.key ? 0.5 : 1,
                      }}
                    >
                      {wf.enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">{wf.description}</p>

                <div className="flex items-center gap-3 text-[11px]">
                  <div className="flex items-center gap-1">
                    <WfHealthIcon className="w-3 h-3" style={{ color: wfHealth.color }} />
                    <span style={{ color: wfHealth.color }}>{wfHealth.label}</span>
                  </div>
                  {wf.runCount > 0 && (
                    <span className="text-muted-foreground/60 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> {wf.runCount} runs
                    </span>
                  )}
                  {wf.lastRunAt && (
                    <span className="text-muted-foreground/60">Last: {new Date(wf.lastRunAt).toLocaleDateString()}</span>
                  )}
                </div>

                <div className="rounded-lg p-2 space-y-1" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-accent1))" }} />
                    <span className="text-muted-foreground">Trigger:</span>
                    <span className="font-medium">{getTriggerLabel(wf.triggerEvent)}</span>
                  </div>
                  {getWorkflowActionSummary(wf.key).map((label, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-success))" }} />
                      <span className="text-muted-foreground">{i === 0 ? "Then:" : "→"}</span>
                      <span className="font-medium">{label}</span>
                    </div>
                  ))}
                </div>

                {wfWarnings.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-md" style={{ background: "hsl(var(--kf-warning) / 0.08)", color: "hsl(var(--kf-warning))" }}>
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{wfWarnings[0]}</span>
                  </div>
                )}

                <AnimatePresence>
                  {expandedWf === wf.key && wf.configSchema.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border/40 pt-2 mt-1 space-y-2">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Configuration</div>
                        {wf.configSchema.map((field) => (
                          <div key={field.key} className="flex items-center gap-2">
                            <label className="text-xs text-muted-foreground flex-1">{field.label}</label>
                            {field.type === "boolean" ? (
                              <button
                                onClick={() =>
                                  handleConfigUpdate(wf, {
                                    ...wf.config,
                                    [field.key]: !(wf.config[field.key] ?? field.default),
                                  })
                                }
                                className="w-8 h-5 rounded-full transition-colors relative"
                                style={{
                                  background: (wf.config[field.key] ?? field.default)
                                    ? "hsl(var(--kf-success))"
                                    : "hsl(var(--muted))",
                                }}
                              >
                                <div
                                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                                    (wf.config[field.key] ?? field.default) ? "translate-x-3.5" : "translate-x-0.5"
                                  }`}
                                  style={{ background: "hsl(var(--foreground))" }}
                                />
                              </button>
                            ) : field.type === "number" ? (
                              <input
                                type="number"
                                className="w-20 rounded-lg border border-border/60 bg-input px-2 py-1 text-xs text-right"
                                value={String(wf.config[field.key] ?? field.default)}
                                onChange={(e) =>
                                  handleConfigUpdate(wf, {
                                    ...wf.config,
                                    [field.key]: parseInt(e.target.value, 10) || field.default,
                                  })
                                }
                              />
                            ) : (
                              <input
                                type="text"
                                className="w-32 rounded-lg border border-border/60 bg-input px-2 py-1 text-xs"
                                value={String(wf.config[field.key] ?? field.default)}
                                onChange={(e) =>
                                  handleConfigUpdate(wf, {
                                    ...wf.config,
                                    [field.key]: e.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
