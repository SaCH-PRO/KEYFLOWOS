import { useMemo } from "react";
import type { Invoice, Quote } from "@/lib/client";

export interface FinancialSummary {
  outstanding: number;
  overdue: number;
  collectedThisMonth: number;
  draftCount: number;
  pendingQuotes: number;
}

export function useFinancialSummary(invoices: Invoice[], quotes: Quote[]): FinancialSummary {
  return useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    let outstanding = 0;
    let overdue = 0;
    let collectedThisMonth = 0;
    let draftCount = 0;
    let pendingQuotes = 0;
    for (const inv of invoices) {
      const amount = Number(inv.total ?? 0);
      if (inv.status === "PAID") {
        const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
        if (paidDate && paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear) {
          collectedThisMonth += amount;
        }
      } else if (inv.status === "OVERDUE") {
        outstanding += amount;
        overdue += amount;
      } else if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
        outstanding += amount;
        if (inv.dueDate && new Date(inv.dueDate) < now) overdue += amount;
      } else if (inv.status === "DRAFT") {
        outstanding += amount;
        draftCount += 1;
      }
    }
    for (const q of quotes) {
      if (q.status === "SENT" || q.status === "DRAFT") pendingQuotes += 1;
    }
    return { outstanding, overdue, collectedThisMonth, draftCount, pendingQuotes };
  }, [invoices, quotes]);
}
