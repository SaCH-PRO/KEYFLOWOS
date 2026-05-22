"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, Clock, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

interface BudgetData {
  budgetAmount: number;
  budgetHours: number;
  totalCost: number;
  timeCost: number;
  expenseCost: number;
  trackedHours: number;
  remainingBudget: number;
  percentUsed: number;
  percentHoursUsed: number;
  status: string;
}

export function ProjectBudgetView({ businessId, projectId }: { businessId: string; projectId: string }) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/businesses/${businessId}/projects/${projectId}/budget`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [businessId, projectId]);

  if (loading) return <div className="p-8 text-center text-sm text-muted-foreground">Loading budget...</div>;
  if (!data || data.budgetAmount === 0) return (
    <div className="p-8 text-center">
      <p className="text-sm text-muted-foreground">No budget set for this project.</p>
      <p className="text-xs text-muted-foreground mt-1">Set a budget in project settings to track profitability.</p>
    </div>
  );

  const statusColor = data.status === "HEALTHY" ? "text-emerald-400" : data.status === "WARNING" ? "text-amber-400" : data.status === "AT_RISK" ? "text-orange-400" : "text-red-400";
  const statusBg = data.status === "HEALTHY" ? "bg-emerald-500/10" : data.status === "WARNING" ? "bg-amber-500/10" : data.status === "AT_RISK" ? "bg-orange-500/10" : "bg-red-500/10";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBg} ${statusColor}`}>
          {data.status.replace("_", " ")}
        </span>
        {data.status !== "HEALTHY" && <AlertTriangle className={`w-4 h-4 ${statusColor}`} />}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BudgetCard icon={<DollarSign className="w-4 h-4 text-emerald-400" />} label="Budget" value={`$${data.budgetAmount.toFixed(0)}`} />
        <BudgetCard icon={<TrendingDown className="w-4 h-4 text-red-400" />} label="Spent" value={`$${data.totalCost.toFixed(0)}`} />
        <BudgetCard icon={<TrendingUp className="w-4 h-4 text-blue-400" />} label="Remaining" value={`$${data.remainingBudget.toFixed(0)}`} />
        <BudgetCard icon={<Clock className="w-4 h-4 text-violet-400" />} label="Hours" value={`${data.trackedHours.toFixed(1)}/${data.budgetHours.toFixed(0)}`} />
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>Budget Used</span>
            <span>{data.percentUsed}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(data.percentUsed, 100)}%` }}
              className={`h-full rounded-full ${data.percentUsed > 100 ? "bg-red-500" : data.percentUsed > 90 ? "bg-orange-500" : data.percentUsed > 75 ? "bg-amber-500" : "bg-emerald-500"}`}
            />
          </div>
        </div>
        {data.budgetHours > 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>Hours Used</span>
              <span>{data.percentHoursUsed}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(data.percentHoursUsed, 100)}%` }}
                className={`h-full rounded-full ${data.percentHoursUsed > 100 ? "bg-red-500" : data.percentHoursUsed > 90 ? "bg-orange-500" : data.percentHoursUsed > 75 ? "bg-amber-500" : "bg-emerald-500"}`}
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Time Cost</div>
          <div className="text-lg font-bold">${data.timeCost.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Expense Cost</div>
          <div className="text-lg font-bold">${data.expenseCost.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

function BudgetCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
