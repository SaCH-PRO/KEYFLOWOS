"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList, Play, CheckCircle, XCircle, Clock, AlertCircle, ChevronRight } from "lucide-react";
import { listPlans, type AiPlan } from "@/lib/plans";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";
import Link from "next/link";

export default function PlansPage() {
  const { businessId } = useControlTowerData();
  const [plans, setPlans] = useState<AiPlan[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    loadData();
  }, [businessId]);

  async function loadData() {
    if (!businessId) return;
    setLoading(true);
    const res = await listPlans(businessId, undefined, 50);
    if (res.data) setPlans(res.data);
    setLoading(false);
  }

  function statusIcon(status: string) {
    switch (status) {
      case "completed": return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case "executing": return <Play className="w-4 h-4 text-amber-400" />;
      case "approved": return <Clock className="w-4 h-4 text-blue-400" />;
      case "draft": return <ClipboardList className="w-4 h-4 text-muted-foreground" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-400" />;
      case "partial": return <AlertCircle className="w-4 h-4 text-orange-400" />;
      default: return <ClipboardList className="w-4 h-4 text-muted-foreground" />;
    }
  }

  function progressText(plan: AiPlan) {
    const total = plan.steps.length;
    const done = plan.steps.filter(s => s.status === "completed").length;
    const failed = plan.steps.filter(s => s.status === "failed" || s.status === "skipped").length;
    if (plan.status === "completed") return `${done}/${total} done`;
    if (plan.status === "failed") return `${failed}/${total} failed`;
    if (plan.status === "partial") return `${done} done · ${failed} failed`;
    return `${done}/${total} steps`;
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">AI Plans</h1>
          <p className="text-sm text-muted-foreground">Track KEY's multi-step operations</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : plans.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No plans yet. Ask KEY to do something complex!</div>
        ) : (
          <div className="divide-y divide-border">
            {plans.map(plan => (
              <Link key={plan.id} href={`/app/plans/${plan.id}`}>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    {statusIcon(plan.status)}
                    <div>
                      <div className="text-sm font-medium">{plan.objective}</div>
                      <div className="text-xs text-muted-foreground">
                        {progressText(plan)} · {plan.urgency} priority · {new Date(plan.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </motion.div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
