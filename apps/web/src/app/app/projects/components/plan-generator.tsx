"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Lightbulb, Sparkles, Loader2, Target, DollarSign, Calendar, ArrowRight, CheckCircle2, Trash2, FileText } from "lucide-react";
import { Button, Badge, Card, Input } from "@keyflow/ui";
import { useProjectPlans } from "../hooks/use-project-plans";
import type { ProjectPlan } from "@/lib/project-plans-api";
import { getCachedBusiness } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";

interface PlanGeneratorProps {
  businessId: string;
  goals: Array<{ id: string; title: string; category: string }>;
  onPlanCreated?: (plan: ProjectPlan) => void;
  /** A plan was approved and materialized into a project: the page reloads its projects. */
  onPlanApproved?: () => void;
}

/**
 * PR196-PROJECTS-SERVER holds the plan rules (D-85): approve is a compare-and-set from any status
 * but approved/materialized while the plan has no project (409 after); delete is for a draft with
 * no project (409 otherwise). The list offers each action only where those rules allow it.
 */
const canApprove = (plan: ProjectPlan) => !plan.projectId && plan.status !== "approved" && plan.status !== "materialized";
const canDelete = (plan: ProjectPlan) => !plan.projectId && plan.status === "draft";

const planDetailHref = (planId: string) => `/app/projects/plans/${encodeURIComponent(planId)}`;

export function PlanGenerator({ businessId, goals, onPlanCreated, onPlanApproved }: PlanGeneratorProps) {
  const [userIdea, setUserIdea] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [estimatedBudget, setEstimatedBudget] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const { plans, createPlan, loadPlans, removePlan, approve, loading } = useProjectPlans(businessId);
  const [result, setResult] = useState<ProjectPlan | null>(null);
  /** The plan an approve or a delete is in flight for (one at a time; WPD-12). */
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** The server's answer to the last refused action, per plan. */
  const [notices, setNotices] = useState<Record<string, string>>({});
  /**
   * D-85: approving or deleting a plan needs the owner, an admin or projects:write. The screen
   * cannot read the member's authority, so it learns it from the server's 403 and then withdraws
   * both actions rather than offering what will be refused.
   */
  const [governDenied, setGovernDenied] = useState(false);
  const currency = getCachedBusiness()?.currency ?? "TTD";

  const notice = (planId: string, message: string | null) =>
    setNotices((prev) => {
      const next = { ...prev };
      if (message) next[planId] = message;
      else delete next[planId];
      return next;
    });

  /** A refused approve or delete: 403 withdraws the actions, 409 reloads the list to the server's state. */
  const refused = (planId: string, res: { error: string | null; status?: number }) => {
    notice(planId, res.error ?? "The request was refused");
    if (res.status === 403) setGovernDenied(true);
    if (res.status === 409) void loadPlans();
  };

  const handleApprove = async (planId: string) => {
    // WPD-12: one approve in flight; a second click before the button disables sends nothing.
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingPlanId(planId);
    notice(planId, null);
    try {
      const res = await approve(planId);
      if ("data" in res && res.data) {
        onPlanApproved?.();
        return;
      }
      refused(planId, { error: res.error ?? null, status: "status" in res ? res.status : undefined });
    } finally {
      inFlight.current = false;
      setPendingPlanId(null);
    }
  };

  const handleDelete = async (planId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingPlanId(planId);
    setConfirmDeleteId(null);
    notice(planId, null);
    try {
      const res = await removePlan(planId);
      if (res && res.error) refused(planId, res);
    } finally {
      inFlight.current = false;
      setPendingPlanId(null);
    }
  };

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
              {result.estimatedTotalHours ? (
                <Badge tone="default"><Calendar className="w-3 h-3 mr-1" />{result.estimatedTotalHours}h</Badge>
              ) : null}
              {result.estimatedBudget ? (
                <Badge tone="default"><DollarSign className="w-3 h-3 mr-1" />{formatCurrency(result.estimatedBudget, currency)}</Badge>
              ) : null}
              {result.estimatedPeople ? (
                <Badge tone="default">{result.estimatedPeople} people</Badge>
              ) : null}
              {result.estimatedDurationDays ? (
                <Badge tone="default">{result.estimatedDurationDays} days</Badge>
              ) : null}
            </div>
            <Link
              href={planDetailHref(result.id)}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Review Plan <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
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

      {/* PR196-PROJECTS-WEB (F10b): the business's saved plans, with the actions the server allows. */}
      {plans.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h4 className="text-sm font-semibold">Saved Project Plans ({plans.length})</h4>
          </div>
          <div className="space-y-2.5">
            {plans.map((plan) => {
              const busy = pendingPlanId === plan.id;
              return (
                <div key={plan.id} data-plan-id={plan.id}>
                  <Card variant="outlined" className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{plan.userIdea}</span>
                          <Badge tone={plan.status === "materialized" ? "success" : "default"}>{plan.status}</Badge>
                        </div>
                        {plan.strategySummary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{plan.strategySummary}</p>
                        )}
                        {/* WPD-15/16: no event count (the list carries at most 3 events per plan); no stray 0. */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                          {plan.estimatedDurationDays ? <span>{plan.estimatedDurationDays} days</span> : null}
                          {plan.estimatedBudget ? <span>{formatCurrency(plan.estimatedBudget, currency)}</span> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!governDenied && canApprove(plan) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pendingPlanId !== null}
                            onClick={() => void handleApprove(plan.id)}
                            title="Approve and create the project"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />}
                            Approve
                          </Button>
                        )}
                        <Link
                          href={planDetailHref(plan.id)}
                          className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium bg-muted hover:bg-muted/80"
                        >
                          Open <ArrowRight className="w-3.5 h-3.5 ml-1" />
                        </Link>
                        {!governDenied && canDelete(plan) && (confirmDeleteId === plan.id ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pendingPlanId !== null}
                              onClick={() => void handleDelete(plan.id)}
                              className="text-destructive"
                            >
                              Confirm delete
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pendingPlanId !== null}
                            onClick={() => setConfirmDeleteId(plan.id)}
                            aria-label="Delete plan"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
                          </Button>
                        ))}
                      </div>
                    </div>
                    {notices[plan.id] && (
                      <p role="alert" className="mt-2 text-xs text-destructive">{notices[plan.id]}</p>
                    )}
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
