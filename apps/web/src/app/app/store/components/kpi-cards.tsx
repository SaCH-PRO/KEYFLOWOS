"use client";

import { motion } from "framer-motion";
import { Store, ShoppingBag, TrendingUp, AlertTriangle } from "lucide-react";
import type { DriftedItem } from "./store-types";

interface KpiCardsProps {
  servicesCount: number;
  commerceProductsCount: number;
  storeEnabled: boolean;
  driftedItemsCount: number;
}

export function KpiCards({ servicesCount, commerceProductsCount, storeEnabled, driftedItemsCount }: KpiCardsProps) {
  const kpiCards = [
    {
      label: "Store Items",
      value: servicesCount,
      icon: Store,
      color: "hsl(var(--kf-accent1))",
      bg: "hsl(var(--kf-accent1) / 0.08)",
      border: "hsl(var(--kf-accent1) / 0.2)",
    },
    {
      label: "Commerce Products",
      value: commerceProductsCount,
      icon: ShoppingBag,
      color: "hsl(var(--kf-accent2))",
      bg: "hsl(var(--kf-accent2) / 0.08)",
      border: "hsl(var(--kf-accent2) / 0.2)",
    },
    {
      label: "Store Status",
      value: storeEnabled ? "Published" : "Unpublished",
      icon: TrendingUp,
      color: storeEnabled ? "hsl(142 70% 55%)" : "hsl(40 90% 55%)",
      bg: storeEnabled ? "hsl(142 70% 45% / 0.08)" : "hsl(40 90% 50% / 0.08)",
      border: storeEnabled ? "hsl(142 70% 45% / 0.2)" : "hsl(40 90% 50% / 0.2)",
      dot: storeEnabled ? "hsl(142 70% 55%)" : "hsl(40 90% 55%)",
    },
    {
      label: "Price Drifts",
      value: driftedItemsCount,
      icon: AlertTriangle,
      color: driftedItemsCount > 0 ? "hsl(30 90% 60%)" : "hsl(var(--kf-muted-foreground))",
      bg: driftedItemsCount > 0 ? "hsl(30 90% 50% / 0.08)" : "hsl(var(--kf-muted) / 0.3)",
      border: driftedItemsCount > 0 ? "hsl(30 90% 50% / 0.2)" : "hsl(var(--kf-border))",
      warn: driftedItemsCount > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {kpiCards.map((kpi, idx) => {
        const Icon = kpi.icon;
        return (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="rounded-2xl p-4 relative overflow-hidden"
            style={{
              background: kpi.bg,
              border: `1px solid ${kpi.border}`,
              backdropFilter: "blur(20px)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <Icon className="w-4 h-4" style={{ color: kpi.color }} />
              {(kpi as any).dot && (
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: (kpi as any).dot }}
                />
              )}
              {(kpi as any).warn && (
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: "hsl(30 90% 55%)" }}
                />
              )}
            </div>
            <p className="text-2xl font-bold" style={{ color: kpi.color }}>
              {kpi.value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.label}</p>
          </motion.div>
        );
      })}
    </div>
  );
}
