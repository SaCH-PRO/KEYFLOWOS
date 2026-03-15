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
} from "lucide-react";
import { useRouter } from "next/navigation";
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
import { BillingSettingsPanel } from "../components/billing-settings-panel";

export type BillingSegment = "quotes" | "invoices" | "schedules";

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
          onClick={() => router.push("/app/settings/connections")}
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
            </AnimatePresence>
          </div>

          <div className="px-3 sm:px-4 pb-4">
            <BillingSettingsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
