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
  Mail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useModuleEmit } from "@/hooks/use-module-events";
import type { Invoice, Quote, Contact, Product } from "@/lib/client";
import { fetchCommerceStats, fetchRecurringInvoices, type CommerceStats } from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";
import QuotesPanel from "../quotes/quotes-panel";
import InvoicesPanel from "../invoices/invoices-panel";
import RecurringPanel from "../recurring/recurring-panel";

export type BillingSegment = "quotes" | "invoices" | "schedules";

const SEGMENTS: { key: BillingSegment; label: string; icon: React.ElementType; accent: string; accentMuted: string }[] = [
  { key: "quotes", label: "Quotes", icon: FileText, accent: "hsl(var(--kf-accent1))", accentMuted: "hsl(var(--kf-accent1) / 0.15)" },
  { key: "invoices", label: "Invoices", icon: CreditCard, accent: "#10b981", accentMuted: "rgba(16,185,129,0.15)" },
  { key: "schedules", label: "Schedules", icon: RefreshCw, accent: "#a78bfa", accentMuted: "rgba(167,139,250,0.15)" },
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
  prefillContactId?: string;
  prefillItems?: import("../components/commerce-types").InvoiceLineItem[];
  prefillToken?: number;
  onPrefillApplied?: () => void;
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
  prefillContactId,
  prefillItems,
  prefillToken,
  onPrefillApplied,
}: BillingPanelProps) {
  const router = useRouter();
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

  const segmentIndex = SEGMENTS.findIndex(s => s.key === segment);

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

  const { swipeHandlers } = useSwipeTabs({
    tabs: SEGMENTS.map(s => s.key),
    activeTab: segment,
    onTabChange: (tab) => handleSegmentChange(tab as BillingSegment),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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

        <button
          onClick={() => router.push("/app/settings/connections")}
          className={`
            ml-auto inline-flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border text-sm transition-all duration-200
            ${gmailStatus?.connected
              ? "border-green-500/30 bg-green-500/[0.06] hover:bg-green-500/10"
              : "border-amber-500/30 bg-amber-500/[0.06] hover:bg-amber-500/10"
            }
          `}
          title={gmailStatus?.connected ? `Email connected: ${gmailStatus.email}` : "Email not connected — click to set up"}
          aria-label={gmailStatus?.connected ? `Email connected via ${gmailStatus.email}` : "Connect email account"}
        >
          <span className="relative flex h-2 w-2">
            {gmailStatus?.connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${gmailStatus?.connected ? "bg-green-500" : "bg-amber-500"}`} />
          </span>
          <Mail className={`w-3.5 h-3.5 ${gmailStatus?.connected ? "text-green-400" : "text-amber-400"}`} />
          <span className={`text-[10px] sm:text-[11px] hidden sm:inline ${gmailStatus?.connected ? "text-green-300" : "text-amber-300"}`}>
            {gmailStatus?.connected ? "Email" : "Connect"}
          </span>
        </button>
      </div>

      <div className="relative">
        <div
          role="tablist"
          aria-label="Billing sections"
          onKeyDown={(e) => {
            const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
            const dir = keys[e.key];
            if (dir !== undefined) {
              e.preventDefault();
              const idx = SEGMENTS.findIndex(s => s.key === segment);
              const next = idx + dir;
              if (next >= 0 && next < SEGMENTS.length) handleSegmentChange(SEGMENTS[next].key);
            } else if (e.key === "Home") {
              e.preventDefault();
              handleSegmentChange(SEGMENTS[0].key);
            } else if (e.key === "End") {
              e.preventDefault();
              handleSegmentChange(SEGMENTS[SEGMENTS.length - 1].key);
            }
          }}
          className="flex -mb-px"
        >
          {SEGMENTS.map((seg, i) => {
            const isActive = segment === seg.key;
            const count = segmentCounts[seg.key];
            return (
              <button
                key={seg.key}
                onClick={() => handleSegmentChange(seg.key)}
                role="tab"
                id={`billing-tab-${seg.key}`}
                aria-selected={isActive}
                aria-controls={`billing-tabpanel-${seg.key}`}
                tabIndex={isActive ? 0 : -1}
                style={{ zIndex: isActive ? 10 : SEGMENTS.length - i }}
                className={`group relative flex-1 flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap
                  transition-colors duration-200 outline-none
                  focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.5)] focus-visible:ring-offset-1 focus-visible:ring-offset-background
                  px-3 sm:px-5 py-2.5 sm:py-3
                  text-xs sm:text-sm font-semibold
                  rounded-t-xl
                  border-x border-t border-b-0
                  ${isActive
                    ? "bg-card/80 backdrop-blur-sm text-foreground border-border/40"
                    : "bg-transparent text-muted-foreground/50 border-transparent hover:text-muted-foreground/80 hover:bg-white/[0.03]"
                  }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="billing-tab-bar"
                    className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl"
                    style={{
                      background: `linear-gradient(90deg, ${seg.accent}, ${seg.accent})`,
                    }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                  />
                )}
                {isActive && (
                  <motion.div
                    layoutId="billing-tab-bg"
                    className="absolute inset-0 rounded-t-xl"
                    style={{
                      background: `linear-gradient(180deg, ${seg.accentMuted} 0%, transparent 100%)`,
                    }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                  />
                )}
                <seg.icon
                  className={`relative z-10 w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 transition-colors duration-200 ${
                    !isActive ? "group-hover:text-muted-foreground/70" : ""
                  }`}
                  style={isActive ? { color: seg.accent } : undefined}
                />
                <span className="relative z-10">{seg.label}</span>
                {count > 0 && (
                  <span
                    className="relative z-10 text-[10px] sm:text-xs tabular-nums rounded-full px-1.5 py-px min-w-[20px] text-center transition-colors duration-200"
                    style={isActive
                      ? { background: seg.accentMuted, color: seg.accent }
                      : { background: "rgba(255,255,255,0.04)", color: "inherit" }
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="h-px bg-border/40" />

        <div className="absolute bottom-0 left-0 right-0 h-px pointer-events-none" style={{ zIndex: 1 }}>
          {segmentIndex >= 0 && (
            <motion.div
              className="absolute bottom-0 h-px bg-card/80"
              animate={{
                left: `${(segmentIndex / SEGMENTS.length) * 100}%`,
                width: `${100 / SEGMENTS.length}%`,
              }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            />
          )}
        </div>
      </div>

      <div className="p-3 sm:p-4" data-swipe-ignore {...swipeHandlers}>
        <AnimatePresence mode="wait" custom={slideDir}>
          {segment === "quotes" && (
            <motion.div
              key="quotes"
              id="billing-tabpanel-quotes"
              role="tabpanel"
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
                prefillContactId={segment === "quotes" ? prefillContactId : undefined}
                prefillItems={segment === "quotes" ? prefillItems : undefined}
                prefillToken={segment === "quotes" ? prefillToken : undefined}
                onPrefillApplied={onPrefillApplied}
              />
            </motion.div>
          )}
          {segment === "invoices" && (
            <motion.div
              key="invoices"
              id="billing-tabpanel-invoices"
              role="tabpanel"
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
                prefillContactId={segment === "invoices" ? prefillContactId : undefined}
                prefillItems={segment === "invoices" ? prefillItems : undefined}
                prefillToken={segment === "invoices" ? prefillToken : undefined}
                onPrefillApplied={onPrefillApplied}
              />
            </motion.div>
          )}
          {segment === "schedules" && (
            <motion.div
              key="schedules"
              id="billing-tabpanel-schedules"
              role="tabpanel"
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

    </div>
  );
}
