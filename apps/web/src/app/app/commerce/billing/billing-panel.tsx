"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  CreditCard,
  RefreshCw,
  DollarSign,
  Clock,
  AlertTriangle,
  TrendingUp,
  Mail,
  Send,
  CheckCircle2,
  Loader2,
  Bot,
  Copy,
  X,
  ChevronDown,
  Sparkles,
  ChevronRight,
  Bell,
  Pencil,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { toast } from "sonner";
import { useModuleEmit } from "@/hooks/use-module-events";
import { Skeleton } from "@/components/ui/skeleton";
import type { Invoice, Quote, Contact, Product } from "@/lib/client";
import {
  fetchCommerceStats, fetchRecurringInvoices, type CommerceStats,
  markInvoicePaid, updateInvoiceStatus, updateQuoteStatus,
  convertQuoteToInvoice, commerceAiInvoiceReminder,
  type CommerceInvoiceReminder,
} from "@/lib/client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { getStatusBadge } from "../components/commerce-types";
import { useBillingStats } from "../hooks/use-billing-stats";
import type { BillingSlots } from "../utils/commerce-slots";
import { SAVED_VIEWS, type SavedViewKey } from "../utils/smart-cta";
import QuotesPanel from "../quotes/quotes-panel";
import InvoicesPanel from "../invoices/invoices-panel";
import RecurringPanel from "../recurring/recurring-panel";
import CollectionsPanel from "./collections-panel";
import Link from "next/link";

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
      .filter((inv) => inv.status === "OVERDUE" || inv.status === "SENT" || inv.status === "PARTIALLY_PAID")
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

  if (actionableInvoices.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Payment Follow-Up</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50 font-medium">{actionableInvoices.length} pending</span>
      </div>
      <div className="space-y-1">
        {visible.map((inv) => {
          const daysOver = getDaysOverdue(inv.dueDate);
          const isOverdue = inv.status === "OVERDUE";
          const isLoading = actionLoading[inv.id];
          return (
            <div
              key={inv.id}
              className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                isOverdue ? "bg-red-500/[0.04] hover:bg-red-500/[0.08]" : "bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${isOverdue ? "bg-red-500/15" : "bg-amber-500/15"}`}>
                {isOverdue ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> : <Clock className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getStatusBadge(inv.status)}`}>{inv.status}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground/60 truncate">{getContactName(inv.contact)}</span>
                  {isOverdue && daysOver > 0 && <span className="text-[10px] font-medium text-red-400">{daysOver}d overdue</span>}
                </div>
              </div>
              <span className="text-xs font-bold shrink-0">{formatCurrency(Number(inv.total), currency)}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onSendReminder(inv.id)} disabled={!!isLoading} className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50" title="Send Reminder">
                  {isLoading === "send" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
                <button onClick={() => handleMarkPaid(inv.id)} disabled={!!isLoading} className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50" title="Mark Paid">
                  {isLoading === "paid" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {actionableInvoices.length > 5 && (
        <button onClick={() => setShowAll(!showAll)} className="w-full mt-2 py-1.5 text-[10px] font-medium text-muted-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-white/[0.02]">
          {showAll ? "Show less" : `Show ${actionableInvoices.length - 5} more`}
        </button>
      )}
    </div>
  );
});

const QuoteActionQueue = React.memo(function QuoteActionQueue({
  quotes,
  currency,
  businessId,
  setQuotes,
  setInvoices,
  onSwitchToInvoices,
}: {
  quotes: Quote[];
  currency: string;
  businessId: string | null;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  onSwitchToInvoices: () => void;
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
        onSwitchToInvoices();
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

  if (pendingQuotes.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Quote Actions</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50 font-medium">{pendingQuotes.length} pending</span>
      </div>
      <div className="space-y-1">
        {visible.map((quote) => {
          const isLoading = actionLoading[quote.id];
          const expiringSoon = isExpiringSoon(quote);
          return (
            <div
              key={quote.id}
              className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
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
                  {expiringSoon && <span className="text-[10px] font-medium text-amber-400">Expiring soon</span>}
                </div>
                <span className="text-[10px] text-muted-foreground/60 truncate block mt-0.5">{getContactName(quote.contact)}</span>
              </div>
              <span className="text-xs font-bold shrink-0">{formatCurrency(Number(quote.total), currency)}</span>
              <div className="flex items-center gap-1 shrink-0">
                {quote.status === "DRAFT" && (
                  <button onClick={() => handleSend(quote.id)} disabled={!!isLoading} className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50" title="Send Quote">
                    {isLoading === "send" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  </button>
                )}
                {quote.status === "SENT" && (
                  <button onClick={() => handleAccept(quote.id)} disabled={!!isLoading} className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50" title="Accept Quote">
                    {isLoading === "accept" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  </button>
                )}
                {quote.status === "ACCEPTED" && !quote.invoiceId && (
                  <button onClick={() => handleConvert(quote)} disabled={!!isLoading} className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50" title="Convert to Invoice">
                    {isLoading === "convert" ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {pendingQuotes.length > 5 && (
        <button onClick={() => setShowAll(!showAll)} className="w-full mt-2 py-1.5 text-[10px] font-medium text-muted-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-white/[0.02]">
          {showAll ? "Show less" : `Show ${pendingQuotes.length - 5} more`}
        </button>
      )}
    </div>
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
      className="rounded-xl border border-[hsl(var(--kf-accent1))]/30 bg-card/80 backdrop-blur-sm p-4 overflow-hidden"
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
            <button onClick={() => handleCopy(reminder.message)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors">
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
                    <button onClick={() => handleCopy(alt.message)} className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline mt-1">Copy</button>
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

export type BillingSegment = "quotes" | "invoices" | "schedules" | "collections";

const SEGMENTS: { key: BillingSegment; label: string; icon: React.ElementType; accent: string; accentMuted: string }[] = [
  { key: "quotes", label: "Quotes", icon: FileText, accent: "hsl(var(--kf-accent1))", accentMuted: "hsl(var(--kf-accent1) / 0.15)" },
  { key: "invoices", label: "Invoices", icon: CreditCard, accent: "hsl(var(--kf-success))", accentMuted: "hsl(var(--kf-success) / 0.15)" },
  { key: "schedules", label: "Recurring", icon: RefreshCw, accent: "hsl(var(--kf-info))", accentMuted: "hsl(var(--kf-info) / 0.15)" },
  { key: "collections", label: "Collections", icon: AlertTriangle, accent: "hsl(var(--kf-error))", accentMuted: "hsl(var(--kf-error) / 0.15)" },
];
interface BillingPanelProps {
  businessId: string | null;
  contacts: Contact[];
  products: Product[];
  quotes: Quote[];
  invoices: Invoice[];
  loading: boolean;
  gmailStatus: { connected: boolean; email: string | null } | null;
  currency: string;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  triggerNewQuote?: number;
  triggerNewInvoice?: number;
  triggerNewSchedule?: number;
  defaultSegment?: BillingSegment;
  activeSegment?: BillingSegment;
  hideSegmentNav?: boolean;
  onSegmentChange?: (segment: BillingSegment) => void;
  prefillContactId?: string;
  prefillItems?: import("../components/commerce-types").InvoiceLineItem[];
  prefillToken?: number;
  onPrefillApplied?: () => void;
  slots?: BillingSlots;
  onViewContact?: (contactId: string) => void;
  onViewClientIntel?: (contactId: string) => void;
  onSelectProduct?: (productId: string) => void;
  onAiRecoveryPlan?: () => void;
  onAiForecast?: () => void;
  onAiDraftReminder?: (invoiceId: string) => void;
}

function SavedViewsRail({
  activeView,
  onViewChange,
  invoices,
  quotes,
  schedulesCount,
}: {
  activeView: SavedViewKey;
  onViewChange: (view: SavedViewKey) => void;
  invoices: Invoice[];
  quotes: Quote[];
  schedulesCount: number;
}) {
  const invoiceViews = SAVED_VIEWS.filter((v) => v.section === "invoices");
  const quoteViews = SAVED_VIEWS.filter((v) => v.section === "quotes");
  const scheduleViews = SAVED_VIEWS.filter((v) => v.section === "schedules");

  function renderGroup(label: string, views: typeof SAVED_VIEWS) {
    return (
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 px-3 mb-1">
          {label}
        </p>
        {views.map((view) => {
          const isActive = activeView === view.key;
          const count =
            view.key === "recurring"
              ? schedulesCount
              : view.filterFn(invoices, quotes);
          const Icon = view.icon;
          return (
            <button
              key={view.key}
              onClick={() => onViewChange(view.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium rounded-lg transition-all ${
                isActive
                  ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/20"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 text-left truncate">{view.label}</span>
              {count > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                    isActive
                      ? "bg-[hsl(var(--kf-accent1))]/20"
                      : "bg-white/[0.06] text-muted-foreground/60"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-[200px] shrink-0 border-r border-border/30 py-3 overflow-y-auto hidden lg:block">
      {renderGroup("Invoices", invoiceViews)}
      {renderGroup("Quotes", quoteViews)}
      {renderGroup("Schedules", scheduleViews)}
    </div>
  );
}

export function BillingPanel({
  businessId,
  contacts,
  products,
  quotes,
  invoices,
  loading,
  gmailStatus,
  currency,
  setProducts,
  setQuotes,
  setInvoices,
  triggerNewQuote = 0,
  triggerNewInvoice = 0,
  triggerNewSchedule = 0,
  defaultSegment = "invoices",
  activeSegment,
  hideSegmentNav = false,
  onSegmentChange,
  prefillContactId,
  prefillItems,
  prefillToken,
  onPrefillApplied,
  slots,
  onViewContact,
  onViewClientIntel,
  onSelectProduct,
  onAiRecoveryPlan,
  onAiForecast,
  onAiDraftReminder,
}: BillingPanelProps) {
  const router = useRouter();
  const { pushContext, setTaskOrigin, current } = useNavigationContext();
  const [segment, setSegment] = useState<BillingSegment>(defaultSegment);
  const [savedView, setSavedView] = useState<SavedViewKey>("all_invoices");
  const emitEvent = useModuleEmit();
  const [serverStats, setServerStats] = useState<CommerceStats | null>(null);
  const [schedulesCount, setSchedulesCount] = useState(0);

  useEffect(() => {
    if (activeSegment && activeSegment !== segment) {
      setSegment(activeSegment);
    }
  }, [activeSegment]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchCommerceStats(businessId).then((res) => {
      if (!cancelled && res.data) setServerStats(res.data);
    });
    fetchRecurringInvoices(businessId).then((res) => {
      if (!cancelled && res.data) setSchedulesCount(res.data.length);
    });
    return () => { cancelled = true; };
  }, [businessId, invoices.length, quotes.length]);

  const clientStats = useBillingStats(invoices, quotes);

  const stats = useMemo(() => {
    if (serverStats) {
      return {
        totalRevenue: serverStats.totalRevenue,
        outstanding: serverStats.outstandingAmount,
        overdueAmount: serverStats.overdueAmount,
        overdueCount: serverStats.invoiceStatusBreakdown?.OVERDUE?.count ?? 0,
        conversionRate: serverStats.quoteConversionRate,
      };
    }
    return clientStats;
  }, [serverStats, clientStats]);

  const handleSegmentChange = useCallback((s: BillingSegment) => {
    if (s === segment) return;
    setSegment(s);
    onSegmentChange?.(s);
    emitEvent("module:view_changed", "commerce", { segment: s });
  }, [segment, emitEvent, onSegmentChange]);

  const switchToInvoices = useCallback(() => {
    handleSegmentChange("invoices");
  }, [handleSegmentChange]);

  const handleViewChange = useCallback((view: SavedViewKey) => {
    setSavedView(view);
    const viewDef = SAVED_VIEWS.find((v) => v.key === view);
    if (viewDef) {
      handleSegmentChange(viewDef.section);
    }
  }, [handleSegmentChange]);

  const collectionsCount = useMemo(() =>
    invoices.filter((inv) => inv.status === "OVERDUE" || (inv.status === "SENT" && inv.dueDate && new Date(inv.dueDate) < new Date())).length,
    [invoices],
  );

  const segmentCounts = useMemo(() => ({
    quotes: quotes.length,
    invoices: invoices.length,
    schedules: schedulesCount,
    collections: collectionsCount,
  }), [quotes.length, invoices.length, schedulesCount, collectionsCount]);

  const activeViewDef = SAVED_VIEWS.find((v) => v.key === savedView);
  const statusFilterFromView = activeViewDef?.statusFilter;

  const collectionRate = useMemo(() => {
    const totalSent = invoices.filter((inv) => inv.status !== "DRAFT").length;
    const paidCount = invoices.filter((inv) => inv.status === "PAID").length;
    return totalSent > 0 ? Math.round((paidCount / totalSent) * 100) : 0;
  }, [invoices]);

  const pendingQuotesCount = useMemo(() =>
    quotes.filter((q) => q.status === "DRAFT" || q.status === "SENT").length, [quotes]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 overflow-x-auto scrollbar-none shrink-0">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-white/[0.03]"
              style={{ animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite` }}
            >
              <div className="w-3 h-3 rounded bg-muted/30 shrink-0" />
              <div className="h-3 bg-muted/30 rounded w-10" />
            </div>
          ))
        ) : (
          <>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-white/[0.03] text-sm" role="status">
              <DollarSign className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <span className="font-semibold text-[11px]">{formatCurrencyCompact(stats.totalRevenue, currency)}</span>
              <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">Revenue</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-white/[0.03] text-sm" role="status">
              <Clock className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
              <span className="font-semibold text-[11px]">{formatCurrencyCompact(stats.outstanding, currency)}</span>
              <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">Owed</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-white/[0.03] text-sm" role="status">
              <TrendingUp className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <span className="font-semibold text-[11px]">{stats.conversionRate}%</span>
              <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">Conversion</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/50 bg-white/[0.03] text-sm" role="status">
              <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <span className="font-semibold text-[11px]">{collectionRate}%</span>
              <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">Collected</span>
            </div>
            {stats.overdueCount > 0 && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/[0.06] text-sm" role="status">
                <AlertTriangle className="w-3 h-3 shrink-0 text-red-400" />
                <span className="font-semibold text-[11px] text-red-400">{formatCurrencyCompact(stats.overdueAmount, currency)}</span>
                <span className="text-[10px] text-red-300/60 hidden sm:inline">Overdue</span>
              </div>
            )}
          </>
        )}

        {onAiForecast && (
          <button
            onClick={onAiForecast}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-purple-500/30 bg-purple-500/[0.06] hover:bg-purple-500/10 text-sm transition-all duration-200 shrink-0"
            title="AI Cash Flow Forecast"
          >
            <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
            <span className="text-[10px] text-purple-300 hidden sm:inline">Forecast</span>
          </button>
        )}

        <button
          onClick={() => {
            if (current) setTaskOrigin(current);
            pushContext({ taskIntent: "connect-email", workspace: "Revenue" });
            router.push("/app/settings/connections");
          }}
          className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-sm transition-all duration-200 shrink-0 ${
            gmailStatus?.connected
              ? "border-green-500/30 bg-green-500/[0.06] hover:bg-green-500/10"
              : "border-amber-500/30 bg-amber-500/[0.06] hover:bg-amber-500/10"
          }`}
          title={gmailStatus?.connected ? `Email connected: ${gmailStatus.email}` : "Email not connected"}
        >
          <span className="relative flex h-2 w-2">
            {gmailStatus?.connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${gmailStatus?.connected ? "bg-green-500" : "bg-amber-500"}`} />
          </span>
          <Mail className={`w-3.5 h-3.5 ${gmailStatus?.connected ? "text-green-400" : "text-amber-400"}`} />
        </button>
      </div>

      {slots?.renderKpiExtra?.()}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SavedViewsRail
          activeView={savedView}
          onViewChange={handleViewChange}
          invoices={invoices}
          quotes={quotes}
          schedulesCount={schedulesCount}
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          {!hideSegmentNav && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border/30 lg:hidden">
              {([
                { key: "invoices" as const, label: "Invoices", icon: CreditCard },
                { key: "quotes" as const, label: "Quotes", icon: FileText },
                { key: "schedules" as const, label: "Schedules", icon: RefreshCw },
                { key: "collections" as const, label: "Collections", icon: AlertTriangle },
              ]).map((seg) => (
                <button
                  key={seg.key}
                  onClick={() => handleSegmentChange(seg.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    segment === seg.key
                      ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/20"
                      : "text-muted-foreground hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  <seg.icon className="w-3.5 h-3.5" />
                  {seg.label}
                </button>
              ))}
            </div>
          )}

          {slots?.renderInsightBanner?.()}

          <div className="p-3 sm:p-4">
            <AnimatePresence mode="wait">
              {segment === "quotes" && (
                <motion.div
                  key="quotes"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <QuotesPanel
                    quotes={quotes}
                    contacts={contacts}
                    products={products}
                    businessId={businessId}
                    loading={loading}
                    gmailStatus={gmailStatus}
                    setProducts={setProducts}
                    setQuotes={setQuotes}
                    setInvoices={setInvoices}
                    onSwitchToInvoices={switchToInvoices}
                    currency={currency}
                    triggerNew={triggerNewQuote}
                    prefillContactId={segment === "quotes" ? prefillContactId : undefined}
                    prefillItems={segment === "quotes" ? prefillItems : undefined}
                    prefillToken={segment === "quotes" ? prefillToken : undefined}
                    onPrefillApplied={onPrefillApplied}
                    renderTimelineBadge={slots?.renderTimelineBadge}
                    onViewContact={onViewContact}
                    onViewClientIntel={onViewClientIntel}
                    onSelectProduct={onSelectProduct}
                    initialStatusFilter={statusFilterFromView}
                  />
                </motion.div>
              )}
              {segment === "invoices" && (
                <motion.div
                  key="invoices"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <InvoicesPanel
                    invoices={invoices}
                    contacts={contacts}
                    products={products}
                    businessId={businessId}
                    loading={loading}
                    setProducts={setProducts}
                    setInvoices={setInvoices}
                    gmailStatus={gmailStatus}
                    currency={currency}
                    triggerNew={triggerNewInvoice}
                    prefillContactId={segment === "invoices" ? prefillContactId : undefined}
                    prefillItems={segment === "invoices" ? prefillItems : undefined}
                    prefillToken={segment === "invoices" ? prefillToken : undefined}
                    onPrefillApplied={onPrefillApplied}
                    renderTimelineBadge={slots?.renderTimelineBadge}
                    onViewContact={onViewContact}
                    onViewClientIntel={onViewClientIntel}
                    onSelectProduct={onSelectProduct}
                    onAiDraftReminder={onAiDraftReminder}
                    initialStatusFilter={statusFilterFromView}
                  />
                </motion.div>
              )}
              {segment === "schedules" && (
                <motion.div
                  key="schedules"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <RecurringPanel
                    businessId={businessId}
                    contacts={contacts}
                    products={products}
                    triggerNew={triggerNewSchedule}
                    currency={currency}
                  />
                </motion.div>
              )}
              {segment === "collections" && (
                <motion.div
                  key="collections"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <CollectionsPanel
                    invoices={invoices}
                    quotes={quotes}
                    currency={currency}
                    businessId={businessId}
                    contacts={contacts}
                    setInvoices={setInvoices}
                    onAiRecoveryPlan={onAiRecoveryPlan}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="px-3 sm:px-4 pb-4">
            <Link
              href="/app/settings/business"
              className="flex items-center justify-between w-full rounded-xl border border-border/30 bg-white/[0.03] px-4 py-3 text-sm font-medium text-foreground/90 hover:bg-white/[0.04] transition-colors group"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                Billing & Invoice Settings
              </span>
              <span className="text-xs text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors">
                Manage in Settings →
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
