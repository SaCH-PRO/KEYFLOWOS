"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Clock, DollarSign } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { Contact } from "@/lib/client";
import { formatTTD, RECHARTS_TOOLTIP_STYLE } from "./insights-shared";

const REVENUE_COLORS = ['#f97316', '#10b981', '#64748b'];

export const RevenueBreakdown = React.memo(function RevenueBreakdown({ data }: { data: RevenueData }) {
  const total = data.fromActivePipeline + data.fromRecurringClients + data.fromColdLeads;
  const pieData = [
    { name: "Active Pipeline", value: data.fromActivePipeline },
    { name: "Recurring", value: data.fromRecurringClients },
    { name: "Cold (if won)", value: data.fromColdLeads },
  ].filter((d) => d.value > 0);

  const sources = [
    { label: "Active", value: data.fromActivePipeline, color: REVENUE_COLORS[0] },
    { label: "Recurring", value: data.fromRecurringClients, color: REVENUE_COLORS[1] },
    { label: "Cold", value: data.fromColdLeads, color: REVENUE_COLORS[2] },
  ];

  return (
    <div className="space-y-2" role="img" aria-label={`Revenue forecast: ${formatTTD(total)} total. ${formatTTD(data.fromActivePipeline)} from active pipeline, ${formatTTD(data.fromRecurringClients)} from recurring clients, ${formatTTD(data.fromColdLeads)} from cold leads`}>
      <span className="sr-only">
        Revenue forecast totals {formatTTD(total)}, with {formatTTD(data.fromActivePipeline)} from active pipeline, {formatTTD(data.fromRecurringClients)} from recurring clients, and {formatTTD(data.fromColdLeads)} from cold leads.
        {data.expiringQuotes.count > 0 ? ` ${data.expiringQuotes.count} expiring quotes.` : ""}
        {data.overdueInvoices.count > 0 ? ` ${data.overdueInvoices.count} overdue invoices.` : ""}
      </span>
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          Revenue Forecast
        </h3>
        <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>{formatTTD(total)}</span>
      </div>

      {pieData.length > 0 ? (
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <ResponsiveContainer width={100} height={100}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={46}
                  dataKey="value"
                  paddingAngle={2}
                  animationDuration={800}
                  strokeWidth={0}
                >
                  {pieData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={REVENUE_COLORS[index % REVENUE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
                  formatter={((value: number | undefined, name: string | undefined) => [formatTTD(value ?? 0), name ?? '']) as never}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            {sources.filter((s) => s.value > 0).map((s) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[11px] text-muted-foreground/60 truncate">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-semibold">{formatTTD(s.value)}</span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono w-6 text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-16 text-[10px] text-muted-foreground/50">No revenue data</div>
      )}

      {(data.expiringQuotes.count > 0 || data.overdueInvoices.count > 0) && (
        <div className="flex gap-1.5 pt-2 border-t border-border/20">
          {data.expiringQuotes.count > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-amber-400 px-2 py-1 rounded-md bg-amber-500/[0.05] border border-amber-500/10">
              <Clock className="w-3.5 h-3.5" />
              {data.expiringQuotes.count} expiring
            </div>
          )}
          {data.overdueInvoices.count > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-red-400 px-2 py-1 rounded-md bg-red-500/[0.05] border border-red-500/10">
              <DollarSign className="w-3.5 h-3.5" />
              {data.overdueInvoices.count} overdue
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const RevenueByClient = React.memo(function RevenueByClient({ contacts, onNavigatePipeline }: { contacts: Contact[]; onNavigatePipeline?: (filter?: { status?: string }) => void }) {
  const ranked = useMemo(() => {
    return contacts
      .filter((c) => c.meta?.totalRevenue && c.meta.totalRevenue > 0)
      .sort((a, b) => (b.meta?.totalRevenue ?? 0) - (a.meta?.totalRevenue ?? 0))
      .slice(0, 10);
  }, [contacts]);

  if (ranked.length === 0) return null;

  const maxRevenue = ranked[0]?.meta?.totalRevenue ?? 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5" />
          Revenue by Client
        </h3>
        <span className="text-[10px] text-muted-foreground/50">Top {ranked.length}</span>
      </div>
      <div className="space-y-1">
        {ranked.map((c, i) => {
          const revenue = c.meta?.totalRevenue ?? 0;
          const pct = (revenue / maxRevenue) * 100;
          const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
          return (
            <button
              key={c.id}
              onClick={() => onNavigatePipeline?.({ status: "CLIENT" })}
              className="w-full text-left group hover:bg-white/[0.02] rounded-md p-1 -mx-1 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground/50 w-4 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] font-medium text-foreground/70 truncate">{name}</span>
                    <span className="text-[11px] font-bold text-emerald-400 ml-1.5 shrink-0">{formatTTD(revenue)}</span>
                  </div>
                  <div className="h-0.5 bg-white/[0.03] rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, delay: i * 0.04 }}
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500/40 to-emerald-400" />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});
