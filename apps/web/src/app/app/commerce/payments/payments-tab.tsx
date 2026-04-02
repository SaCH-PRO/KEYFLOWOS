"use client";

import React, { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  TrendingUp,
  Send,
  Loader2,
  ChevronDown,
  Search,
  X,
  Settings,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import type { Invoice, Contact } from "@/lib/client";
import { markInvoicePaid, updateInvoiceStatus } from "@/lib/client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { getStatusBadge } from "../components/commerce-types";
import { EmptyState } from "@/components/ui/empty-state";
import { CashFlowSummary } from "../components/cash-flow-summary";
import { DateRangeFilter, filterByDateRange, DEFAULT_DATE_RANGE } from "../components/date-range-filter";
import type { DateRange } from "../components/date-range-filter";
import { exportToCsv } from "../components/bulk-action-bar";

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

interface PaymentsTabProps {
  invoices: Invoice[];
  currency: string;
  businessId: string | null;
  contacts: Contact[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  onNavigateToInvoices?: () => void;
}

type PaymentView = "all" | "received" | "pending" | "overdue";

const VIEW_FILTERS: { key: PaymentView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "received", label: "Received" },
  { key: "pending", label: "Pending" },
  { key: "overdue", label: "Overdue" },
];

export default function PaymentsTab({
  invoices,
  currency,
  businessId,
  contacts,
  setInvoices,
  onNavigateToInvoices,
}: PaymentsTabProps) {
  const [activeView, setActiveView] = useState<PaymentView>("all");
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOverdue, setExpandedOverdue] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    let totalReceived = 0;
    let receivedThisMonth = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    for (const inv of invoices) {
      const amount = Number(inv.total ?? 0);
      if (inv.status === "PAID") {
        totalReceived += amount;
        paidCount++;
        const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
        if (paidDate && paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear) {
          receivedThisMonth += amount;
        }
      } else if (inv.status === "OVERDUE") {
        totalOverdue += amount;
        overdueCount++;
      } else if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
        const isOverdue = inv.dueDate && new Date(inv.dueDate) < now;
        if (isOverdue) {
          totalOverdue += amount;
          overdueCount++;
        } else {
          totalPending += amount;
          pendingCount++;
        }
      } else if (inv.status === "DRAFT") {
        totalPending += amount;
        pendingCount++;
      }
    }

    return { totalReceived, receivedThisMonth, totalPending, totalOverdue, paidCount, pendingCount, overdueCount };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const now = new Date();
    let list = invoices;

    if (activeView === "received") {
      list = list.filter((inv) => inv.status === "PAID");
    } else if (activeView === "pending") {
      list = list.filter((inv) => {
        if (inv.status === "DRAFT") return true;
        if (inv.status === "SENT" || inv.status === "PARTIALLY_PAID") {
          return !(inv.dueDate && new Date(inv.dueDate) < now);
        }
        return false;
      });
    } else if (activeView === "overdue") {
      list = list.filter(
        (inv) =>
          inv.status === "OVERDUE" ||
          ((inv.status === "SENT" || inv.status === "PARTIALLY_PAID") &&
            inv.dueDate &&
            new Date(inv.dueDate) < now)
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (inv) =>
          (inv.invoiceNumber ?? "").toLowerCase().includes(q) ||
          getContactName(inv.contact).toLowerCase().includes(q) ||
          String(inv.total).includes(q)
      );
    }

    list = filterByDateRange(list, (inv) => inv.paidAt ?? inv.issueDate, dateRange);

    return list.sort(
      (a, b) => new Date(b.paidAt ?? b.issueDate ?? 0).getTime() - new Date(a.paidAt ?? a.issueDate ?? 0).getTime()
    );
  }, [invoices, activeView, searchQuery, dateRange]);

  const overdueQueue = useMemo(() => {
    const now = new Date();
    return invoices
      .filter(
        (inv) =>
          inv.status === "OVERDUE" ||
          ((inv.status === "SENT" || inv.status === "PARTIALLY_PAID") &&
            inv.dueDate &&
            new Date(inv.dueDate) < now)
      )
      .sort((a, b) => getDaysOverdue(b.dueDate) - getDaysOverdue(a.dueDate));
  }, [invoices]);

  const handleMarkPaid = useCallback(
    async (invoiceId: string) => {
      if (actionLoading[invoiceId]) return;
      setActionLoading((prev) => ({ ...prev, [invoiceId]: "paid" }));
      try {
        const { data, error } = await markInvoicePaid(invoiceId);
        if (!error && data) {
          setInvoices((prev) =>
            prev.map((i) => (i.id === invoiceId ? { ...i, status: data.status ?? "PAID" } : i))
          );
          toast.success("Invoice marked as paid");
        } else {
          toast.error(error ?? "Failed to mark paid");
        }
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev };
          delete next[invoiceId];
          return next;
        });
      }
    },
    [actionLoading, setInvoices]
  );

  const handleSendReminder = useCallback(
    async (invoiceId: string) => {
      if (actionLoading[invoiceId]) return;
      setActionLoading((prev) => ({ ...prev, [invoiceId]: "send" }));
      try {
        const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
        if (!error && data) {
          setInvoices((prev) =>
            prev.map((i) => (i.id === invoiceId ? { ...i, status: "SENT" } : i))
          );
          toast.success("Reminder sent");
        } else {
          toast.error(error ?? "Failed to send reminder");
        }
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev };
          delete next[invoiceId];
          return next;
        });
      }
    },
    [actionLoading, setInvoices]
  );

  const methodBreakdown = useMemo(() => {
    const methods: Record<string, { count: number; total: number }> = {};
    for (const inv of invoices) {
      if (inv.status !== "PAID") continue;
      const payments = inv.payments ?? [];
      if (payments.length === 0) {
        const key = "Other";
        if (!methods[key]) methods[key] = { count: 0, total: 0 };
        methods[key].count++;
        methods[key].total += Number(inv.total ?? 0);
      } else {
        for (const p of payments) {
          const key = p.provider || "Other";
          if (!methods[key]) methods[key] = { count: 0, total: 0 };
          methods[key].count++;
          methods[key].total += p.amount;
        }
      }
    }
    return Object.entries(methods)
      .map(([method, data]) => ({ method, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [invoices]);

  const viewCounts = useMemo(() => {
    const now = new Date();
    const isOverdue = (i: Invoice) =>
      i.status === "OVERDUE" ||
      ((i.status === "SENT" || i.status === "PARTIALLY_PAID") && i.dueDate && new Date(i.dueDate) < now);
    return {
      all: invoices.length,
      received: invoices.filter((i) => i.status === "PAID").length,
      pending: invoices.filter(
        (i) => (i.status === "DRAFT" || i.status === "SENT" || i.status === "PARTIALLY_PAID") && !isOverdue(i)
      ).length,
      overdue: invoices.filter((i) => isOverdue(i)).length,
    };
  }, [invoices]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
              Received
            </span>
          </div>
          <p className="text-lg font-bold text-emerald-400">
            {formatCurrencyCompact(stats.totalReceived, currency)}
          </p>
          <p className="text-[10px] text-muted-foreground/50">{stats.paidCount} paid</p>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-blue-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
              This Month
            </span>
          </div>
          <p className="text-lg font-bold text-blue-400">
            {formatCurrencyCompact(stats.receivedThisMonth, currency)}
          </p>
          <p className="text-[10px] text-muted-foreground/50">collected</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
              Pending
            </span>
          </div>
          <p className="text-lg font-bold text-amber-400">
            {formatCurrencyCompact(stats.totalPending, currency)}
          </p>
          <p className="text-[10px] text-muted-foreground/50">{stats.pendingCount} awaiting</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3 text-red-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
              Overdue
            </span>
          </div>
          <p className="text-lg font-bold text-red-400">
            {formatCurrencyCompact(stats.totalOverdue, currency)}
          </p>
          <p className="text-[10px] text-muted-foreground/50">{stats.overdueCount} overdue</p>
        </div>
      </div>

      <CashFlowSummary
        totalReceived={stats.totalReceived}
        totalPending={stats.totalPending}
        totalOverdue={stats.totalOverdue}
        currency={currency}
      />

      {overdueQueue.length > 0 && (
        <div className="rounded-xl border border-red-500/20 bg-card overflow-hidden">
          <button
            onClick={() => setExpandedOverdue(!expandedOverdue)}
            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors"
          >
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold">Recovery Queue</span>
            <span className="text-[10px] text-red-400/70 ml-1">
              {overdueQueue.length} overdue &middot;{" "}
              {formatCurrencyCompact(stats.totalOverdue, currency)}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-muted-foreground/40 ml-auto transition-transform ${
                expandedOverdue ? "rotate-180" : ""
              }`}
            />
          </button>
          <AnimatePresence>
            {expandedOverdue && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="divide-y divide-border/30">
                  {overdueQueue.slice(0, 10).map((inv) => {
                    const daysOver = getDaysOverdue(inv.dueDate);
                    const isLoading = actionLoading[inv.id];
                    return (
                      <div
                        key={inv.id}
                        className="px-4 py-3 hover:bg-white/[0.02] transition-colors flex items-center gap-3"
                      >
                        <div className="p-1.5 rounded-lg bg-red-500/10 shrink-0">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">
                              {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getStatusBadge(inv.status)}`}
                            >
                              {inv.status}
                            </span>
                            <span className="text-[10px] font-medium text-red-400">
                              {daysOver}d overdue
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground/60 block mt-0.5">
                            {getContactName(inv.contact)}
                          </span>
                        </div>
                        <span className="text-sm font-bold shrink-0">
                          {formatCurrency(Number(inv.total), currency)}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleSendReminder(inv.id)}
                            disabled={!!isLoading}
                            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                            title="Send Reminder"
                          >
                            {isLoading === "send" ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            onClick={() => handleMarkPaid(inv.id)}
                            disabled={!!isLoading}
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            title="Mark Paid"
                          >
                            {isLoading === "paid" ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {overdueQueue.length > 10 && (
                  <div className="px-4 py-2 text-center">
                    <span className="text-[10px] text-muted-foreground/50">
                      +{overdueQueue.length - 10} more overdue invoices
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {methodBreakdown.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Payment Methods
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {methodBreakdown.map((m) => (
              <div
                key={m.method}
                className="rounded-lg bg-white/[0.02] border border-border/30 p-2.5"
              >
                <span className="text-[10px] font-medium text-muted-foreground/60 block">
                  {m.method}
                </span>
                <span className="text-sm font-bold block mt-0.5">
                  {formatCurrencyCompact(m.total, currency)}
                </span>
                <span className="text-[10px] text-muted-foreground/40">
                  {m.count} payment{m.count !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search payments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-white/[0.03] border border-border/40 rounded-xl focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground/50" />
              </button>
            )}
          </div>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5 mb-3">
          {VIEW_FILTERS.map((f) => {
            const count = viewCounts[f.key];
            return (
              <button
                key={f.key}
                onClick={() => setActiveView(f.key)}
                className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  activeView === f.key
                    ? "bg-white/[0.08] border border-border/60 text-foreground"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05] hover:text-muted-foreground"
                }`}
              >
                {f.label}
                <span
                  className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                    activeView === f.key
                      ? "bg-white/10"
                      : "bg-white/[0.04] text-muted-foreground/50"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {filteredInvoices.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title={
              activeView === "overdue"
                ? "No overdue payments"
                : activeView === "received"
                  ? "No payments received yet"
                  : activeView === "pending"
                    ? "No pending payments"
                    : "No payment activity"
            }
            description={
              activeView === "overdue"
                ? "All payments are current — great job!"
                : "Payment activity will appear here as invoices are created and paid."
            }
            actionLabel={activeView === "all" ? "Create Invoice" : undefined}
            onAction={activeView === "all" ? onNavigateToInvoices : undefined}
            tip="Payments are tracked automatically from your invoices."
          />
        ) : (
          <div className="space-y-1">
            {filteredInvoices.map((inv) => {
              const isLoading = actionLoading[inv.id];
              const isPaid = inv.status === "PAID";
              const isOverdue =
                inv.status === "OVERDUE" ||
                ((inv.status === "SENT" || inv.status === "PARTIALLY_PAID") &&
                  inv.dueDate &&
                  new Date(inv.dueDate) < new Date());

              return (
                <div
                  key={inv.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                    isOverdue
                      ? "bg-red-500/[0.04] hover:bg-red-500/[0.08]"
                      : isPaid
                        ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]"
                        : "bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-lg shrink-0 ${
                      isPaid
                        ? "bg-emerald-500/15"
                        : isOverdue
                          ? "bg-red-500/15"
                          : "bg-amber-500/15"
                    }`}
                  >
                    {isPaid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : isOverdue ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">
                        {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getStatusBadge(inv.status)}`}
                      >
                        {inv.status}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 block mt-0.5 truncate">
                      {getContactName(inv.contact)}
                    </span>
                  </div>
                  <span className="text-xs font-bold shrink-0">
                    {formatCurrency(Number(inv.total), currency)}
                  </span>
                  {!isPaid && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleSendReminder(inv.id)}
                        disabled={!!isLoading}
                        className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                        title="Send Reminder"
                      >
                        {isLoading === "send" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Send className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        onClick={() => handleMarkPaid(inv.id)}
                        disabled={!!isLoading}
                        className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        title="Mark Paid"
                      >
                        {isLoading === "paid" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Link
        href="/app/settings/business?tab=payments"
        className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/5 hover:bg-muted/10 transition-colors group"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-muted/20">
            <Settings className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-medium">Payment Settings</p>
            <p className="text-[10px] text-muted-foreground/60">Configure payment gateways, methods & preferences</p>
          </div>
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </Link>
    </motion.div>
  );
}
