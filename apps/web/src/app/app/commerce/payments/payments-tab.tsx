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
} from "lucide-react";
import { toast } from "sonner";
import type { Invoice, PaymentRecord } from "@/lib/client";
import {
  getInvoice,
  markInvoicePaid,
  sendInvoiceReminder,
} from "@/lib/client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { invoiceBalanceOfStoredRows, readStoredPaymentRows } from "@keyflow/shared";
import { getStatusBadge } from "../components/commerce-types";
import { EmptyState } from "@/components/ui/empty-state";
import { CashFlowSummary } from "../components/cash-flow-summary";
import { DateRangeFilter, filterByDateRange, DEFAULT_DATE_RANGE } from "../components/date-range-filter";
import type { DateRange } from "../components/date-range-filter";
import { BulkActionBar, exportToCsv } from "../components/bulk-action-bar";

function getDaysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// FOLLOW3-A8 review (SEC-A8-1 / A8-CR-1): a reminder is only for an invoice that
// was issued and is still owed, the same set the invoice detail page and the
// mobile actions offer one for. DRAFT/PENDING were never issued (the public link
// in the email would be dead), FULLY_CREDITED/VOID/PAID owe nothing, FAILED is
// not a live invoice: none of them is reminded from this tab.
const REMINDABLE_STATUSES: ReadonlySet<string> = new Set(["SENT", "OVERDUE", "PARTIALLY_PAID"]);

function canRemind(status: string | null | undefined): boolean {
  return !!status && REMINDABLE_STATUSES.has(status);
}

/**
 * The invoices whose remaining balance this tab, the Sales overview hero and
 * the cash-flow summary count as owed (invoiceMoney's owedCents): the web's one
 * list, mirroring the server's OPEN_RECEIVABLE_STATUSES (commerce-stats.service)
 * less PARTIALLY_CREDITED, which the list row cannot net (it carries no credit
 * note). A PENDING invoice counts as owed everywhere (owner ruling D-256).
 */
export const OWED_STATUSES: ReadonlySet<string> = new Set(["PENDING", "SENT", "OVERDUE", "PARTIALLY_PAID"]);

/**
 * V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-024, BUG-020; D-14, D-75): one
 * invoice's money as this tab states it, read from the invoice's own payment
 * rows through the shared balance contract (invoiceBalanceOfStoredRows, the
 * mirror of the server's balanceOfStoredRows), in integer cents. Every figure,
 * count and list of the tab goes through it, so a label means one thing.
 *  - cash: the money in (SUCCESSFUL) and out (a refund) with its date and its
 *    method. A PAID invoice counts its full total (owner rulings D-249,
 *    D-250): what its rows do not record as received counts on the day it was
 *    paid, under "Other", as the server's stats read it.
 *  - netCents: the sum of cash; `received` when it is above zero (the
 *    invoices the Received figure, its count, its filter and its list mean).
 *  - leftCents: what the rows leave of the total, never below zero and never
 *    more than the total (D-250).
 *  - owedCents: leftCents on an issued, unsettled invoice (OWED_STATUSES:
 *    PENDING, SENT, PARTIALLY_PAID, OVERDUE); 0 on any other invoice. A draft was never sent:
 *    it is counted apart ("drafts unsent"). A PARTIALLY_CREDITED invoice is
 *    not counted here: the list row carries no credit note, so what is left
 *    of it cannot be told (the server's stats count it).
 *  - state: "overdue" when something is owed past the due date (or the invoice
 *    is flagged OVERDUE), "pending" when something is owed and not yet due.
 */
