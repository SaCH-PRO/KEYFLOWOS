"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  SkipForward,
  RotateCcw,
  ClipboardList,
} from "lucide-react";
import { getPlan, approvePlan, undoPlanStep, type AiPlan, type PlanStep } from "@/lib/plans";
import { useControlTowerData } from "../../control-tower/components/use-control-tower-data";
import Link from "next/link";

export default function PlanDetailPage() {
  const { businessId } = useControlTowerData();
  const params = useParams();
  const planId = params.planId as string;
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [undoingStepId, setUndoingStepId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !planId) return;
    loadPlan();
    const interval = setInterval(loadPlan, 3000); // Live refresh
    return () => clearInterval(interval);
  }, [businessId, planId]);

  async function loadPlan() {
    if (!businessId || !planId) return;
    setLoading(true);
    const res = await getPlan(businessId, planId);
    if (res.data) setPlan(res.data);
    setLoading(false);
  }

  async function handleApprove() {
    if (!businessId || !plan) return;
    const res = await approvePlan(businessId, plan.id);
    if (res.data) loadPlan();
  }

  async function handleUndoStep(step: PlanStep) {
    if (!businessId || !plan) return;
    setUndoingStepId(step.id);
    const res = await undoPlanStep(businessId, plan.id, step.id);
    if (res.data?.success) loadPlan();
    setUndoingStepId(null);
  }

  function stepIcon(step: PlanStep) {
    switch (step.status) {
      case "completed": return <CheckCircle className="w-5 h-5 text-emerald-400" />;
      case "executing": return <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />;
      case "pending": return <Clock className="w-5 h-5 text-muted-foreground" />;
      case "failed": return <XCircle className="w-5 h-5 text-red-400" />;
      case "skipped": return <SkipForward className="w-5 h-5 text-muted-foreground" />;
      case "awaiting_approval": return <AlertCircle className="w-5 h-5 text-orange-400" />;
      default: return <ClipboardList className="w-5 h-5 text-muted-foreground" />;
    }
  }

  if (!plan && loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">Plan not found</div>
    );
  }

  const completedCount = plan.steps.filter(s => s.status === "completed").length;
  const failedCount = plan.steps.filter(s => s.status === "failed" || s.status === "skipped").length;
  const progressPercent = plan.steps.length > 0 ? Math.round((completedCount / plan.steps.length) * 100) : 0;

  return (
    <div className="space-y-6 pb-12 max-w-3xl">
      <Link href="/app/plans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to plans
      </Link>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            plan.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
            plan.status === "executing" ? "bg-amber-500/10 text-amber-400" :
            plan.status === "failed" ? "bg-red-500/10 text-red-400" :
            plan.status === "approved" ? "bg-blue-500/10 text-blue-400" :
            "bg-muted text-muted-foreground"
          }`}>
            {plan.status}
          </span>
          <span className="text-xs text-muted-foreground">{plan.urgency} priority</span>
        </div>
        <h1 className="text-xl font-bold text-foreground">{plan.objective}</h1>
        <p className="text-sm text-muted-foreground">
          {completedCount} of {plan.steps.length} steps completed
          {failedCount > 0 && ` · ${failedCount} failed`}
        </p>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full bg-[hsl(24_95%_53%)]"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {plan.status === "draft" && (
        <button
          onClick={handleApprove}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 text-sm font-medium transition-all"
        >
          <Play className="w-4 h-4" />
          Approve & Execute
        </button>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="divide-y divide-border">
          {plan.steps.map((step, idx) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{stepIcon(step)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{step.action}</div>
                    <div className="flex items-center gap-2">
                      {step.riskTier >= 3 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                          T{step.riskTier}
                        </span>
                      )}
                      {step.status === "completed" && (
                        <button
                          onClick={() => handleUndoStep(step)}
                          disabled={undoingStepId === step.id}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Undo this step"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {step.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{step.description}</div>
                  )}
                  {step.errorMessage && (
                    <div className="text-xs text-red-400 mt-1">{step.errorMessage}</div>
                  )}
                  {step.outputResult && (
                    <div className="mt-1.5 p-2 rounded-lg bg-muted/50 text-xs font-mono text-muted-foreground overflow-auto max-h-24">
                      {JSON.stringify(step.outputResult, null, 2)}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
