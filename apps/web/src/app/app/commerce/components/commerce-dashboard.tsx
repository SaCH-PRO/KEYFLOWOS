"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  TrendingUp,
  Clock,
  AlertTriangle,
  Package,
  FileText,
  CheckCircle,
  RefreshCw,
} from "lucide-react";
import { Invoice, Quote, Product } from "@/lib/client";

interface CommerceDashboardProps {
  invoices: Invoice[];
  quotes: Quote[];
  products: Product[];
}

function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

export default function CommerceDashboard({ invoices, quotes, products }: CommerceDashboardProps) {
  const stats = useMemo(() => {
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);

    const outstandingInvoices = invoices.filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE");
    const outstanding = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);

    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const paidThisMonth = paidInvoices.filter((inv) => {
      const dateStr = inv.paidAt || inv.issueDate;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const paidThisMonthAmount = paidThisMonth.reduce((sum, inv) => sum + Number(inv.total), 0);

    const activeQuotes = quotes.filter((q) => q.status === "DRAFT" || q.status === "SENT").length;
    const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
    const conversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;
    const activeProducts = products.filter((p) => p.isActive !== false).length;

    return {
      totalRevenue,
      outstanding,
      overdueAmount,
      overdueCount: overdueInvoices.length,
      paidThisMonthAmount,
      paidThisMonthCount: paidThisMonth.length,
      totalProducts: products.length,
      activeProducts,
      activeQuotes,
      conversionRate,
    };
  }, [invoices, quotes, products]);

  const kpiCards = [
    {
      label: "Total Revenue",
      value: formatTTD(stats.totalRevenue),
      icon: DollarSign,
      color: "#10b981",
      glow: "shadow-emerald-500/10",
    },
    {
      label: "Outstanding",
      value: formatTTD(stats.outstanding),
      icon: Clock,
      color: "#f59e0b",
      glow: "shadow-amber-500/10",
    },
    {
      label: "Overdue",
      value: stats.overdueCount > 0 ? formatTTD(stats.overdueAmount) : "None",
      subtitle: stats.overdueCount > 0 ? `${stats.overdueCount} invoice${stats.overdueCount !== 1 ? "s" : ""}` : "All clear",
      icon: AlertTriangle,
      color: stats.overdueCount > 0 ? "#ef4444" : "#6b7280",
      glow: stats.overdueCount > 0 ? "shadow-red-500/10" : "",
    },
    {
      label: "Paid This Month",
      value: formatTTD(stats.paidThisMonthAmount),
      subtitle: `${stats.paidThisMonthCount} invoice${stats.paidThisMonthCount !== 1 ? "s" : ""}`,
      icon: CheckCircle,
      color: "#14b8a6",
      glow: "shadow-teal-500/10",
    },
  ];

  const secondaryStats = [
    { icon: Package, label: "products", value: stats.activeProducts, color: "hsl(var(--kf-accent1))" },
    { icon: FileText, label: "active quotes", value: stats.activeQuotes, color: "hsl(200 80% 55%)" },
    { icon: TrendingUp, label: "conversion", value: `${stats.conversionRate}%`, color: "hsl(142 76% 36%)" },
    { icon: RefreshCw, label: "total invoices", value: invoices.length, color: "hsl(var(--kf-accent2))" },
  ];

  return (
    <div className="space-y-3">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {kpiCards.map((card) => (
          <motion.div
            key={card.label}
            variants={item}
            className={`rounded-xl border border-border/50 bg-card p-3.5 flex items-start gap-3 group hover:border-border/70 transition-all hover:shadow-lg ${card.glow}`}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-white/10"
              style={{ backgroundColor: `${card.color}15` }}
            >
              <card.icon className="w-4.5 h-4.5" style={{ color: card.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1">
                {card.label}
              </p>
              <p className="text-base sm:text-lg font-bold truncate leading-tight">{card.value}</p>
              {card.subtitle && (
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">{card.subtitle}</p>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.25 }}
        className="flex flex-wrap gap-2"
      >
        {secondaryStats.map((stat) => (
          <div
            key={stat.label}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-white/[0.03] text-sm"
          >
            <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
            <span className="font-semibold text-xs">{stat.value}</span>
            <span className="text-[11px] text-muted-foreground/50">{stat.label}</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