export function invoiceMoney(inv: Invoice, now: Date) {
  const cents = (amount: number) => Math.round((Number(amount) || 0) * 100);
  const rows = inv.payments ?? [];
  const total = Number(inv.total ?? 0) || 0;
  const balance = invoiceBalanceOfStoredRows(total, rows, inv.currency);
  const cash: Array<{ cents: number; at: Date | null; method: string; payment: boolean }> = [];
  for (const row of rows) {
    const at = row.createdAt ? new Date(row.createdAt) : null;
    const method = row.provider || "Other";
    for (const part of readStoredPaymentRows([row])) {
      if (part.status === "SUCCESSFUL") cash.push({ cents: cents(part.amount), at, method, payment: true });
      else if (part.status === "REFUNDED") cash.push({ cents: -Math.abs(cents(part.amount)), at, method, payment: false });
    }
  }
  // D-249 / D-250: a PAID invoice counts its full total. What its rows do not
  // record as received (all of it, or the rest of it) counts on the day it was
  // paid; refund rows still come off.
  // Nothing is unrecorded once the payments settle the total as the balance
  // contract reads it (a legacy sub-cent total settled by its row: review P2C-5).
  const paidSettles = invoiceBalanceOfStoredRows(total, [{ amount: balance.paid, status: "SUCCESSFUL" }], inv.currency).isFullyPaid;
  const unrecordedCents = inv.status === "PAID" && !paidSettles ? cents(balance.total) - cents(balance.paid) : 0;
  if (unrecordedCents > 0) {
    cash.push({ cents: unrecordedCents, at: inv.paidAt ? new Date(inv.paidAt) : null, method: "Other", payment: true });
  }
  const netCents = cash.reduce((sum, row) => sum + row.cents, 0);
  // D-250: never more than the total (a refund with no original leaves the rows' net below zero).
  const leftCents = Math.min(Math.max(0, cents(balance.remaining)), Math.max(0, cents(balance.total)));
  const owedCents = OWED_STATUSES.has(inv.status) ? leftCents : 0;
  const pastDue = inv.status === "OVERDUE" || (!!inv.dueDate && new Date(inv.dueDate) < now);
  const state: "pending" | "overdue" | null = owedCents > 0 ? (pastDue ? "overdue" : "pending") : null;
  return { cash, netCents, received: netCents > 0, leftCents, owedCents, state };
}

/**
 * Reviews COR-1 and C2-2 / S2-1: an invoice after a successful mark-paid, as
 * the server now holds it. PATCH .../paid records what was left as a payment
 * (D-05) and answers the invoice without its payment rows, so the invoice is
 * read again through the tenant-bound detail route (its own-tenant rows): the
 * tab then states what the server recorded, also when the tab was stale or
 * the invoice is credited (it stays PARTIALLY_CREDITED, with no paid date).
 *
 * When that read fails the tab falls back to what it can know: on a PAID
 * answer, the row mark-paid records (what the rows left of the total, dated
 * now); on any other answer nothing is guessed. A paid date is never invented for
 * an invoice the server did not answer PAID.
 */
async function afterMarkPaid(inv: Invoice, answered: Partial<Invoice>, businessId: string | null): Promise<Invoice> {
  if (businessId) {
    try {
      const { data } = await getInvoice(businessId, inv.id);
      if (data && data.id === inv.id) {
        return { ...inv, status: data.status, paidAt: data.paidAt ?? null, payments: data.payments ?? inv.payments };
      }
    } catch {
      // fall back below
    }
  }
  const status = answered.status ?? "PAID";
  if (status !== "PAID") return { ...inv, status, paidAt: answered.paidAt ?? inv.paidAt ?? null };
  // PAID: mark-paid recorded what the rows left of the total (D-05). That row
  // is added here, dated now, so the invoice reads as received in full also
  // when it carries refund rows (review P2C-4: 500 paid and 100 refunded,
  // marked paid, is 500 received, not 400). A reload replaces it with the
  // server's rows.
  const paidAt = answered.paidAt ?? inv.paidAt ?? new Date().toISOString();
  const { leftCents } = invoiceMoney(inv, new Date());
  if (leftCents <= 0) return { ...inv, status, paidAt };
  const settled: PaymentRecord = {
    id: `local-markpaid-${inv.id}`,
    amount: leftCents / 100,
    currency: inv.currency,
    status: "SUCCESSFUL",
    provider: "manual",
    providerPaymentId: `local-markpaid-${inv.id}`,
    createdAt: new Date().toISOString(),
    businessId: businessId ?? "",
    invoiceId: inv.id,
  };
  return { ...inv, status, paidAt, payments: [...(inv.payments ?? []), settled] };
}

function getContactName(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!contact) return "Unknown";
  return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
}

