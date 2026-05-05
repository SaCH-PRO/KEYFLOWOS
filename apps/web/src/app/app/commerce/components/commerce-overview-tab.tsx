"use client";

import React, { useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  DollarSign,
  Clock,
  AlertTriangle,
  FileText,
  CreditCard,
  RefreshCw,
  ArrowRight,
  Sparkles,
  Users,
  Package,
  ArrowUpRight,
  Zap,
  Repeat,
  Percent,
  TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchCommerceStats,
  fetchRecurringInvoices,
  fetchRevenueOverview,
  type CommerceStats,
  type Invoice,
  type Quote,
  type RecurringInvoice,
  type RevenueOverview,
} from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { openKey } from "@/components/key/key-agent";
import { RevenueIntelligenceSection } from "./revenue-intelligence-section";
import { ChurnRiskPanel } from "./churn-risk-panel";

interface CommerceOverviewTabProps {
  businessId: string | null;
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
  loading: boolean;
  onNavigate: (tab: string, segment?: string) => void;
  onNewItem: () => void;
}

const stagger = {
  container: {
    hidden: {},
    visible: { transition: { staggerChildren: 0.04 } },
  },
  item: {
    hidden: { opacity: 0, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
    },
  },
};

function OverviewSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading overview">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-3">
            <Skeleton className="h-3 w-14 mb-2" />
            <Skeleton className="h-6 w-20 mb-1" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

function getDaysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  return Math.max(0, Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}

function getDaysUntilExpiry(expiryDate: string | null | undefined): number {
  if (!expiryDate) return 999;
  const exp = new Date(expiryDate);
  const now = new Date();
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getContactName(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!contact) return "Unknown";
  return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
}

