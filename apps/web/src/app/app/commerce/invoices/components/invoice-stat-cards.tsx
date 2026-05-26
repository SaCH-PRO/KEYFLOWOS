"use client";

import { useMemo } from "react";
import { FileText, Clock, AlertCircle, CheckCircle, TrendingUp } from "lucide-react";
import { Invoice } from "@/lib/client";
import { formatAmount } from "../../utils/commerce-utils";

interface InvoiceStatCardsProps {
  invoices: Invoice[];
  currency: string;
  onFilterClick?: (filter: string) => void;
}

export function InvoiceStatCards({ invoices, currency, onFilterClick }: InvoiceStatCardsProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let unpaidTotal = 0;
    let unpaidCount = 0;
    let overdueTotal = 0;
    let overdueCount = 0;
    let paidMonthTotal = 0;
    let paidMonthCount = 0;
    let draftsTotal = 0;
    let draftsCount = 0;

    for (const inv of invoices) {
      const total = Number(inv.total);
      const paidAmount = (inv.payments ?? [])
        .filter((p) => p.status === "SUCCESSFUL")
        .reduce((sum, p) => sum + p.amount, 0);
      const remaining = Math.max(0, total - paidAmount);

      if (inv.status === "DRAFT") {
        draftsTotal += total;
        draftsCount++;
      } else if (inv.status === "PAID") {
        if (inv.paidAt && new Date(inv.paidAt) >= startOfMonth) {
          paidMonthTotal += total;
          paidMonthCount++;
        }
      } else if (inv.status === "OVERDUE") {
        overdueTotal += remaining;
        overdueCount++;
      } else if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
        unpaidTotal += remaining;
        unpaidCount++;
      }
    }

    return {
      unpaid: { total: unpaidTotal, count: unpaidCount },
      overdue: { total: overdueTotal, count: overdueCount },
      paidThisMonth: { total: paidMonthTotal, count: paidMonthCount },
      drafts: { total: draftsTotal, count: draftsCount },
    };
  }, [invoices]);

  const cards = [
    {
      key: "unpaid",
      label: "Unpaid",
      value: formatAmount(stats.unpaid.total, currency),
      count: stats.unpaid.count,
      icon: Clock,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      hoverBorder: "hover:border-amber-500/40",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: formatAmount(stats.overdue.total, currency),
      count: stats.overdue.count,
      icon: AlertCircle,
      color: "text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
      hoverBorder: "hover:border-red-500/40",
    },
    {
      key: "paid",
      label: "Paid this month",
      value: formatAmount(stats.paidThisMonth.total, currency),
      count: stats.paidThisMonth.count,
      icon: CheckCircle,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      hoverBorder: "hover:border-emerald-500/40",
    },
    {
      key: "drafts",
      label: "Drafts",
      value: formatAmount(stats.drafts.total, currency),
      count: stats.drafts.count,
      icon: FileText,
      color: "text-slate-400",
      bgColor: "bg-slate-500/10",
      borderColor: "border-slate-500/20",
      hoverBorder: "hover:border-slate-500/40",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <button
          key={card.key}
          onClick={() => onFilterClick?.(card.key === "paid" ? "PAID" : card.key === "unpaid" ? "SENT" : card.key.toUpperCase())}
          className={`text-left rounded-xl border ${card.borderColor} ${card.hoverBorder} ${card.bgColor} p-4 transition-all hover:scale-[1.02]`}
        >
          <div className="flex items-center gap-2 mb-2">
            <card.icon className={`w-4 h-4 ${card.color}`} />
            <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
          </div>
          <p className="text-xl font-bold tracking-tight">{card.value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {card.count} invoice{card.count !== 1 ? "s" : ""}
          </p>
        </button>
      ))}
    </div>
  );
}
