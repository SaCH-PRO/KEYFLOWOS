"use client";

import { useState, useEffect, useCallback } from "react";
import { Target, Plus, TrendingUp, Calendar, Loader2, Zap, Trash2, RefreshCw, FolderKanban, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";
import { fetchProjects } from "@/lib/client";

interface Goal {
  id: string;
  title: string;
  description: string | null;
  category: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  deadline: string | null;
  status: string;
  priority: number;
  role: string | null;
  autoActions: boolean;
  progress?: {
    current: number;
    target: number;
    percent: number;
    daysRemaining: number;
    dailyTarget: number;
    onTrack: boolean;
  };
}

interface LinkedProject {
  id: string;
  name: string;
  status: string;
  tasks: Array<{ isCompleted: boolean }>;
}

const ROLE_COLORS: Record<string, string> = {
  sales: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  support: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  operations: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  marketing: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  general: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const CATEGORY_LABELS: Record<string, string> = {
  revenue: "Revenue",
  leads: "Leads",
  retention: "Retention",
  efficiency: "Efficiency",
  custom: "Custom",
};

export default function GoalsPage() {
  const businessId = getStoredBusinessId();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<LinkedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // Auto-map category to role so users don't have to choose
  const categoryToRole = (cat: string): string => {
    switch (cat) {
      case "revenue": return "finance";
      case "leads": return "sales";
      case "retention": return "sales";
      case "efficiency": return "operations";
      default: return "general";
    }
  };

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "revenue",
    targetValue: "",
    unit: "dollars",
    deadline: "",
    role: "finance",
    autoActions: true,
  });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [goalsRes, projectsRes] = await Promise.all([
        apiGet<Goal[]>(`/ai/businesses/${businessId}/goals`),
        fetchProjects(businessId),
      ]);
      setGoals(Array.isArray(goalsRes.data) ? goalsRes.data : []);
      setProjects(Array.isArray(projectsRes.data) ? projectsRes.data : []);
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
      const res = await apiPostSimple(`/ai/businesses/${businessId}/goals`, {
        ...form,
        targetValue: form.targetValue ? parseFloat(form.targetValue) : undefined,
      });
      if (!res.error) {
        toast.success("Goal created");
        setShowCreate(false);
        setForm({ title: "", description: "", category: "revenue", targetValue: "", unit: "dollars", deadline: "", role: "finance", autoActions: true });
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
      const res = await apiDelete(`/ai/businesses/${businessId}/goals/${goalId}`);
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

  const updateProgress = async (goalId: string) => {
    if (!businessId) return;
    try {
      const res = await apiPostSimple(`/ai/businesses/${businessId}/goals/${goalId}/progress`, {});
      if (!res.error) {
        toast.success("Progress updated");
        load();
      } else {
        toast.error("Failed to update progress");
      }
    } catch {
      toast.error("Failed to update progress");
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
            <p className="text-xs text-muted-foreground/60">Track outcomes and let Key work toward them</p>
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
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Goal title (e.g., $15K revenue this month)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="col-span-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
            />
            <textarea
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="col-span-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
              rows={2}
            />
            <select
              value={form.category}
              onChange={(e) => {
                const cat = e.target.value;
                setForm({ ...form, category: cat, role: categoryToRole(cat) });
              }}
              className="px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80"
            >
              <option value="revenue">Revenue</option>
              <option value="leads">Leads</option>
              <option value="retention">Retention</option>
              <option value="efficiency">Efficiency</option>
              <option value="custom">Custom</option>
            </select>
            <input
              type="number"
              placeholder="Target value"
              value={form.targetValue}
              onChange={(e) => setForm({ ...form, targetValue: e.target.value })}
              className="px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
            />
            <input
              type="text"
              placeholder="Unit (dollars, count, percent)"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
            />
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              className="px-3 py-2 rounded-lg bg-muted/30 border border-border/20 text-sm text-foreground/80"
            />
            <div className="px-3 py-2 rounded-lg bg-muted/20 border border-border/20 text-sm text-muted-foreground/60 flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${ROLE_COLORS[form.role] ?? ROLE_COLORS.general}`}>
                {form.role}
              </span>
              <span className="text-xs">Auto-assigned from category</span>
            </div>
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
            <p className="text-sm text-muted-foreground/50 mt-1">Set a goal and Key will track progress and suggest daily actions.</p>
          </div>
        ) : (
          goals.map((goal) => (
            <div
              key={goal.id}
              className="p-4 rounded-xl border border-border/20 bg-card/50 hover:border-border/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${ROLE_COLORS[goal.role ?? "general"] ?? ROLE_COLORS.general}`}
                    >
                      {goal.role ?? "general"}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/30 text-muted-foreground/50">
                      {CATEGORY_LABELS[goal.category] ?? goal.category}
                    </span>
                    {goal.status === "achieved" && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Achieved
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-foreground/80">{goal.title}</h3>
                  {goal.description && <p className="text-xs text-muted-foreground/50 mt-0.5">{goal.description}</p>}

                  {/* Linked Projects */}
                  {(() => {
                    const linked = projects.filter((p) => (p as any).goalId === goal.id);
                    if (linked.length === 0) return null;
                    const totalTasks = linked.reduce((sum, p) => sum + p.tasks.length, 0);
                    const completedTasks = linked.reduce((sum, p) => sum + p.tasks.filter((t) => t.isCompleted).length, 0);
                    const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                    return (
                      <div className="mt-2 flex items-center gap-2">
                        <FolderKanban className="w-3 h-3 text-muted-foreground/40" />
                        <span className="text-[10px] text-muted-foreground/50">
                          {linked.length} project{linked.length > 1 ? "s" : ""} · {completedTasks}/{totalTasks} tasks
                        </span>
                        <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-400/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Create Project from Goal */}
                  <div className="mt-2">
                    <button
                      onClick={() => window.location.href = `/app/projects?tab=plans`}
                      className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> Create project plan from this goal
                    </button>
                  </div>

                  {/* Progress Bar */}
                  {goal.progress && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground/50">
                          {goal.progress.current.toLocaleString()} / {goal.progress.target.toLocaleString()} {goal.unit}
                        </span>
                        <span className={goal.progress.onTrack ? "text-emerald-400" : "text-amber-400"}>
                          {goal.progress.percent}% — {goal.progress.onTrack ? "On Track" : "Behind"}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${goal.progress.percent}%`,
                            background: goal.progress.onTrack
                              ? "linear-gradient(90deg, hsl(var(--kf-accent2)), hsl(var(--kf-accent1)))"
                              : "linear-gradient(90deg, #f59e0b, #ef4444)",
                          }}
                        />
                      </div>
                      {goal.progress.daysRemaining > 0 && (
                        <p className="text-[10px] text-muted-foreground/40 mt-1">
                          {goal.progress.daysRemaining} days left · Need {goal.progress.dailyTarget.toLocaleString()} {goal.unit}/day
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateProgress(goal.id)}
                    className="p-2 rounded-lg text-muted-foreground/40 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
                    title="Update progress"
                  >
                    <RefreshCw className="w-4 h-4" />
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
