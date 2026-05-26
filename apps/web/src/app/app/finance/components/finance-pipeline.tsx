"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  TrendingUp,
  Plus,
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import { Skeleton } from "@/components/ui/skeleton";
import { FINANCIAL_STAGES } from "@/lib/finance/constants";
import { normalizeInvoice, normalizeQuote, computePipelineMetrics, getPipelineStage } from "@/lib/finance/utils";
import { useBulkSelection } from "../../commerce/hooks/use-bulk-selection";
import { useCommerceSearch } from "../../commerce/hooks/use-commerce-search";
import { DateRangeFilter, filterByDateRange } from "../../commerce/components/date-range-filter";
import { BILLING_SORT_OPTIONS } from "../../commerce/components/commerce-types";
import { BulkActionBar } from "../../commerce/components/bulk-action-bar";
import { RecordCard, type PipelineAction } from "./records/record-card";
import { PaymentRecordModal } from "./payment-record-modal";
import { QuoteConvertModal } from "./quote-convert-modal";
import { SendEmailModal } from "./send-email-modal";
import { ConfirmDialog } from "./confirm-dialog";
import { usePipelineActions } from "../hooks/use-pipeline-actions";
import PaymentsTab from "../../commerce/payments/payments-tab";
import { updateInvoiceStatus, updateQuoteStatus, type Contact } from "@/lib/client";
import { toast } from "sonner";
import type { Invoice, Quote } from "@/lib/client";
import type { FinancialRecord, PipelineMetrics } from "@/lib/finance/types";

type PipelineView = "all" | "quotes" | "invoices" | "collections";
type StageKey = "all" | typeof FINANCIAL_STAGES[number]["key"];

interface FinancePipelineProps {
  businessId: string | null;
  quotes: Quote[];
  invoices: Invoice[];
  loading: boolean;
  currency?: string;
  contacts?: Contact[];
  setInvoices?: React.Dispatch<React.SetStateAction<Invoice[]>>;
  onViewRecord?: (record: FinancialRecord) => void;
}

