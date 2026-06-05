"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Paperclip,
  Tag,
  ArrowRight,
  Wallet,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { Expense, ExpenseCategory, ExpenseSummary, ExpenseBudget } from "@/lib/client";

interface ExpensesSnapshotTabProps {
  expenses: Expense[];
  categories: ExpenseCategory[];
  summary: ExpenseSummary | null;
  budgets: ExpenseBudget[];
  onNavigate?: (tab: string) => void;
  onViewExpense?: (exp: Expense) => void;
}

export function ExpensesSnapshotTab({
  expenses,
  categories,
  summary,
  budgets,
  onNavigate,
  onViewExpense,
}: ExpensesSnapshotTabProps) {
  const totalSpent = summary?.total ?? 0;
  const changePct = summary?.comparison?.changePercent ?? 0;
  const direction = summary?.comparison?.direction ?? "flat";
  const bills = expenses.filter((e) => e.status === "BILL" && !e.paidAt);
  const paidCount = expenses.filter((e) => e.status === "PAID").length;
  const recentExpenses = [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

  const overBudget = budgets.filter((b) => b.isOverBudget);
  const uncategorizedCount = summary?.uncategorizedCount ?? expenses.filter((e) => !e.categoryId).length;
  const missingReceiptCount = summary?.missingReceiptCount ?? expenses.filter((e) => !e.receiptUrl && e.status === "PAID").length;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 rounded-2xl bg-white/[0.02] border border-border/40"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Spent</p>
            <p className="text-3xl font-bold text-foreground mt-1">{formatCurrency(totalSpent, "TTD")}</p>
            <div className="flex items-center gap-1.5 mt-2">
              {direction === "up" ? (
                <TrendingUp className="w-3.5 h-3.5 text-rose-400" />
              ) : direction === "down" ? (
                <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Minus className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span className={`text-xs font-medium ${direction === "up" ? "text-rose-400" : direction === "down" ? "text-emerald-400" : "text-muted-foreground"}`}>
                {changePct > 0 ? `+${changePct}%` : `${changePct}%`} vs last period
              </span>
            </div>
          </div>
          <div className="text-right space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground">Transactions</p>
              <p className="text-sm font-semibold">{summary?.count ?? expenses.length}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Average</p>
              <p className="text-sm font-semibold">{formatCurrency(summary?.averageExpense ?? 0, "TTD")}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* At a Glance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GlanceCard
          icon={Layers}
          label="Categories"
          value={summary?.byCategory?.length ?? 0}
          sublabel="active categories"
          color="text-violet-400"
          bg="bg-violet-500/10"
          onClick={() => onNavigate?.("categories")}
        />
        <GlanceCard
          icon={FileText}
          label="Bills Due"
          value={bills.length}
          sublabel={bills.length > 0 ? `${bills.filter((b) => b.dueDate && new Date(b.dueDate) < new Date()).length} overdue` : "all paid"}
          color="text-amber-400"
          bg="bg-amber-500/10"
          onClick={() => onNavigate?.("pipeline")}
        />
        <GlanceCard
          icon={CheckCircle2}
          label="Paid"
          value={paidCount}
          sublabel="expenses settled"
          color="text-emerald-400"
          bg="bg-emerald-500/10"
          onClick={() => onNavigate?.("pipeline")}
        />
      </div>

      {/* Bills Queue */}
      {bills.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-white/[0.02] border border-border/40 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Bills Queue
            </h3>
            <span className="text-[10px] text-muted-foreground">{bills.length} pending</span>
          </div>
          <div className="space-y-2">
            {bills.slice(0, 5).map((bill) => {
              const isOverdue = bill.dueDate && new Date(bill.dueDate) < new Date();
              return (
                <div
                  key={bill.id}
                  onClick={() => onViewExpense?.(bill)}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-border/30 hover:border-amber-500/30 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isOverdue ? "bg-red-400" : "bg-amber-400"}`} />
                    <span className="text-xs font-medium truncate">{bill.description}</span>
                    {isOverdue && <span className="text-[10px] text-red-400 font-medium">Overdue</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {bill.dueDate && (
                      <span className="text-[10px] text-muted-foreground">
                        Due {new Date(bill.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    <span className="text-xs font-semibold">{formatCurrency(bill.amount, bill.currency)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {overBudget.length > 0 && (
          <ActionCard
            icon={AlertTriangle}
            title={`${overBudget.length} budget${overBudget.length > 1 ? "s" : ""} over limit`}
            description="Spending has exceeded the set budget amount."
            color="text-rose-400"
            bg="bg-rose-500/10"
            urgent
            onClick={() => onNavigate?.("budgets")}
          />
        )}
        {uncategorizedCount > 0 && (
          <ActionCard
            icon={Tag}
            title={`${uncategorizedCount} uncategorized`}
            description="Expenses without a category can't be tracked properly."
            color="text-amber-400"
            bg="bg-amber-500/10"
            onClick={() => onNavigate?.("pipeline")}
          />
        )}
        {missingReceiptCount > 0 && (
          <ActionCard
            icon={Paperclip}
            title={`${missingReceiptCount} missing receipts`}
            description="Attach receipts for tax compliance and audit readiness."
            color="text-blue-400"
            bg="bg-blue-500/10"
            onClick={() => onNavigate?.("pipeline")}
          />
        )}
        {overBudget.length === 0 && uncategorizedCount === 0 && missingReceiptCount === 0 && (
          <ActionCard
            icon={CheckCircle2}
            title="All caught up"
            description="No urgent expense actions"
            color="text-emerald-400"
            bg="bg-emerald-500/10"
            onClick={() => onNavigate?.("pipeline")}
          />
        )}
      </div>

      {/* Recent Activity */}
      <div className="p-4 rounded-2xl bg-white/[0.02] border border-border/40 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          Recent Activity
        </h3>
        {recentExpenses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent expenses.</p>
        ) : (
          <div className="space-y-1">
            {recentExpenses.map((exp) => {
              const cat = categories.find((c) => c.id === exp.categoryId) || exp.category;
              return (
                <div
                  key={exp.id}
                  onClick={() => onViewExpense?.(exp)}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-white/[0.03] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: cat?.color || "#6366f1" }}
                    />
                    <span className="text-xs truncate">{exp.description}</span>
                    {exp.status === "BILL" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Bill</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(exp.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <span className="text-xs font-medium">{formatCurrency(exp.amount, exp.currency)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function GlanceCard({
  icon: Icon,
  label,
  value,
  sublabel,
  color,
  bg,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sublabel: string;
  color: string;
  bg: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className={`p-4 rounded-2xl bg-white/[0.02] border border-border/40 cursor-pointer transition-colors hover:border-border/60 ${onClick ? "hover:bg-white/[0.03]" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30" />
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sublabel}</p>
    </motion.div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  color,
  bg,
  urgent,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  bg: string;
  urgent?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className={`p-4 rounded-xl border bg-card hover:border-[hsl(var(--kf-accent1))]/30 transition-all cursor-pointer ${urgent ? "border-rose-500/20" : "border-border/60"}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        {urgent && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-500 uppercase tracking-wider">
            Action
          </span>
        )}
      </div>
      <h3 className={`text-sm font-semibold mb-0.5`}>{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </motion.div>
  );
}
