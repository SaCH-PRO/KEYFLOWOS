"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, UserPlus, Calendar, Users, Layers, ChevronRight, Loader2 } from "lucide-react";
import { listWorkflows, instantiateWorkflow, type WorkflowTemplate } from "@/lib/workflows";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";
import Link from "next/link";

const CATEGORY_ICONS: Record<string, typeof UserPlus> = {
  crm: Users,
  finance: Calendar,
  multi: Layers,
};

export default function WorkflowsPage() {
  const { businessId } = useControlTowerData();
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [instantiating, setInstantiating] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    loadData();
  }, [businessId]);

  async function loadData() {
    if (!businessId) return;
    setLoading(true);
    const res = await listWorkflows(businessId);
    if (res.data) setWorkflows(res.data);
    setLoading(false);
  }

  async function handleInstantiate(key: string) {
    if (!businessId) return;
    setInstantiating(key);
    const res = await instantiateWorkflow(businessId, key);
    setInstantiating(null);
    if (res.data) {
      // Redirect to the plan page
      window.location.href = `/app/plans/${res.data.planId}`;
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Workflows</h1>
          <p className="text-sm text-muted-foreground">Pre-built multi-step operations KEY can run for you</p>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workflows.map((wf, idx) => {
            const Icon = CATEGORY_ICONS[wf.category] || Layers;
            return (
              <motion.div
                key={wf.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="rounded-xl border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold">{wf.name}</h3>
                    <p className="text-xs text-muted-foreground">{wf.description}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">{wf.steps.length} steps · {wf.category}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {wf.steps.slice(0, 3).map((step) => (
                    <div key={step.order} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium">
                        {step.order}
                      </span>
                      <span className="truncate">{step.action}</span>
                    </div>
                  ))}
                  {wf.steps.length > 3 && (
                    <p className="text-[10px] text-muted-foreground/50 pl-6">+{wf.steps.length - 3} more steps</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleInstantiate(wf.key)}
                    disabled={instantiating === wf.key}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(24_95%_53%)] text-white text-xs font-medium hover:brightness-110 transition-all disabled:opacity-50"
                  >
                    {instantiating === wf.key ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Run workflow
                  </button>
                  <Link
                    href={`/app/plans`}
                    className="px-3 py-1.5 rounded-lg bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View plans
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
