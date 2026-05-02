"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Power,
  PowerOff,
  Brain,
  Settings2,
  Clock,
  Plus,
  Search,
  Pencil,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Workflow,
  Sparkles,
} from "lucide-react";
import {
  Playbook,
  updatePlaybook,
  CrossModuleWorkflow,
  updateCrossModuleWorkflow,
} from "@/lib/client";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import {
  getTriggerLabel,
  getActionLabels,
  getWorkflowActionSummary,
  getFlowModules,
  getTriggerModule,
  MODULE_COLORS,
} from "./automation-constants";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { PlaybookEditor } from "./playbook-editor";
import { AiFlowGenerator } from "./ai-flow-generator";
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
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [aiGeneratedConfig, setAiGeneratedConfig] = useState<{ name: string; triggerEvent: string; actions: ActionStep[]; conditions: string[] } | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);

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
    if (activeTaskIdRef.current) {
      markTaskCompleted(activeTaskIdRef.current);
      activeTaskIdRef.current = null;
    }
    setShowEditor(false);
    setEditingPlaybook(null);
    onTemplateClear();
  }

  function handleEditPlaybook(pb: Playbook) {
    const taskId = registerInterruptedTask({
      id: `automations-flow-${pb.id}`,
      module: "automations",
      label: pb.name || "Unnamed flow",
      description: "Resume editing this automation flow",
      route: "/app/automations",
      draftId: pb.id,
      originRoute: "/app/automations",
      originLabel: "Automations",
      taskIntent: "edit-flow",
      formData: null,
    });
    activeTaskIdRef.current = taskId;
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
    if (!enabled) return { label: "Paused", color: "hsl(var(--muted-foreground))", icon: PowerOff, score: 0, detail: "Flow is paused — enable to start processing" };
    if (runCount === 0 && !lastRunAt) return { label: "Never run", color: "hsl(var(--kf-warning))", icon: AlertTriangle, score: 15, detail: "Active but never triggered — verify trigger configuration" };
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    let score = 40;
    if (lastRunAt && new Date(lastRunAt).getTime() > weekAgo) score += 40;
    else if (lastRunAt && new Date(lastRunAt).getTime() > thirtyDaysAgo) score += 20;
    if (runCount >= 10) score += 20;
    else if (runCount >= 3) score += 10;
    score = Math.min(score, 100);

    if (score >= 80) return { label: "Healthy", color: "hsl(var(--kf-success))", icon: CheckCircle, score, detail: `${runCount} total runs — actively processing` };
    if (score >= 50) return { label: "Idle", color: "hsl(var(--muted-foreground))", icon: Clock, score, detail: `${runCount} runs — last active ${lastRunAt ? new Date(lastRunAt).toLocaleDateString() : "unknown"}` };
    return { label: "Stale", color: "hsl(var(--kf-warning))", icon: AlertTriangle, score, detail: `Only ${runCount} runs — may need review` };
  }

  function getFlowWarnings(enabled: boolean, lastRunAt: string | null | undefined, runCount: number): string[] {
    const warnings: string[] = [];
    if (enabled && runCount === 0 && !lastRunAt) {
      warnings.push("This flow is active but has never run — check the trigger configuration");
    }
    if (enabled && lastRunAt) {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      if (new Date(lastRunAt).getTime() < thirtyDaysAgo) {
        warnings.push("Has not run in over 30 days — ensure the trigger event is still occurring");
      }
    }
    if (enabled && runCount > 0 && runCount < 3) {
      warnings.push("Low activity — consider reviewing whether this flow is relevant");
    }
    return warnings;
  }

  function getHealthScoreBar(score: number) {
    const color = score >= 80 ? "hsl(var(--kf-success))" : score >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)", maxWidth: "40px" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
        </div>
        <span className="text-[9px] font-medium" style={{ color }}>{score}</span>
      </div>
    );
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAiGenerator(!showAiGenerator)}
            className="px-3 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2 min-h-[44px] transition-colors"
            style={{
              background: showAiGenerator ? "hsl(var(--kf-accent2) / 0.15)" : "hsl(var(--muted) / 0.5)",
              color: showAiGenerator ? "hsl(var(--kf-accent2))" : "hsl(var(--muted-foreground))",
            }}
          >
            <Sparkles className="w-4 h-4" />
            AI Generate
          </button>
          <button
            onClick={() => { setEditingPlaybook(null); setShowEditor(true); }}
            className="kf-btn-primary px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            New Flow
          </button>
        </div>
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

      <AnimatePresence>
        {showAiGenerator && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <AiFlowGenerator
              businessId={businessId}
              onGenerated={(config) => {
                setAiGeneratedConfig(config);
                setEditingPlaybook(null);
                setShowEditor(true);
                setShowAiGenerator(false);
              }}
              onClose={() => setShowAiGenerator(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))", border: "1px solid hsl(var(--kf-warning) / 0.3)" }}>
          {error}
        </div>
      )}

      <PlaybookEditor
        open={showEditor}
        onClose={() => { handleEditorClose(); setAiGeneratedConfig(null); }}
        onSaved={(pb) => { handlePlaybookSaved(pb); setAiGeneratedConfig(null); }}
        template={aiGeneratedConfig ? {
          id: "ai-generated",
          name: aiGeneratedConfig.name,
          description: "",
          category: "AI Generated",
          trigger: aiGeneratedConfig.triggerEvent,
          actions: aiGeneratedConfig.actions,
          businessProblem: "",
          modulesTouched: [],
          prerequisites: [],
          expectedOutcome: "",
          complexity: "easy" as const,
        } : templateToUse}
        editingPlaybook={editingPlaybook}
        businessId={businessId}
      />

      {loading ? (
        <SkeletonList rows={4} cols={3} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={search.trim() || statusFilter !== "all" ? "No matching flows" : "No flows yet"}
          description={
            search.trim() || statusFilter !== "all"
              ? "Try a different search or filter."
              : "Create a flow or use a template to start automating your business."
          }
          actionLabel={!search.trim() && statusFilter === "all" ? "Create Flow" : undefined}
          actionIcon={Plus}
          onAction={!search.trim() && statusFilter === "all" ? () => setShowEditor(true) : undefined}
          tip={
            !search.trim() && statusFilter === "all"
              ? "Start with a template like \"Follow up on paid invoices\" or \"Remind no-shows\" — they're one click to activate."
              : undefined
          }
          variant="compact"
          iconColor="hsl(var(--kf-accent1))"
        />
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
                    <div className="flex items-center gap-1" title={health.detail}>
                      <HealthIcon className="w-3 h-3" style={{ color: health.color }} />
                      <span style={{ color: health.color }}>{health.label}</span>
                    </div>
                    {getHealthScoreBar(health.score)}
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
            const wfModules = [getTriggerModule(wf.triggerEvent)].filter((m) => m !== "General");

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
                  <div className="flex items-center gap-1" title={wfHealth.detail}>
                    <WfHealthIcon className="w-3 h-3" style={{ color: wfHealth.color }} />
                    <span style={{ color: wfHealth.color }}>{wfHealth.label}</span>
                  </div>
                  {getHealthScoreBar(wfHealth.score)}
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

                {wfModules.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {wfModules.map((mod) => (
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
                )}

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
