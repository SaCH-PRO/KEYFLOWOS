"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, Clock, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { getProjectBudget, type ProjectBudget } from "@/lib/api/projects";
import { getCachedBusiness } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";

/**
 * PR196-PROJECTS-WEB (WPD-03, WPD-04): the budget is read through the API client
 * (lib/api: the API base and the member's token). It used to fetch a web-relative
 * /api/projects/... URL the web app has no route for, so every project read
 * "No budget set". Amounts are in the business currency (D-13), not a hard-coded
 * '$'; a failed read is an error, distinct from a project with no budget.
 */
type BudgetState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; data: ProjectBudget };

/**
 * Review SEC-W196-2: a member refused the budget's costs sees that, not a number. The Revenue tab
 * also shows this when the project's expense list refuses the member (the budget route returns the
 * expense and spend totals that list guards).
 */
export function BudgetAccessDenied() {
  return (
    <div role="alert" className="p-8 text-center">
      <p className="text-sm text-muted-foreground">You don&apos;t have access to this project&apos;s budget and costs.</p>
    </div>
  );
}

export function ProjectBudgetView({ businessId, projectId, currency }: { businessId: string; projectId: string; currency?: string }) {
  const [state, setState] = useState<BudgetState>({ kind: "loading" });
  const money = (amount: number) => formatCurrency(amount, currency ?? getCachedBusiness()?.currency ?? "TTD");

  useEffect(() => {
    let cancelled = false;
    void getProjectBudget(businessId, projectId).then((res) => {
      if (cancelled) return;
      if (res.data) setState({ kind: "loaded", data: res.data });
      else if (res.status === 403) setState({ kind: "denied" });
      else setState({ kind: "error", message: res.error ?? "Request failed" });
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, projectId]);

  if (state.kind === "loading") return <div className="p-8 text-center text-sm text-muted-foreground">Loading budget...</div>;
  if (state.kind === "denied") return <BudgetAccessDenied />;
  if (state.kind === "error") {
    return (
      <div role="alert" className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Could not load this project&apos;s budget.</p>
        <p className="text-xs text-muted-foreground mt-1">{state.message}</p>
      </div>
    );
  }
  const data = state.data;
  if (!data.budgetAmount) return (
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
        <BudgetCard icon={<DollarSign className="w-4 h-4 text-emerald-400" />} label="Budget" value={money(data.budgetAmount)} />
        <BudgetCard icon={<TrendingDown className="w-4 h-4 text-red-400" />} label="Spent" value={money(data.totalCost)} />
        <BudgetCard icon={<TrendingUp className="w-4 h-4 text-blue-400" />} label="Remaining" value={money(data.remainingBudget)} />
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
          <div className="text-lg font-bold">{money(data.timeCost)}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Expense Cost</div>
          <div className="text-lg font-bold">{money(data.expenseCost)}</div>
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
