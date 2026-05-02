"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  DollarSign,
  RefreshCw,
  Users,
  FileText,
  ArrowUp,
  Clock,
} from "lucide-react";

export interface RevenueData {
  fromActivePipeline: number;
  fromRecurringClients: number;
  fromColdLeads: number;
  expiringQuotes: { count: number; value: number };
  overdueInvoices: { count: number; value: number };
}

interface PredictiveRevenueProps {
  data: RevenueData;
  period?: string;
  onViewExpiringQuotes?: () => void;
  onViewOverdueInvoices?: () => void;
}

export function PredictiveRevenue({
  data,
  period = "Next 30 Days",
  onViewExpiringQuotes,
  onViewOverdueInvoices,
}: PredictiveRevenueProps) {
  const total = useMemo(() => {
    return data.fromActivePipeline + data.fromRecurringClients + data.fromColdLeads;
  }, [data]);

  const sources = [
    {
      label: "Active Pipeline",
      value: data.fromActivePipeline,
      icon: FileText,
      color: "hsl(var(--kf-accent1))",
      confidence: "high",
    },
    {
      label: "Recurring Clients",
      value: data.fromRecurringClients,
      icon: RefreshCw,
      color: "hsl(142 76% 36%)",
      confidence: "very high",
    },
    {
      label: "Cold Leads (if won)",
      value: data.fromColdLeads,
      icon: Users,
      color: "hsl(var(--kf-muted-foreground))",
      confidence: "low",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[hsl(var(--kf-accent2))]" />
          Projected Revenue
        </h2>
        <span className="text-xs text-muted-foreground">{period}</span>
      </div>

      <div className="space-y-3">
        {sources.map((source, index) => {
          const Icon = source.icon;
          const percentage = total > 0 ? (source.value / total) * 100 : 0;

          return (
            <motion.div
              key={source.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" style={{ color: source.color }} />
                  <span>{source.label}</span>
                </div>
                <span className="font-medium">TTD {source.value.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.8, delay: index * 0.1 }}
                  className="h-full rounded-full"
                  style={{ background: source.color }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className="text-sm font-medium">TOTAL POTENTIAL</span>
        <span className="text-2xl font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
          TTD {total.toLocaleString()}
        </span>
      </div>

      {(data.expiringQuotes.count > 0 || data.overdueInvoices.count > 0) && (
        <div className="space-y-2">
          {data.expiringQuotes.count > 0 && (
            <button
              onClick={onViewExpiringQuotes}
              className="w-full flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left"
            >
              <Clock className="w-4 h-4 text-amber-500" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {data.expiringQuotes.count} quotes expiring this week
                </p>
                <p className="text-xs text-muted-foreground">
                  Follow up to secure TTD {data.expiringQuotes.value.toLocaleString()}
                </p>
              </div>
              <ArrowUp className="w-4 h-4 text-amber-500" />
            </button>
          )}

          {data.overdueInvoices.count > 0 && (
            <button
              onClick={onViewOverdueInvoices}
              className="w-full flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors text-left"
            >
              <DollarSign className="w-4 h-4 text-red-400" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {data.overdueInvoices.count} overdue invoices
                </p>
                <p className="text-xs text-muted-foreground">
                  TTD {data.overdueInvoices.value.toLocaleString()} outstanding
                </p>
              </div>
              <ArrowUp className="w-4 h-4 text-red-400" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
