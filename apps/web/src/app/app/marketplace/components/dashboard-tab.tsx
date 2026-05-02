"use client";

import { motion } from "framer-motion";
import {
  Globe,
  Package,
  ShoppingCart,
  Truck,
  DollarSign,
  Clock,
  Warehouse,
} from "lucide-react";
import { StatCards } from "@/components/ui/stat-cards";
import { formatCurrency, formatDate, StatusBadge, EmptyState } from "./marketplace-utils";

interface DashboardData {
  activeListings?: number;
  pendingOrders?: number;
  inTransitShipments?: number;
  monthlyRevenue?: number;
  preOrders?: number;
  warehouses?: number;
  totalProducts?: number;
  totalOrders?: number;
  totalRevenue?: number;
  pendingShipments?: number;
  lowStockCount?: number;
  marketReach?: { LOCAL?: number; REGIONAL?: number; INTERNATIONAL?: number };
  recentOrders?: Array<{ id: string; orderNumber?: string; customerName?: string | null; total?: number | string; status?: string; createdAt?: string }>;
}

export function DashboardTab({ data }: { data: DashboardData | null | undefined }) {
  const stats = data || {};
  return (
    <div className="space-y-6">
      <StatCards
        columns={3}
        items={[
          { label: "Active Listings", value: String(stats.activeListings ?? 0), sub: "In marketplace", icon: Package, color: "#22c55e" },
          { label: "Pending Orders", value: String(stats.pendingOrders ?? 0), sub: "Awaiting action", icon: ShoppingCart, color: "#f59e0b" },
          { label: "In-Transit", value: String(stats.inTransitShipments ?? 0), sub: "Shipments", icon: Truck, color: "#06b6d4" },
          { label: "Monthly Revenue", value: formatCurrency(stats.monthlyRevenue ?? 0), sub: "This month", icon: DollarSign, color: "#8b5cf6" },
          { label: "Pre-Orders", value: String(stats.preOrders ?? 0), sub: "Pending fulfillment", icon: Clock, color: "#f97316" },
          { label: "Warehouses", value: String(stats.warehouses ?? 0), sub: "Active locations", icon: Warehouse, color: "#ec4899" },
        ]}
      />

      {stats.marketReach && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-5"
        >
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Market Reach Breakdown
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["LOCAL", "REGIONAL", "INTERNATIONAL"] as const).map((reach) => {
              const count = stats.marketReach?.[reach] ?? 0;
              const colors: Record<string, { bg: string; border: string; text: string }> = {
                LOCAL: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
                REGIONAL: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
                INTERNATIONAL: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-400" },
              };
              const c = colors[reach];
              return (
                <div key={reach} className={`${c.bg} border ${c.border} rounded-xl p-4 text-center`}>
                  <p className={`text-2xl font-bold ${c.text}`}>{count}</p>
                  <p className="text-xs text-muted-foreground mt-1">{reach} Listings</p>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {(stats.recentOrders?.length ?? 0) > 0 && stats.recentOrders && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden"
        >
          <div className="p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              Recent Orders
            </h3>
          </div>
          <div className="divide-y divide-white/5">
            {stats.recentOrders.slice(0, 5).map((order) => (
              <div key={order.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{order.customerName || "Customer"}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(order.createdAt ?? "")}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status ?? "PENDING"} />
                  <span className="text-sm font-semibold">{formatCurrency(Number(order.total ?? 0))}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {!stats.activeListings && !stats.pendingOrders && (
        <EmptyState
          icon={Globe}
          title="Welcome to Global Commerce"
          description="Start by listing your products in the Catalog tab to begin selling on the marketplace."
        />
      )}
    </div>
  );
}
