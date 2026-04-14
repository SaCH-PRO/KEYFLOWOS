"use client";

import { useEffect, useState } from "react";
import { DollarSign, FileText, ExternalLink, CreditCard, TrendingDown, Wallet, AlertCircle } from "lucide-react";
import { fetchExpensesByProject, type Expense } from "@/lib/client";

interface RevenueTabProps {
  invoiceId?: string;
  businessId?: string;
  projectId?: string;
}

export function RevenueTab({ invoiceId, businessId, projectId }: RevenueTabProps) {
  const [projectExpenses, setProjectExpenses] = useState<Expense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !projectId) return;
    let cancelled = false;
    async function loadExpenses() {
      setLoadingExpenses(true);
      setExpenseError(null);
      try {
        const res = await fetchExpensesByProject(businessId!, projectId!);
        if (!cancelled && res.data) {
          setProjectExpenses(res.data.expenses);
        }
      } catch (err) {
        if (!cancelled) {
          setExpenseError("Failed to load project expenses. Please try again.");
          console.error("[RevenueTab] expense fetch error:", err);
        }
      }
      if (!cancelled) setLoadingExpenses(false);
    }
    void loadExpenses();
    return () => { cancelled = true; };
  }, [businessId, projectId]);

  const totalCost = projectExpenses.reduce((s, e) => s + e.amount, 0);

  const categorySummary = projectExpenses.reduce<Record<string, number>>((acc, e) => {
    const cat = e.category || "Uncategorized";
    acc[cat] = (acc[cat] || 0) + e.amount;
    return acc;
  }, {});
  const sortedCategories = Object.entries(categorySummary).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {invoiceId ? (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-success) / 0.1)" }}>
              <FileText className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Invoice Linked</p>
              <p className="text-[10px] text-muted-foreground">ID: {invoiceId.slice(0, 8)}...</p>
            </div>
            <a
              href={`/app/commerce?tab=invoices&id=${invoiceId}`}
              className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
              style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}
            >
              <ExternalLink className="w-3 h-3" />
              View Invoice
            </a>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 rounded-xl border border-dashed border-border/40">
          <DollarSign className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">No revenue linked</p>
          <p className="text-xs text-muted-foreground mt-1">Link an invoice or quote to track revenue against this project.</p>
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5" />
          Project Costs
        </h4>
        {loadingExpenses ? (
          <div className="flex items-center gap-2 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
            <p className="text-xs text-muted-foreground">Loading expenses...</p>
          </div>
        ) : expenseError ? (
          <div className="flex items-center gap-2 py-3 px-3 rounded-lg" style={{ background: "hsl(var(--kf-error) / 0.06)" }}>
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
            <span className="text-xs" style={{ color: "hsl(var(--kf-error))" }}>{expenseError}</span>
          </div>
        ) : projectExpenses.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Wallet className="w-4 h-4 text-muted-foreground/40" />
            <span>No expenses linked to this project yet. Tag expenses from the Expenses workspace.</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "hsl(var(--kf-error) / 0.06)" }}>
              <span className="text-xs text-muted-foreground">{projectExpenses.length} expense{projectExpenses.length !== 1 ? "s" : ""} linked</span>
              <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-error))" }}>
                TTD ${totalCost.toLocaleString("en-TT", { minimumFractionDigits: 2 })}
              </span>
            </div>

            {sortedCategories.length > 1 && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">By Category</span>
                {sortedCategories.slice(0, 5).map(([cat, amount]) => (
                  <div key={cat} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate flex-1">{cat}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full overflow-hidden bg-muted/30">
                        <div className="h-full rounded-full" style={{ width: `${(amount / totalCost) * 100}%`, background: "hsl(var(--kf-error) / 0.5)" }} />
                      </div>
                      <span className="text-muted-foreground tabular-nums w-20 text-right">TTD ${amount.toLocaleString("en-TT", { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1 max-h-40 overflow-y-auto">
              {projectExpenses.slice(0, 10).map((exp) => (
                <div key={exp.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs" style={{ background: "hsl(var(--muted) / 0.15)" }}>
                  <span className="truncate flex-1">{exp.description}</span>
                  <span className="ml-2 font-medium tabular-nums" style={{ color: "hsl(var(--kf-error))" }}>
                    TTD ${exp.amount.toLocaleString("en-TT", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {projectExpenses.length > 10 && (
                <p className="text-[10px] text-muted-foreground text-center">+{projectExpenses.length - 10} more</p>
              )}
            </div>
            <a
              href="/app/expenses"
              className="text-xs inline-flex items-center gap-1 transition-colors"
              style={{ color: "hsl(var(--kf-accent1))" }}
            >
              <ExternalLink className="w-3 h-3" />
              View all in Expenses
            </a>
          </div>
        )}
      </div>

      {invoiceId && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5" />
            Payment Tracking
          </h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Payment status available from the Revenue workspace.</span>
          </div>
          <a
            href="/app/commerce?tab=invoices"
            className="text-xs inline-flex items-center gap-1 transition-colors"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <ExternalLink className="w-3 h-3" />
            Go to Revenue
          </a>
        </div>
      )}
    </div>
  );
}
