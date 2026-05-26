"use client";

import { useMemo } from "react";
import { parseDate } from "@/lib/date-safe";
import type { Invoice, Quote } from "@/lib/client";

export interface AgingBucket {
  label: string;
  count: number;
  amount: number;
}

export interface BillingStats {
  totalRevenue: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  conversionRate: number;
  aging: AgingBucket[];
}

function safeNumber(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function useBillingStats(invoices: Invoice[], quotes: Quote[]): BillingStats {
  return useMemo(() => {
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + safeNumber(inv.total), 0);
    const outstandingInvoices = invoices.filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE");
    const outstanding = outstandingInvoices.reduce((sum, inv) => sum + safeNumber(inv.total), 0);
    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + safeNumber(inv.total), 0);
    const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
    const conversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;

    const now = new Date();
    const buckets: AgingBucket[] = [
      { label: "Current", count: 0, amount: 0 },
      { label: "1–30 days", count: 0, amount: 0 },
      { label: "31–60 days", count: 0, amount: 0 },
      { label: "60+ days", count: 0, amount: 0 },
    ];

    for (const inv of outstandingInvoices) {
      const total = safeNumber(inv.total);
      const due = parseDate(inv.dueDate);
      if (!due) {
        buckets[0].count++;
        buckets[0].amount += total;
        continue;
      }
      const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (Number.isNaN(daysOverdue)) {
        buckets[0].count++;
        buckets[0].amount += total;
      } else if (daysOverdue <= 0) {
        buckets[0].count++;
        buckets[0].amount += total;
      } else if (daysOverdue <= 30) {
        buckets[1].count++;
        buckets[1].amount += total;
      } else if (daysOverdue <= 60) {
        buckets[2].count++;
        buckets[2].amount += total;
      } else {
        buckets[3].count++;
        buckets[3].amount += total;
      }
    }

    return { totalRevenue, outstanding, overdueAmount, overdueCount: overdueInvoices.length, conversionRate, aging: buckets };
  }, [invoices, quotes]);
}
