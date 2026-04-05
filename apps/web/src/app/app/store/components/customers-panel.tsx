"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Search,
  ChevronDown,
  ChevronUp,
  Crown,
  Star,
  ShoppingBag,
  UserPlus,
  UserCheck,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

interface CustomerOrder {
  ref: string;
  date: string;
  total: number;
  status: string;
  items: string[];
}

interface Customer {
  id: string;
  name: string;
  email: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  isRepeat: boolean;
  orders: CustomerOrder[];
}

const DEMO_CUSTOMERS: Customer[] = [
  {
    id: "c1", name: "Maria Garcia", email: "maria@example.com",
    totalOrders: 5, totalSpent: 1025.00, lastOrderDate: "2026-04-04",
    isRepeat: true,
    orders: [
      { ref: "ORD-001", date: "2026-04-04", total: 245.00, status: "confirmed", items: ["Deep Tissue Massage", "Aromatherapy Add-on"] },
      { ref: "ORD-006", date: "2026-03-28", total: 160.00, status: "delivered", items: ["Hot Stone Massage"] },
      { ref: "ORD-011", date: "2026-03-15", total: 220.00, status: "delivered", items: ["Full Body Treatment"] },
      { ref: "ORD-018", date: "2026-02-20", total: 200.00, status: "delivered", items: ["Deep Tissue Massage", "Recovery Balm"] },
      { ref: "ORD-025", date: "2026-01-10", total: 200.00, status: "delivered", items: ["Deep Tissue Massage", "Recovery Balm"] },
    ],
  },
  {
    id: "c2", name: "James Wilson", email: "james@example.com",
    totalOrders: 3, totalSpent: 389.97, lastOrderDate: "2026-04-03",
    isRepeat: true,
    orders: [
      { ref: "ORD-002", date: "2026-04-03", total: 89.99, status: "shipped", items: ["Essential Oil Set"] },
      { ref: "ORD-012", date: "2026-03-10", total: 149.99, status: "delivered", items: ["Premium Skincare Set"] },
      { ref: "ORD-019", date: "2026-02-15", total: 149.99, status: "delivered", items: ["Premium Skincare Set"] },
    ],
  },
  {
    id: "c3", name: "Aisha Mohammed", email: "aisha@example.com",
    totalOrders: 2, totalSpent: 700.00, lastOrderDate: "2026-04-02",
    isRepeat: true,
    orders: [
      { ref: "ORD-003", date: "2026-04-02", total: 350.00, status: "delivered", items: ["Full Body Treatment", "Facial Treatment"] },
      { ref: "ORD-020", date: "2026-02-28", total: 350.00, status: "delivered", items: ["Full Body Treatment", "Facial Treatment"] },
    ],
  },
  {
    id: "c4", name: "Chen Wei", email: "chen@example.com",
    totalOrders: 1, totalSpent: 0.00, lastOrderDate: "2026-04-01",
    isRepeat: false,
    orders: [
      { ref: "ORD-004", date: "2026-04-01", total: 75.00, status: "cancelled", items: ["Relaxation Package"] },
    ],
  },
  {
    id: "c5", name: "Sofia Petrov", email: "sofia@example.com",
    totalOrders: 1, totalSpent: 199.50, lastOrderDate: "2026-03-30",
    isRepeat: false,
    orders: [
      { ref: "ORD-005", date: "2026-03-30", total: 199.50, status: "refunded", items: ["Premium Skincare Set", "Face Mask Pack"] },
    ],
  },
  {
    id: "c6", name: "David Brown", email: "david@example.com",
    totalOrders: 4, totalSpent: 560.00, lastOrderDate: "2026-03-25",
    isRepeat: true,
    orders: [
      { ref: "ORD-013", date: "2026-03-25", total: 160.00, status: "delivered", items: ["Hot Stone Massage"] },
      { ref: "ORD-016", date: "2026-03-05", total: 120.00, status: "delivered", items: ["Deep Tissue Massage"] },
      { ref: "ORD-021", date: "2026-02-10", total: 160.00, status: "delivered", items: ["Hot Stone Massage"] },
      { ref: "ORD-026", date: "2026-01-05", total: 120.00, status: "delivered", items: ["Deep Tissue Massage"] },
    ],
  },
];

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5" style={{ color: `hsl(${color})` }} />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

