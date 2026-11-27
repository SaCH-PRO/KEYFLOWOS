"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Palette, X, Receipt, Target } from "lucide-react";
import { toast } from "sonner";
import { ExpenseCategory, ExpenseBudget, ExpenseSummary, createExpenseCategory, deleteExpenseCategory } from "@/lib/client";
import { useRefusal } from "@/lib/failure-kit";
import { CATEGORY_COLORS, formatCurrency, refusedStart, canStartFor } from "./expense-utils";

interface ExpenseCategoriesTabProps {
  businessId: string;
  categories: ExpenseCategory[];
  /** R11-1: the data hook's guarded writers; a reply for a business no longer shown writes and says nothing. */
  isCurrentBusiness: (businessId: string) => boolean;
  addCategory: (businessId: string, category: ExpenseCategory) => boolean;
  removeCategory: (businessId: string, categoryId: string) => boolean;
  summary: ExpenseSummary | null;
  budgets: ExpenseBudget[];
}

export function ExpenseCategoriesTab({ businessId, categories, isCurrentBusiness, addCategory, removeCategory, summary, budgets }: ExpenseCategoriesTabProps) {
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0]);
  // EXPENSES-HUB-3: the client answers a refused create as { error } and does not throw; it used to say
  // "Category created" anyway. A refusal says why and keeps what was typed.
  const { refused } = useRefusal();
  // R19-5: every reply is judged by the start check's test (the given check, and the stored id).
  const live = () => canStartFor(businessId, isCurrentBusiness);

  const categoryData = useMemo(() => {
    return categories.map(cat => {
      const catSummary = summary?.byCategory?.find(c => c.categoryId === cat.id);
      const budget = budgets.find(b => b.category?.id === cat.id || b.categoryId === cat.id);
      const total = catSummary?.total ?? 0;
      const prevTotal = catSummary?.prevTotal ?? 0;
      // EXPENSES-HUB-3 (COR MINOR-3): no trend is computed here. The browser made "Spike +100%" from a previous
      // total of 0 (the server says 0), and "spike" and "saved" from thresholds the server never set; the server's
      // totals for this period and the last are shown as they are.
      return {
        ...cat,
        total,
        prevTotal,
        percent: catSummary?.percent ?? 0,
        txCount: cat._count?.expenses ?? 0,
        budget: budget ?? null,
      };
    }).sort((a, b) => b.total - a.total);
  }, [categories, summary, budgets]);

  const maxTotal = categoryData.length > 0 ? Math.max(...categoryData.map(c => Math.max(c.total, c.prevTotal)), 1) : 1;

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    if (refusedStart(businessId, isCurrentBusiness)) return;
    try {
      const res = await createExpenseCategory(businessId, { name: newCatName.trim(), color: newCatColor });
      // R11-1: answered after a switch to another business: nothing is added there and nothing is said.
      if (!live()) return;
      if (refused(res, { what: "add expense categories" })) return;
      if (!res.data) { toast.error("Failed to create category"); return; }
      if (!addCategory(businessId, res.data)) return;
      setNewCatName(""); setNewCatColor(CATEGORY_COLORS[0]);
      toast.success("Category created");
    } catch { if (live()) toast.error("Failed to create category"); }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (refusedStart(businessId, isCurrentBusiness)) return;
    try {
      const res = await deleteExpenseCategory(businessId, categoryId);
      // R11-2: answered after a switch to another business: nothing is removed there and nothing is said.
      if (!live()) return;
      if (refused(res, { what: "delete expense categories" })) return;
      if (!removeCategory(businessId, categoryId)) return;
      toast.success("Category deleted");
    } catch { if (live()) toast.error("Failed to delete category"); }
  };

  return (
    <div className="space-y-6">
      <div className="kf-card rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Palette className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />Create Category</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input placeholder="Category name..." aria-label="Category name" value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddCategory()} className="flex-1 min-w-[140px] bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
          <div className="flex items-center gap-1">
            {CATEGORY_COLORS.map(c => (
              <button key={c} onClick={() => setNewCatColor(c)} aria-label={`Colour ${c}`} aria-pressed={newCatColor === c} className="w-5 h-5 rounded-full transition-transform" style={{ background: c, transform: newCatColor === c ? "scale(1.3)" : "scale(1)", boxShadow: newCatColor === c ? `0 0 0 2px ${c}40` : "none" }} />
            ))}
          </div>
          <button onClick={handleAddCategory} disabled={!newCatName.trim()} aria-label="Add category" className="kf-btn-primary px-4 py-2 min-h-[44px] sm:min-h-0 rounded-lg text-sm font-medium disabled:opacity-40"><Plus className="w-4 h-4" /></button>
        </div>
      </div>

      {categoryData.length > 0 ? (
        <div className="kf-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Palette className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              Category Breakdown
              <span className="text-xs text-muted-foreground font-normal">({categories.length})</span>
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Current vs previous period comparison</p>
          </div>
          <div className="divide-y divide-border/30">
            {categoryData.map((cat, i) => (
              <motion.div
                key={cat.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="px-4 py-3 hover:bg-white/[0.02] transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: cat.color || "#6366f1" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium">{cat.name}</span>
                      <span className="text-[10px] text-muted-foreground">{cat.txCount} txn{cat.txCount !== 1 ? "s" : ""}</span>
                      {cat.budget && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: cat.budget.isOverBudget ? "hsl(var(--kf-error) / 0.1)" : "hsl(var(--kf-info) / 0.1)", color: cat.budget.isOverBudget ? "hsl(var(--kf-error))" : "hsl(var(--kf-info))" }}>
                          <Target className="w-2.5 h-2.5" />
                          {cat.budget.percentUsed}% of {formatCurrency(cat.budget.amount)}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden relative">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(cat.total / maxTotal) * 100}%` }}
                            transition={{ duration: 0.5, delay: i * 0.05 }}
                            className="h-full rounded-full"
                            style={{ background: cat.color || "#6366f1" }}
                          />
                        </div>
                        <span className="text-xs font-semibold w-28 text-right">{formatCurrency(cat.total)}</span>
                        <span className="text-[10px] text-muted-foreground w-10 text-right">{cat.percent}%</span>
                      </div>
                      {cat.prevTotal > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted/15 overflow-hidden relative">
                            <div
                              className="h-full rounded-full opacity-40"
                              style={{ width: `${(cat.prevTotal / maxTotal) * 100}%`, background: cat.color || "#6366f1" }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-28 text-right">prev: {formatCurrency(cat.prevTotal)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteCategory(cat.id)} aria-label={`Delete category ${cat.name}`} className="sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all"><X className="w-3.5 h-3.5" /></button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="kf-card rounded-xl p-8 text-center space-y-2">
          <Palette className="w-8 h-8 mx-auto text-muted-foreground/30" />
          <p className="text-sm font-medium">No categories yet</p>
          <p className="text-xs text-muted-foreground">Create categories above to sort your expenses and set budgets.</p>
        </div>
      )}

      {summary?.byCategory && summary.byCategory.length > 0 && (
        <div className="kf-card rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Category Health
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {summary.byCategory.slice(0, 6).map(cat => {
              const budget = budgets.find(b => b.category?.id === cat.categoryId || b.categoryId === cat.categoryId);
              return (
                <div key={cat.categoryId} className="bg-white/5 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color || "#6366f1" }} />
                    <span className="text-xs font-medium flex-1">{cat.name}</span>
                    <span className="text-[10px] text-muted-foreground">{cat.percent}%</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{formatCurrency(cat.total)}</span>
                    {budget ? (
                      <span className={budget.isOverBudget ? "text-red-400" : budget.isNearAlert ? "text-amber-400" : "text-green-400"}>
                        {budget.isOverBudget ? "Over budget" : `${budget.percentUsed}% used`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">No budget</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
