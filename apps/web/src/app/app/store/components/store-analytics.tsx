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

const EVENT_CONFIG: Record<string, { label: string; color: string; icon: typeof Eye }> = {
  page_view: { label: "Page Views", color: "hsl(220 70% 55%)", icon: Eye },
  add_to_cart: { label: "Add to Cart", color: "hsl(280 70% 55%)", icon: ShoppingCart },
  checkout_start: { label: "Checkout Start", color: "hsl(40 90% 50%)", icon: CreditCard },
  checkout_complete: { label: "Completed", color: "hsl(142 70% 45%)", icon: CheckCircle },
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
    load(PERIODS[selectedPeriod].days);
  }, [selectedPeriod, load]);

  const kpis = analytics
    ? [
        {
          label: "Total Bookings",
          value: analytics.bookings.total.toLocaleString(),
          icon: Calendar,
          color: "hsl(var(--kf-accent1))",
          bg: "hsl(var(--kf-accent1) / 0.15)",
          border: "hsl(var(--kf-accent1) / 0.25)",
        },
        {
          label: "Revenue (Period)",
          value: formatPrice(analytics.revenue.inPeriod),
          icon: DollarSign,
          color: "hsl(142 70% 45%)",
          bg: "hsl(142 70% 45% / 0.15)",
          border: "hsl(142 70% 45% / 0.25)",
        },
        {
          label: "Bookings (Period)",
          value: analytics.bookings.inPeriod.toLocaleString(),
          icon: TrendingUp,
          color: "hsl(var(--kf-accent2))",
          bg: "hsl(var(--kf-accent2) / 0.15)",
          border: "hsl(var(--kf-accent2) / 0.25)",
        },
        {
          label: "Catalog Items",
          value: (analytics.catalog.products + analytics.catalog.services).toLocaleString(),
          icon: Package,
          color: "hsl(40 90% 50%)",
          bg: "hsl(40 90% 50% / 0.15)",
          border: "hsl(40 90% 50% / 0.25)",
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
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2
          className="text-lg font-semibold bg-clip-text text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
          }}
        >
          Store Analytics
        </h2>

        <div
          className="inline-flex rounded-xl p-1 gap-1"
          style={{
            background: "hsl(var(--kf-accent1) / 0.08)",
            border: "1px solid hsl(var(--kf-accent1) / 0.12)",
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
                    ? "hsl(var(--kf-accent1) / 0.15)"
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
            className="space-y-6"
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl p-5 animate-pulse"
                  style={{
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
                    border: "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <div
                    className="h-10 w-10 rounded-xl mb-3"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                  />
                  <div
                    className="h-4 w-16 rounded mb-2"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                  />
                  <div
                    className="h-6 w-24 rounded"
                    style={{ background: "hsl(var(--kf-accent1) / 0.08)" }}
                  />
                </div>
              ))}
            </div>
            <div
              className="rounded-2xl p-6 animate-pulse"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
                border: "1px solid hsl(var(--kf-border) / 0.3)",
              }}
            >
              <div
                className="h-5 w-32 rounded mb-4"
                style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
              />
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-10 rounded mb-2"
                  style={{ background: "hsl(var(--kf-accent1) / 0.05)" }}
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
            className="space-y-6"
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {kpis.map((kpi, i) => {
                const Icon = kpi.icon;
                return (
                  <motion.div
                    key={kpi.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className="relative overflow-hidden rounded-2xl p-5"
                    style={{
                      background: `linear-gradient(135deg, ${kpi.bg}, hsl(var(--kf-accent2) / 0.04))`,
                      border: `1px solid ${kpi.border}`,
                    }}
                  >
                    <div
                      className="absolute inset-0 opacity-[0.03]"
                      style={{
                        background: `radial-gradient(ellipse at 30% 0%, ${kpi.color}, transparent 60%)`,
                      }}
                    />
                    <div className="relative">
                      <div
                        className="h-10 w-10 rounded-xl flex items-center justify-center mb-3"
                        style={{
                          background: kpi.bg,
                          border: `1px solid ${kpi.border}`,
                        }}
                      >
                        <Icon className="w-5 h-5" style={{ color: kpi.color }} />
                      </div>
                      <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                      <p className="text-xl font-bold" style={{ color: kpi.color }}>
                        {kpi.value}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative overflow-hidden rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.04))",
                border: "1px solid hsl(var(--kf-accent1) / 0.12)",
              }}
            >
              <div
                className="px-5 py-3 border-b flex items-center gap-2"
                style={{
                  borderColor: "hsl(var(--kf-accent1) / 0.1)",
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), transparent)",
                }}
              >
                <Package
                  className="w-4 h-4"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                />
                <h3
                  className="text-sm font-semibold"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                >
                  Summary
                </h3>
              </div>

              <div className="divide-y" style={{ borderColor: "hsl(var(--kf-border) / 0.15)" }}>
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
                    transition={{ delay: 0.35 + i * 0.05 }}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <span className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                      {row.value}
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {eventEntries.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="relative overflow-hidden rounded-2xl"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.08), hsl(var(--kf-accent1) / 0.04))",
                  border: "1px solid hsl(var(--kf-accent2) / 0.12)",
                }}
              >
                <div
                  className="px-5 py-3 border-b flex items-center gap-2"
                  style={{
                    borderColor: "hsl(var(--kf-accent2) / 0.1)",
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), transparent)",
                  }}
                >
                  <BarChart3
                    className="w-4 h-4"
                    style={{ color: "hsl(var(--kf-accent2))" }}
                  />
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: "hsl(var(--kf-accent2))" }}
                  >
                    Event Breakdown
                  </h3>
                </div>

                <div className="px-5 py-4 flex flex-wrap gap-2">
                  {eventEntries.map(([type, count], i) => {
                    const cfg = EVENT_CONFIG[type] ?? {
                      label: type,
                      color: "hsl(var(--kf-accent1))",
                      icon: Eye,
                    };
                    const EvIcon = cfg.icon;
                    return (
                      <motion.span
                        key={type}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.55 + i * 0.05 }}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
                        style={{
                          background: `color-mix(in srgb, ${cfg.color} 15%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${cfg.color} 25%, transparent)`,
                          color: cfg.color,
                        }}
                      >
                        <EvIcon className="w-3.5 h-3.5" />
                        {cfg.label}
                        <span
                          className="ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                          style={{
                            background: `color-mix(in srgb, ${cfg.color} 20%, transparent)`,
                          }}
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
