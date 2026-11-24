import { useMemo } from "react";
import type { Invoice, Quote } from "@/lib/client";
import { OWED_STATUSES, invoiceRemainingOwed, safeInvoiceAmount } from "@/lib/commerce-status";

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
      if (inv.status === "PAID") {
        const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
        if (paidDate && paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear) {
          collectedThisMonth += safeInvoiceAmount(inv.total);
        }
      } else if (OWED_STATUSES.has(inv.status)) {
        const owed = invoiceRemainingOwed(inv);
        outstanding += owed;
        if (inv.status === "OVERDUE" || (inv.dueDate && new Date(inv.dueDate) < now)) {
          overdue += owed;
        }
      } else if (inv.status === "DRAFT") {
        draftCount += 1;
      }
    }
    for (const q of quotes) {
      if (q.status === "SENT" || q.status === "DRAFT") pendingQuotes += 1;
    }
    return { outstanding, overdue, collectedThisMonth, draftCount, pendingQuotes };
  }, [invoices, quotes]);
}
