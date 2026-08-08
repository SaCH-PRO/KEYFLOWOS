"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  AlertTriangle,
  FileText,
  CreditCard,
  RefreshCw,
  ArrowRight,
  Zap,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { CommerceHub } from "./commerce-hub";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { parseDate } from "@/lib/date-safe";
import { InvoiceStatus, QuoteStatus } from "@/lib/commerce-status";
import type { Invoice, Quote, RecurringInvoice } from "@/lib/client";

interface CommerceOverviewTabProps {
  businessId: string | null;
  invoices: Invoice[];
  quotes: Quote[];
  recurring?: RecurringInvoice[];
  currency: string;
  loading: boolean;
  onNavigate: (tab: string, segment?: string) => void;
  onNewItem: () => void;
}

/* ─── Helpers ─── */
function getContactName(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!contact) return "Unknown";
  return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
}

function timeAgo(dateStr: string | null | undefined): string {
  const d = parseDate(dateStr);
  if (!d) return "";
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ─── Skeleton ─── */
function OverviewSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading overview">
      <div className="rounded-2xl border border-border/50 bg-card p-5 h-28">
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-8 w-40 mb-2" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-4 h-24">
            <Skeleton className="h-8 w-8 rounded-lg mb-2" />
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border/50 bg-card">
        <div className="px-4 py-3 border-b border-border/40">
          <Skeleton className="h-3 w-24" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Revenue Hero ─── */
function RevenueHero({
  outstanding,
  collected,
  overdue,
  overdueCount,
  currency,
  onNewItem,
}: {
  outstanding: number;
  collected: number;
  overdue: number;
  overdueCount: number;
  currency: string;
  onNewItem: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 sm:p-6"
    >
      <div className="absolute -right-20 -top-20 w-64 h-64 bg-gradient-to-br from-orange-500/5 to-teal-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Outstanding Revenue</p>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">{formatCurrency(outstanding, currency)}</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <TrendingUp className="w-3 h-3" />
              {formatCurrencyCompact(collected, currency)} collected
            </span>
            {overdueCount > 0 && (
              <>
                <span className="text-border">|</span>
                <span className="text-amber-500">{overdueCount} overdue — {formatCurrencyCompact(overdue, currency)}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onNewItem}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
        >
          <CreditCard className="w-4 h-4" />
          New Invoice
        </button>
      </div>
    </motion.div>
  );
}

/* ─── Revenue At a Glance ─── */
function RevenueAtAGlance({
  quotes,
  invoices,
  recurring,
  currency,
}: {
  quotes: Quote[];
  invoices: Invoice[];
  recurring?: RecurringInvoice[];
  currency: string;
}) {
  const quoteTotal = quotes.reduce((s, q) => s + (q.total ?? 0), 0);
  const invoiceTotal = invoices.filter((i) => i.status === InvoiceStatus.SENT || i.status === InvoiceStatus.OVERDUE).reduce((s, i) => s + (Number(i.total) ?? 0), 0);
  const paidTotal = invoices.filter((i) => i.status === InvoiceStatus.PAID).reduce((s, i) => s + (Number(i.total) ?? 0), 0);

  const activeRecurring = (recurring ?? []).filter((r) => r.status === "ACTIVE");
  const mrr = activeRecurring.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const nextRun = activeRecurring.length > 0
    ? activeRecurring.slice().sort((a, b) => new Date(a.nextRunDate).getTime() - new Date(b.nextRunDate).getTime())[0]
    : null;

  const pipelineStages = [
    { label: "Quotes", amount: quoteTotal, count: quotes.length, icon: FileText, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Invoiced", amount: invoiceTotal, count: invoices.filter((i) => i.status === InvoiceStatus.SENT || i.status === InvoiceStatus.OVERDUE).length, icon: CreditCard, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Paid", amount: paidTotal, count: invoices.filter((i) => i.status === InvoiceStatus.PAID).length, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">At a Glance</p>
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {pipelineStages.map((stage, idx) => {
          const Icon = stage.icon;
          return (
            <div key={stage.label} className="flex items-center gap-2 flex-shrink-0">
              <div className="flex flex-col items-center gap-1 min-w-[80px] sm:min-w-[100px] p-2 rounded-xl border border-border/30 bg-white/[0.02]">
                <div className={`w-7 h-7 rounded-lg ${stage.bg} flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${stage.color}`} />
                </div>
                <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{stage.label}</span>
                <span className="text-sm font-bold text-foreground">
                  {stage.amount > 0 ? formatCurrencyCompact(stage.amount, currency) : "—"}
                </span>
                {stage.count > 0 && <span className="text-[9px] text-muted-foreground/50">{stage.count}</span>}
              </div>
              {idx < pipelineStages.length - 1 && <div className="w-3 h-[1px] bg-border/30 flex-shrink-0" />}
            </div>
          );
        })}

        {/* Divider + Recurring */}
        {activeRecurring.length > 0 && (
          <>
            <div className="w-[1px] bg-border/30 mx-1 self-stretch" />
            <div className="flex flex-col items-center gap-1 min-w-[80px] sm:min-w-[100px] p-2 rounded-xl border border-violet-500/20 bg-violet-500/5 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <RefreshCw className="w-3.5 h-3.5 text-violet-500" />
              </div>
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Recurring</span>
              <span className="text-sm font-bold text-violet-500">
                {mrr > 0 ? formatCurrencyCompact(mrr, currency) : "—"}
              </span>
              <span className="text-[9px] text-muted-foreground/50">
                {activeRecurring.length} active{nextRun ? ` · ${new Date(nextRun.nextRunDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              </span>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Action Cards ─── */
function RevenueActionCards({
  invoices,
  quotes,
  recurring,
  currency,
  onNavigate,
}: {
  invoices: Invoice[];
  quotes: Quote[];
  recurring: RecurringInvoice[];
  currency: string;
  onNavigate: (tab: string, segment?: string) => void;
}) {
  const cards: { id: string; icon: React.ElementType; title: string; desc: string; cta: string; onClick: () => void; urgent: boolean; color: string; bg: string }[] = [];

  const overdue = invoices.filter((i) => i.status === InvoiceStatus.OVERDUE);
  const overdueAmount = overdue.reduce((s, i) => s + (Number(i.total) ?? 0), 0);
  if (overdue.length > 0) {
    cards.push({
      id: "overdue",
      icon: AlertTriangle,
      title: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`,
      desc: `${formatCurrency(overdueAmount, currency)} unpaid`,
      cta: "View",
      onClick: () => onNavigate("invoices"),
      urgent: true,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    });
  }

  const pendingQuotes = quotes.filter((q) => q.status === QuoteStatus.SENT);
  if (pendingQuotes.length > 0) {
    cards.push({
      id: "quotes",
      icon: FileText,
      title: `${pendingQuotes.length} pending quote${pendingQuotes.length === 1 ? "" : "s"}`,
      desc: "Awaiting client response",
      cta: "View",
      onClick: () => onNavigate("quotes"),
      urgent: false,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    });
  }

  const drafts = invoices.filter((i) => i.status === InvoiceStatus.DRAFT);
  if (drafts.length > 0) {
    cards.push({
      id: "drafts",
      icon: CreditCard,
      title: `${drafts.length} draft invoice${drafts.length === 1 ? "" : "s"}`,
      desc: "Ready to send",
      cta: "Send",
      onClick: () => onNavigate("invoices"),
      urgent: false,
      color: "text-[hsl(var(--kf-accent1))]",
      bg: "bg-[hsl(var(--kf-accent1))]/10",
    });
  }

  const upcoming = (recurring ?? []).filter((r) => r.status === "ACTIVE" && r.nextRunDate);
  if (upcoming.length > 0) {
    cards.push({
      id: "recurring",
      icon: RefreshCw,
      title: `${upcoming.length} recurring schedule${upcoming.length === 1 ? "" : "s"}`,
      desc: "Active",
      cta: "View",
      onClick: () => onNavigate("recurring"),
      urgent: false,
      color: "text-violet-500",
      bg: "bg-violet-500/10",
    });
  }

  if (cards.length === 0) {
    cards.push({
      id: "healthy",
      icon: CheckCircle2,
      title: "All caught up",
      desc: "No urgent revenue actions",
      cta: "Create invoice",
      onClick: () => onNavigate("invoices"),
      urgent: false,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    });
  }

  const display = cards.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)).slice(0, 3);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {display.map((card, idx) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.08 }}
            className={`rounded-xl border border-border/60 bg-card p-4 hover:border-[hsl(var(--kf-accent1))]/30 transition-all ${card.urgent ? "border-amber-500/20" : ""}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
              {card.urgent && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-500 uppercase tracking-wider">Action</span>}
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-0.5">{card.title}</h3>
            <p className="text-xs text-muted-foreground mb-3">{card.desc}</p>
            <button
              onClick={card.onClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/5 text-foreground hover:bg-foreground/10 transition-colors"
            >
              {card.cta}
              <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ─── Activity Feed ─── */
function RevenueActivityFeed({
  invoices,
  quotes,
  currency,
}: {
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
}) {
  const items = useMemo(() => {
    const all: { id: string; type: string; title: string; subtitle?: string; amount: number; currency: string; date: string | null | undefined; icon: React.ElementType; color: string; bg: string }[] = [];

    invoices.forEach((inv) => {
      const contact = getContactName(inv.contact);
      if (inv.status === InvoiceStatus.PAID && inv.paidAt) {
        all.push({ id: `paid-${inv.id}`, type: "paid", title: "Payment received", subtitle: `Invoice #${inv.invoiceNumber ?? inv.id.slice(0, 6)} — ${contact}`, amount: Number(inv.total) ?? 0, currency: inv.currency ?? currency, date: inv.paidAt, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" });
      } else if (inv.status === InvoiceStatus.SENT) {
        all.push({ id: `sent-${inv.id}`, type: "sent", title: "Invoice sent", subtitle: `Invoice #${inv.invoiceNumber ?? inv.id.slice(0, 6)} — ${contact}`, amount: Number(inv.total) ?? 0, currency: inv.currency ?? currency, date: inv.issueDate, icon: CreditCard, color: "text-blue-500", bg: "bg-blue-500/10" });
      } else if (inv.status === InvoiceStatus.OVERDUE) {
        all.push({ id: `od-${inv.id}`, type: "overdue", title: "Invoice overdue", subtitle: `Invoice #${inv.invoiceNumber ?? inv.id.slice(0, 6)} — ${contact}`, amount: Number(inv.total) ?? 0, currency: inv.currency ?? currency, date: inv.dueDate, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" });
      }
    });

    quotes.filter((q) => q.status === QuoteStatus.ACCEPTED).forEach((q) => {
      all.push({ id: `acc-${q.id}`, type: "accepted", title: "Quote accepted", subtitle: `Quote #${q.quoteNumber} — ${getContactName(q.contact)}`, amount: q.total, currency: q.currency, date: q.createdAt, icon: FileText, color: "text-emerald-500", bg: "bg-emerald-500/10" });
    });

    // Sort by date descending, filtering out items with no date
    return all
      .filter((item) => !!item.date)
      .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())
      .slice(0, 10);
  }, [invoices, quotes, currency]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} className="rounded-2xl border border-border/60 bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Activity</p>
      </div>
      <div className="divide-y divide-border/30">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">No recent revenue activity</div>
        ) : (
          items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${item.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{item.title}</p>
                  {item.subtitle && <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-foreground">{formatCurrency(item.amount, item.currency)}</p>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(item.date)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

/* ─── Main Component ─── */
export function CommerceOverviewTab({
  invoices,
  quotes,
  recurring,
  currency,
  loading,
  onNavigate,
  onNewItem,
}: CommerceOverviewTabProps) {
  const stats = useMemo(() => {
    const outstanding = invoices.filter((i) => i.status === InvoiceStatus.SENT || i.status === InvoiceStatus.OVERDUE).reduce((s, i) => s + (Number(i.total) ?? 0), 0);
    const collected = invoices.filter((i) => i.status === InvoiceStatus.PAID).reduce((s, i) => s + (Number(i.total) ?? 0), 0);
    const overdue = invoices.filter((i) => i.status === InvoiceStatus.OVERDUE).reduce((s, i) => s + (Number(i.total) ?? 0), 0);
    const overdueCount = invoices.filter((i) => i.status === InvoiceStatus.OVERDUE).length;
    return { outstanding, collected, overdue, overdueCount };
  }, [invoices]);

  if (loading) return <OverviewSkeleton />;

  return (
    <div className="space-y-5">
      <RevenueHero outstanding={stats.outstanding} collected={stats.collected} overdue={stats.overdue} overdueCount={stats.overdueCount} currency={currency} onNewItem={onNewItem} />
      <CommerceHub />
      <RevenueAtAGlance quotes={quotes} invoices={invoices} recurring={recurring} currency={currency} />
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">Actions</h2>
        </div>
        <RevenueActionCards invoices={invoices} quotes={quotes} recurring={recurring ?? []} currency={currency} onNavigate={onNavigate} />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">Activity</h2>
        </div>
        <RevenueActivityFeed invoices={invoices} quotes={quotes} currency={currency} />
      </div>
    </div>
  );
}
