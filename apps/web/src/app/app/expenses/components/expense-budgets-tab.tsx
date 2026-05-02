"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Target, AlertTriangle, X, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
import { ExpenseBudget, ExpenseCategory, ExpenseSummary, Expense, upsertExpenseBudget, deleteExpenseBudget } from "@/lib/client";
import { formatCurrency } from "./expense-utils";

interface ExpenseBudgetsTabProps {
  businessId: string;
  budgets: ExpenseBudget[];
  categories: ExpenseCategory[];
  expenses: Expense[];
  summary: ExpenseSummary | null;
  onReload: () => void;
}

export function ExpenseBudgetsTab({ businessId, budgets, categories, expenses: _expenses, summary: _summary, onReload }: ExpenseBudgetsTabProps) {
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ categoryId: "", amount: "", alertAt: "80" });

  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);

  const totalAllocated = budgets.reduce((s, b) => s + b.amount, 0);
  const totalConsumed = budgets.reduce((s, b) => s + b.spent, 0);
  const overBudgetCount = budgets.filter(b => b.isOverBudget).length;
  const nearLimitCount = budgets.filter(b => b.isNearAlert && !b.isOverBudget).length;

  const handleSaveBudget = async () => {
    if (!budgetForm.amount) return;
    const now = new Date();
    try {
      await upsertExpenseBudget(businessId, {
        categoryId: budgetForm.categoryId || undefined,
        amount: parseFloat(budgetForm.amount),
        month: now.getMonth() + 1, year: now.getFullYear(),
        alertAt: parseFloat(budgetForm.alertAt) || 80,
      });
      setShowBudgetModal(false);
      setBudgetForm({ categoryId: "", amount: "", alertAt: "80" });
      toast.success("Budget saved");
      onReload();
    } catch { toast.error("Failed to save budget"); }
  };

  const handleDeleteBudget = async (budgetId: string) => {
    try { await deleteExpenseBudget(businessId, budgetId); toast.success("Budget deleted"); onReload(); } catch { toast.error("Failed to delete budget"); }
  };

  return (
    <>
      <div className="space-y-6">
        {budgets.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="kf-card rounded-xl p-3">
              <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Allocated</span>
              <span className="text-sm font-bold">{formatCurrency(totalAllocated)}</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5">{budgets.length} budget{budgets.length !== 1 ? "s" : ""} active</span>
            </div>
            <div className="kf-card rounded-xl p-3">
              <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Consumed</span>
              <span className="text-sm font-bold" style={{ color: totalConsumed > totalAllocated ? "hsl(var(--kf-error))" : undefined }}>{formatCurrency(totalConsumed)}</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5">{totalAllocated > 0 ? `${Math.round((totalConsumed / totalAllocated) * 100)}%` : "0%"} used</span>
            </div>
            <div className="kf-card rounded-xl p-3">
              <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Month Progress</span>
              <span className="text-sm font-bold">{monthProgress}%</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5 flex items-center gap-1"><Calendar className="w-3 h-3" />Day {dayOfMonth} of {daysInMonth}</span>
            </div>
            <div className={`kf-card rounded-xl p-3 ${overBudgetCount > 0 ? "border-red-500/30" : ""}`}>
              <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Status</span>
              {overBudgetCount > 0 ? (
                <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-error))" }}>{overBudgetCount} exceeded</span>
              ) : nearLimitCount > 0 ? (
                <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-warning))" }}>{nearLimitCount} near limit</span>
              ) : (
                <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-success))" }}>All on track</span>
              )}
              <span className="text-[10px] text-muted-foreground block mt-0.5">{formatCurrency(Math.max(0, totalAllocated - totalConsumed))} remaining</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Monthly Budgets</h3>
          <button onClick={() => setShowBudgetModal(true)} className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Set Budget</button>
        </div>

        {budgets.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No budgets set yet"
            description="Set spending limits per category to get overspend alerts, cost tracking, and AI-powered budget recommendations."
            actionLabel="Set Budget"
            onAction={() => setShowBudgetModal(true)}
            tip="Budgets reset monthly. You'll get a warning when spending reaches your alert threshold."
          />
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {budgets.map(b => {
              const projectedSpend = dayOfMonth > 0 ? (b.spent / dayOfMonth) * daysInMonth : b.spent;
              const projectedOver = projectedSpend > b.amount;
              const projectedOverBy = projectedSpend - b.amount;
              return (
                <div key={b.id} className={`kf-card rounded-xl p-4 ${b.isOverBudget ? "border-red-500/30" : b.isNearAlert ? "border-amber-500/30" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {b.category && <div className="w-3 h-3 rounded-full" style={{ background: b.category.color || "#6366f1" }} />}
                      <span className="text-sm font-medium">{b.category?.name || "All Categories"}</span>
                    </div>
                    <button onClick={() => handleDeleteBudget(b.id)} className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-lg font-bold">{formatCurrency(b.spent)}</span>
                    <span className="text-xs text-muted-foreground">of {formatCurrency(b.amount)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted/30 overflow-hidden mb-1.5 relative">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(b.percentUsed, 100)}%` }} transition={{ duration: 0.6 }} className={`h-full rounded-full ${b.isOverBudget ? "bg-red-500" : b.isNearAlert ? "bg-amber-500" : "bg-green-500"}`} />
                    <div className="absolute top-0 h-full w-px bg-muted-foreground/30" style={{ left: `${monthProgress}%` }} title={`Month progress: ${monthProgress}%`} />
                  </div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className={b.isOverBudget ? "text-red-400" : b.isNearAlert ? "text-amber-400" : "text-green-400"}>
                      {b.isOverBudget ? `Over by ${formatCurrency(Math.abs(b.remaining))}` : `${formatCurrency(b.remaining)} remaining`}
                    </span>
                    <span className="text-muted-foreground">{b.percentUsed}%</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t border-border/30 pt-2 mt-1">
                    <span className="flex items-center gap-1">
                      {projectedOver ? <TrendingUp className="w-3 h-3 text-red-400" /> : <TrendingDown className="w-3 h-3 text-green-400" />}
                      Projected: {formatCurrency(projectedSpend)}
                    </span>
                    {projectedOver && (
                      <span className="text-red-400">+{formatCurrency(projectedOverBy)} over</span>
                    )}
                  </div>
                  {b.isOverBudget && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 rounded-lg px-2 py-1"><AlertTriangle className="w-3 h-3" /> Budget exceeded!</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showBudgetModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="budget-modal-title">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBudgetModal(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
                <h2 id="budget-modal-title" className="text-base font-semibold">Set Monthly Budget</h2>
                <button onClick={() => setShowBudgetModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div><label className="text-xs text-muted-foreground mb-1 block">Category</label><select value={budgetForm.categoryId} onChange={e => setBudgetForm({ ...budgetForm, categoryId: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"><option value="">All Categories (Total Budget)</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Monthly Limit (TTD) *</label><input type="number" step="0.01" value={budgetForm.amount} onChange={e => setBudgetForm({ ...budgetForm, amount: e.target.value })} placeholder="5000.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Alert at (%)</label><input type="number" step="5" min="50" max="100" value={budgetForm.alertAt} onChange={e => setBudgetForm({ ...budgetForm, alertAt: e.target.value })} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /><p className="text-[10px] text-muted-foreground mt-1">You&apos;ll be warned when spending reaches this percentage.</p></div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowBudgetModal(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/30">Cancel</button>
                  <button onClick={handleSaveBudget} disabled={!budgetForm.amount} className="kf-btn-primary px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40">Save Budget</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
