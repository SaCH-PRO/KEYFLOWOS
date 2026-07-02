"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Target,
  Plus,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Play,
  Lightbulb,
  FolderKanban,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";

interface PlanStep {
  id: string;
  action: string;
  module: string | null;
  status: string;
}

interface Plan {
  id: string;
  objective: string;
  status: string;
  steps: PlanStep[];
  createdAt: string;
}

interface AiGoal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  targetDate: string | null;
  plans?: Plan[];
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  COMPLETED: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  ARCHIVED: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  draft: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  running: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  failed: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  waiting_approval: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};

export default function GoalsPage() {
  const businessId = getStoredBusinessId();
  const [goals, setGoals] = useState<AiGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [executingPlanId, setExecutingPlanId] = useState<string | null>(null);
  const [generatingGoalId, setGeneratingGoalId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "" });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<AiGoal[]>(`/api/v1/cortex/goals?businessId=${businessId}`);
      setGoals(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error("Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const createGoal = async () => {
    if (!businessId || !form.title) return;
    try {
      const res = await apiPostSimple(`/api/v1/cortex/goals`, {
        businessId,
        title: form.title,
        description: form.description,
        priority: 1,
      });
      if (!res.error) {
        toast.success("Goal created");
        setShowCreate(false);
        setForm({ title: "", description: "" });
        load();
      } else {
        toast.error("Failed to create goal");
      }
    } catch {
      toast.error("Failed to create goal");
    }
  };

  const deleteGoal = async (goalId: string) => {
    if (!businessId) return;
    try {
      const res = await apiDelete(`/api/v1/cortex/goals/${goalId}?businessId=${businessId}`);
      if (!res.error) {
        toast.success("Goal deleted");
        load();
      } else {
        toast.error("Failed to delete goal");
      }
    } catch {
      toast.error("Failed to delete goal");
    }
  };

  const generatePlan = async (goalId: string) => {
    if (!businessId) return;
    setGeneratingGoalId(goalId);
    try {
      const res = await apiPostSimple(`/api/v1/cortex/goals/${goalId}/plans`, {});
      if (!res.error) {
        toast.success("Plan generated");
        loadGoalDetails(goalId);
      } else {
        toast.error("Failed to generate plan");
      }
    } catch {
      toast.error("Failed to generate plan");
    } finally {
      setGeneratingGoalId(null);
    }
  };

  const executePlan = async (planId: string, goalId: string) => {
    if (!businessId) return;
    setExecutingPlanId(planId);
    try {
      const res = await apiPostSimple(`/api/v1/cortex/plans/${planId}/execute`, {});
      if (!res.error) {
        toast.success("Plan execution started");
        loadGoalDetails(goalId);
      } else {
        toast.error("Failed to execute plan");
      }
    } catch {
      toast.error("Failed to execute plan");
    } finally {
      setExecutingPlanId(null);
    }
  };

  const loadGoalDetails = async (goalId: string) => {
    if (!businessId) return;
    try {
      const res = await apiGet<AiGoal>(`/api/v1/cortex/goals/${goalId}?businessId=${businessId}`);
      if (res.data) {
        setGoals((prev) => prev.map((g) => (g.id === goalId ? res.data! : g)));
      }
    } catch {
      toast.error("Failed to load goal details");
    }
  };

  const toggleExpand = (goalId: string) => {
    const next = expandedGoalId === goalId ? null : goalId;
    setExpandedGoalId(next);
    if (next) {
      loadGoalDetails(goalId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground/90">Goals</h1>
            <p className="text-xs text-muted-foreground/60">Set outcomes and let KEY build plans to reach them</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New Goal
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="p-4 rounded-xl border border-border/20 bg-card/50 space-y-3">
          <h3 className="text-sm font-semibold text-foreground/80">Create New Goal</h3>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Goal title (e.g., $15K revenue this month)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
            />
            <textarea
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={createGoal}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
            >
              Create Goal
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Goals List */}
      <div className="space-y-3">
        {goals.length === 0 ? (
          <div className="text-center py-20">
            <Target className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground/70">No goals yet</h2>
            <p className="text-sm text-muted-foreground/50 mt-1">Set a goal and KEY will generate a plan to achieve it.</p>
          </div>
        ) : (
          goals.map((goal) => (
            <div
              key={goal.id}
              className="p-4 rounded-xl border border-border/20 bg-card/50 hover:border-border/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${
                        STATUS_COLORS[goal.status] ?? STATUS_COLORS.ACTIVE
                      }`}
                    >
                      {goal.status}
                    </span>
                    {goal.priority > 0 && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/30 text-muted-foreground/50">
                        Priority {goal.priority}
                      </span>
                    )}
                    {goal.targetDate && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/30 text-muted-foreground/50">
                        Due {new Date(goal.targetDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-foreground/80">{goal.title}</h3>
                  {goal.description && <p className="text-xs text-muted-foreground/50 mt-0.5">{goal.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => generatePlan(goal.id)}
                    disabled={generatingGoalId === goal.id}
                    className="p-2 rounded-lg text-muted-foreground/40 hover:text-[hsl(var(--kf-accent1))] hover:bg-muted/30 transition-colors disabled:opacity-50"
                    title="Generate KEY plan"
                  >
                    {generatingGoalId === goal.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Lightbulb className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => toggleExpand(goal.id)}
                    className="p-2 rounded-lg text-muted-foreground/40 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
                    title={expandedGoalId === goal.id ? "Hide plans" : "Show plans"}
                  >
                    {expandedGoalId === goal.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => deleteGoal(goal.id)}
                    className="p-2 rounded-lg text-muted-foreground/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete goal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded Plans */}
              {expandedGoalId === goal.id && (
                <div className="mt-4 pt-4 border-t border-border/10">
                  <h4 className="text-xs font-semibold text-foreground/70 mb-3 flex items-center gap-1.5">
                    <FolderKanban className="w-3.5 h-3.5" />
                    Generated Plans
                  </h4>
                  {!goal.plans || goal.plans.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50">No plans yet. Generate one to get started.</p>
                  ) : (
                    <div className="space-y-2">
                      {goal.plans.map((plan) => (
                        <div
                          key={plan.id}
                          className="p-3 rounded-lg bg-muted/20 border border-border/10"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground/80 truncate">{plan.objective}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                    STATUS_COLORS[plan.status] ?? STATUS_COLORS.pending
                                  }`}
                                >
                                  {plan.status}
                                </span>
                                <span className="text-[10px] text-muted-foreground/50">
                                  {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}
                                </span>
                              </div>
                              {plan.steps.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                  {plan.steps.slice(0, 4).map((step) => (
                                    <li key={step.id} className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                          step.status === "completed"
                                            ? "bg-emerald-400"
                                            : step.status === "failed"
                                            ? "bg-rose-400"
                                            : "bg-amber-400"
                                        }`}
                                      />
                                      {step.module ? `${step.module}.` : ""}
                                      {step.action}
                                    </li>
                                  ))}
                                  {plan.steps.length > 4 && (
                                    <li className="text-[10px] text-muted-foreground/40 pl-3">
                                      +{plan.steps.length - 4} more
                                    </li>
                                  )}
                                </ul>
                              )}
                            </div>
                            <button
                              onClick={() => executePlan(plan.id, goal.id)}
                              disabled={executingPlanId === plan.id || ["running", "completed"].includes(plan.status)}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                              {executingPlanId === plan.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Play className="w-3 h-3" />
                              )}
                              {plan.status === "running" ? "Running" : plan.status === "completed" ? "Done" : "Run"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
