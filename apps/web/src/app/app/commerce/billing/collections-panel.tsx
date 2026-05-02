"use client";

import React, { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  Send,
  CheckCircle2,
  Loader2,
  Bot,
  Copy,
  X,
  Phone,
  Mail,
  Calendar,
  TrendingUp,
  Shield,
  Sparkles,
  ChevronDown,
  MessageSquare,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import type { Invoice, Contact } from "@/lib/client";
import {
  markInvoicePaid,
  updateInvoiceStatus,
  commerceAiInvoiceReminder,
  type CommerceInvoiceReminder,
} from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import { getStatusBadge } from "../components/commerce-types";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerBadge } from "../components/customer-badge";
import { useCustomerBadgeMap } from "../hooks/use-customer-badge";
import type { Quote } from "@/lib/client";

function getDaysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function getContactName(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!contact) return "Unknown";
  return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
}

type RecoveryPriority = "critical" | "high" | "medium" | "low";

interface OverdueItem {
  invoice: Invoice;
  daysOverdue: number;
  priority: RecoveryPriority;
  estimatedRecovery: number;
}

function computePriority(inv: Invoice, daysOverdue: number): RecoveryPriority {
  const amount = Number(inv.total ?? 0);
  if (daysOverdue > 60 || amount > 5000) return "critical";
  if (daysOverdue > 30 || amount > 2000) return "high";
  if (daysOverdue > 14 || amount > 500) return "medium";
  return "low";
}

function estimateRecovery(amount: number, daysOverdue: number): number {
  if (daysOverdue <= 14) return amount * 0.95;
  if (daysOverdue <= 30) return amount * 0.85;
  if (daysOverdue <= 60) return amount * 0.65;
  return amount * 0.4;
}

