"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, DollarSign, Wallet, Clock,
  ArrowUpRight, ArrowDownRight, ShieldAlert, Briefcase, Users,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import type { FinancialGrowthData } from "@/lib/client";
import { formatTTD, RECHARTS_TOOLTIP_STYLE, stagger } from "./insights-shared";

export const FinancialKPIs = React.memo(function FinancialKPIs({
  data,
}: {
  data: FinancialGrowthData;
}) {
  const growthPositive = data.revenueGrowthPct >= 0;
  const collectionHealthy = data.collectionRate >= 80;

  const kpis = [
    {
      label: "Revenue Collected",
      value: formatTTD(data.totalCollected),
      sub: "Last 6 months",
      icon: Wallet,
      accentVar: "--kf-accent1",
      trend: growthPositive ? "up" as const : "down" as const,
      trendLabel: `${growthPositive ? "+" : ""}${data.revenueGrowthPct}% MoM`,
    },
    {
      label: "Collection Rate",
      value: `${data.collectionRate}%`,
      sub: `${formatTTD(data.totalCollected)} of ${formatTTD(data.totalInvoiced)}`,
      icon: TrendingUp,
      accentVar: collectionHealthy ? "--kf-accent1" : "--kf-accent2",
      trend: collectionHealthy ? "up" as const : "down" as const,
      trendLabel: collectionHealthy ? "Healthy" : "Needs attention",
    },
    {
      label: "Avg. Client Value",
      value: formatTTD(data.avgClientValue),
      sub: `${data.clientCount} active client${data.clientCount !== 1 ? "s" : ""}`,
      icon: Users,
      accentVar: "--kf-accent2",
      trend: null,
      trendLabel: undefined,
    },
    {
      label: "Avg. Days to Pay",
      value: `${data.avgDaysToPayment}d`,
      sub: data.avgDaysToPayment <= 14 ? "Fast collection" : data.avgDaysToPayment <= 30 ? "Average pace" : "Slow — follow up",
      icon: Clock,
      accentVar: data.avgDaysToPayment <= 14 ? "--kf-accent1" : "--kf-accent2",
      trend: data.avgDaysToPayment <= 14 ? "up" as const : data.avgDaysToPayment > 30 ? "down" as const : null,
      trendLabel: data.avgDaysToPayment <= 14 ? "Excellent" : data.avgDaysToPayment > 30 ? "Slow" : undefined,
    },
  ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-4 gap-1.5 sm:gap-2.5"
      role="img"
      aria-label={`Financial KPIs: ${formatTTD(data.totalCollected)} collected, ${data.collectionRate}% collection rate, ${formatTTD(data.avgClientValue)} avg client value, ${data.avgDaysToPayment} days to pay`}
    >
      {kpis.map((s) => {
        const Icon = s.icon;
        return (
          <motion.div
            key={s.label}
            variants={stagger.item}
            className="relative overflow-hidden rounded-xl border border-border/50 bg-card p-2 sm:p-3 group"
          >
            <div
              className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.04] -translate-y-1/2 translate-x-1/2 blur-xl"
              style={{ background: `hsl(var(${s.accentVar}))` }}
              aria-hidden="true"
            />
            <div className="flex items-center gap-1 mb-1 sm:mb-1.5">
              <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider leading-tight truncate">{s.label}</span>
            </div>
            <div className="text-sm sm:text-xl font-bold tracking-tight leading-tight" style={{ color: `hsl(var(${s.accentVar}))` }}>
              {s.value}
            </div>
            <div className="hidden sm:flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground/50">{s.sub}</span>
            </div>
            {s.trend && s.trendLabel && (
              <div className={`items-center gap-0.5 mt-1 text-[10px] font-semibold hidden sm:flex ${s.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                {s.trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {s.trendLabel}
              </div>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
});

export const RevenueVelocity = React.memo(function RevenueVelocity({
  data,
}: {
  data: FinancialGrowthData;
}) {
  const chartData = data.monthlyRevenue;
  const hasData = chartData.some((d) => d.collected > 0 || d.invoiced > 0);

  if (!hasData) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          Revenue Velocity
        </h3>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-border/30 flex items-center justify-center mb-2">
            <DollarSign className="w-4 h-4 text-muted-foreground/50" />
          </div>
          <p className="text-[10px] text-muted-foreground/50 max-w-[180px] leading-relaxed">Revenue data appears when you create invoices</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          Revenue Velocity
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Collected</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400/60 inline-block" />Invoiced</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="collectedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="invoicedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.5, fontSize: 10 }}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
            formatter={((value: number) => [formatTTD(value), '']) as never}
            labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 11, marginBottom: 4 }}
          />
          <Area type="monotone" dataKey="invoiced" stroke="#f59e0b" strokeWidth={1.5} fill="url(#invoicedGrad)" strokeOpacity={0.6} dot={false} />
          <Area type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} fill="url(#collectedGrad)" dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }} activeDot={{ r: 4, fill: '#10b981' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

export const CashFlowHealth = React.memo(function CashFlowHealth({
  data,
}: {
  data: FinancialGrowthData;
}) {
  const uncollected = data.totalInvoiced - data.totalCollected;
  const collectionRate = data.collectionRate;

  const circumference = 2 * Math.PI * 36;
  const dashLength = (collectionRate / 100) * circumference;
  const color = collectionRate >= 80 ? "hsl(142 76% 36%)" : collectionRate >= 60 ? "hsl(var(--kf-accent2))" : "hsl(0 84% 60%)";

  const growthIcon = data.revenueGrowthPct >= 0 ? TrendingUp : TrendingDown;
  const GrowthIcon = growthIcon;

  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5" />
        Cash Flow Health
      </h3>
      <div className="flex items-center gap-5">
        <div className="relative w-[88px] h-[88px] shrink-0">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="36" fill="none" strokeWidth="5" className="stroke-white/[0.04]" />
            <motion.circle
              cx="40" cy="40" r="36" fill="none" strokeWidth="5"
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${dashLength} ${circumference - dashLength}` }}
              transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
              strokeLinecap="round"
              style={{ stroke: color }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold" style={{ color }}>{collectionRate}%</span>
            <span className="text-[10px] text-muted-foreground/50">collected</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60">Collected</span>
            <span className="text-[11px] font-bold text-emerald-400">{formatTTD(data.totalCollected)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60">Outstanding</span>
            <span className="text-[11px] font-bold text-amber-400">{formatTTD(uncollected)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-border/20">
            <span className="text-[11px] text-muted-foreground/60">MoM Growth</span>
            <span className={`text-[11px] font-bold flex items-center gap-0.5 ${data.revenueGrowthPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              <GrowthIcon className="w-3 h-3" />
              {data.revenueGrowthPct >= 0 ? "+" : ""}{data.revenueGrowthPct}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

export const RevenueAtRisk = React.memo(function RevenueAtRisk({
  data,
  revenueData,
  onViewExpiringQuotes,
  onViewOverdueInvoices,
}: {
  data: FinancialGrowthData;
  revenueData: { overdueInvoices: { count: number; value: number }; expiringQuotes: { count: number; value: number } } | null;
  onViewExpiringQuotes: () => void;
  onViewOverdueInvoices: () => void;
}) {
  const overdueValue = revenueData?.overdueInvoices.value ?? 0;
  const expiringValue = revenueData?.expiringQuotes.value ?? 0;
  const totalAtRisk = data.revenueAtRisk;
  const hasSegmentData = overdueValue > 0 || expiringValue > 0;

  if (totalAtRisk === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5" />
          Revenue at Risk
        </h3>
        <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04]">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
            <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div>
            <span className="text-xs text-emerald-400 font-semibold">No revenue at risk</span>
            <p className="text-[10px] text-emerald-400/50">All invoices and quotes are on track</p>
          </div>
        </div>
      </div>
    );
  }

  const segments = [
    { label: "Overdue Invoices", value: overdueValue, count: revenueData?.overdueInvoices.count ?? 0, color: "#ef4444", onClick: onViewOverdueInvoices },
    { label: "Expiring Quotes", value: expiringValue, count: revenueData?.expiringQuotes.count ?? 0, color: "#f59e0b", onClick: onViewExpiringQuotes },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-red-400/60" />
          Revenue at Risk
        </h3>
        <span className="text-sm font-bold text-red-400">{formatTTD(totalAtRisk)}</span>
      </div>
      {hasSegmentData ? (
        <>
          <div className="w-full h-2 rounded-full bg-white/[0.03] overflow-hidden flex">
            {segments.map((s) => {
              const pct = totalAtRisk > 0 ? (s.value / totalAtRisk) * 100 : 0;
              return (
                <motion.div
                  key={s.label}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6 }}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ background: s.color }}
                />
              );
            })}
          </div>
          <div className="space-y-1.5">
            {segments.map((s) => (
              <button
                key={s.label}
                onClick={s.onClick}
                className="flex items-center justify-between w-full p-2 rounded-lg border border-border/30 bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-[11px] text-muted-foreground/60">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground/40 font-mono">({s.count})</span>
                </div>
                <span className="text-[11px] font-bold" style={{ color: s.color }}>{formatTTD(s.value)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[10px] text-red-400/50">Overdue invoices or expiring quotes detected</p>
      )}
    </div>
  );
});

const SERVICE_COLORS = ['#f97316', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

export const TopServicesRevenue = React.memo(function TopServicesRevenue({
  data,
}: {
  data: FinancialGrowthData;
}) {
  const services = data.topServices;

  if (services.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <Briefcase className="w-3.5 h-3.5" />
          Top Services
        </h3>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-border/30 flex items-center justify-center mb-2">
            <Briefcase className="w-4 h-4 text-muted-foreground/50" />
          </div>
          <p className="text-[10px] text-muted-foreground/50 max-w-[180px] leading-relaxed">Service revenue appears with bookings</p>
        </div>
      </div>
    );
  }

  const maxRevenue = Math.max(...services.map((s) => s.revenue), 1);

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Briefcase className="w-3.5 h-3.5" />
        Top Services
      </h3>
      <ResponsiveContainer width="100%" height={services.length * 34 + 10}>
        <BarChart
          data={services}
          layout="vertical"
          margin={{ top: 0, right: 4, bottom: 0, left: 4 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            axisLine={false}
            tickLine={false}
            width={80}
            tick={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.6, fontSize: 10 }}
          />
          <Tooltip
            contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
            formatter={((value: number, _: string, entry: { payload: { bookings: number } }) => [
              `${formatTTD(value)} (${entry.payload.bookings} bookings)`, 'Revenue',
            ]) as never}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} animationDuration={800}>
            {services.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={SERVICE_COLORS[index % SERVICE_COLORS.length]} fillOpacity={0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
