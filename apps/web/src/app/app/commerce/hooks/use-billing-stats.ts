"use client";

import { useMemo } from "react";
import type { Invoice, Quote } from "@/lib/client";

export interface BillingStats {
  totalRevenue: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  conversionRate: number;
}

export function useBillingStats(invoices: Invoice[], quotes: Quote[]): BillingStats {
  return useMemo(() => {
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const outstandingInvoices = invoices.filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE");
    const outstanding = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
    const conversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;
    return { totalRevenue, outstanding, overdueAmount, overdueCount: overdueInvoices.length, conversionRate };
  }, [invoices, quotes]);
}