export function CommerceOverviewTab({
  businessId,
  invoices,
  quotes,
  currency,
  loading,
  onNavigate,
  onNewItem,
}: CommerceOverviewTabProps) {
  const [stats, setStats] = useState<CommerceStats | null>(null);
  const [recurring, setRecurring] = useState<RecurringInvoice[]>([]);
  const [revenueOverview, setRevenueOverview] = useState<RevenueOverview | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchCommerceStats(businessId).then((res) => {
      if (!cancelled && res.data) setStats(res.data);
    });
    fetchRecurringInvoices(businessId).then((res) => {
      if (!cancelled && res.data) setRecurring(res.data);
    });
    fetchRevenueOverview(businessId).then((res) => {
      if (!cancelled && res.data) setRevenueOverview(res.data);
    });
    return () => { cancelled = true; };
  }, [businessId, invoices.length, quotes.length]);

  const localStats = useMemo(() => {
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const outstandingInvoices = invoices.filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE");
    const outstanding = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
    const conversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;
    return { totalRevenue, outstanding, overdueAmount, overdueCount: overdueInvoices.length, conversionRate };
  }, [invoices, quotes]);

  const kpi = useMemo(() => {
    if (stats) {
      return {
        collected: stats.totalRevenue,
        outstanding: stats.outstandingAmount,
        overdue: stats.overdueAmount,
        overdueCount: stats.invoiceStatusBreakdown?.OVERDUE?.count ?? 0,
        conversionRate: stats.quoteConversionRate,
      };
    }
    return {
      collected: localStats.totalRevenue,
      outstanding: localStats.outstanding,
      overdue: localStats.overdueAmount,
      overdueCount: localStats.overdueCount,
      conversionRate: localStats.conversionRate,
    };
  }, [stats, localStats]);

  const priorityItems = useMemo(() => {
    const items: { id: string; type: string; icon: React.ElementType; color: string; bgColor: string; title: string; subtitle: string; amount?: number; urgency: number }[] = [];

    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
    overdueInvoices.forEach((inv) => {
      const days = getDaysOverdue(inv.dueDate);
      items.push({
        id: inv.id,
        type: "overdue",
        icon: AlertTriangle,
        color: "text-red-400",
        bgColor: "bg-red-500/10",
        title: `${inv.invoiceNumber ?? "Invoice"} — ${getContactName(inv.contact)}`,
        subtitle: `${days}d overdue`,
        amount: Number(inv.total),
        urgency: 100 + days,
      });
    });

    const pendingInvoices = invoices.filter((inv) => inv.status === "SENT");
    pendingInvoices.forEach((inv) => {
      items.push({
        id: inv.id,
        type: "pending",
        icon: Clock,
        color: "text-amber-400",
        bgColor: "bg-amber-500/10",
        title: `${inv.invoiceNumber ?? "Invoice"} — ${getContactName(inv.contact)}`,
        subtitle: "Awaiting payment",
        amount: Number(inv.total),
        urgency: 50,
      });
    });

    const expiringQuotes = quotes.filter((q) => {
      if (q.status !== "SENT" && q.status !== "DRAFT") return false;
      const days = getDaysUntilExpiry(q.expiryDate);
      return days >= 0 && days <= 7;
    });
    expiringQuotes.forEach((q) => {
      const days = getDaysUntilExpiry(q.expiryDate);
      items.push({
        id: q.id,
        type: "expiring",
        icon: FileText,
        color: "text-purple-400",
        bgColor: "bg-purple-500/10",
        title: `${q.quoteNumber ?? "Quote"} — ${getContactName(q.contact)}`,
        subtitle: days <= 0 ? "Expired" : `Expires in ${days}d`,
        amount: Number(q.total),
        urgency: 80 - days,
      });
    });

    const upcomingRecurring = recurring.filter((r) => {
      if (!r.isActive || !r.nextRunDate) return false;
      const daysUntil = getDaysUntilExpiry(r.nextRunDate);
      return daysUntil >= 0 && daysUntil <= 14;
    });
    upcomingRecurring.forEach((r) => {
      const days = getDaysUntilExpiry(r.nextRunDate);
      const contactName = r.contact ? `${r.contact.firstName ?? ""} ${r.contact.lastName ?? ""}`.trim() : "Unknown";
      items.push({
        id: r.id,
        type: "recurring",
        icon: RefreshCw,
        color: "text-blue-400",
        bgColor: "bg-blue-500/10",
        title: `${r.name} — ${contactName}`,
        subtitle: days === 0 ? "Runs today" : `Runs in ${days}d`,
        amount: r.subtotal,
        urgency: 40 + (14 - days),
      });
    });

    return items.sort((a, b) => b.urgency - a.urgency).slice(0, 8);
  }, [invoices, quotes, recurring]);

  const revenueFeed = useMemo(() => {
    const topCustomers: { name: string; revenue: number; count: number }[] = [];
    const customerMap = new Map<string, { name: string; revenue: number; count: number }>();
    invoices.filter((inv) => inv.status === "PAID").forEach((inv) => {
      const name = getContactName(inv.contact);
      const existing = customerMap.get(name) ?? { name, revenue: 0, count: 0 };
      existing.revenue += Number(inv.total);
      existing.count++;
      customerMap.set(name, existing);
    });
    customerMap.forEach((v) => topCustomers.push(v));
    topCustomers.sort((a, b) => b.revenue - a.revenue);

    const recentPaid = invoices
      .filter((inv) => inv.status === "PAID")
      .sort((a, b) => new Date(b.paidAt ?? b.issueDate ?? "").getTime() - new Date(a.paidAt ?? a.issueDate ?? "").getTime())
      .slice(0, 5);

    const convertedQuotes = quotes
      .filter((q) => q.status === "ACCEPTED")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return { topCustomers: topCustomers.slice(0, 5), topProducts: stats?.topProducts?.slice(0, 5) ?? [], recentPaid, convertedQuotes };
  }, [invoices, quotes, stats]);

  const suggestedActions = useMemo(() => {
    const actions: { id: string; icon: React.ElementType; color: string; label: string; description: string; action: () => void }[] = [];

    if (kpi.overdueCount > 0) {
      actions.push({
        id: "overdue",
        icon: AlertTriangle,
        color: "text-red-400",
        label: "Collect overdue payments",
        description: `${kpi.overdueCount} invoices totaling ${formatCurrencyCompact(kpi.overdue, currency)}`,
        action: () => onNavigate("billing", "invoices"),
      });
    }

    const draftInvoices = invoices.filter((inv) => inv.status === "DRAFT");
    if (draftInvoices.length > 0) {
      actions.push({
        id: "send-drafts",
        icon: CreditCard,
        color: "text-blue-400",
        label: "Send draft invoices",
        description: `${draftInvoices.length} draft${draftInvoices.length > 1 ? "s" : ""} ready to send`,
        action: () => onNavigate("billing", "invoices"),
      });
    }

    const pendingQuotes = quotes.filter((q) => q.status === "SENT");
    if (pendingQuotes.length > 0) {
      actions.push({
        id: "follow-quotes",
        icon: FileText,
        color: "text-purple-400",
        label: "Follow up on quotes",
        description: `${pendingQuotes.length} quote${pendingQuotes.length > 1 ? "s" : ""} awaiting response`,
        action: () => onNavigate("billing", "quotes"),
      });
    }

    if (actions.length === 0) {
      actions.push({
        id: "new-invoice",
        icon: Zap,
        color: "text-emerald-400",
        label: "Create your next invoice",
        description: "Start billing for new work",
        action: onNewItem,
      });
    }

    return actions;
  }, [kpi, invoices, quotes, currency, onNavigate, onNewItem]);

  if (loading && !stats) return <OverviewSkeleton />;

  const rk = revenueOverview?.kpis;
  // Build deep-link query for the matching Revenue Reports preset.
  // We pre-apply the current month so the report opens with the same period
  // operators see in the Overview KPIs.
  const reportHref = (preset: string) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = now.toISOString();
    const qs = new URLSearchParams({ tab: "revenue-detail", rev: preset, startDate: start, endDate: end });
    return `/app/reports?${qs.toString()}`;
  };
  const kpiCards = rk
    ? [
        {
          icon: DollarSign,
          label: "Collected this month",
          value: formatCurrencyCompact(rk.collectedThisMonth, currency),
          color: "#10b981",
          href: reportHref("collected-vs-expected"),
        },
        {
          icon: Clock,
          label: "Outstanding",
          value: formatCurrencyCompact(rk.outstanding, currency),
          color: "#f59e0b",
          href: reportHref("aging-buckets"),
        },
        {
          icon: AlertTriangle,
          label: "Overdue",
          value: rk.overdueCount > 0 ? formatCurrencyCompact(rk.overdue, currency) : "—",
          color: rk.overdueCount > 0 ? "#ef4444" : "#6b7280",
          href: reportHref("aging-buckets"),
        },
        {
          icon: FileText,
          label: "Quote pipeline",
          value: formatCurrencyCompact(rk.quotePipeline, currency),
          color: "#a855f7",
          href: reportHref("quote-conversion"),
        },
        {
          icon: Repeat,
          label: "Recurring expected",
          value: formatCurrencyCompact(rk.recurringExpected, currency),
          color: "#6366f1",
          href: reportHref("recurring-expected"),
        },
        {
          icon: Percent,
          label: "Cash collection rate",
          value: `${Math.round(rk.cashCollectionRate * 100)}%`,
          color: "hsl(142 76% 36%)",
          href: reportHref("days-to-pay"),
        },
      ]
    : [
        {
          icon: DollarSign,
          label: "Collected this month",
          value: formatCurrencyCompact(kpi.collected, currency),
          color: "#10b981",
          href: reportHref("collected-vs-expected"),
        },
        {
          icon: Clock,
          label: "Outstanding",
          value: formatCurrencyCompact(kpi.outstanding, currency),
          color: "#f59e0b",
          href: reportHref("aging-buckets"),
        },
        {
          icon: AlertTriangle,
          label: "Overdue",
          value: kpi.overdueCount > 0 ? formatCurrencyCompact(kpi.overdue, currency) : "—",
          color: kpi.overdueCount > 0 ? "#ef4444" : "#6b7280",
          href: reportHref("aging-buckets"),
        },
        {
          icon: FileText,
          label: "Quote pipeline",
          value: "—",
          color: "#a855f7",
          href: reportHref("quote-conversion"),
        },
        {
          icon: Repeat,
          label: "Recurring expected",
          value: "—",
          color: "#6366f1",
          href: reportHref("recurring-expected"),
        },
        {
          icon: Percent,
          label: "Cash collection rate",
          value: "—",
          color: "hsl(142 76% 36%)",
          href: reportHref("days-to-pay"),
        },
      ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <motion.div variants={stagger.item} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpiCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            title="View detailed reports"
            className="block rounded-xl border border-border/50 bg-card p-3 hover:border-[hsl(var(--kf-accent1))]/50 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <card.icon className="w-3.5 h-3.5 shrink-0" style={{ color: card.color }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {card.label}
              </span>
            </div>
            <div className="text-lg font-bold tracking-tight" style={{ color: card.color }}>
              {card.value}
            </div>
          </Link>
        ))}
      </motion.div>

      <div className="flex justify-end">
        <Link
          href={reportHref("by-source")}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--kf-accent1))] hover:underline"
        >
          View detailed reports →
        </Link>
      </div>

      <motion.div variants={stagger.item}>
        <RevenueIntelligenceSection businessId={businessId} currency={currency} />
      </motion.div>

      {revenueOverview && (
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Revenue Pulse
                </h3>
                <p className="text-[10px] text-muted-foreground/50">Last 12 weeks · billed vs. collected</p>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground/60">Cash collection</div>
                <div className="text-sm font-bold text-emerald-400">
                  {Math.round(revenueOverview.kpis.cashCollectionRate * 100)}%
                </div>
              </div>
            </div>
            <div className="h-32 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueOverview.pulse} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pulseCollected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="pulseBilled" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="weekStart" hide />
                  <YAxis hide />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(value, name) => [formatCurrencyCompact(Number(value ?? 0), currency), name === "collected" ? "Collected" : name === "billed" ? "Billed" : "Outstanding"] as [string, string]}
                    labelFormatter={(l) => `Week of ${l}`}
                  />
                  <Area type="monotone" dataKey="billed" stroke="#6366f1" strokeWidth={1.5} fill="url(#pulseBilled)" />
                  <Area type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={1.5} fill="url(#pulseCollected)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500/70" />
                <span className="text-muted-foreground/60">Billed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500/70" />
                <span className="text-muted-foreground/60">Collected</span>
              </div>
              <div className="text-right text-muted-foreground/60">
                Quote pipeline {formatCurrencyCompact(revenueOverview.kpis.quotePipeline, currency)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Top Revenue Actions
              </h3>
              <button
                onClick={() => onNavigate("actions")}
                className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:underline flex items-center gap-0.5"
              >
                View all <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {revenueOverview.top.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60 my-auto py-4 text-center">
                Nothing pressing right now.
              </p>
            ) : (
              <ul className="space-y-1.5 flex-1">
                {revenueOverview.top.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: a.priority === 1 ? "#ef4444" : a.priority === 2 ? "#f59e0b" : "#6b7280" }}
                    />
                    <span className="text-[11px] text-foreground/80 truncate flex-1">{a.title}</span>
                    {a.amountAtRisk != null && a.amountAtRisk > 0 && (
                      <span className="text-[10px] font-semibold text-foreground/60 shrink-0">
                        {formatCurrencyCompact(a.amountAtRisk, currency)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() =>
                openKey({
                  mode: "chat",
                  module: "revenue",
                  prompt: "Walk me through what's happening with my revenue this month and what I should focus on first.",
                  context: {
                    surface: "commerce-overview",
                    kpis: revenueOverview.kpis,
                    pulse: revenueOverview.pulse,
                    topActions: revenueOverview.top.map((a) => ({
                      id: a.id, type: a.type, title: a.title, priority: a.priority, amountAtRisk: a.amountAtRisk,
                    })),
                  },
                })
              }
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold"
              style={{
                background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))",
                border: "1px solid hsl(var(--kf-accent1) / 0.25)",
                color: "hsl(var(--kf-accent1))",
              }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ask AI about revenue
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <motion.div variants={stagger.item} className="lg:col-span-3 space-y-3">
          {priorityItems.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Priority Lane
                </h3>
                <button
                  onClick={() => onNavigate("billing")}
                  className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:underline flex items-center gap-0.5"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-1.5">
                {priorityItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <div className={`p-1.5 rounded-lg shrink-0 ${item.bgColor}`}>
                      <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground/80 truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground/50">{item.subtitle}</p>
                    </div>
                    {item.amount != null && (
                      <span className={`text-xs font-semibold shrink-0 ${item.color}`}>
                        {formatCurrencyCompact(item.amount, currency)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {revenueFeed.topCustomers.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
                Revenue Feed
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground/50 mb-2 block">Top Customers</span>
                  <div className="space-y-1.5">
                    {revenueFeed.topCustomers.map((c, i) => (
                      <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                        <div className="flex items-center gap-2 min-w-0">
                          <Users className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                          <span className="text-[11px] font-medium text-foreground/80 truncate">{c.name}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-emerald-400 shrink-0">
                          {formatCurrencyCompact(c.revenue, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {revenueFeed.topProducts.length > 0 && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground/50 mb-2 block">Top Products</span>
                    <div className="space-y-1.5">
                      {revenueFeed.topProducts.map((p, i) => (
                        <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                          <div className="flex items-center gap-2 min-w-0">
                            <Package className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                            <span className="text-[11px] font-medium text-foreground/80 truncate">{p.name}</span>
                          </div>
                          <span className="text-[11px] font-semibold text-emerald-400 shrink-0">
                            {formatCurrencyCompact(p.revenue, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {revenueFeed.recentPaid.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  <span className="text-[10px] font-medium text-muted-foreground/50 mb-2 block">Recently Paid</span>
                  <div className="space-y-1">
                    {revenueFeed.recentPaid.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                        <div className="flex items-center gap-2 min-w-0">
                          <CreditCard className="w-3 h-3 text-emerald-400/60 shrink-0" />
                          <span className="text-[11px] text-foreground/70 truncate">
                            {inv.invoiceNumber ?? "Invoice"} — {getContactName(inv.contact)}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-emerald-400 shrink-0">
                          {formatCurrencyCompact(Number(inv.total), currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="lg:col-span-2 space-y-3">
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
              Suggested Actions
            </h3>
            <div className="space-y-2">
              {suggestedActions.map((action) => (
                <button
                  key={action.id}
                  onClick={action.action}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-left group"
                >
                  <div className="p-1.5 rounded-lg bg-white/[0.04] shrink-0">
                    <action.icon className={`w-4 h-4 ${action.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground/80">{action.label}</p>
                    <p className="text-[10px] text-muted-foreground/50">{action.description}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {revenueFeed.convertedQuotes.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
                Recently Converted Quotes
              </h3>
              <div className="space-y-1.5">
                {revenueFeed.convertedQuotes.map((q) => (
                  <div key={q.id} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowUpRight className="w-3 h-3 text-emerald-400/60 shrink-0" />
                      <span className="text-[11px] text-foreground/70 truncate">
                        {q.quoteNumber ?? "Quote"} — {getContactName(q.contact)}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-400 shrink-0">
                      {formatCurrencyCompact(Number(q.total), currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border/30 bg-gradient-to-br from-[hsl(var(--kf-accent1))]/5 to-[hsl(var(--kf-accent2))]/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <span className="text-xs font-semibold text-foreground/80">Quick Actions</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onNavigate("billing", "invoices")}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/20 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
              >
                <CreditCard className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px] font-medium text-foreground/70">Invoices</span>
              </button>
              <button
                onClick={() => onNavigate("billing", "quotes")}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/20 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
              >
                <FileText className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-[11px] font-medium text-foreground/70">Quotes</span>
              </button>
              <button
                onClick={() => onNavigate("billing", "schedules")}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/20 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-[11px] font-medium text-foreground/70">Recurring</span>
              </button>
              <button
                onClick={() => onNavigate("catalog")}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/20 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
              >
                <TrendingUp className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] font-medium text-foreground/70">Intelligence</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div variants={stagger.item}>
        <ChurnRiskPanel businessId={businessId} />
      </motion.div>
    </motion.div>
  );
}
