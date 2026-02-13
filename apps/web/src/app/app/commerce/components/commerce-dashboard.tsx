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
  CreditCard,
} from "lucide-react";
import { Invoice, Quote, Product } from "@/lib/client";

interface CommerceDashboardProps {
  invoices: Invoice[];
  quotes: Quote[];
  products: Product[];
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function CommerceDashboard({ invoices, quotes, products }: CommerceDashboardProps) {
  const stats = useMemo(() => {
    const totalRevenue = invoices
      .filter((inv) => inv.status === "PAID")
      .reduce((sum, inv) => sum + Number(inv.total), 0);

    const outstanding = invoices
      .filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE")
      .reduce((sum, inv) => sum + Number(inv.total), 0);

    const overdueCount = invoices.filter((inv) => inv.status === "OVERDUE").length;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const paidThisMonth = invoices.filter((inv) => {
      if (inv.status !== "PAID") return false;
      const dateStr = inv.paidAt || inv.issueDate;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    const activeQuotes = quotes.filter(
      (q) => q.status === "DRAFT" || q.status === "SENT"
    ).length;

    const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
    const conversionRate = quotes.length > 0
      ? Math.round((acceptedQuotes / quotes.length) * 100)
      : 0;

    return {
      totalRevenue,
      outstanding,
      overdueCount,
      paidThisMonth,
      totalProducts: products.length,
      activeQuotes,
      conversionRate,
    };
  }, [invoices, quotes, products]);

  const kpiCards = [
    {
      label: "Total Revenue",
      value: `$${stats.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      sublabel: "TTD",
      icon: DollarSign,
      gradient: "from-emerald-500 to-green-600",
      indicator: "bg-emerald-500/60",
    },
    {
      label: "Outstanding",
      value: `$${stats.outstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      sublabel: "TTD",
      icon: Clock,
      gradient: "from-amber-500 to-orange-600",
      indicator: "bg-amber-500/60",
    },
    {
      label: "Overdue",
      value: `${stats.overdueCount} overdue`,
      sublabel: "",
      icon: AlertTriangle,
      gradient: "from-red-500 to-rose-600",
      indicator: stats.overdueCount > 0 ? "bg-red-500/60" : "bg-slate-500/40",
    },
    {
      label: "Paid This Month",
      value: String(stats.paidThisMonth),
      sublabel: "invoices",
      icon: CheckCircle,
      gradient: "from-emerald-500 to-teal-600",
      indicator: "bg-emerald-500/60",
    },
  ];

  return (
    <div className="space-y-4">
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
            className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-5 flex items-start gap-4"
          >
            <div
              className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shrink-0`}
            >
              <card.icon className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                {card.label}
              </p>
              <p className="text-2xl font-bold truncate">{card.value}</p>
              {card.sublabel && (
                <p className="text-xs text-muted-foreground mt-0.5">{card.sublabel}</p>
              )}
            </div>
            <div className={`w-2 h-2 rounded-full ${card.indicator} mt-1 ml-auto shrink-0`} />
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="flex flex-wrap gap-3"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card/60 border border-border/40 text-sm">
          <Package className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{stats.totalProducts}</span>
          <span className="text-muted-foreground">products</span>
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card/60 border border-border/40 text-sm">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{stats.activeQuotes}</span>
          <span className="text-muted-foreground">active quotes</span>
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card/60 border border-border/40 text-sm">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{stats.conversionRate}%</span>
          <span className="text-muted-foreground">conversion</span>
        </div>
      </motion.div>
    </div>
  );
}
