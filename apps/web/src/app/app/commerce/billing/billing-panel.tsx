"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  CreditCard,
  RefreshCw,
  DollarSign,
  Clock,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { useModuleEmit } from "@/hooks/use-module-events";
import type { Invoice, Quote, Contact, Product } from "@/lib/client";
import { fetchCommerceStats, fetchRecurringInvoices, type CommerceStats } from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";
import QuotesPanel from "../quotes/quotes-panel";
import InvoicesPanel from "../invoices/invoices-panel";
import RecurringPanel from "../recurring/recurring-panel";

export type BillingSegment = "quotes" | "invoices" | "schedules";

const SEGMENTS: { key: BillingSegment; label: string; icon: React.ElementType }[] = [
  { key: "quotes", label: "Quotes", icon: FileText },
  { key: "invoices", label: "Invoices", icon: CreditCard },
  { key: "schedules", label: "Schedules", icon: RefreshCw },
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
  onSegmentChange?: (segment: BillingSegment) => void;
}

function computeBillingStats(invoices: Invoice[], quotes: Quote[]) {
  const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
  const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const outstandingInvoices = invoices.filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE");
  const outstanding = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const overdueInvoices = invoices.filter((inv) => inv.status === "OVERDUE");
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;
  const conversionRate = quotes.length > 0 ? Math.round((acceptedQuotes / quotes.length) * 100) : 0;
  return { totalRevenue, outstanding, overdueAmount, overdueCount: overdueInvoices.length, conversionRate };
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
  onSegmentChange,
}: BillingPanelProps) {
  const [segment, setSegment] = useState<BillingSegment>(defaultSegment);
  const [slideDir, setSlideDir] = useState(0);
  const emitEvent = useModuleEmit();
  const prevSegmentRef = useRef(defaultSegment);
  const [serverStats, setServerStats] = useState<CommerceStats | null>(null);
  const [schedulesCount, setSchedulesCount] = useState(0);

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

  const clientStats = useMemo(() => computeBillingStats(invoices, quotes), [invoices, quotes]);

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
    const order: BillingSegment[] = ["quotes", "invoices", "schedules"];
    setSlideDir(order.indexOf(s) > order.indexOf(segment) ? 1 : -1);
    prevSegmentRef.current = segment;
    setSegment(s);
    onSegmentChange?.(s);
    emitEvent("billing:segment_changed", "commerce", { segment: s });
  }, [segment, emitEvent, onSegmentChange]);

  const switchToInvoices = useCallback(() => {
    handleSegmentChange("invoices");
  }, [handleSegmentChange]);

  const segmentCounts = useMemo(() => ({
    quotes: quotes.length,
    invoices: invoices.length,
    schedules: schedulesCount,
  }), [quotes.length, invoices.length, schedulesCount]);

  const kpiChips = useMemo(() => [
    { icon: DollarSign, label: "Revenue", value: formatCurrencyCompact(stats.totalRevenue, currency), color: "#10b981" },
    { icon: Clock, label: "Owed", value: formatCurrencyCompact(stats.outstanding, currency), color: "#f59e0b" },
    { icon: AlertTriangle, label: "Overdue", value: stats.overdueCount > 0 ? formatCurrencyCompact(stats.overdueAmount, currency) : "—", color: stats.overdueCount > 0 ? "#ef4444" : "#6b7280" },
    { icon: TrendingUp, label: "Conversion", value: `${stats.conversionRate}%`, color: "hsl(142 76% 36%)" },
  ], [stats, currency]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {kpiChips.map((chip) => (
          <div
            key={chip.label}
            className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border/50 bg-white/[0.03] text-sm"
          >
            <chip.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" style={{ color: chip.color }} />
            <span className="font-semibold text-[11px] sm:text-xs">{chip.value}</span>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground/50 hidden sm:inline">{chip.label}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-border/40 backdrop-blur-sm">
        {SEGMENTS.map((seg) => {
          const isActive = segment === seg.key;
          const count = segmentCounts[seg.key];
          return (
            <button
              key={seg.key}
              onClick={() => handleSegmentChange(seg.key)}
              className={`
                flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                ${isActive
                  ? "bg-white/10 text-white shadow-sm border border-white/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                }
              `}
              aria-selected={isActive}
              role="tab"
            >
              <seg.icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{seg.label}</span>
              {count > 0 && (
                <span className={`
                  text-[10px] px-1.5 py-0.5 rounded-full min-w-[20px] text-center
                  ${isActive ? "bg-white/15 text-white" : "bg-white/[0.06] text-muted-foreground"}
                `}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" custom={slideDir}>
        {segment === "quotes" && (
          <motion.div
            key="quotes"
            custom={slideDir}
            initial={{ opacity: 0, x: slideDir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slideDir * -40 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
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
            />
          </motion.div>
        )}
        {segment === "invoices" && (
          <motion.div
            key="invoices"
            custom={slideDir}
            initial={{ opacity: 0, x: slideDir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slideDir * -40 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
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
            />
          </motion.div>
        )}
        {segment === "schedules" && (
          <motion.div
            key="schedules"
            custom={slideDir}
            initial={{ opacity: 0, x: slideDir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slideDir * -40 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
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
  );
}
