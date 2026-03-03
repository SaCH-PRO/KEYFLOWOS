"use client";

import { useEffect, useState, useMemo } from "react";
import {
  DollarSign,
  TrendingUp,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Invoice, Quote, Product, fetchCommerceStats, type CommerceStats } from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";

interface CommerceKpiStripProps {
  businessId: string | null;
  invoices: Invoice[];
  quotes: Quote[];
  products: Product[];
  currency?: string;
}

function computeStats(invoices: Invoice[], quotes: Quote[]) {
  const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
  const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const outstandingInvoices = invoices.filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE");
  const outstanding = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
  const conversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;

  return {
    totalRevenue,
    outstanding,
    overdueAmount,
    overdueCount: overdueInvoices.length,
    conversionRate,
  };
}

export function CommerceKpiStrip({ businessId, invoices, quotes, products, currency = "TTD" }: CommerceKpiStripProps) {
  const [serverStats, setServerStats] = useState<CommerceStats | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchCommerceStats(businessId).then((res) => {
      if (!cancelled && res.data) setServerStats(res.data);
    });
    return () => { cancelled = true; };
  }, [businessId, invoices.length, quotes.length, products.length]);

  const clientStats = useMemo(() => computeStats(invoices, quotes), [invoices, quotes]);

  const stats = useMemo(() => {
    if (serverStats) {
      return {
        totalRevenue: serverStats.totalRevenue,
        outstanding: serverStats.outstandingAmount,
        overdueAmount: serverStats.overdueAmount,
        overdueCount: serverStats.invoiceStatusBreakdown?.OVERDUE?.count ?? 0,
        conversionRate: serverStats.quoteConversionRate,
      };
    }
    return clientStats;
  }, [serverStats, clientStats]);

  const chips = [
    {
      icon: DollarSign,
      label: "Revenue",
      value: formatCurrencyCompact(stats.totalRevenue, currency),
      color: "#10b981",
    },
    {
      icon: Clock,
      label: "Owed",
      value: formatCurrencyCompact(stats.outstanding, currency),
      color: "#f59e0b",
    },
    {
      icon: AlertTriangle,
      label: "Overdue",
      value: stats.overdueCount > 0 ? formatCurrencyCompact(stats.overdueAmount, currency) : "—",
      color: stats.overdueCount > 0 ? "#ef4444" : "#6b7280",
    },
    {
      icon: TrendingUp,
      label: "Conversion",
      value: `${stats.conversionRate}%`,
      color: "hsl(142 76% 36%)",
    },
  ];

  return (
    <div className="flex flex-wrap gap-1.5 sm:gap-2">
      {chips.map((chip) => (
        <div
          key={chip.label}
          className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border/50 bg-white/[0.03] text-sm"
        >
          <chip.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" style={{ color: chip.color }} />
          <span className="font-semibold text-[11px] sm:text-xs">{chip.value}</span>
          <span className="text-[10px] sm:text-[11px] text-muted-foreground/50 hidden sm:inline">{chip.label}</span>
        </div>
      ))}
    </div>
  );
}
