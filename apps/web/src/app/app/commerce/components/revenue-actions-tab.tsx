"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Clock, FileText, RefreshCw, UserMinus, Receipt,
  CheckCircle2, X, MoonStar, Sparkles, ChevronDown, ChevronRight,
  Loader2, Mail, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyCompact } from "@/lib/currency";
import {
  fetchRevenueActions, completeRevenueAction, dismissRevenueAction,
  snoozeRevenueAction, reconcileRevenueActions,
  sendInvoiceReminder, resendInvoiceReceipt,
  sendStaleQuoteFollowUp, convertQuoteToInvoice,
  type RevenueAction, type RevenueActionType,
} from "@/lib/client";
import { openKey } from "@/components/key/key-agent";
import { CollectionsScoringPanel } from "./collections-scoring-panel";
import nextDynamic from "next/dynamic";

const PaymentPlanPanel = nextDynamic(
  () => import("./payment-plan-panel").then((m) => m.PaymentPlanPanel),
  { ssr: false, loading: () => null },
);
const QuoteFollowUpPanel = nextDynamic(
  () => import("./quote-follow-up-panel").then((m) => m.QuoteFollowUpPanel),
  { ssr: false, loading: () => null },
);

interface Props {
  businessId: string | null;
  currency: string;
  onOpenInvoice?: (id: string) => void;
  onOpenQuote?: (id: string) => void;
  onOpenContact?: (id: string) => void;
  onNavigate?: (tab: string) => void;
}

const TYPE_META: Record<RevenueActionType, { icon: React.ElementType; tone: string; label: string }> = {
  OVERDUE_INVOICE: { icon: AlertTriangle, tone: "text-red-400", label: "Overdue invoice" },
  STALE_QUOTE: { icon: Clock, tone: "text-amber-400", label: "Stale quote" },
  ACCEPTED_QUOTE_NO_INVOICE: { icon: FileText, tone: "text-purple-400", label: "Quote → Invoice" },
  PAID_INVOICE_NO_RECEIPT: { icon: Receipt, tone: "text-blue-400", label: "Send receipt" },
  RECURRING_FAILURE: { icon: RefreshCw, tone: "text-orange-400", label: "Recurring failure" },
  DORMANT_HIGH_VALUE: { icon: UserMinus, tone: "text-fuchsia-400", label: "Dormant customer" },
};

function priorityBg(p: number) {
  if (p === 1) return "border-red-500/30 bg-red-500/[0.04]";
  if (p === 2) return "border-amber-500/25 bg-amber-500/[0.03]";
  return "border-border/40 bg-card";
}
function priorityLabel(p: number) {
  return p === 1 ? "High" : p === 2 ? "Medium" : "Low";
}

type AiPanelTarget =
  | { kind: "payment-plan"; invoiceId: string; invoiceNumber: string; invoiceAmount: number }
  | { kind: "quote-follow-up"; quoteId: string; quoteNumber: string; quoteAmount: number }
  | null;