/* ─── Stage Bar ─── */
function StageBar({
  metrics,
  activeStage,
  onStageChange,
  currency,
}: {
  metrics: PipelineMetrics;
  activeStage: StageKey;
  onStageChange: (s: StageKey) => void;
  currency: string;
}) {
  const stages: { key: StageKey; label: string; count: number; value: number; color: string }[] = [
    { key: "all", label: "All", count: metrics.totalRecords, value: metrics.totalValue, color: "#f8fafc" },
    { key: "draft", label: "Drafts", count: metrics.draftCount, value: metrics.draftValue, color: FINANCIAL_STAGES[0].color },
    { key: "sent", label: "Outbound", count: metrics.sentCount, value: metrics.sentValue, color: FINANCIAL_STAGES[1].color },
    { key: "action_needed", label: "Action", count: metrics.actionCount, value: metrics.actionValue, color: FINANCIAL_STAGES[3].color },
    { key: "accepted", label: "Won", count: metrics.wonCount, value: metrics.wonValue, color: FINANCIAL_STAGES[4].color },
    { key: "lost", label: "Lost", count: metrics.lostCount, value: metrics.lostValue, color: FINANCIAL_STAGES[6].color },
  ];

  return (
    <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {stages.map((stage) => {
        const active = activeStage === stage.key;
        return (
          <button
            key={stage.key}
            onClick={() => onStageChange(stage.key)}
            className={`flex flex-col items-center gap-0.5 min-w-[72px] sm:min-w-[88px] py-2 px-2 rounded-xl border transition-all ${
              active
                ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10"
                : "border-border/30 bg-card hover:border-border/50"
            }`}
          >
            <span className="text-sm font-bold" style={{ color: active ? "hsl(var(--kf-accent1))" : stage.color }}>
              {stage.count}
            </span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{stage.label}</span>
            {stage.value > 0 && (
              <span className="text-[9px] text-muted-foreground/50">{formatCurrencyCompact(stage.value, currency)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Metrics Row ─── */
function PipelineMetricsRow({ metrics, currency }: { metrics: PipelineMetrics; currency: string }) {
  const items = [
    { label: "Pipeline", value: metrics.totalValue, color: "text-[hsl(var(--kf-accent1))]", icon: TrendingUp },
    { label: "Outstanding", value: metrics.sentValue + metrics.actionValue, color: "text-amber-400", icon: Clock },
    { label: "Won", value: metrics.wonValue, color: "text-emerald-400", icon: CheckCircle2 },
    { label: "At Risk", value: metrics.actionValue, color: "text-red-400", icon: AlertTriangle },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
          <span className={`text-sm font-bold ${item.color}`}>
            {item.value > 0 ? formatCurrencyCompact(item.value, currency) : "—"}
          </span>
          <span className="text-[10px] text-muted-foreground/50">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Confirm dialog state helper ─── */
interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "danger" | "warning" | "primary";
  onConfirm: () => void;
}

/* ─── Main Component ─── */
export function FinancePipeline({
  businessId,
  quotes,
  invoices,
  loading,
  currency = "TTD",
  contacts = [],
  setInvoices,
  onViewRecord,
}: FinancePipelineProps) {
  const searchParams = useSearchParams();
  const [view, setViewState] = useState<PipelineView>("all");
  const [stage, setStage] = useState<StageKey>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("date-desc");
  const [dateRange, setDateRange] = useState<{ from: Date | null; to: Date | null; preset: import("../../commerce/components/date-range-filter").DatePreset }>({ from: null, to: null, preset: "all" });

  const { selectedIds, toggleSelected, selectAll, clearSelection } = useBulkSelection();

  const [localInvoices, setLocalInvoices] = useState<Invoice[]>(invoices);
  const [localQuotes, setLocalQuotes] = useState<Quote[]>(quotes);

  // Sync with props
  React.useEffect(() => { setLocalInvoices(invoices); }, [invoices]);
  React.useEffect(() => { setLocalQuotes(quotes); }, [quotes]);

  // Sync view with URL ?view= query param
  useEffect(() => {
    const paramView = searchParams.get("view");
    const validViews: PipelineView[] = ["all", "quotes", "invoices", "collections"];
    if (paramView && validViews.includes(paramView as PipelineView)) {
      setViewState(paramView as PipelineView);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount read
  }, []);

  const setView = useCallback((next: PipelineView) => {
    setViewState(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "all") {
        url.searchParams.delete("view");
      } else {
        url.searchParams.set("view", next);
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const actions = usePipelineActions({
    businessId,
    invoices: localInvoices,
    quotes: localQuotes,
    setInvoices: setLocalInvoices,
    setQuotes: setLocalQuotes,
  });

  /* ─── Modals ─── */
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false, title: "", description: "", confirmLabel: "Confirm", variant: "danger", onConfirm: () => {},
  });
  const [sendEmailFor, setSendEmailFor] = useState<{ type: "quote" | "invoice"; id: string; number: string; contact?: { email?: string | null } | null } | null>(null);

  const records = useMemo(() => {
    const q = localQuotes.map(normalizeQuote);
    const i = localInvoices.map(normalizeInvoice);
    return [...q, ...i];
  }, [localQuotes, localInvoices]);

  const metrics = useMemo(() => computePipelineMetrics(records), [records]);

  const filteredByView = useMemo(() => {
    if (view === "quotes") return records.filter((r) => r.type === "quote");
    if (view === "invoices") return records.filter((r) => r.type === "invoice");
    return records;
  }, [records, view]);

  const filteredByStage = useMemo(() => {
    if (stage === "all") return filteredByView;
    return filteredByView.filter((r) => getPipelineStage(r.status) === stage);
  }, [filteredByView, stage]);

  const dateFiltered = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return filteredByStage;
    return filterByDateRange(filteredByStage, (r) => r.issueDate, dateRange);
  }, [filteredByStage, dateRange]);

  const searched = useCommerceSearch(
    dateFiltered,
    (item) => `${item.number} ${item.contact?.firstName ?? ""} ${item.contact?.lastName ?? ""} ${item.contact?.email ?? ""} ${item.items.map((i) => i.description).join(" ")}`,
    search,
  ).filtered;

  const sorted = useMemo(() => {
    const [field, dir] = sortKey.split("-") as [string, "asc" | "desc"];
    return [...searched].sort((a, b) => {
      let cmp = 0;
      if (field === "date") cmp = new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime();
      else if (field === "amount") cmp = a.total - b.total;
      else if (field === "name") {
        const na = `${a.contact?.firstName ?? ""} ${a.contact?.lastName ?? ""}`;
        const nb = `${b.contact?.firstName ?? ""} ${b.contact?.lastName ?? ""}`;
        cmp = na.localeCompare(nb);
      }
      return dir === "asc" ? cmp : -cmp;
    });
  }, [searched, sortKey]);

  const handleSelectAll = useCallback(() => {
    const allSelected = sorted.every((r) => selectedIds.has(r.id));
    if (allSelected) clearSelection();
    else selectAll(sorted.map((r) => r.id));
  }, [sorted, selectedIds, clearSelection, selectAll]);

  /* ─── Confirmation helpers ─── */
  const confirmDelete = useCallback((record: FinancialRecord, onConfirm: () => void) => {
    setConfirm({
      open: true,
      title: `Delete ${record.type}?`,
      description: `This will permanently delete ${record.number}. This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
      onConfirm: () => { onConfirm(); setConfirm((p) => ({ ...p, open: false })); },
    });
  }, []);

  const confirmVoid = useCallback((invoice: Invoice, onConfirm: () => void) => {
    setConfirm({
      open: true,
      title: "Void invoice?",
      description: `This will void ${invoice.invoiceNumber ?? invoice.id}. The invoice will remain visible but marked as void.`,
      confirmLabel: "Void",
      variant: "warning",
      onConfirm: () => { onConfirm(); setConfirm((p) => ({ ...p, open: false })); },
    });
  }, []);

  /* ─── Action handler ─── */
  const handleAction = useCallback(
    (record: FinancialRecord, action: PipelineAction) => {
      const rawQuote = record.type === "quote" ? localQuotes.find((q) => q.id === record.id) : null;
      const rawInvoice = record.type === "invoice" ? localInvoices.find((inv) => inv.id === record.id) : null;

      switch (action) {
        case "send":
          if (rawQuote) {
            setSendEmailFor({ type: "quote", id: rawQuote.id, number: rawQuote.quoteNumber, contact: rawQuote.contact });
          }
          if (rawInvoice) {
            setSendEmailFor({ type: "invoice", id: rawInvoice.id, number: rawInvoice.invoiceNumber ?? rawInvoice.id, contact: rawInvoice.contact });
          }
          break;
        case "accept":
          if (rawQuote) actions.acceptQuote(rawQuote.id);
          break;
        case "reject":
          if (rawQuote) actions.rejectQuote(rawQuote.id);
          break;
        case "convert":
          if (rawQuote) actions.setConvertModalFor(rawQuote);
          break;
        case "delete":
          confirmDelete(record, () => {
            if (rawQuote) actions.handleDeleteQuote(rawQuote.id);
            if (rawInvoice) actions.handleDeleteInvoice(rawInvoice.id);
          });
          break;
        case "duplicate":
          if (rawQuote) actions.handleDuplicateQuote(rawQuote);
          if (rawInvoice) actions.handleDuplicateInvoice(rawInvoice);
          break;
        case "mark-paid":
          if (rawInvoice) actions.handleMarkPaid(rawInvoice.id);
          break;
        case "record-payment":
          if (rawInvoice) actions.setPaymentModalFor(rawInvoice);
          break;
        case "void":
          if (rawInvoice) {
            confirmVoid(rawInvoice, () => {
              actions.voidInvoice(rawInvoice.id);
              // Show undo toast
              toast("Invoice voided", {
                action: {
                  label: "Undo",
                  onClick: async () => {
                    const { data } = await updateInvoiceStatus(rawInvoice.id, "SENT");
                    if (data) {
                      setLocalInvoices((prev) => prev.map((inv) => (inv.id === rawInvoice.id ? data : inv)));
                      toast.success("Invoice restored");
                    }
                  },
                },
              });
            });
          }
          break;
        case "remind":
          if (rawInvoice) actions.handleSendReminder(rawInvoice, rawInvoice.contact?.email ?? "", "");
          break;
        case "resend-receipt":
          if (rawInvoice) actions.handleResendReceipt(rawInvoice.id);
          break;
      }
    },
    [localQuotes, localInvoices, actions, confirmDelete, confirmVoid],
  );

  const handleEmailSent = useCallback(() => {
    // After email is sent, update status to SENT
    if (sendEmailFor?.type === "quote") {
      updateQuoteStatus(sendEmailFor.id, "SENT").then(({ data }) => {
        if (data) setLocalQuotes((prev) => prev.map((q) => (q.id === sendEmailFor.id ? data : q)));
      });
    }
    if (sendEmailFor?.type === "invoice") {
      updateInvoiceStatus(sendEmailFor.id, "SENT").then(({ data }) => {
        if (data) setLocalInvoices((prev) => prev.map((inv) => (inv.id === sendEmailFor.id ? data : inv)));
      });
    }
    setSendEmailFor(null);
  }, [sendEmailFor]);

  if (loading && records.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/30 border border-border/40">
          {(["all", "quotes", "invoices", "collections"] as PipelineView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === v
                  ? "bg-card text-foreground shadow-sm border border-border/40"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "all" ? "All" : v === "quotes" ? "Quotes" : v === "invoices" ? "Invoices" : "Collections"}
            </button>
          ))}
        </div>
      </div>

      {view === "collections" ? (
        <PaymentsTab
          invoices={invoices}
          currency={currency}
          businessId={businessId}
          setInvoices={setInvoices ?? (() => {})}
        />
      ) : (
        <>
          {/* Metrics */}
          <PipelineMetricsRow metrics={metrics} currency={currency} />

          {/* Stage Bar */}
          <StageBar metrics={metrics} activeStage={stage} onStageChange={setStage} currency={currency} />

          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records..."
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-card border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
            </div>

            <DateRangeFilter value={dateRange} onChange={setDateRange} />

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="px-3 py-2 rounded-xl bg-card border border-border/40 text-xs text-foreground focus:outline-none"
            >
              {BILLING_SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* List */}
          <div className="space-y-2">
            {sorted.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-border/40 bg-card">
                <TrendingUp className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No records match your filters</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    checked={sorted.length > 0 && sorted.every((r) => selectedIds.has(r.id))}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-border/50 accent-[hsl(var(--kf-accent1))]"
                  />
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${sorted.length} records`}
                  </span>
                </div>

                {sorted.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    selected={selectedIds.has(record.id)}
                    onToggleSelect={() => toggleSelected(record.id)}
                    onClick={() => onViewRecord?.(record)}
                    onAction={handleAction}
                    actionLoading={actions.actionLoading}
                  />
                ))}
              </>
            )}
          </div>

          {/* Bulk Actions */}
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedIds.size}
                totalCount={sorted.length}
                onSelectAll={handleSelectAll}
                onClearSelection={clearSelection}
                onExportCsv={() => actions.handleExportCsv(selectedIds, sorted)}
                onBulkStatusChange={(status) => actions.handleBulkStatusChange(selectedIds, status)}
                onBulkDelete={() => {
                  setConfirm({
                    open: true,
                    title: "Delete selected?",
                    description: `This will permanently delete ${selectedIds.size} records.`,
                    confirmLabel: "Delete",
                    variant: "danger",
                    onConfirm: () => {
                      actions.handleBulkDelete(selectedIds);
                      setConfirm((p) => ({ ...p, open: false }));
                    },
                  });
                }}
                statusOptions={[
                  { value: "SENT", label: "Send" },
                  { value: "VOID", label: "Void" },
                ]}
                entityLabel="records"
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Payment Record Modal */}
      <PaymentRecordModal
        invoice={actions.paymentModalFor}
        businessId={businessId}
        onClose={() => actions.setPaymentModalFor(null)}
        onSubmit={(inv, form) => actions.handleRecordPayment(inv, form)}
        loading={actions.paymentModalFor ? actions.actionLoading[`payment-${actions.paymentModalFor.id}`] : false}
      />

      {/* Quote Convert Modal */}
      <QuoteConvertModal
        quote={actions.convertModalFor}
        onClose={() => actions.setConvertModalFor(null)}
        onSubmit={(quote, form) => actions.handleConvertQuote(quote, form)}
        loading={actions.convertModalFor ? actions.actionLoading[`convert-${actions.convertModalFor.id}`] : false}
      />

      {/* Send Email Modal */}
      <SendEmailModal
        businessId={businessId}
        record={sendEmailFor}
        onClose={() => setSendEmailFor(null)}
        onSent={handleEmailSent}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        variant={confirm.variant}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
