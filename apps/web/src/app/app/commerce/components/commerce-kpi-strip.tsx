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

interface KpiMetricProps {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
  score?: number;
}

function KpiMetric({ icon: Icon, label, value, color, score }: KpiMetricProps) {
  return (
    <div
      className="rounded-xl p-2.5 border transition-colors"
      style={{ background: `${color}08`, borderColor: `${color}25` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon className="h-3 w-3" style={{ color }} />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="text-sm font-display font-bold" style={{ color }}>
        {value}
      </div>
      {score !== undefined && (
        <div className="mt-1.5 h-1 rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(score, 100)}%`, background: color }}
          />
        </div>
      )}
    </div>
  );
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

  const metrics = [
    {
      icon: DollarSign,
      label: "Revenue",
      value: formatCurrencyCompact(stats.totalRevenue, currency),
      color: "hsl(var(--kf-success, 160 70% 45%))",
    },
    {
      icon: Clock,
      label: "Owed",
      value: formatCurrencyCompact(stats.outstanding, currency),
      color: "hsl(var(--kf-warning, 30 90% 55%))",
    },
    {
      icon: AlertTriangle,
      label: "Overdue",
      value: stats.overdueCount > 0 ? formatCurrencyCompact(stats.overdueAmount, currency) : "—",
      color: stats.overdueCount > 0 ? "hsl(var(--kf-error, 0 80% 60%))" : "hsl(var(--kf-muted-foreground))",
    },
    {
      icon: TrendingUp,
      label: "Conversion",
      value: `${stats.conversionRate}%`,
      color: "hsl(var(--kf-accent1))",
      score: stats.conversionRate,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {metrics.map((metric) => (
        <KpiMetric key={metric.label} {...metric} />
      ))}
    </div>
  );
}
