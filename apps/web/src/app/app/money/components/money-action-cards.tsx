"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, Clock, FileText, TrendingDown, Send, Zap, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import {
  sendInvoiceReminder,
  sendStaleQuoteFollowUp,
  type FinanceOverview,
  type Invoice,
  type Quote,
} from "@/lib/client";

interface MoneyActionCardsProps {
  overview: FinanceOverview | null;
  invoices: Invoice[];
  quotes: Quote[];
  businessId: string | null;
  currency?: string;
}

interface ActionCard {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  cta: string;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  urgent: boolean;
  color: string;
  bgColor: string;
}

export function MoneyActionCards({
  overview,
  invoices,
  quotes,
  businessId,
  currency = "TTD",
}: MoneyActionCardsProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleSendReminders = useCallback(async () => {
    if (!businessId) return;
    const overdue = invoices.filter((i) => i.status === "OVERDUE");
    if (overdue.length === 0) return;

    setLoadingId("overdue");
    try {
      await Promise.all(
        overdue.slice(0, 3).map((i) => sendInvoiceReminder(businessId, i.id, {}))
      );
      toast.success(`Reminders sent to ${Math.min(overdue.length, 3)} clients`);
    } catch {
      toast.error("Failed to send reminders");
    } finally {
      setLoadingId(null);
    }
  }, [businessId, invoices]);

  const handleFollowUpQuotes = useCallback(async () => {
    if (!businessId) return;
    const stale = quotes.filter((q) => q.status === "SENT");
    if (stale.length === 0) return;

    setLoadingId("quotes");
    try {
      await Promise.all(
        stale.slice(0, 3).map((q) => sendStaleQuoteFollowUp({ quoteId: q.id, businessId }))
      );
      toast.success(`Follow-ups sent for ${Math.min(stale.length, 3)} quotes`);
    } catch {
      toast.error("Failed to send follow-ups");
    } finally {
      setLoadingId(null);
    }
  }, [businessId, quotes]);

  const cards: ActionCard[] = [];

  // Overdue invoices
  const overdueCount = overview?.overdueInvoiceCount ?? 0;
  const overdueAmount = overview?.overdueInvoices ?? 0;
  if (overdueCount > 0) {
    cards.push({
      id: "overdue",
      icon: AlertTriangle,
      title: `${overdueCount} overdue invoice${overdueCount === 1 ? "" : "s"}`,
      description: `${formatCurrency(overdueAmount, currency)} unpaid`,
      cta: "Send reminders",
      onClick: handleSendReminders,
      loading: loadingId === "overdue",
      urgent: true,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    });
  }

  // Pending quotes
  const pendingQuotes = quotes.filter((q) => q.status === "SENT").length;
  if (pendingQuotes > 0) {
    cards.push({
      id: "quotes",
      icon: FileText,
      title: `${pendingQuotes} pending quote${pendingQuotes === 1 ? "" : "s"}`,
      description: "Awaiting client response",
      cta: "Follow up",
      onClick: handleFollowUpQuotes,
      loading: loadingId === "quotes",
      urgent: false,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    });
  }

  // Cash runway warning
  const runway = overview?.cashRunwayMonths ?? null;
  if (runway != null && runway < 30) {
    cards.push({
      id: "runway",
      icon: TrendingDown,
      title: "Cash runway low",
      description: `${runway} days of cash left`,
      cta: "Create invoice",
      href: "/app/commerce?tab=pipeline",
      urgent: runway < 14,
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
    });
  }

  // Bills due
  const billsDue = overview?.billsDueCount ?? 0;
  const billsAmount = overview?.billsDue ?? 0;
  if (billsDue > 0) {
    cards.push({
      id: "bills",
      icon: Clock,
      title: `${billsDue} bill${billsDue === 1 ? "" : "s"} due`,
      description: `${formatCurrency(billsAmount, currency)} owed`,
      cta: "View bills",
      href: "/app/expenses",
      urgent: false,
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    });
  }

  // Pending actions from finance overview
  const pendingActions = overview?.pendingActionCount ?? 0;
  if (pendingActions > 0) {
    cards.push({
      id: "actions",
      icon: Zap,
      title: `${pendingActions} action${pendingActions === 1 ? "" : "s"} pending`,
      description: "Review recommended tasks",
      cta: "Review",
      href: "/app/money",
      urgent: false,
      color: "text-[hsl(var(--kf-accent1))]",
      bgColor: "bg-[hsl(var(--kf-accent1))]/10",
    });
  }

  // If nothing urgent, show a positive card
  if (cards.length === 0) {
    cards.push({
      id: "healthy",
      icon: CheckCircle2,
      title: "All caught up",
      description: "No urgent money actions right now",
      cta: "View reports",
      href: "/app/reports",
      urgent: false,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    });
  }

  // Limit to 3 most urgent
  const displayCards = cards
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))
    .slice(0, 3);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {displayCards.map((card, idx) => {
        const Icon = card.icon;

        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.08 }}
            className={`rounded-xl border border-border/60 bg-card p-4 hover:border-[hsl(var(--kf-accent1))]/30 hover:shadow-sm transition-all ${
              card.urgent ? "border-amber-500/20" : ""
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg ${card.bgColor} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
              {card.urgent && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-500 uppercase tracking-wider">
                  Action
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-0.5">{card.title}</h3>
            <p className="text-xs text-muted-foreground mb-3">{card.description}</p>
            {card.onClick ? (
              <button
                onClick={card.onClick}
                disabled={card.loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/5 text-foreground hover:bg-foreground/10 transition-colors disabled:opacity-50"
              >
                {card.loading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                {card.cta}
              </button>
            ) : (
              <Link
                href={card.href ?? "#"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/5 text-foreground hover:bg-foreground/10 transition-colors"
              >
                <Send className="w-3 h-3" />
                {card.cta}
              </Link>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
