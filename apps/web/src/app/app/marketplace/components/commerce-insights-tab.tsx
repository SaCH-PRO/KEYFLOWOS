"use client";

import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Sparkles,
  DollarSign,
  ShoppingBag,
  Target,
  Zap,
  Clock,
} from "lucide-react";
import type {
  Product,
  MarketplaceListing,
  MarketplaceOrder,
  InventoryStock,
} from "@/lib/marketplace-types";

type ListingRow = MarketplaceListing & { status?: string; active?: boolean };
type InventoryRow = InventoryStock & { reorderLevel?: number | null };

function InsightCard({
  icon: Icon,
  title,
  value,
  sub,
  color,
  bg,
  border,
  badge,
  delay = 0,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  sub: string;
  color: string;
  bg: string;
  border: string;
  badge?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`${bg} border ${border} rounded-2xl p-4 space-y-3`}
    >
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-xl ${bg}`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        {badge && (
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${bg} ${color} border ${border}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground/70 font-medium">{title}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
      </div>
    </motion.div>
  );
}

function PlaceholderCard({ title, description, icon: Icon, delay = 0 }: { title: string; description: string; icon: React.ElementType; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-white/3 border border-white/6 rounded-2xl p-4 relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.03]">
        <Icon style={{ width: "120px", height: "120px" }} />
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-purple-500/10">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <span className="text-[9px] uppercase tracking-wider font-semibold text-purple-400">AI-Powered</span>
        </div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-1">{description}</p>
        <div className="mt-3 h-12 rounded-xl bg-white/5 flex items-center justify-center">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
            <Clock className="w-3 h-3" />
            Populates when AI engine is active
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function CommerceInsightsTab({
  products,
  listings,
  orders,
  inventory,
}: {
  products: Product[];
  listings: ListingRow[];
  orders: MarketplaceOrder[];
  inventory: InventoryRow[];
}) {
  const activeListings = listings.filter((l) => l.status === "ACTIVE" || l.active).length;
  const totalRevenue = orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  const productsWithCost = products.filter((p) => p.costPrice && p.price);
  const avgMargin =
    productsWithCost.length > 0
      ? productsWithCost.reduce((sum, p) => {
          const price = parseFloat(String(p.price));
          const cost = parseFloat(String(p.costPrice));
          const margin = ((price - cost) / price) * 100;
          return sum + margin;
        }, 0) / productsWithCost.length
      : 0;
  const lowStockCount = inventory.filter((i) => {
    const reorder = i.reorderLevel ?? i.reorderAt;
    return reorder != null && i.quantity <= reorder;
  }).length;
  const readyProducts = products.filter((p) => p.price && p.costPrice).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-purple-500/10">
          <Sparkles className="w-4 h-4 text-purple-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Commerce Insights</h3>
          <p className="text-[11px] text-muted-foreground">Summary metrics and AI-powered signals</p>
        </div>
        <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" />
          AI engine: Task 4
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InsightCard
          icon={DollarSign}
          title="Avg Margin"
          value={productsWithCost.length > 0 ? `${avgMargin.toFixed(1)}%` : "—"}
          sub={`Across ${productsWithCost.length} priced products`}
          color="text-emerald-400"
          bg="bg-emerald-500/10"
          border="border-emerald-500/20"
          delay={0}
        />
        <InsightCard
          icon={TrendingUp}
          title="Active Listings"
          value={String(activeListings)}
          sub={`of ${listings.length} total listings`}
          color="text-blue-400"
          bg="bg-blue-500/10"
          border="border-blue-500/20"
          delay={0.05}
        />
        <InsightCard
          icon={ShoppingBag}
          title="Order Revenue"
          value={`$${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          sub="From non-cancelled orders"
          color="text-purple-400"
          bg="bg-purple-500/10"
          border="border-purple-500/20"
          delay={0.1}
        />
        <InsightCard
          icon={lowStockCount > 0 ? AlertTriangle : Target}
          title="Inventory Alerts"
          value={String(lowStockCount)}
          sub="Products below reorder level"
          color={lowStockCount > 0 ? "text-amber-400" : "text-muted-foreground/50"}
          bg={lowStockCount > 0 ? "bg-amber-500/10" : "bg-muted/5"}
          border={lowStockCount > 0 ? "border-amber-500/20" : "border-white/5"}
          badge={lowStockCount > 0 ? "Alert" : undefined}
          delay={0.15}
        />
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">AI-Powered Analysis</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PlaceholderCard
            icon={TrendingDown}
            title="Cost Pressure Signals"
            description="Identify products where supplier costs are compressing margins below threshold."
            delay={0.2}
          />
          <PlaceholderCard
            icon={AlertTriangle}
            title="Source Risk Indicators"
            description="Flag products with single-supplier dependency or concentration risk."
            delay={0.25}
          />
          <PlaceholderCard
            icon={Target}
            title="Product Opportunities"
            description="Surface high-margin products with untapped market reach potential."
            delay={0.3}
          />
          <PlaceholderCard
            icon={TrendingUp}
            title="Margin Analysis"
            description="Deep margin breakdown by product category, supplier, and fulfillment model."
            delay={0.35}
          />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="rounded-2xl border border-purple-500/15 p-4 space-y-2"
        style={{ background: "rgba(168, 85, 247, 0.04)" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <p className="text-sm font-semibold">Product Readiness Overview</p>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-2">
          {[
            { label: "Priced", count: readyProducts, total: products.length, color: "text-emerald-400", bg: "bg-emerald-500" },
            { label: "Listed", count: listings.length, total: products.length, color: "text-blue-400", bg: "bg-blue-500" },
            { label: "In Orders", count: new Set(orders.flatMap((o) => o.items?.map((i) => i.productId) ?? [])).size, total: products.length, color: "text-purple-400", bg: "bg-purple-500" },
          ].map((item) => {
            const pct = products.length > 0 ? Math.round((item.count / products.length) * 100) : 0;
            return (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{item.label}</span>
                  <span className={`text-[10px] font-semibold ${item.color}`}>{item.count}/{item.total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.bg}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
