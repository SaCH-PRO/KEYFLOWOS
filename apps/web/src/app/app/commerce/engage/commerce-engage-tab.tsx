"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  Send,
  CheckCircle2,
  RefreshCw,
  X,
  Filter,
  TrendingUp,
  CreditCard,
  Plus,
  Loader2,
  Bot,
  Copy,
  ArrowUpRight,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Invoice,
  type Quote,
  type CommerceStats,
  type CommerceInvoiceReminder,
  fetchCommerceStats,
  fetchRecurringInvoices,
  markInvoicePaid,
  updateInvoiceStatus,
  updateQuoteStatus,
  convertQuoteToInvoice,
  commerceAiInvoiceReminder,
} from "@/lib/client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { getStatusBadge } from "../components/commerce-types";

type EngageFilter = "all" | "invoices" | "quotes";
type UrgencyFilter = "all" | "overdue" | "due_soon" | "pending";

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } },
  item: {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
  },
};

interface CommerceEngageTabProps {
  invoices: Invoice[];
  quotes: Quote[];
  businessId: string | null;
  currency: string;
  loading?: boolean;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  onCreateInvoice: () => void;
  onCreateQuote: () => void;
  onCreateSchedule: () => void;
  onSwitchToBilling: () => void;
}

const EngageSkeleton = React.memo(function EngageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading engage data">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/50 bg-card p-4">
            <Skeleton className="h-3 w-16 mb-3" />
            <Skeleton className="h-7 w-12 mb-2" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-40 mb-2" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02]">
                <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-7 w-14 rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

function getDaysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function getDaysUntilDue(dueDate: string | null | undefined): number {
  if (!dueDate) return 999;
  const due = new Date(dueDate);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getContactName(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!contact) return "Unknown";
  return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
}

const HeroStats = React.memo(function HeroStats({
  invoices,
  quotes,
  recurringCount,
  currency,
}: {
  invoices: Invoice[];
  quotes: Quote[];
  recurringCount: number;
  currency: string;
}) {
  const stats = useMemo(() => {
    const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const pendingQuotes = quotes.filter((q) => q.status === "DRAFT" || q.status === "SENT");
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalSent = invoices.filter((inv) => inv.status !== "DRAFT").length;
    const collectionRate = totalSent > 0 ? Math.round((paidInvoices.length / totalSent) * 100) : 0;

    return [
      {
        label: "Overdue",
        mobileLabel: "Due",
        value: overdueInvoices.length,
        sub: overdueInvoices.length > 0 ? formatCurrencyCompact(overdueAmount, currency) : "All clear",
        icon: AlertTriangle,
        accent: "from-red-500/15 to-red-500/5",
        iconColor: "text-red-400",
        highlight: overdueInvoices.length > 0,
      },
      {
        label: "Pending Quotes",
        mobileLabel: "Quotes",
        value: pendingQuotes.length,
        sub: `${pendingQuotes.filter((q) => q.status === "SENT").length} awaiting response`,
        icon: FileText,
        accent: "from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5",
        iconColor: "text-[hsl(var(--kf-accent1))]",
        highlight: false,
      },
      {
        label: "Recurring",
        mobileLabel: "Recur",
        value: recurringCount,
        sub: "Active schedules",
        icon: RefreshCw,
        accent: "from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5",
        iconColor: "text-[hsl(var(--kf-accent2))]",
        highlight: false,
      },
      {
        label: "Collection Rate",
        mobileLabel: "Rate",
        value: `${collectionRate}%`,
        sub: `${paidInvoices.length} of ${totalSent} collected`,
        icon: TrendingUp,
        accent: "from-emerald-500/15 to-emerald-500/5",
        iconColor: "text-emerald-400",
        highlight: false,
      },
    ];
  }, [invoices, quotes, recurringCount, currency]);

  return (
    <motion.div variants={stagger.item} className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="relative rounded-xl border border-border/50 bg-card p-2 sm:p-3 overflow-hidden"
          >
            <div className={`absolute -top-6 -right-6 w-14 h-14 rounded-full bg-gradient-to-br ${stat.accent} blur-xl opacity-60`} aria-hidden="true" />
            <div className="relative">
              <div className="flex items-center gap-1 sm:gap-1.5 mb-1 sm:mb-1.5">
                <div className={`p-1 sm:p-1.5 rounded-lg bg-gradient-to-br ${stat.accent}`}>
                  <Icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${stat.iconColor}`} />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 sm:hidden">{stat.mobileLabel}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hidden sm:inline">{stat.label}</span>
              </div>
              <p className={`text-sm sm:text-xl font-bold tracking-tight leading-tight ${stat.highlight ? "text-red-400" : ""}`}>
                {stat.value}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 hidden sm:block">{stat.sub}</p>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
});

const QuickActionsBar = React.memo(function QuickActionsBar({
  onCreateInvoice,
  onCreateQuote,
  onCreateSchedule,
}: {
  onCreateInvoice: () => void;
  onCreateQuote: () => void;
  onCreateSchedule: () => void;
}) {
  const actions = [
    { label: "Create Invoice", icon: CreditCard, onClick: onCreateInvoice, accent: "from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25" },
    { label: "Create Quote", icon: FileText, onClick: onCreateQuote, accent: "from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5 text-[hsl(var(--kf-accent2))] hover:from-[hsl(var(--kf-accent2))]/25" },
    { label: "New Schedule", icon: RefreshCw, onClick: onCreateSchedule, accent: "from-emerald-500/15 to-emerald-500/5 text-emerald-400 hover:from-emerald-500/25" },
  ];

  return (
    <motion.div variants={stagger.item} className="flex items-center gap-2 flex-wrap">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            onClick={action.onClick}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r ${action.accent} border border-border/30 transition-all`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{action.label}</span>
            <span className="sm:hidden"><Plus className="w-3 h-3" /></span>
          </button>
        );
      })}
    </motion.div>
  );
});

