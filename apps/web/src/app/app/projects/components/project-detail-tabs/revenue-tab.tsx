"use client";

import { useEffect, useState } from "react";
import { DollarSign, FileText, ExternalLink, CreditCard, TrendingDown } from "lucide-react";
import { fetchExpensesByProject, type Expense } from "@/lib/client";

interface RevenueTabProps {
  invoiceId?: string;
  businessId?: string;
  projectId?: string;
}

export function RevenueTab({ invoiceId, businessId, projectId }: RevenueTabProps) {
  const [projectExpenses, setProjectExpenses] = useState<Expense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);

  useEffect(() => {
    if (!businessId || !projectId) return;
    setLoadingExpenses(true);
    fetchExpensesByProject(businessId, projectId)
      .then((res) => {
        if (res.data) {
          setProjectExpenses(res.data.expenses);
        }
      })
      .finally(() => setLoadingExpenses(false));
  }, [businessId, projectId]);

  const totalCost = projectExpenses.reduce((s, e) => s + e.amount, 0);

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
          <p className="text-xs text-muted-foreground mt-1">Link an invoice or quote to track revenue.</p>
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5" />
          Project Costs
        </h4>
        {loadingExpenses ? (
          <p className="text-xs text-muted-foreground">Loading expenses...</p>
        ) : projectExpenses.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>No expenses linked to this project yet. Tag expenses from the Expenses workspace.</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{projectExpenses.length} expense{projectExpenses.length !== 1 ? "s" : ""} linked</span>
              <span className="text-sm font-bold text-red-400">TTD ${totalCost.toLocaleString("en-TT", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {projectExpenses.slice(0, 10).map((exp) => (
                <div key={exp.id} className="flex items-center justify-between bg-white/5 rounded-lg px-2.5 py-1.5 text-xs">
                  <span className="truncate flex-1">{exp.description}</span>
                  <span className="text-red-400 ml-2 font-medium">TTD ${exp.amount.toLocaleString("en-TT", { minimumFractionDigits: 2 })}</span>
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
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Tracking</h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CreditCard className="w-3.5 h-3.5" />
            <span>Payment status available from the Revenue workspace.</span>
          </div>
        </div>
      )}
    </div>
  );
}