const PRIORITY_CONFIG: Record<RecoveryPriority, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: "Critical", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/25" },
  high: { label: "High", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/25" },
  medium: { label: "Medium", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25" },
  low: { label: "Low", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/25" },
};

const TONE_OPTIONS = [
  { value: "friendly", label: "Friendly", icon: MessageSquare },
  { value: "professional", label: "Professional", icon: Mail },
  { value: "firm", label: "Firm", icon: Shield },
  { value: "urgent", label: "Urgent", icon: AlertTriangle },
];

const PAYMENT_PLAN_SUGGESTIONS = [
  { label: "2 installments", months: 2, icon: Calendar },
  { label: "3 installments", months: 3, icon: Calendar },
  { label: "50% now, rest in 30d", months: 1, icon: DollarSign },
];

interface CollectionsPanelProps {
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
  businessId: string | null;
  contacts: Contact[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  onAiRecoveryPlan?: () => void;
}

export default function CollectionsPanel({
  invoices,
  quotes,
  currency,
  businessId,
  contacts: _contacts,
  setInvoices,
  onAiRecoveryPlan,
}: CollectionsPanelProps) {
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [reminderData, setReminderData] = useState<CommerceInvoiceReminder | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [selectedTone, setSelectedTone] = useState("professional");
  const [copied, setCopied] = useState(false);
  const [contactAttempts, setContactAttempts] = useState<Record<string, { count: number; lastDate: string }>>({});
  const [showPaymentPlan, setShowPaymentPlan] = useState<string | null>(null);
  const [expandedQueue, setExpandedQueue] = useState(true);

  const badgeMap = useCustomerBadgeMap(invoices, quotes);

  const overdueQueue = useMemo<OverdueItem[]>(() => {
    return invoices
      .filter((inv) => inv.status === "OVERDUE" || (inv.status === "SENT" && inv.dueDate && new Date(inv.dueDate) < new Date()))
      .map((inv) => {
        const days = getDaysOverdue(inv.dueDate);
        const priority = computePriority(inv, days);
        const amount = Number(inv.total ?? 0);
        return {
          invoice: inv,
          daysOverdue: days,
          priority,
          estimatedRecovery: estimateRecovery(amount, days),
        };
      })
      .sort((a, b) => {
        const prioOrder: Record<RecoveryPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        const prioDiff = prioOrder[a.priority] - prioOrder[b.priority];
        if (prioDiff !== 0) return prioDiff;
        return b.daysOverdue - a.daysOverdue;
      });
  }, [invoices]);

  const summaryStats = useMemo(() => {
    const totalOverdue = overdueQueue.reduce((sum, item) => sum + Number(item.invoice.total ?? 0), 0);
    const totalRecoverable = overdueQueue.reduce((sum, item) => sum + item.estimatedRecovery, 0);
    const criticalCount = overdueQueue.filter((i) => i.priority === "critical").length;
    const avgDaysOverdue = overdueQueue.length > 0
      ? Math.round(overdueQueue.reduce((sum, i) => sum + i.daysOverdue, 0) / overdueQueue.length)
      : 0;
    return { totalOverdue, totalRecoverable, criticalCount, avgDaysOverdue, count: overdueQueue.length };
  }, [overdueQueue]);

  const handleGenerateReminder = useCallback(async (invoiceId: string) => {
    if (!businessId) return;
    setSelectedInvoiceId(invoiceId);
    setReminderLoading(true);
    setReminderData(null);
    try {
      const res = await commerceAiInvoiceReminder(invoiceId, businessId, selectedTone);
      if (res.data) setReminderData(res.data);
    } catch {
      toast.error("Failed to generate reminder");
    } finally {
      setReminderLoading(false);
    }
  }, [businessId, selectedTone]);

  const handleCopyReminder = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }, []);

  const handleMarkPaid = useCallback(async (invoiceId: string) => {
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
  }, [actionLoading, setInvoices]);

  const handleSendReminder = useCallback(async (invoiceId: string) => {
    if (actionLoading[invoiceId]) return;
    setActionLoading((prev) => ({ ...prev, [invoiceId]: "send" }));
    try {
      const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: "SENT" } : i)));
        toast.success("Reminder sent");
      } else {
        toast.error(error ?? "Failed to send reminder");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
    }
  }, [actionLoading, setInvoices]);

  const recordContactAttempt = useCallback((invoiceId: string) => {
    setContactAttempts((prev) => ({
      ...prev,
      [invoiceId]: {
        count: (prev[invoiceId]?.count ?? 0) + 1,
        lastDate: new Date().toISOString(),
      },
    }));
    toast.success("Contact attempt recorded");
  }, []);

  if (overdueQueue.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 text-center"
      >
        <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Collections Clear</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          No overdue invoices. All payments are up to date.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Total Overdue</span>
          </div>
          <p className="text-lg font-bold text-red-400">{formatCurrency(summaryStats.totalOverdue, currency)}</p>
          <p className="text-[10px] text-muted-foreground/50">{summaryStats.count} invoice{summaryStats.count !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Est. Recoverable</span>
          </div>
          <p className="text-lg font-bold text-emerald-400">{formatCurrency(summaryStats.totalRecoverable, currency)}</p>
          <p className="text-[10px] text-muted-foreground/50">{Math.round((summaryStats.totalRecoverable / summaryStats.totalOverdue) * 100)}% recovery rate</p>
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-3 h-3 text-orange-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Critical</span>
          </div>
          <p className="text-lg font-bold text-orange-400">{summaryStats.criticalCount}</p>
          <p className="text-[10px] text-muted-foreground/50">Need immediate action</p>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-blue-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Avg Overdue</span>
          </div>
          <p className="text-lg font-bold text-blue-400">{summaryStats.avgDaysOverdue}d</p>
          <p className="text-[10px] text-muted-foreground/50">Average days past due</p>
        </div>
      </div>

      {onAiRecoveryPlan && (
        <button
          onClick={onAiRecoveryPlan}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-purple-300">Generate AI Recovery Plan</span>
        </button>
      )}

      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <button
          onClick={() => setExpandedQueue(!expandedQueue)}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors"
        >
          <DollarSign className="w-4 h-4 text-muted-foreground/50" />
          <span className="text-sm font-semibold">Recovery Queue</span>
          <span className="text-[10px] text-muted-foreground/50 ml-1">{overdueQueue.length} items</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/40 ml-auto transition-transform ${expandedQueue ? "rotate-180" : ""}`} />
        </button>

        <AnimatePresence>
          {expandedQueue && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="divide-y divide-border/30">
                {overdueQueue.map((item) => {
                  const inv = item.invoice;
                  const isLoading = actionLoading[inv.id];
                  const prioCfg = PRIORITY_CONFIG[item.priority];
                  const badge = inv.contactId ? badgeMap.get(inv.contactId) : null;
                  const attempts = contactAttempts[inv.id];

                  return (
                    <div key={inv.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${prioCfg.bg}`}>
                          <AlertTriangle className={`w-3.5 h-3.5 ${prioCfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${prioCfg.bg} ${prioCfg.color} ${prioCfg.border} font-medium`}>
                              {prioCfg.label}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getStatusBadge(inv.status)}`}>{inv.status}</span>
                            {badge && <CustomerBadge badge={badge} size="sm" />}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground/60">{getContactName(inv.contact)}</span>
                            <span className="text-[10px] font-medium text-red-400">{item.daysOverdue}d overdue</span>
                            <span className="text-[10px] text-emerald-400">
                              ~{formatCurrency(item.estimatedRecovery, currency)} recoverable
                            </span>
                          </div>
                          {attempts && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <Phone className="w-2.5 h-2.5 text-muted-foreground/40" />
                              <span className="text-[10px] text-muted-foreground/50">
                                {attempts.count} attempt{attempts.count > 1 ? "s" : ""} · Last: {new Date(attempts.lastDate).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-bold">{formatCurrency(Number(inv.total), currency)}</span>
                          <div className="flex items-center gap-1 mt-1.5 justify-end">
                            <button
                              onClick={() => handleGenerateReminder(inv.id)}
                              className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                              title="AI Reminder"
                            >
                              <Bot className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => recordContactAttempt(inv.id)}
                              className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                              title="Log Contact Attempt"
                            >
                              <Phone className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setShowPaymentPlan(showPaymentPlan === inv.id ? null : inv.id)}
                              className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
                              title="Payment Plan"
                            >
                              <CreditCard className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleSendReminder(inv.id)}
                              disabled={!!isLoading}
                              className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
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
                      </div>

                      <AnimatePresence>
                        {showPaymentPlan === inv.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-border/30">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">Suggested Payment Plans</span>
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                {PAYMENT_PLAN_SUGGESTIONS.map((plan) => {
                                  const total = Number(inv.total ?? 0);
                                  const perInstallment = plan.months > 1 ? total / plan.months : total * 0.5;
                                  return (
                                    <button
                                      key={plan.label}
                                      onClick={() => {
                                        toast.success(`Payment plan suggestion: ${plan.label} — ${formatCurrency(perInstallment, currency)}/installment`);
                                      }}
                                      className="p-2 rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-left"
                                    >
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <plan.icon className="w-3 h-3 text-purple-400" />
                                        <span className="text-[10px] font-medium">{plan.label}</span>
                                      </div>
                                      <span className="text-[10px] text-muted-foreground/50">
                                        {formatCurrency(perInstallment, currency)}/payment
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selectedInvoiceId && (
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
              <button onClick={() => { setSelectedInvoiceId(null); setReminderData(null); }} className="p-1 rounded-lg hover:bg-muted transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-medium">Tone:</span>
              {TONE_OPTIONS.map((tone) => (
                <button
                  key={tone.value}
                  onClick={() => setSelectedTone(tone.value)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors border ${
                    selectedTone === tone.value
                      ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]/30"
                      : "bg-white/[0.02] text-muted-foreground/60 border-border/30 hover:bg-white/[0.05]"
                  }`}
                >
                  <tone.icon className="w-2.5 h-2.5" />
                  {tone.label}
                </button>
              ))}
            </div>

            {reminderLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : reminderData ? (
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Subject</span>
                  <p className="text-sm font-medium mt-0.5">{reminderData.subject}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Message</span>
                  <p className="text-xs text-muted-foreground/80 mt-1 p-3 rounded-xl bg-white/[0.03] border border-border/30 whitespace-pre-wrap">
                    {reminderData.message}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyReminder(reminderData.message)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                  >
                    {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy Message"}
                  </button>
                </div>
                {reminderData.alternativeMessages?.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors">
                      Alternative tones ({reminderData.alternativeMessages.length})
                    </summary>
                    <div className="space-y-2 mt-2">
                      {reminderData.alternativeMessages.map((alt, i) => (
                        <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/20">
                          <span className="text-[10px] font-medium text-muted-foreground/50 capitalize">{alt.tone}</span>
                          <p className="text-xs text-muted-foreground/70 mt-1">{alt.message}</p>
                          <button
                            onClick={() => handleCopyReminder(alt.message)}
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
              <p className="text-xs text-muted-foreground/60">Click the AI button on any invoice to generate a reminder.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
