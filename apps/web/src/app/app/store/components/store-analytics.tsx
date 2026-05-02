"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  DollarSign,
  TrendingUp,
  BarChart3,
  Package,
  Eye,
  ShoppingCart,
  CreditCard,
  CheckCircle,
} from "lucide-react";
import { fetchStoreAnalytics, StoreAnalytics } from "@/lib/client";
import { formatPrice } from "@/lib/format";

type Props = {
  businessId: string;
};

const PERIODS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "All Time", days: 0 },
] as const;

const EVENT_CONFIG: Record<string, { label: string; icon: typeof Eye }> = {
  page_view: { label: "Page Views", icon: Eye },
  add_to_cart: { label: "Add to Cart", icon: ShoppingCart },
  checkout_start: { label: "Checkout Start", icon: CreditCard },
  checkout_complete: { label: "Completed", icon: CheckCircle },
};

export function StoreAnalyticsDashboard({ businessId }: Props) {
  const [analytics, setAnalytics] = useState<StoreAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(1);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    const res = await fetchStoreAnalytics(businessId, days || undefined);
    if (res.data) setAnalytics(res.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    load(PERIODS[selectedPeriod].days);
  }, [selectedPeriod, load]);

  const kpis = analytics
    ? [
        {
          label: "Total Bookings",
          value: analytics.bookings.total.toLocaleString(),
          icon: Calendar,
        },
        {
          label: "Revenue (Period)",
          value: formatPrice(analytics.revenue.inPeriod),
          icon: DollarSign,
        },
        {
          label: "Bookings (Period)",
          value: analytics.bookings.inPeriod.toLocaleString(),
          icon: TrendingUp,
        },
        {
          label: "Catalog Items",
          value: (analytics.catalog.products + analytics.catalog.services).toLocaleString(),
          icon: Package,
        },
      ]
    : [];

  const eventEntries = analytics
    ? Object.entries(analytics.storefrontEvents).filter(([, v]) => v > 0)
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
          >
            <BarChart3 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <h2 className="text-sm font-semibold">Store Analytics</h2>
        </div>

        <div
          className="inline-flex rounded-xl p-1 gap-1"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border)/0.5)",
          }}
        >
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setSelectedPeriod(i)}
              className="relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                color:
                  selectedPeriod === i
                    ? "hsl(var(--kf-accent1))"
                    : "hsl(var(--kf-foreground) / 0.5)",
                background:
                  selectedPeriod === i
                    ? "hsl(var(--kf-accent1) / 0.1)"
                    : "transparent",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl p-4 animate-pulse"
                  style={{
                    background: "hsl(var(--kf-card))",
                    border: "1px solid hsl(var(--kf-border)/0.3)",
                  }}
                >
                  <div
                    className="h-7 w-7 rounded-lg mb-3"
                    style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
                  />
                  <div
                    className="h-5 w-16 rounded mb-1.5"
                    style={{ background: "hsl(var(--kf-muted)/0.3)" }}
                  />
                  <div
                    className="h-3 w-20 rounded"
                    style={{ background: "hsl(var(--kf-muted)/0.2)" }}
                  />
                </div>
              ))}
            </div>
            <div
              className="rounded-xl p-5 animate-pulse"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border)/0.3)",
              }}
            >
              <div
                className="h-4 w-24 rounded mb-4"
                style={{ background: "hsl(var(--kf-muted)/0.3)" }}
              />
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-9 rounded mb-2"
                  style={{ background: "hsl(var(--kf-muted)/0.15)" }}
                />
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {kpis.map((kpi, i) => {
                const Icon = kpi.icon;
                return (
                  <motion.div
                    key={kpi.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-xl p-4"
                    style={{
                      background: "hsl(var(--kf-card))",
                      border: "1px solid hsl(var(--kf-border)/0.5)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
                      >
                        <Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                      </div>
                    </div>
                    <p className="text-xl font-bold text-foreground">{kpi.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.label}</p>
                  </motion.div>
                );
              })}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="rounded-xl overflow-hidden"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border)/0.5)",
              }}
            >
              <div
                className="px-5 py-3 flex items-center gap-2"
                style={{ borderBottom: "1px solid hsl(var(--kf-border)/0.3)" }}
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
                >
                  <Package className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <h3 className="text-xs font-semibold">Summary</h3>
              </div>

              <div>
                {analytics && [
                  { label: "Invoices (Period)", value: analytics.invoices.inPeriod.toLocaleString() },
                  { label: "Invoices (Total)", value: analytics.invoices.total.toLocaleString() },
                  { label: "Products", value: analytics.catalog.products.toLocaleString() },
                  { label: "Services", value: analytics.catalog.services.toLocaleString() },
                  { label: "Last 7 Days Bookings", value: analytics.bookings.last7Days.toLocaleString() },
                ].map((row, i) => (
                  <motion.div
                    key={row.label}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.04 }}
                    className="flex items-center justify-between px-5 py-2.5"
                    style={{
                      borderBottom:
                        i < 4 ? "1px solid hsl(var(--kf-border)/0.15)" : "none",
                    }}
                  >
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                    <span className="text-sm font-semibold text-foreground">{row.value}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {eventEntries.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
                className="rounded-xl overflow-hidden"
                style={{
                  background: "hsl(var(--kf-card))",
                  border: "1px solid hsl(var(--kf-border)/0.5)",
                }}
              >
                <div
                  className="px-5 py-3 flex items-center gap-2"
                  style={{ borderBottom: "1px solid hsl(var(--kf-border)/0.3)" }}
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center"
                    style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
                  >
                    <BarChart3 className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <h3 className="text-xs font-semibold">Event Breakdown</h3>
                </div>

                <div className="px-5 py-4 flex flex-wrap gap-2">
                  {eventEntries.map(([type, count], i) => {
                    const cfg = EVENT_CONFIG[type] ?? {
                      label: type,
                      icon: Eye,
                    };
                    const EvIcon = cfg.icon;
                    return (
                      <motion.span
                        key={type}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.4 + i * 0.05 }}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                        style={{
                          background: "hsl(var(--kf-accent1)/0.08)",
                          border: "1px solid hsl(var(--kf-accent1)/0.15)",
                          color: "hsl(var(--kf-accent1))",
                        }}
                      >
                        <EvIcon className="w-3.5 h-3.5" />
                        {cfg.label}
                        <span
                          className="ml-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ background: "hsl(var(--kf-accent1)/0.12)" }}
                        >
                          {count.toLocaleString()}
                        </span>
                      </motion.span>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
