"use client";

import React from "react";
import { formatCurrency } from "@/lib/currency";
import type { Expense, ExpenseSummary } from "@/lib/client";

interface ExpenseMetricsRowProps {
  expenses: Expense[];
  summary: ExpenseSummary | null;
  currency?: string;
}

export function ExpenseMetricsRow({ expenses, summary, currency = "TTD" }: ExpenseMetricsRowProps) {
  const totalSpent = summary?.total ?? expenses.reduce((s, e) => s + e.amount, 0);
  const thisMonth = expenses
    .filter((e) => {
      const d = new Date(e.date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, e) => s + e.amount, 0);
  const billsDue = expenses.filter((e) => e.status === "BILL" && !e.paidAt).length;
  const missingReceipts = expenses.filter((e) => !e.receiptUrl && e.status === "PAID").length;

  const items = [
    { label: "Total Spent", value: formatCurrency(totalSpent, currency), color: "text-rose-400" },
    { label: "This Month", value: formatCurrency(thisMonth, currency), color: "text-foreground" },
    { label: "Bills Due", value: billsDue > 0 ? `${billsDue} pending` : "All paid", color: billsDue > 0 ? "text-amber-400" : "text-emerald-400" },
    { label: "Missing Receipts", value: missingReceipts > 0 ? `${missingReceipts}` : "All attached", color: missingReceipts > 0 ? "text-amber-400" : "text-emerald-400" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</span>
          <span className={`text-xs font-semibold ${item.color}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