export function CustomersPanel() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"spent" | "orders" | "recent">("spent");

  const customers = DEMO_CUSTOMERS;
  const repeatCount = customers.filter((c) => c.isRepeat).length;
  const newCount = customers.length - repeatCount;
  const avgOrderValue = customers.reduce((s, c) => s + c.totalSpent, 0) / Math.max(customers.reduce((s, c) => s + c.totalOrders, 0), 1);

  const filtered = useMemo(() => {
    let result = customers;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      if (sortBy === "spent") return b.totalSpent - a.totalSpent;
      if (sortBy === "orders") return b.totalOrders - a.totalOrders;
      return new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime();
    });
  }, [customers, search, sortBy]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="Total Customers" value={customers.length} icon={Users} color="var(--kf-accent1)" />
        <StatCard label="Repeat Buyers" value={repeatCount} icon={UserCheck} color="var(--kf-success)" />
        <StatCard label="New Customers" value={newCount} icon={UserPlus} color="var(--kf-info)" />
        <StatCard label="Avg Order Value" value={`$${avgOrderValue.toFixed(2)}`} icon={ShoppingBag} color="var(--kf-warning)" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
          <h4 className="text-xs font-semibold mb-3">New vs Returning Ratio</h4>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.15)" }}>
              <div className="h-full rounded-full" style={{ width: `${customers.length > 0 ? (repeatCount / customers.length) * 100 : 0}%`, background: "hsl(var(--kf-success))" }} />
            </div>
            <span className="text-[10px] font-medium whitespace-nowrap">
              <span style={{ color: "hsl(var(--kf-success))" }}>{repeatCount} returning</span>
              <span className="text-muted-foreground"> / </span>
              <span style={{ color: "hsl(var(--kf-info))" }}>{newCount} new</span>
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {customers.length > 0 ? `${((repeatCount / customers.length) * 100).toFixed(0)}% repeat buyer rate` : "No customer data"}
          </p>
        </div>

        <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
          <h4 className="text-xs font-semibold mb-3">AOV Trend</h4>
          <div className="flex items-end gap-px h-12">
            {[185, 210, 195, 230, 205, 245, avgOrderValue].map((val, i) => {
              const maxVal = Math.max(185, 210, 195, 230, 205, 245, avgOrderValue, 1);
              return (
                <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${(val / maxVal) * 100}%`, background: i === 6 ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-accent1)/0.25)" }} title={`$${val.toFixed(2)}`} />
              );
            })}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] text-muted-foreground">6 months ago</span>
            <span className="text-[9px] text-muted-foreground">Now</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <h4 className="text-xs font-semibold mb-3">Top Customers by Spend</h4>
        <div className="space-y-2">
          {[...customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5).map((c, idx) => {
            const topSpend = customers.reduce((max, cu) => Math.max(max, cu.totalSpent), 1);
            return (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground w-4 text-right">{idx + 1}</span>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}>
                  {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium truncate">{c.name}</span>
                    {c.isRepeat && <Star className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />}
                  </div>
                  <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.12)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(c.totalSpent / topSpend) * 100}%`, background: "hsl(var(--kf-accent1)/0.6)" }} />
                  </div>
                </div>
                <span className="text-xs font-bold flex-shrink-0">${c.totalSpent.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers..."
            aria-label="Search customers"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs bg-transparent min-h-[44px]"
            style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
          />
        </div>
        <div className="flex items-center gap-1">
          {(["spent", "orders", "recent"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              aria-pressed={sortBy === key}
              className="px-2.5 py-2 rounded-lg text-[10px] font-medium transition-colors min-h-[36px]"
              style={{
                background: sortBy === key ? "hsl(var(--kf-accent1)/0.1)" : "transparent",
                color: sortBy === key ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
              }}
            >
              {key === "spent" ? "Top Spenders" : key === "orders" ? "Most Orders" : "Recent"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No customers found</p>
          </div>
        ) : (
          filtered.map((customer, idx) => {
            const isExpanded = expandedId === customer.id;
            return (
              <motion.div
                key={customer.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="rounded-xl overflow-hidden"
                style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : customer.id)}
                  className="w-full p-3.5 flex items-center gap-3 text-left transition-colors hover:bg-[hsl(var(--kf-muted)/0.06)]"
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold" style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}>
                    {customer.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold truncate">{customer.name}</span>
                      {customer.isRepeat && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.1)", color: "hsl(var(--kf-success))" }}>
                          <Star className="w-2.5 h-2.5" />Repeat
                        </span>
                      )}
                      {idx === 0 && sortBy === "spent" && (
                        <Crown className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-warning))" }} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{customer.email}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 mr-2">
                    <p className="text-sm font-bold">${customer.totalSpent.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">{customer.totalOrders} order{customer.totalOrders !== 1 ? "s" : ""}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider pt-3">Order History</p>
                        {customer.orders.map((order) => (
                          <div key={order.ref} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: "hsl(var(--kf-muted)/0.06)" }}>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">{order.ref}</span>
                                <StatusBadge status={order.status} variant="filled" size="sm" />
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{order.items.join(", ")}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-semibold">${order.total.toFixed(2)}</p>
                              <p className="text-[10px] text-muted-foreground">{new Date(order.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}
