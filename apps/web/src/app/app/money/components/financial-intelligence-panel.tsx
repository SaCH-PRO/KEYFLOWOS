"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Zap,
  Sparkles,
  Target,
  PieChart,
} from "lucide-react";

interface CashflowPrediction {
  month: string;
  projected: number;
  conservative: number;
  optimistic: number;
}

interface FinancialInsight {
  id: string;
  type: "opportunity" | "risk" | "optimization" | "prediction";
  title: string;
  description: string;
  impact: string;
  actionLabel?: string;
}

interface ExpenseCategory {
  category: string;
  amount: number;
  budget: number;
  trend: number;
}

export function FinancialIntelligencePanel() {
  const predictions: CashflowPrediction[] = useMemo(() => [
    { month: "Jun", projected: 28400, conservative: 26200, optimistic: 31200 },
    { month: "Jul", projected: 31200, conservative: 28400, optimistic: 34800 },
    { month: "Aug", projected: 29800, conservative: 27200, optimistic: 33400 },
    { month: "Sep", projected: 35600, conservative: 31800, optimistic: 39200 },
    { month: "Oct", projected: 38400, conservative: 34200, optimistic: 42800 },
    { month: "Nov", projected: 41200, conservative: 36800, optimistic: 45600 },
  ], []);

  const insights: FinancialInsight[] = useMemo(() => [
    { id: "1", type: "risk", title: "Cash Flow Tightening", description: "3 large expenses due in 10 days while 2 invoices are 15+ days overdue. Consider accelerating collections.", impact: "$4,200 at risk", actionLabel: "Review Invoices" },
    { id: "2", type: "opportunity", title: "Revenue Recovery", description: "Automated follow-ups on 5 overdue invoices could recover $4,200 within 48 hours with 78% success rate.", impact: "+$4,200", actionLabel: "Auto-Follow Up" },
    { id: "3", type: "optimization", title: "Expense Optimization", description: "Software subscriptions total $420/month but 3 tools have overlapping features. Consolidation could save $120/month.", impact: "-$120/mo", actionLabel: "Review Subscriptions" },
    { id: "4", type: "prediction", title: "Q3 Forecast", description: "At current trajectory, Q3 revenue will reach $91K. Accelerating sales velocity could push this to $102K.", impact: "+$11K potential", actionLabel: "View Forecast" },
  ], []);

  const expenses: ExpenseCategory[] = useMemo(() => [
    { category: "Software", amount: 420, budget: 400, trend: 5 },
    { category: "Marketing", amount: 680, budget: 800, trend: -12 },
    { category: "Operations", amount: 1240, budget: 1200, trend: 3 },
    { category: "Payroll", amount: 8200, budget: 8200, trend: 0 },
    { category: "Rent", amount: 1500, budget: 1500, trend: 0 },
  ], []);

  const maxProjected = Math.max(...predictions.map((p) => p.optimistic));

  return (
    <div className="space-y-4">
      {/* Cashflow Prediction */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            6-Month Cash Flow Forecast
          </h3>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-accent1))]" /> Projected</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Conservative</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Optimistic</span>
          </div>
        </div>
        <div className="flex items-end gap-2 h-32">
          {predictions.map((pred, i) => {
            const projectedHeight = (pred.projected / maxProjected) * 100;
            const conservativeHeight = (pred.conservative / maxProjected) * 100;
            const optimisticHeight = (pred.optimistic / maxProjected) * 100;
            return (
              <div key={pred.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full relative flex justify-center" style={{ height: "100px" }}>
                  {/* Conservative range */}
                  <div
                    className="absolute bottom-0 w-6 rounded-t-md bg-muted/20"
                    style={{ height: `${conservativeHeight}%` }}
                  />
                  {/* Optimistic range */}
                  <div
                    className="absolute bottom-0 w-6 rounded-t-md bg-emerald-500/10"
                    style={{ height: `${optimisticHeight}%` }}
                  />
                  {/* Projected */}
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${projectedHeight}%` }}
                    transition={{ delay: i * 0.08, duration: 0.5, ease: "easeOut" }}
                    className="absolute bottom-0 w-3 rounded-t-md bg-[hsl(var(--kf-accent1))]"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground font-medium">{pred.month}</span>
                <span className="text-[9px] text-muted-foreground">${(pred.projected / 1000).toFixed(1)}k</span>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Expense Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <PieChart className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          Expense vs Budget
        </h3>
        <div className="space-y-2.5">
          {expenses.map((expense, i) => {
            const pct = (expense.amount / expense.budget) * 100;
            return (
              <motion.div
                key={expense.category}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{expense.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">${expense.amount} / ${expense.budget}</span>
                    <span className={`text-[10px] font-medium ${expense.trend > 0 ? "text-rose-500" : expense.trend < 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                      {expense.trend !== 0 ? `${expense.trend > 0 ? "+" : ""}${expense.trend}%` : "—"}
                    </span>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(pct, 100)}%` }}
                    transition={{ delay: i * 0.08 + 0.2, duration: 0.5 }}
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: pct > 100 ? "#ef4444" : pct > 85 ? "#f59e0b" : "#10b981",
                    }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* AI Insights */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Financial Intelligence
          </h3>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const config = {
              opportunity: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Zap },
              risk: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
              optimization: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Target },
              prediction: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: Sparkles },
            }[insight.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                className={`rounded-xl border ${config.border} ${config.bg} p-3`}
              >
                <div className="flex items-start gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{insight.impact}</span>
                      {insight.actionLabel && (
                        <button className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] hover:underline">
                          {insight.actionLabel}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
