"use client";

import { useState } from "react";
import { Lightbulb, Sparkles, Loader2, Target, DollarSign, Calendar, ArrowRight, CheckCircle2, Trash2, FileText } from "lucide-react";
import { Button, Badge, Card, Input } from "@keyflow/ui";
import { useProjectPlans } from "../hooks/use-project-plans";
import type { ProjectPlan } from "@/lib/project-plans-api";

interface PlanGeneratorProps {
  businessId: string;
  goals: Array<{ id: string; title: string; category: string }>;
  onPlanCreated?: (plan: ProjectPlan) => void;
}

export function PlanGenerator({ businessId, goals, onPlanCreated }: PlanGeneratorProps) {
  const [userIdea, setUserIdea] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [estimatedBudget, setEstimatedBudget] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const { plans, createPlan, removePlan, approve, loading } = useProjectPlans(businessId);
  const [result, setResult] = useState<ProjectPlan | null>(null);

  const handleSubmit = async () => {
    if (!userIdea.trim()) return;
    const res = await createPlan({
      userIdea,
      goalId: selectedGoalId || undefined,
      options: {
        estimatedBudget: estimatedBudget ? parseFloat(estimatedBudget) : undefined,
        estimatedDurationDays: estimatedDuration ? parseInt(estimatedDuration) : undefined,
      },
    });
    if ('data' in res && res.data) {
      setResult(res.data);
      onPlanCreated?.(res.data);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        <Card variant="outlined" className="border-green-500/30">
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-green-400" />
              <h3 className="text-base font-semibold">Plan Generated</h3>
            </div>
            <p className="text-sm text-muted-foreground">{result.strategySummary}</p>
            <div className="flex flex-wrap gap-2">
              {result.estimatedTotalHours && (
                <Badge tone="default"><Calendar className="w-3 h-3 mr-1" />{result.estimatedTotalHours}h</Badge>
              )}
              {result.estimatedBudget && (
                <Badge tone="default"><DollarSign className="w-3 h-3 mr-1" />{result.estimatedBudget}</Badge>
              )}
              {result.estimatedPeople && (
                <Badge tone="default">{result.estimatedPeople} people</Badge>
              )}
              {result.estimatedDurationDays && (
                <Badge tone="default">{result.estimatedDurationDays} days</Badge>
              )}
            </div>
            <Button size="sm" onClick={() => window.location.href = `/app/projects/plans/${result.id}`}>
              Review Plan <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </Card>
        <Button variant="ghost" size="sm" onClick={() => { setResult(null); setUserIdea(""); }}>
          Generate Another Plan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-semibold">Describe Your Idea to Key</h3>
          </div>
          <textarea
            placeholder="e.g., I want to launch a new service package for high-value clients including a discovery call, custom proposal, and 3-month retainer..."
            value={userIdea}
            onChange={(e) => setUserIdea(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="w-3 h-3" /> Link to Goal (optional)
              </label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={selectedGoalId}
                onChange={(e) => setSelectedGoalId(e.target.value)}
              >
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Budget Limit (optional)
              </label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                value={estimatedBudget}
                onChange={(e) => setEstimatedBudget(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Target Duration in Days (optional)
              </label>
              <Input
                type="number"
                placeholder="e.g. 30"
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={loading || !userIdea.trim()} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {loading ? "Key is thinking..." : "Generate Plan with Key"}
          </Button>
        </div>
      </Card>

      {plans.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h4 className="text-sm font-semibold">Saved Project Plans ({plans.length})</h4>
          </div>
          <div className="space-y-2.5">
            {plans.map((plan) => (
              <Card key={plan.id} variant="outlined" className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{plan.userIdea}</span>
                      <Badge tone={plan.status === "materialized" ? "success" : "default"}>
                        {plan.status}
                      </Badge>
                    </div>
                    {plan.strategySummary && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{plan.strategySummary}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                      {plan.estimatedDurationDays && <span>{plan.estimatedDurationDays} days</span>}
                      {plan.estimatedBudget && <span>• ${plan.estimatedBudget}</span>}
                      {plan.timelineEvents?.length > 0 && <span>• {plan.timelineEvents.length} events</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {plan.status !== "materialized" && plan.status !== "rejected" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void approve(plan.id)}
                        title="Approve & Materialize into Project"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                        Approve
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => window.location.href = `/app/projects/plans/${plan.id}`}
                    >
                      Open <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void removePlan(plan.id)}
                      title="Delete plan"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
