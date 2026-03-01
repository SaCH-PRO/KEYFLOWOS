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

function formatTTDCompact(value: number): string {
  if (value >= 1000000) return `TTD ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `TTD ${(value / 1000).toFixed(1)}k`;
  return `TTD ${value.toFixed(0)}`;
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
      label: "Revenue",
      mobileLabel: "Revenue",
      value: formatTTD(stats.totalRevenue),
      mobileValue: formatTTDCompact(stats.totalRevenue),
      icon: DollarSign,
      color: "#10b981",
      glow: "shadow-emerald-500/10",
    },
    {
      label: "Outstanding",
      mobileLabel: "Owed",
      value: formatTTD(stats.outstanding),
      mobileValue: formatTTDCompact(stats.outstanding),
      icon: Clock,
      color: "#f59e0b",
      glow: "shadow-amber-500/10",
    },
    {
      label: "Overdue",
      mobileLabel: "Overdue",
      value: stats.overdueCount > 0 ? formatTTD(stats.overdueAmount) : "None",
      mobileValue: stats.overdueCount > 0 ? formatTTDCompact(stats.overdueAmount) : "—",
      subtitle: stats.overdueCount > 0 ? `${stats.overdueCount} invoice${stats.overdueCount !== 1 ? "s" : ""}` : "All clear",
      icon: AlertTriangle,
      color: stats.overdueCount > 0 ? "#ef4444" : "#6b7280",
      glow: stats.overdueCount > 0 ? "shadow-red-500/10" : "",
    },
    {
      label: "Paid This Month",
      mobileLabel: "Monthly",
      value: formatTTD(stats.paidThisMonthAmount),
      mobileValue: formatTTDCompact(stats.paidThisMonthAmount),
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
    <div className="space-y-2.5">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-4 gap-1.5 sm:gap-3"
      >
        {kpiCards.map((card) => (
          <motion.div
            key={card.label}
            variants={item}
            className={`rounded-xl border border-border/50 bg-card p-2 sm:p-3.5 group hover:border-border/70 transition-all hover:shadow-lg ${card.glow}`}
          >
            <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-1.5">
              <div
                className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-white/10"
                style={{ backgroundColor: `${card.color}15` }}
              >
                <card.icon className="w-3 h-3 sm:w-4 sm:h-4" style={{ color: card.color }} />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                <span className="hidden sm:inline">{card.label}</span>
                <span className="sm:hidden">{card.mobileLabel}</span>
              </span>
            </div>
            <p className="text-xs sm:text-lg font-bold truncate leading-tight">
              <span className="hidden sm:inline">{card.value}</span>
              <span className="sm:hidden">{card.mobileValue}</span>
            </p>
            {card.subtitle && (
              <p className="text-[10px] text-muted-foreground/50 mt-0.5 hidden sm:block">{card.subtitle}</p>
            )}
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.25 }}
        className="flex flex-wrap gap-1.5 sm:gap-2"
      >
        {secondaryStats.map((stat) => (
          <div
            key={stat.label}
            className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border/50 bg-white/[0.03] text-sm"
          >
            <stat.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" style={{ color: stat.color }} />
            <span className="font-semibold text-[11px] sm:text-xs">{stat.value}</span>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground/50 hidden sm:inline">{stat.label}</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
