"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, Receipt, DollarSign, Wallet, TrendingDown, Clock, Target } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/currency";
import type { Invoice, Quote, Expense, ExpenseSummary, FinanceOverview, RevenueOverview } from "@/lib/client";

interface MoneyFlowBarProps {
  quotes: Quote[];
  invoices: Invoice[];
  expenses: Expense[];
  expenseSummary: ExpenseSummary | null;
  overview: FinanceOverview | null;
  revenueOverview: RevenueOverview | null;
  budgets: { amount: number; spent: number }[];
  currency?: string;
}

interface FlowStage {
  key: string;
  label: string;
  icon: React.ElementType;
  amount: number;
  count: number;
  href: string;
  color: string;
  bgColor: string;
}

export function MoneyFlowBar({
  quotes,
  invoices,
  expenses,
  expenseSummary,
  overview,
  budgets,
  currency = "TTD",
}: MoneyFlowBarProps) {
  const quoteTotal = quotes.reduce((s, q) => s + (q.total ?? 0), 0);
  const invoiceTotal = invoices.reduce((s, i) => s + (Number(i.total) ?? 0), 0);
  const paidTotal = invoices
    .filter((i) => i.status === "PAID")
    .reduce((s, i) => s + (Number(i.total) ?? 0), 0);
  const cash = overview?.cashBalance ?? 0;
  const expenseTotal = expenseSummary?.total ?? expenses.reduce((s, e) => s + e.amount, 0);
  const billsTotal = overview?.billsDue ?? 0;
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const _budgetSpent = budgets.reduce((s, b) => s + b.spent, 0);

  const stages: FlowStage[] = [
    {
      key: "quotes",
      label: "Quotes",
      icon: FileText,
      amount: quoteTotal,
      count: quotes.length,
      href: "/app/commerce?tab=pipeline",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      key: "invoices",
      label: "Invoices",
      icon: Receipt,
      amount: invoiceTotal,
      count: invoices.length,
      href: "/app/commerce?tab=pipeline",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      key: "paid",
      label: "Paid",
      icon: DollarSign,
      amount: paidTotal,
      count: invoices.filter((i) => i.status === "PAID").length,
      href: "/app/commerce?tab=payments",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      key: "cash",
      label: "Cash",
      icon: Wallet,
      amount: cash,
      count: overview?.cashAccountCount ?? 0,
      href: "/app/finance/accounts",
      color: "text-[hsl(var(--kf-accent1))]",
      bgColor: "bg-[hsl(var(--kf-accent1))]/10",
    },
    {
      key: "expenses",
      label: "Expenses",
      icon: TrendingDown,
      amount: expenseTotal,
      count: expenses.length,
      href: "/app/expenses",
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
    },
    {
      key: "bills",
      label: "Bills",
      icon: Clock,
      amount: billsTotal,
      count: overview?.billsDueCount ?? 0,
      href: "/app/expenses",
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
    {
      key: "budgeting",
      label: "Budget",
      icon: Target,
      amount: budgetTotal,
      count: budgets.length,
      href: "/app/budgeting",
      color: "text-teal-500",
      bgColor: "bg-teal-500/10",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Money Flow
      </p>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isLast = idx === stages.length - 1;

          return (
            <div key={stage.key} className="flex items-center gap-2 flex-shrink-0">
              <Link
                href={stage.href}
                className="flex flex-col items-center gap-1.5 min-w-[80px] sm:min-w-[100px] p-2.5 rounded-xl hover:bg-muted/30 transition-colors group"
              >
                <div className={`w-8 h-8 rounded-lg ${stage.bgColor} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${stage.color}`} />
                </div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {stage.label}
                </span>
                <span className="text-sm font-bold text-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors">
                  {formatCurrencyCompact(stage.amount, currency)}
                </span>
                <span className="text-[9px] text-muted-foreground/60">
                  {stage.count} {stage.count === 1 ? "item" : "items"}
                </span>
              </Link>

              {!isLast && (
                <div className="w-4 h-[1px] bg-gradient-to-r from-border to-border/30 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