const PaymentFollowUpQueue = React.memo(function PaymentFollowUpQueue({
  invoices,
  currency,
  businessId,
  setInvoices,
  onSendReminder,
}: {
  invoices: Invoice[];
  currency: string;
  businessId: string | null;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  onSendReminder: (invoiceId: string) => void;
}) {
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const actionableInvoices = useMemo(() => {
    return invoices
      .filter((inv) => inv.status === "OVERDUE" || inv.status === "SENT")
      .sort((a, b) => {
        if (a.status === "OVERDUE" && b.status !== "OVERDUE") return -1;
        if (b.status === "OVERDUE" && a.status !== "OVERDUE") return 1;
        return getDaysOverdue(b.dueDate) - getDaysOverdue(a.dueDate);
      });
  }, [invoices]);

  const visible = showAll ? actionableInvoices : actionableInvoices.slice(0, 5);

  async function handleMarkPaid(invoiceId: string) {
    if (actionLoading[invoiceId]) return;
    setActionLoading((prev) => ({ ...prev, [invoiceId]: "paid" }));
    try {
      const { data, error } = await markInvoicePaid(invoiceId);
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: data.status ?? "PAID" } : i)));
        toast.success("Invoice marked as paid");
      } else {
        toast.error(error ?? "Failed to mark paid");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
    }
  }

  async function handleSendInvoice(invoiceId: string) {
    if (actionLoading[invoiceId]) return;
    setActionLoading((prev) => ({ ...prev, [invoiceId]: "send" }));
    try {
      const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: "SENT" } : i)));
        toast.success("Invoice sent");
      } else {
        toast.error(error ?? "Failed to send invoice");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
    }
  }

  if (actionableInvoices.length === 0) {
    return (
      <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]/30" />
          <DollarSign className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Payment Follow-Up</span>
        </div>
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400/60 mb-2" />
          <p className="text-sm text-muted-foreground/60">All invoices are up to date</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]/30" />
        <DollarSign className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Payment Follow-Up</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50 font-medium">{actionableInvoices.length} pending</span>
      </div>

      <div className="space-y-1.5">
        {visible.map((inv) => {
          const daysOver = getDaysOverdue(inv.dueDate);
          const isOverdue = inv.status === "OVERDUE";
          const isLoading = actionLoading[inv.id];

          return (
            <div
              key={inv.id}
              className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                isOverdue ? "bg-red-500/[0.04] hover:bg-red-500/[0.08]" : "bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${isOverdue ? "bg-red-500/15" : "bg-amber-500/15"}`}>
                {isOverdue ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getStatusBadge(inv.status)}`}>{inv.status}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground/60 truncate">{getContactName(inv.contact)}</span>
                  {isOverdue && daysOver > 0 && (
                    <span className="text-[10px] font-medium text-red-400">{daysOver}d overdue</span>
                  )}
                </div>
              </div>

              <span className="text-xs font-bold shrink-0">{formatCurrency(Number(inv.total), currency)}</span>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onSendReminder(inv.id)}
                  disabled={!!isLoading}
                  className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50"
                  title="Send Reminder"
                >
                  {isLoading === "send" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => handleMarkPaid(inv.id)}
                  disabled={!!isLoading}
                  className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                  title="Mark Paid"
                >
                  {isLoading === "paid" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {actionableInvoices.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 py-1.5 text-[10px] font-medium text-muted-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-white/[0.02]"
        >
          {showAll ? "Show less" : `Show ${actionableInvoices.length - 5} more`}
        </button>
      )}
    </motion.div>
  );
});

const QuoteActionQueue = React.memo(function QuoteActionQueue({
  quotes,
  currency,
  businessId,
  setQuotes,
  setInvoices,
  onSwitchToBilling,
}: {
  quotes: Quote[];
  currency: string;
  businessId: string | null;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  onSwitchToBilling: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const pendingQuotes = useMemo(() => {
    return quotes
      .filter((q) => q.status === "DRAFT" || q.status === "SENT" || q.status === "ACCEPTED")
      .sort((a, b) => {
        const order: Record<string, number> = { ACCEPTED: 0, SENT: 1, DRAFT: 2 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      });
  }, [quotes]);

  const visible = showAll ? pendingQuotes : pendingQuotes.slice(0, 5);

  async function handleAccept(quoteId: string) {
    if (actionLoading[quoteId]) return;
    setActionLoading((prev) => ({ ...prev, [quoteId]: "accept" }));
    try {
      const res = await updateQuoteStatus(quoteId, "ACCEPTED");
      if (res.data) {
        setQuotes((q) => q.map((item) => (item.id === quoteId ? res.data! : item)));
        toast.success("Quote accepted");
      } else {
        toast.error(res.error ?? "Failed to accept quote");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[quoteId]; return next; });
    }
  }

  async function handleSend(quoteId: string) {
    if (actionLoading[quoteId]) return;
    setActionLoading((prev) => ({ ...prev, [quoteId]: "send" }));
    try {
      const res = await updateQuoteStatus(quoteId, "SENT");
      if (res.data) {
        setQuotes((q) => q.map((item) => (item.id === quoteId ? res.data! : item)));
        toast.success("Quote sent");
      } else {
        toast.error(res.error ?? "Failed to send quote");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[quoteId]; return next; });
    }
  }

  async function handleConvert(quote: Quote) {
    if (!businessId || actionLoading[quote.id]) return;
    setActionLoading((prev) => ({ ...prev, [quote.id]: "convert" }));
    try {
      const res = await convertQuoteToInvoice({
        businessId,
        quoteId: quote.id,
        taxRate: Number(quote.taxRate) || 0,
      });
      if (res.data) {
        setInvoices((inv) => [res.data!, ...inv]);
        setQuotes((q) => q.map((item) => (item.id === quote.id ? { ...item, invoiceId: res.data!.id } : item)));
        toast.success("Quote converted to invoice");
        onSwitchToBilling();
      } else {
        toast.error(res.error ?? "Failed to convert quote");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[quote.id]; return next; });
    }
  }

  function isExpiringSoon(quote: Quote): boolean {
    if (!quote.expiryDate) return false;
    const days = getDaysUntilDue(quote.expiryDate);
    return days >= 0 && days <= 7;
  }

  if (pendingQuotes.length === 0) {
    return (
      <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/30" />
          <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Quote Actions</span>
        </div>
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400/60 mb-2" />
          <p className="text-sm text-muted-foreground/60">No pending quotes</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/30" />
        <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Quote Actions</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50 font-medium">{pendingQuotes.length} pending</span>
      </div>

      <div className="space-y-1.5">
        {visible.map((quote) => {
          const isLoading = actionLoading[quote.id];
          const expiringSoon = isExpiringSoon(quote);

          return (
            <div
              key={quote.id}
              className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                expiringSoon ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]" : "bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${
                quote.status === "ACCEPTED" ? "bg-emerald-500/15" : quote.status === "SENT" ? "bg-blue-500/15" : "bg-slate-500/15"
              }`}>
                <FileText className={`w-3.5 h-3.5 ${
                  quote.status === "ACCEPTED" ? "text-emerald-400" : quote.status === "SENT" ? "text-blue-400" : "text-slate-400"
                }`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{quote.quoteNumber}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getStatusBadge(quote.status)}`}>{quote.status}</span>
                  {expiringSoon && (
                    <span className="text-[10px] font-medium text-amber-400">Expiring soon</span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground/60 truncate block mt-0.5">
                  {getContactName(quote.contact)}
                </span>
              </div>

              <span className="text-xs font-bold shrink-0">{formatCurrency(Number(quote.total), currency)}</span>

              <div className="flex items-center gap-1 shrink-0">
                {quote.status === "DRAFT" && (
                  <button
                    onClick={() => handleSend(quote.id)}
                    disabled={!!isLoading}
                    className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                    title="Send Quote"
                  >
                    {isLoading === "send" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  </button>
                )}
                {quote.status === "SENT" && (
                  <button
                    onClick={() => handleAccept(quote.id)}
                    disabled={!!isLoading}
                    className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                    title="Accept Quote"
                  >
                    {isLoading === "accept" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  </button>
                )}
                {quote.status === "ACCEPTED" && !quote.invoiceId && (
                  <button
                    onClick={() => handleConvert(quote)}
                    disabled={!!isLoading}
                    className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50"
                    title="Convert to Invoice"
                  >
                    {isLoading === "convert" ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pendingQuotes.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 py-1.5 text-[10px] font-medium text-muted-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-white/[0.02]"
        >
          {showAll ? "Show less" : `Show ${pendingQuotes.length - 5} more`}
        </button>
      )}
    </motion.div>
  );
});

const AiSmartReminders = React.memo(function AiSmartReminders({
  invoiceId,
  businessId,
  onClose,
}: {
  invoiceId: string;
  businessId: string | null;
  onClose: () => void;
}) {
  const [reminder, setReminder] = useState<CommerceInvoiceReminder | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!businessId || !invoiceId) return;
    let cancelled = false;
    setLoading(true);
    commerceAiInvoiceReminder(invoiceId, businessId).then((res) => {
      if (!cancelled) {
        setReminder(res.data);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [invoiceId, businessId]);

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Reminder copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-2xl border border-[hsl(var(--kf-accent1))]/30 bg-card/80 backdrop-blur-sm p-4 overflow-hidden"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <span className="text-xs font-semibold">AI Payment Reminder</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : reminder ? (
        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Subject</span>
            <p className="text-sm font-medium mt-0.5">{reminder.subject}</p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Message ({reminder.tone})</span>
            <p className="text-xs text-muted-foreground/80 mt-1 p-3 rounded-xl bg-white/[0.03] border border-border/30 whitespace-pre-wrap">{reminder.message}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleCopy(reminder.message)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
            >
              {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {reminder.alternativeMessages?.length > 0 && (
            <details className="mt-2">
              <summary className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors">
                Alternative versions ({reminder.alternativeMessages.length})
              </summary>
              <div className="space-y-2 mt-2">
                {reminder.alternativeMessages.map((alt, i) => (
                  <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/20">
                    <span className="text-[10px] font-medium text-muted-foreground/50 capitalize">{alt.tone}</span>
                    <p className="text-xs text-muted-foreground/70 mt-1">{alt.message}</p>
                    <button
                      onClick={() => handleCopy(alt.message)}
                      className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline mt-1"
                    >
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/60">Could not generate reminder. Try again later.</p>
      )}
    </motion.div>
  );
});

const RevenueRecoveryPlanner = React.memo(function RevenueRecoveryPlanner({
  invoices,
  currency,
}: {
  invoices: Invoice[];
  currency: string;
}) {
  const agedReceivables = useMemo(() => {
    const unpaid = invoices.filter((inv) => inv.status === "OVERDUE" || inv.status === "SENT");
    const buckets = { current: 0, thirtyDay: 0, sixtyDay: 0, ninetyPlus: 0 };
    let totalCollectible = 0;

    unpaid.forEach((inv) => {
      const amount = Number(inv.total);
      totalCollectible += amount;
      const days = getDaysOverdue(inv.dueDate);
      if (days <= 0) buckets.current += amount;
      else if (days <= 30) buckets.thirtyDay += amount;
      else if (days <= 60) buckets.sixtyDay += amount;
      else buckets.ninetyPlus += amount;
    });

    return { ...buckets, totalCollectible, count: unpaid.length };
  }, [invoices]);

  const maxBucket = Math.max(agedReceivables.current, agedReceivables.thirtyDay, agedReceivables.sixtyDay, agedReceivables.ninetyPlus, 1);

  const bars = [
    { label: "Current", amount: agedReceivables.current, color: "bg-emerald-500/60" },
    { label: "1-30 days", amount: agedReceivables.thirtyDay, color: "bg-amber-500/60" },
    { label: "31-60 days", amount: agedReceivables.sixtyDay, color: "bg-orange-500/60" },
    { label: "90+ days", amount: agedReceivables.ninetyPlus, color: "bg-red-500/60" },
  ];

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-500/30" />
        <Target className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Revenue Recovery</span>
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-lg font-bold">{formatCurrencyCompact(agedReceivables.totalCollectible, currency)}</span>
        <span className="text-[10px] text-muted-foreground/50">collectible across {agedReceivables.count} invoices</span>
      </div>

      <div className="space-y-2.5">
        {bars.map((bar) => {
          const pct = maxBucket > 0 ? (bar.amount / maxBucket) * 100 : 0;
          return (
            <div key={bar.label} className="flex items-center gap-2.5">
              <span className="text-[10px] text-muted-foreground/60 w-16 shrink-0">{bar.label}</span>
              <div className="flex-1 h-5 rounded-md bg-white/[0.03] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className={`h-full rounded-md ${bar.color} flex items-center justify-end pr-2`}
                >
                  {bar.amount > 0 && (
                    <span className="text-[10px] font-semibold text-white/80">{formatCurrencyCompact(bar.amount, currency)}</span>
                  )}
                </motion.div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
});

const FilterToolbar = React.memo(function FilterToolbar({
  typeFilter,
  urgencyFilter,
  onTypeFilter,
  onUrgencyFilter,
  onClear,
}: {
  typeFilter: EngageFilter;
  urgencyFilter: UrgencyFilter;
  onTypeFilter: (v: EngageFilter) => void;
  onUrgencyFilter: (v: UrgencyFilter) => void;
  onClear: () => void;
}) {
  const typeOptions: { value: EngageFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "invoices", label: "Invoices" },
    { value: "quotes", label: "Quotes" },
  ];

  const urgencyOptions: { value: UrgencyFilter; label: string }[] = [
    { value: "all", label: "All Urgency" },
    { value: "overdue", label: "Overdue" },
    { value: "due_soon", label: "Due Soon" },
    { value: "pending", label: "Pending" },
  ];

  const hasFilters = typeFilter !== "all" || urgencyFilter !== "all";

  return (
    <motion.div variants={stagger.item} className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-border/30">
        {typeOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onTypeFilter(opt.value)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
              typeFilter === opt.value
                ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/20"
                : "text-muted-foreground/60 hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-border/30">
        {urgencyOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onUrgencyFilter(opt.value)}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
              urgencyFilter === opt.value
                ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/20"
                : "text-muted-foreground/60 hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {hasFilters && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-muted-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-white/[0.03]"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
    </motion.div>
  );
});

export function CommerceEngageTab({
  invoices,
  quotes,
  businessId,
  currency,
  loading,
  setInvoices,
  setQuotes,
  onCreateInvoice,
  onCreateQuote,
  onCreateSchedule,
  onSwitchToBilling,
}: CommerceEngageTabProps) {
  const [typeFilter, setTypeFilter] = useState<EngageFilter>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [recurringCount, setRecurringCount] = useState(0);
  const [aiReminderInvoiceId, setAiReminderInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchRecurringInvoices(businessId).then((res) => {
      if (!cancelled && res.data) {
        setRecurringCount(res.data.filter((r) => r.isActive).length);
      }
    });
    return () => { cancelled = true; };
  }, [businessId]);

  const handleSendReminder = useCallback((invoiceId: string) => {
    setAiReminderInvoiceId(invoiceId);
  }, []);

  const clearFilters = useCallback(() => {
    setTypeFilter("all");
    setUrgencyFilter("all");
  }, []);

  const filteredInvoices = useMemo(() => {
    if (typeFilter === "quotes") return [];
    let result = invoices;
    if (urgencyFilter === "overdue") result = result.filter((inv) => inv.status === "OVERDUE");
    else if (urgencyFilter === "due_soon") result = result.filter((inv) => {
      const days = getDaysUntilDue(inv.dueDate);
      return inv.status === "SENT" && days >= 0 && days <= 7;
    });
    else if (urgencyFilter === "pending") result = result.filter((inv) => inv.status === "SENT" || inv.status === "DRAFT");
    return result;
  }, [invoices, typeFilter, urgencyFilter]);

  const filteredQuotes = useMemo(() => {
    if (typeFilter === "invoices") return [];
    let result = quotes;
    if (urgencyFilter === "overdue") return [];
    if (urgencyFilter === "due_soon") result = result.filter((q) => {
      if (!q.expiryDate) return false;
      const days = getDaysUntilDue(q.expiryDate);
      return days >= 0 && days <= 7;
    });
    if (urgencyFilter === "pending") result = result.filter((q) => q.status === "DRAFT" || q.status === "SENT");
    return result;
  }, [quotes, typeFilter, urgencyFilter]);

  if (loading) return <EngageSkeleton />;

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <HeroStats
        invoices={invoices}
        quotes={quotes}
        recurringCount={recurringCount}
        currency={currency}
      />

      <QuickActionsBar
        onCreateInvoice={onCreateInvoice}
        onCreateQuote={onCreateQuote}
        onCreateSchedule={onCreateSchedule}
      />

      <FilterToolbar
        typeFilter={typeFilter}
        urgencyFilter={urgencyFilter}
        onTypeFilter={setTypeFilter}
        onUrgencyFilter={setUrgencyFilter}
        onClear={clearFilters}
      />

      <AnimatePresence>
        {aiReminderInvoiceId && (
          <AiSmartReminders
            invoiceId={aiReminderInvoiceId}
            businessId={businessId}
            onClose={() => setAiReminderInvoiceId(null)}
          />
        )}
      </AnimatePresence>

      <div className="grid gap-4 lg:grid-cols-2">
        {typeFilter !== "quotes" && (
          <PaymentFollowUpQueue
            invoices={filteredInvoices}
            currency={currency}
            businessId={businessId}
            setInvoices={setInvoices}
            onSendReminder={handleSendReminder}
          />
        )}

        {typeFilter !== "invoices" && (
          <QuoteActionQueue
            quotes={filteredQuotes}
            currency={currency}
            businessId={businessId}
            setQuotes={setQuotes}
            setInvoices={setInvoices}
            onSwitchToBilling={onSwitchToBilling}
          />
        )}
      </div>

      <RevenueRecoveryPlanner
        invoices={invoices}
        currency={currency}
      />
    </motion.div>
  );
}