export function RevenueActionsTab({
  businessId, currency, onOpenInvoice, onOpenQuote, onOpenContact, onNavigate,
}: Props) {
  const [items, setItems] = useState<RevenueAction[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [aiPanel, setAiPanel] = useState<AiPanelTarget>(null);

  const openAiPanel = useCallback((a: RevenueAction) => {
    if (!a.relatedId) return;
    const amount = a.amountAtRisk ?? 0;
    if (a.type === "OVERDUE_INVOICE") {
      setAiPanel({
        kind: "payment-plan",
        invoiceId: a.relatedId,
        invoiceNumber: a.title || a.relatedId.slice(0, 8),
        invoiceAmount: amount,
      });
    } else if (a.type === "STALE_QUOTE") {
      setAiPanel({
        kind: "quote-follow-up",
        quoteId: a.relatedId,
        quoteNumber: a.title || a.relatedId.slice(0, 8),
        quoteAmount: amount,
      });
    }
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchRevenueActions(businessId, { status: "PENDING", limit: 100 });
    if (res.data) setItems(res.data.items);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const buckets: Record<number, RevenueAction[]> = { 1: [], 2: [], 3: [] };
    (items ?? []).forEach((a) => {
      const p = (a.priority as 1 | 2 | 3) ?? 2;
      (buckets[p] ?? buckets[2]).push(a);
    });
    return buckets;
  }, [items]);

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const handleAction = async (id: string, kind: "complete" | "dismiss" | "snooze", hours = 24) => {
    if (!businessId) return;
    setBusyId(id);
    try {
      const res = kind === "complete"
        ? await completeRevenueAction(businessId, id)
        : kind === "dismiss"
          ? await dismissRevenueAction(businessId, id)
          : await snoozeRevenueAction(businessId, id, hours);
      if (res.data) {
        setItems((prev) => (prev ?? []).filter((a) => a.id !== id));
        toast.success(
          kind === "complete" ? "Marked complete" : kind === "dismiss" ? "Dismissed" : `Snoozed ${hours}h`,
        );
      } else if (res.error) toast.error(res.error);
    } finally { setBusyId(null); }
  };

  const askAI = (a: RevenueAction) => {
    openKey({
      mode: "chat",
      module: "revenue",
      prompt: `Help me handle this revenue action: ${a.title}. ${a.detail ?? ""}`,
      context: { revenueActionId: a.id, type: a.type, relatedType: a.relatedType, relatedId: a.relatedId, amountAtRisk: a.amountAtRisk },
    });
  };

  const completeLocally = (id: string) =>
    setItems((prev) => (prev ?? []).filter((a) => a.id !== id));

  // Direct one-click execute action per action type (e.g. send reminder,
  // convert quote, send receipt). Marks the action complete on success.
  const executeFor = (a: RevenueAction): { label: string; run: () => Promise<void> } | null => {
    if (!businessId) return null;
    if (a.type === "OVERDUE_INVOICE" && a.relatedId) {
      return {
        label: "Send reminder",
        run: async () => {
          const res = await sendInvoiceReminder(businessId, a.relatedId!, {});
          if (res.error) { toast.error(res.error); return; }
          await completeRevenueAction(businessId, a.id);
          completeLocally(a.id);
          toast.success(res.data?.delivered ? "Reminder sent" : "Reminder queued");
        },
      };
    }
    if (a.type === "STALE_QUOTE" && a.relatedId) {
      return {
        label: "Send follow-up",
        run: async () => {
          const res = await sendStaleQuoteFollowUp({ businessId, quoteId: a.relatedId! });
          if (res.error) { toast.error(res.error); return; }
          await completeRevenueAction(businessId, a.id);
          completeLocally(a.id);
          toast.success("Follow-up logged");
        },
      };
    }
    if (a.type === "ACCEPTED_QUOTE_NO_INVOICE" && a.relatedId) {
      return {
        label: "Convert to invoice",
        run: async () => {
          const res = await convertQuoteToInvoice({ businessId, quoteId: a.relatedId! });
          if (res.error) { toast.error(res.error); return; }
          await completeRevenueAction(businessId, a.id);
          completeLocally(a.id);
          toast.success("Invoice created from quote");
          if (res.data && onOpenInvoice) onOpenInvoice(res.data.id);
        },
      };
    }
    if (a.type === "PAID_INVOICE_NO_RECEIPT" && a.relatedId) {
      return {
        label: "Send receipt",
        run: async () => {
          const res = await resendInvoiceReceipt(businessId, a.relatedId!, {});
          if (res.error) { toast.error(res.error); return; }
          await completeRevenueAction(businessId, a.id);
          completeLocally(a.id);
          toast.success("Receipt sent");
        },
      };
    }
    return null;
  };

  // Secondary "open" navigation CTA when an in-place execute isn't appropriate
  // (or as a complement when users want to inspect first).
  const openFor = (a: RevenueAction): { label: string; onClick: () => void } | null => {
    if (a.relatedType === "invoice" && a.relatedId && onOpenInvoice) {
      return { label: "Open invoice", onClick: () => onOpenInvoice(a.relatedId!) };
    }
    if (a.relatedType === "quote" && a.relatedId && onOpenQuote) {
      return { label: "Open quote", onClick: () => onOpenQuote(a.relatedId!) };
    }
    if (a.relatedType === "contact" && a.relatedId && onOpenContact) {
      const label = a.type === "DORMANT_HIGH_VALUE" ? "Reconnect with contact" : "Open contact";
      return { label, onClick: () => onOpenContact(a.relatedId!) };
    }
    if (a.type === "RECURRING_FAILURE" && onNavigate) {
      return { label: "Review recurring schedule", onClick: () => onNavigate("recurring") };
    }
    return null;
  };

  const runExecute = async (a: RevenueAction) => {
    const ex = executeFor(a);
    if (!ex) return;
    setBusyId(a.id);
    try { await ex.run(); } catch (e) {
      toast.error((e as Error).message ?? "Action failed");
    } finally { setBusyId(null); }
  };

  const handleReconcile = async () => {
    if (!businessId) return;
    setReconciling(true);
    try {
      const res = await reconcileRevenueActions(businessId);
      if (res.data) toast.success(`Scan complete — ${res.data.created} new action${res.data.created === 1 ? "" : "s"}`);
      await load();
    } finally { setReconciling(false); }
  };

  if (items === null) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading revenue actions">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
        <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2" />
        <h3 className="text-sm font-semibold mb-1">No revenue actions right now</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Overdue invoices, stale quotes, accepted quotes missing invoices, paid invoices missing receipts,
          recurring failures and dormant high-value customers will surface here automatically.
        </p>
        <button
          onClick={handleReconcile}
          disabled={reconciling}
          className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-border/40 hover:bg-white/[0.04] inline-flex items-center gap-1.5"
        >
          {reconciling ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Scan now
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-xs font-semibold">Revenue Action Queue</h3>
          <span className="text-[10px] text-muted-foreground">
            {items.length} pending · sorted by priority
          </span>
        </div>
        <button
          onClick={handleReconcile}
          disabled={reconciling}
          className="text-[10px] font-medium px-2 py-1 rounded-lg border border-border/40 hover:bg-white/[0.04] inline-flex items-center gap-1"
        >
          {reconciling ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {[1, 2, 3].map((p) => {
        const list = grouped[p] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={p} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {priorityLabel(p)} priority
              </span>
              <span className="text-[10px] text-muted-foreground/50">{list.length}</span>
            </div>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {list.map((a) => {
                  const meta = TYPE_META[a.type] ?? TYPE_META.OVERDUE_INVOICE;
                  const Icon = meta.icon;
                  const isOpen = expanded.has(a.id);
                  const execute = executeFor(a);
                  const open = openFor(a);
                  const draft = a.recommendation?.draft;
                  return (
                    <motion.li
                      key={a.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      className={`rounded-xl border p-3 ${priorityBg(p)}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-1.5 rounded-lg bg-white/[0.04] shrink-0">
                          <Icon className={`w-3.5 h-3.5 ${meta.tone}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-semibold truncate">{a.title}</p>
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 px-1.5 py-0.5 rounded border border-border/30">
                              {meta.label}
                            </span>
                          </div>
                          {a.detail && (
                            <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                              {a.detail}
                            </p>
                          )}
                          {a.amountAtRisk != null && a.amountAtRisk > 0 && (
                            <p className="text-[11px] font-semibold mt-1" style={{ color: p === 1 ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent2))" }}>
                              {formatCurrencyCompact(a.amountAtRisk, currency)}{" "}
                              <span className="text-muted-foreground/50 font-normal">at stake</span>
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => toggle(a.id)}
                          className="p-1 rounded hover:bg-white/[0.04] shrink-0"
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
                              {a.recommendation && (
                                <div className="rounded-lg border border-border/30 bg-white/[0.02] p-2.5">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                      Why this matters
                                    </span>
                                    <span className="text-[9px] text-muted-foreground/50">
                                      ({a.recommendation.source === "ai" ? "AI draft" : "template"})
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-foreground/80 leading-relaxed">
                                    {a.recommendation.explanation}
                                  </p>
                                  <p className="text-[11px] mt-1.5 text-[hsl(var(--kf-accent1))]">
                                    Suggested: {a.recommendation.suggestedAction}
                                  </p>
                                  {draft && (draft.subject || draft.body) && (
                                    <div className="mt-2 pt-2 border-t border-border/20">
                                      <div className="flex items-center gap-1 mb-1">
                                        <Mail className="w-3 h-3 text-muted-foreground/60" />
                                        <span className="text-[10px] font-medium text-muted-foreground/60">Drafted message</span>
                                      </div>
                                      {draft.subject && (
                                        <p className="text-[11px] font-medium text-foreground/80">{draft.subject}</p>
                                      )}
                                      {draft.body && (
                                        <pre className="text-[11px] text-foreground/70 whitespace-pre-wrap font-sans mt-1">
                                          {draft.body}
                                        </pre>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="flex flex-wrap gap-1.5">
                                {execute && (
                                  <button
                                    onClick={() => runExecute(a)}
                                    disabled={busyId === a.id}
                                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
                                    style={{
                                      background: "hsl(var(--kf-accent1) / 0.18)",
                                      color: "hsl(var(--kf-accent1))",
                                      border: "1px solid hsl(var(--kf-accent1) / 0.3)",
                                    }}
                                  >
                                    {busyId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                    {execute.label}
                                  </button>
                                )}
                                {open && (
                                  <button
                                    onClick={open.onClick}
                                    className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-border/40 hover:bg-white/[0.04] inline-flex items-center gap-1"
                                  >
                                    {open.label} <ArrowRight className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => askAI(a)}
                                  className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-border/40 hover:bg-white/[0.04] inline-flex items-center gap-1"
                                >
                                  <Sparkles className="w-3 h-3" /> Ask AI
                                </button>
                                {(a.type === "OVERDUE_INVOICE" || a.type === "STALE_QUOTE") && a.relatedId && (
                                  <button
                                    onClick={() => openAiPanel(a)}
                                    className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-border/40 hover:bg-white/[0.04] inline-flex items-center gap-1"
                                    style={{ color: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1) / 0.3)" }}
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    {a.type === "OVERDUE_INVOICE" ? "AI Payment Plan" : "AI Follow-up"}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleAction(a.id, "complete")}
                                  disabled={busyId === a.id}
                                  className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 inline-flex items-center gap-1 disabled:opacity-50"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Complete
                                </button>
                                <button
                                  onClick={() => handleAction(a.id, "snooze", 24)}
                                  disabled={busyId === a.id}
                                  className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-border/40 hover:bg-white/[0.04] inline-flex items-center gap-1 disabled:opacity-50"
                                >
                                  <MoonStar className="w-3 h-3" /> Snooze 24h
                                </button>
                                <button
                                  onClick={() => handleAction(a.id, "dismiss")}
                                  disabled={busyId === a.id}
                                  className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-border/40 text-muted-foreground hover:bg-white/[0.04] inline-flex items-center gap-1 disabled:opacity-50"
                                >
                                  <X className="w-3 h-3" /> Dismiss
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>
        );
      })}

      <CollectionsScoringPanel businessId={businessId} />

      {aiPanel?.kind === "payment-plan" && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setAiPanel(null)}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <PaymentPlanPanel
              businessId={businessId}
              invoiceId={aiPanel.invoiceId}
              invoiceNumber={aiPanel.invoiceNumber}
              invoiceAmount={aiPanel.invoiceAmount}
              currency={currency}
              onClose={() => setAiPanel(null)}
            />
          </div>
        </div>
      )}

      {aiPanel?.kind === "quote-follow-up" && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setAiPanel(null)}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <QuoteFollowUpPanel
              businessId={businessId}
              quoteId={aiPanel.quoteId}
              quoteNumber={aiPanel.quoteNumber}
              quoteAmount={aiPanel.quoteAmount}
              currency={currency}
              onClose={() => setAiPanel(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
