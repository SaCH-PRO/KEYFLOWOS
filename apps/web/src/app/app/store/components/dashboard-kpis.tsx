"use client";

import { motion } from "framer-motion";
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Percent,
  Tag,
} from "lucide-react";

export interface KpiData {
  totalRevenue: number;
  revenueTrend: number;
  totalOrders: number;
  ordersTrend: number;
  averageOrderValue: number;
  aovTrend: number;
  conversionRate: number;
  conversionTrend: number;
  grossProfitMargin: number;
  marginTrend: number;
  activePromos: number;
}

function TrendArrow({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "hsl(var(--kf-success))" }}>
        <TrendingUp className="w-3 h-3" />+{value.toFixed(1)}%
      </span>
    );
  }
  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "hsl(var(--kf-error))" }}>
        <TrendingDown className="w-3 h-3" />{value.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: "hsl(var(--kf-neutral))" }}>
      <Minus className="w-3 h-3" />0%
    </span>
  );
}

const KPIS: {
  key: keyof KpiData;
  trendKey: keyof KpiData;
  label: string;
  icon: React.ElementType;
  color: string;
  format: (v: number) => string;
  panel: DashboardPanel;
}[] = [
  { key: "totalRevenue", trendKey: "revenueTrend", label: "Total Revenue", icon: DollarSign, color: "var(--kf-success)", format: (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, panel: "profits" },
  { key: "totalOrders", trendKey: "ordersTrend", label: "Total Orders", icon: ShoppingCart, color: "var(--kf-accent1)", format: (v) => v.toLocaleString(), panel: "orders" },
  { key: "averageOrderValue", trendKey: "aovTrend", label: "Avg Order Value", icon: BarChart3, color: "var(--kf-info)", format: (v) => `$${v.toFixed(2)}`, panel: "orders" },
  { key: "conversionRate", trendKey: "conversionTrend", label: "Conversion Rate", icon: Percent, color: "var(--kf-accent2)", format: (v) => `${v.toFixed(1)}%`, panel: "analytics" },
  { key: "grossProfitMargin", trendKey: "marginTrend", label: "Gross Margin", icon: TrendingUp, color: "var(--kf-warning)", format: (v) => `${v.toFixed(1)}%`, panel: "profits" },
  { key: "activePromos", trendKey: "activePromos", label: "Active Promos", icon: Tag, color: "var(--kf-info)", format: (v) => v.toString(), panel: "promos" },
];

type DashboardPanel = "overview" | "orders" | "profits" | "customers" | "analytics" | "promos";

interface DashboardKpisProps {
  data: KpiData;
  onNavigate?: (panel: DashboardPanel) => void;
}

export function DashboardKpis({ data, onNavigate }: DashboardKpisProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {KPIS.map((kpi, idx) => {
        const Icon = kpi.icon;
        const value = data[kpi.key] as number;
        const trend = kpi.key === "activePromos" ? 0 : (data[kpi.trendKey] as number);

        return (
          <motion.button
            key={kpi.label}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + idx * 0.04 }}
            className="rounded-xl px-3.5 py-3 text-left transition-all hover:scale-[1.02] hover:border-[hsl(var(--kf-accent1)_/_0.3)]"
            style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
            onClick={() => onNavigate?.(kpi.panel)}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: `hsl(${kpi.color} / 0.1)` }}
              >
                <Icon className="w-3 h-3" style={{ color: `hsl(${kpi.color})` }} />
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{kpi.label}</p>
            </div>
            <p className="text-lg font-bold text-foreground pl-0.5 truncate">
              {kpi.format(value)}
            </p>
            {kpi.key !== "activePromos" && (
              <div className="pl-0.5 mt-0.5">
                <TrendArrow value={trend} />
              </div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