interface PaymentsTabProps {
  invoices: Invoice[];
  currency: string;
  businessId: string | null;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
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
  setInvoices,
}: PaymentsTabProps) {
  const [activeView, setActiveView] = useState<PaymentView>("all");
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOverdue, setExpandedOverdue] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());



  // V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-024, BUG-020): the strip's figures,
  // from invoiceMoney above. It read the invoice status alone: Received was the
  // totals of PAID invoices, so a deposit on an unpaid invoice was not
  // received; Pending and Overdue were whole totals, so the deposit was still
  // owed; a DRAFT nobody was sent counted as pending.
  //  - Received: the money received net of refunds over every invoice (the
  //    server's revenue), with the number of invoices money came in on.
  //  - This Month: the same, by the date of each payment row. A figure that
  //    nets below zero (refunds outweigh receipts) shows no figure, never a
  //    negative; the server's stats state the net itself.
  //  - Pending / Overdue: what is still owed, and how many invoices owe it.
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    let receivedCents = 0;
    let thisMonthCents = 0;
    let pendingCents = 0;
    let overdueCents = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    for (const inv of invoices) {
      const money = invoiceMoney(inv, now);
      receivedCents += money.netCents;
      for (const row of money.cash) {
        if (row.at && row.at.getMonth() === thisMonth && row.at.getFullYear() === thisYear) thisMonthCents += row.cents;
      }
      if (money.received) paidCount++;
      if (money.state === "overdue") {
        overdueCents += money.owedCents;
        overdueCount++;
      } else if (money.state === "pending") {
        pendingCents += money.owedCents;
        pendingCount++;
      }
    }

    return {
      totalReceived: Math.max(0, receivedCents) / 100,
      receivedThisMonth: Math.max(0, thisMonthCents) / 100,
      totalPending: pendingCents / 100,
      totalOverdue: overdueCents / 100,
      paidCount,
      pendingCount,
      overdueCount,
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const now = new Date();
    let list = invoices;

    if (activeView === "received") {
      // Review C2-1: the invoices the strip's Received adds up (money came in on them), paid in full or not.
      list = list.filter((inv) => invoiceMoney(inv, now).received);
    } else if (activeView === "pending") {
      // Review COR-5: the list is the invoices the strip's Pending adds up.
      list = list.filter((inv) => invoiceMoney(inv, now).state === "pending");
    } else if (activeView === "overdue") {
      list = list.filter((inv) => invoiceMoney(inv, now).state === "overdue");
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
    // Review COR-5: what is overdue and still owed, the invoices the strip's Overdue adds up.
    return invoices
      .filter((inv) => invoiceMoney(inv, now).state === "overdue")
      .sort((a, b) => getDaysOverdue(b.dueDate) - getDaysOverdue(a.dueDate));
  }, [invoices]);

  const handleMarkPaid = useCallback(
    async (invoiceId: string) => {
      if (actionLoading[invoiceId]) return;
      setActionLoading((prev) => ({ ...prev, [invoiceId]: "paid" }));
      try {
        const { data, error } = await markInvoicePaid(invoiceId, businessId ?? undefined);
        if (!error && data) {
          const current = invoices.find((i) => i.id === invoiceId);
          const settled = current ? await afterMarkPaid(current, data, businessId) : null;
          setInvoices((prev) =>
            prev.map((i) => (i.id === invoiceId ? settled ?? { ...i, status: data.status ?? "PAID" } : i))
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
    [actionLoading, setInvoices, invoices, businessId]
  );

  // FOLLOW3-A8 (VR-01): the reminder goes through the reminder door
  // (POST .../invoices/:id/send-reminder), the door the Collections panel uses
  // since V1-42c. It used to ask the status route for SENT, which since V1-42
  // answers a SENT invoice without doing anything (and refuses
  // PARTIALLY_PAID/OVERDUE), while this toasted "Reminder sent" and rewrote the
  // row to SENT. "Reminder sent" now means the server delivered one; a reminder
  // changes nothing on the invoice, so the row is left as it is. Only SENT,
  // OVERDUE and PARTIALLY_PAID rows offer the button (canRemind); the handler
  // checks the same set so no other status ever reaches the door from here.
  const handleSendReminder = useCallback(
    async (invoiceId: string) => {
      if (actionLoading[invoiceId]) return;
      if (!canRemind(invoices.find((i) => i.id === invoiceId)?.status)) return;
      if (!businessId) {
        toast.error("Select a workspace to send a reminder");
        return;
      }
      setActionLoading((prev) => ({ ...prev, [invoiceId]: "send" }));
      try {
        const { data, error } = await sendInvoiceReminder(businessId, invoiceId, {});
        if (error || !data) {
          toast.error(error ?? "Failed to send reminder");
        } else if (data.delivered) {
          toast.success("Reminder sent");
        } else {
          toast.warning("Reminder logged but not emailed: this customer has no email address");
        }
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev };
          delete next[invoiceId];
          return next;
        });
      }
    },
    [actionLoading, businessId, invoices]
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleExportCsv = useCallback(() => {
    const items = filteredInvoices.filter((inv) => selectedIds.size === 0 || selectedIds.has(inv.id));
    exportToCsv(

      items as unknown as Record<string, unknown>[],
      [
        { key: "invoiceNumber", header: "Invoice #" },
        { key: "status", header: "Status" },
        { key: "total", header: `Amount (${currency})`, format: (v: unknown) => Number(v).toFixed(2) },
        { key: "paidAt", header: "Paid Date", format: (v: unknown) => (v ? new Date(v as string).toLocaleDateString() : "—") },
        { key: "dueDate", header: "Due Date", format: (v: unknown) => (v ? new Date(v as string).toLocaleDateString() : "—") },
      ],
      `payments-${new Date().toISOString().slice(0, 10)}`,
    );
    toast.success("CSV exported");
  }, [filteredInvoices, selectedIds, currency]);

  const handleBulkMarkPaid = useCallback(async () => {
    if (!businessId) return;
    const ids = Array.from(selectedIds).filter((id) => {
      const inv = invoices.find((i) => i.id === id);
      return inv && inv.status !== "PAID" && inv.status !== "VOID";
    });
    if (ids.length === 0) {
      toast.info("No eligible invoices to mark as paid");
      return;
    }
    const results = await Promise.all(ids.map((id) => markInvoicePaid(id, businessId)));
    const succeeded = results.filter((r) => r.data).length;
    if (succeeded > 0) {
      const settled = new Map<string, Invoice>();
      await Promise.all(
        invoices.map(async (inv) => {
          const match = results.find((r) => r.data?.id === inv.id);
          if (match?.data) settled.set(inv.id, await afterMarkPaid(inv, match.data, businessId));
        }),
      );
      setInvoices((prev) => prev.map((inv) => settled.get(inv.id) ?? inv));
      toast.success(`${succeeded} invoice(s) marked as paid`);
    }
    setSelectedIds(new Set());
  }, [businessId, selectedIds, invoices, setInvoices]);

  // Review C2-4: the methods of the money behind Received, on any invoice: a
  // payment that went through counts once under its method, a refund takes its
  // amount back, a PENDING or FAILED row is no payment. A PAID invoice with no
  // payment row of its own is under "Other". It read PAID invoices only and
  // added every row whatever its status.
  const methodBreakdown = useMemo(() => {
    const now = new Date();
    const methods: Record<string, { count: number; cents: number }> = {};
    for (const inv of invoices) {
      for (const row of invoiceMoney(inv, now).cash) {
        if (!methods[row.method]) methods[row.method] = { count: 0, cents: 0 };
        methods[row.method].cents += row.cents;
        if (row.payment) methods[row.method].count++;
      }
    }
    return Object.entries(methods)
      .map(([method, data]) => ({ method, count: data.count, total: Math.max(0, data.cents) / 100 }))
      .filter((m) => m.count > 0)
      .sort((a, b) => b.total - a.total);
  }, [invoices]);

  const viewCounts = useMemo(() => {
    const now = new Date();
    // Review COR-5: the counts of the lists above (invoiceMoney's states).
    return {
      all: invoices.length,
      received: invoices.filter((i) => invoiceMoney(i, now).received).length,
      pending: invoices.filter((i) => invoiceMoney(i, now).state === "pending").length,
      overdue: invoices.filter((i) => invoiceMoney(i, now).state === "overdue").length,
    };
  }, [invoices]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {[
          { label: "Received", value: stats.totalReceived, count: stats.paidCount, color: "text-emerald-400", icon: CheckCircle2 },
          { label: "This Month", value: stats.receivedThisMonth, count: null, color: "text-blue-400", icon: TrendingUp },
          { label: "Pending", value: stats.totalPending, count: stats.pendingCount, color: "text-amber-400", icon: Clock },
          { label: "Overdue", value: stats.totalOverdue, count: stats.overdueCount, color: "text-red-400", icon: AlertTriangle },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
            <span className={`text-sm font-bold ${item.color}`}>
              {item.value > 0 ? formatCurrencyCompact(item.value, currency) : "—"}
            </span>
            <span className="text-[10px] text-muted-foreground/50">{item.label}</span>
            {item.count != null && item.count > 0 && (
              <span className="text-[10px] text-muted-foreground/40">· {item.count}</span>
            )}
          </div>
        ))}
      </div>

      <CashFlowSummary
        totalReceived={stats.totalReceived}
        totalPending={stats.totalPending}
        totalOverdue={stats.totalOverdue}
        currency={currency}
        draftCount={invoices.filter((i) => i.status === "DRAFT").length}
        pendingCount={stats.pendingCount}
        overdueCount={stats.overdueCount}
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
                          {formatCurrency(invoiceMoney(inv, new Date()).owedCents / 100, currency)}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleSendReminder(inv.id)}
                            disabled={!!isLoading}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                            title="Send Reminder"
                          >
                            {isLoading === "send" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleMarkPaid(inv.id)}
                            disabled={!!isLoading}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                            title="Mark Paid"
                          >
                            {isLoading === "paid" ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
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
                className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-muted/50 transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground/50" />
              </button>
            )}
          </div>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>

        <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {VIEW_FILTERS.map((f) => {
            const count = viewCounts[f.key];
            return (
              <button
                key={f.key}
                onClick={() => setActiveView(f.key)}
                className={`flex flex-col items-center gap-0.5 min-w-[72px] sm:min-w-[88px] py-2 px-2 rounded-xl border transition-all ${
                  activeView === f.key
                    ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10"
                    : "border-border/30 bg-card hover:border-border/50"
                }`}
              >
                <span className="text-sm font-bold">{count}</span>
                <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{f.label}</span>
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

            tip="Payments are tracked automatically from your invoices."
          />
        ) : (
          <div className="space-y-1">
            {filteredInvoices.length > 0 && (
              <div className="flex items-center gap-1 px-2 pb-1">
                <label className="min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filteredInvoices.length > 0 && filteredInvoices.every((i) => selectedIds.has(i.id))}
                    onChange={() => {
                      const allSelected = filteredInvoices.every((i) => selectedIds.has(i.id));
                      setSelectedIds(allSelected ? new Set() : new Set(filteredInvoices.map((i) => i.id)));
                    }}
                    className="w-4 h-4 rounded border-border/50 accent-[hsl(var(--kf-accent1))]"
                    aria-label="Select all visible payments"
                  />
                </label>
                <span className="text-[10px] text-muted-foreground/50">Select all</span>
              </div>
            )}
            {filteredInvoices.map((inv) => {
              const isLoading = actionLoading[inv.id];
              const isPaid = inv.status === "PAID";
              // Review C2-5: drawn overdue when it is counted overdue, and a part-paid row says what is left.
              const money = invoiceMoney(inv, new Date());
              const isOverdue = money.state === "overdue";
              const partPaid = money.owedCents > 0 && money.owedCents < Math.round((Number(inv.total) || 0) * 100);

              return (
                <div
                  key={inv.id}
                  className={`flex items-center gap-2 p-2.5 rounded-lg transition-colors ${
                    isOverdue
                      ? "bg-red-500/[0.04] hover:bg-red-500/[0.08]"
                      : isPaid
                        ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]"
                        : "bg-white/[0.02] hover:bg-white/[0.04]"
                  } ${selectedIds.has(inv.id) ? "ring-1 ring-[hsl(var(--kf-accent1))]/40" : ""}`}
                >
                  <label className="min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(inv.id)}
                      onChange={() => toggleSelected(inv.id)}
                      className="w-4 h-4 rounded border-border/50 accent-[hsl(var(--kf-accent1))]"
                      aria-label={`Select payment ${inv.invoiceNumber ?? inv.id.slice(0, 8)}`}
                    />
                  </label>
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
                  <span className="text-xs font-bold shrink-0 text-right">
                    {formatCurrency(Number(inv.total), currency)}
                    {partPaid && (
                      <span className="block text-[10px] font-medium text-muted-foreground/60">
                        {formatCurrency(money.owedCents / 100, currency)} left
                      </span>
                    )}
                  </span>
                  {!isPaid && (
                    <div className="flex items-center gap-1 shrink-0">
                      {canRemind(inv.status) && (
                        <button
                          onClick={() => handleSendReminder(inv.id)}
                          disabled={!!isLoading}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                          title="Send Reminder"
                        >
                          {isLoading === "send" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleMarkPaid(inv.id)}
                        disabled={!!isLoading}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        title="Mark Paid"
                      >
                        {isLoading === "paid" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
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

      <BulkActionBar
        selectedCount={selectedIds.size}
        totalCount={filteredInvoices.length}
        onSelectAll={() => setSelectedIds(new Set(filteredInvoices.map((i) => i.id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onExportCsv={handleExportCsv}
        statusOptions={[
          { value: "PAID", label: "Mark Paid" },
        ]}
        onBulkStatusChange={handleBulkMarkPaid}
        entityLabel="payments"
      />


    </motion.div>
  );
}
