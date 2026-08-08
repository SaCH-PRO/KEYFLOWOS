"use client";

import { motion } from "framer-motion";
import { Store, ShoppingBag, TrendingUp, AlertTriangle } from "lucide-react";
import { StatOrb } from "@/components/ui-v2/stat-orb";
import { MetricExplainer } from "@/components/ui/metric-explainer";

interface KpiCardsProps {
  servicesCount: number;
  commerceProductsCount: number;
  storeEnabled: boolean;
  driftedItemsCount: number;
}

export function KpiCards({ servicesCount, commerceProductsCount, storeEnabled, driftedItemsCount }: KpiCardsProps) {
  const kpis = [
    {
      label: "Store Items",
      value: servicesCount,
      color: "orange" as const,
      explanation: "Services and products visible on your public storefront.",
      goodValue: "Add at least 3-5 items to give customers variety.",
    },
    {
      label: "Commerce Products",
      value: commerceProductsCount,
      color: "teal" as const,
      explanation: "Total products in your Commerce catalog that can be toggled into the store.",
      goodValue: "Keep your catalog updated with current pricing.",
    },
    {
      label: "Store Status",
      value: storeEnabled ? "Published" : "Unpublished",
      color: storeEnabled ? ("mint" as const) : ("orange" as const),
      explanation: storeEnabled
        ? "Your store is live and accessible to the public via your store URL."
        : "Your store is in draft mode. Toggle it on to make it publicly accessible.",
    },
    {
      label: "Price Drifts",
      value: driftedItemsCount,
      color: driftedItemsCount > 0 ? ("gold" as const) : ("teal" as const),
      explanation: "Items whose store price differs from Commerce catalog price. Sync to avoid confusion.",
      goodValue: "Keep at 0 for consistent pricing across channels.",
    },
  ];

  const icons = [Store, ShoppingBag, TrendingUp, AlertTriangle];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => {
        const Icon = icons[idx];
        return (
          <MetricExplainer
            key={kpi.label}
            label={kpi.label}
            explanation={kpi.explanation}
            goodValue={kpi.goodValue}
          >
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <StatOrb
                label={kpi.label}
                value={kpi.value}
                color={kpi.color}
                className="relative overflow-hidden"
              >
                <Icon className="absolute top-4 right-4 w-4 h-4 text-muted-foreground/30" />
              </StatOrb>
            </motion.div>
          </MetricExplainer>
        );
      })}
    </div>
  );
}
