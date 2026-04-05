"use client";

import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  Package,
  Clock,
  CheckCircle2,
  Truck,
  XCircle,
  RotateCcw,
  ChevronRight,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { SideSheet } from "@/components/ui/side-sheet";

type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Order {
  id: string;
  ref: string;
  customerName: string;
  customerEmail: string;
  date: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  paymentMethod: string;
  statusHistory: { status: OrderStatus; date: string }[];
}

const STATUS_ICON: Record<OrderStatus, React.ElementType> = {
  pending: Clock,
  confirmed: CheckCircle2,
  processing: Package,
  shipped: Truck,
  delivered: CheckCircle2,
  cancelled: XCircle,
  refunded: RotateCcw,
};

const STATUS_FLOW: OrderStatus[] = ["pending", "confirmed", "processing", "shipped", "delivered"];

const DEMO_ORDERS: Order[] = [
  {
    id: "ord_1", ref: "ORD-001", customerName: "Maria Garcia", customerEmail: "maria@example.com",
    date: "2026-04-04T10:30:00Z", total: 245.00, status: "confirmed", paymentMethod: "Credit Card",
    items: [
      { id: "i1", name: "Deep Tissue Massage", quantity: 1, unitPrice: 120.00, total: 120.00 },
      { id: "i2", name: "Aromatherapy Add-on", quantity: 1, unitPrice: 45.00, total: 45.00 },
      { id: "i3", name: "Recovery Balm", quantity: 2, unitPrice: 40.00, total: 80.00 },
    ],
    statusHistory: [{ status: "pending", date: "2026-04-04T10:30:00Z" }, { status: "confirmed", date: "2026-04-04T10:35:00Z" }],
  },
  {
    id: "ord_2", ref: "ORD-002", customerName: "James Wilson", customerEmail: "james@example.com",
    date: "2026-04-03T14:15:00Z", total: 89.99, status: "shipped", paymentMethod: "PayPal",
    items: [{ id: "i4", name: "Essential Oil Set", quantity: 1, unitPrice: 89.99, total: 89.99 }],
    statusHistory: [
      { status: "pending", date: "2026-04-03T14:15:00Z" }, { status: "confirmed", date: "2026-04-03T14:20:00Z" },
      { status: "processing", date: "2026-04-03T15:00:00Z" }, { status: "shipped", date: "2026-04-04T09:00:00Z" },
    ],
  },
  {
    id: "ord_3", ref: "ORD-003", customerName: "Aisha Mohammed", customerEmail: "aisha@example.com",
    date: "2026-04-02T09:00:00Z", total: 350.00, status: "delivered", paymentMethod: "Credit Card",
    items: [
      { id: "i5", name: "Full Body Treatment", quantity: 1, unitPrice: 250.00, total: 250.00 },
      { id: "i6", name: "Facial Treatment", quantity: 1, unitPrice: 100.00, total: 100.00 },
    ],
    statusHistory: [
      { status: "pending", date: "2026-04-02T09:00:00Z" }, { status: "confirmed", date: "2026-04-02T09:10:00Z" },
      { status: "processing", date: "2026-04-02T10:00:00Z" }, { status: "shipped", date: "2026-04-03T08:00:00Z" },
      { status: "delivered", date: "2026-04-04T11:00:00Z" },
    ],
  },
  {
    id: "ord_4", ref: "ORD-004", customerName: "Chen Wei", customerEmail: "chen@example.com",
    date: "2026-04-01T16:45:00Z", total: 75.00, status: "cancelled", paymentMethod: "Credit Card",
    items: [{ id: "i7", name: "Relaxation Package", quantity: 1, unitPrice: 75.00, total: 75.00 }],
    statusHistory: [
      { status: "pending", date: "2026-04-01T16:45:00Z" }, { status: "cancelled", date: "2026-04-01T17:00:00Z" },
    ],
  },
  {
    id: "ord_5", ref: "ORD-005", customerName: "Sofia Petrov", customerEmail: "sofia@example.com",
    date: "2026-03-30T11:20:00Z", total: 199.50, status: "refunded", paymentMethod: "PayPal",
    items: [
      { id: "i8", name: "Premium Skincare Set", quantity: 1, unitPrice: 149.50, total: 149.50 },
      { id: "i9", name: "Face Mask Pack", quantity: 1, unitPrice: 50.00, total: 50.00 },
    ],
    statusHistory: [
      { status: "pending", date: "2026-03-30T11:20:00Z" }, { status: "confirmed", date: "2026-03-30T11:25:00Z" },
      { status: "refunded", date: "2026-03-31T09:00:00Z" },
    ],
  },
  {
    id: "ord_6", ref: "ORD-006", customerName: "Maria Garcia", customerEmail: "maria@example.com",
    date: "2026-03-28T13:00:00Z", total: 160.00, status: "delivered", paymentMethod: "Credit Card",
    items: [{ id: "i10", name: "Hot Stone Massage", quantity: 1, unitPrice: 160.00, total: 160.00 }],
    statusHistory: [
      { status: "pending", date: "2026-03-28T13:00:00Z" }, { status: "confirmed", date: "2026-03-28T13:05:00Z" },
      { status: "processing", date: "2026-03-28T14:00:00Z" }, { status: "shipped", date: "2026-03-29T08:00:00Z" },
      { status: "delivered", date: "2026-03-30T10:00:00Z" },
    ],
  },
];

const STATUS_FILTERS: { value: OrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All Orders" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
];

function OrderDetailSheet({ order, onClose, onStatusUpdate }: { order: Order; onClose: () => void; onStatusUpdate: (orderId: string, newStatus: OrderStatus) => void }) {
  const currentIdx = STATUS_FLOW.indexOf(order.status);
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;

  return (
    <SideSheet open title={`Order ${order.ref}`} subtitle={order.customerName} onClose={onClose} width="lg">
      <div className="space-y-5 p-1">
        <div className="flex items-center justify-between">
          <StatusBadge status={order.status} variant="filled" size="md" dot />
          <span className="text-xs text-muted-foreground">{new Date(order.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>

        <div className="rounded-xl p-4 space-y-2" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer</h4>
          <p className="text-sm font-medium">{order.customerName}</p>
          <p className="text-xs text-muted-foreground">{order.customerEmail}</p>
          <p className="text-xs text-muted-foreground">Payment: {order.paymentMethod}</p>
        </div>

        <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Items</h4>
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground ml-1">× {item.quantity}</span>
                </div>
                <span className="font-semibold">${item.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="pt-2 flex items-center justify-between font-bold text-sm" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <span>Total</span>
            <span>${order.total.toFixed(2)}</span>
          </div>
        </div>

        <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status Timeline</h4>
          <div className="space-y-2">
            {order.statusHistory.map((entry, idx) => {
              const Icon = STATUS_ICON[entry.status];
              return (
                <div key={idx} className="flex items-center gap-3">
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <div className="flex-1">
                    <span className="text-xs font-medium capitalize">{entry.status.replace("_", " ")}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{new Date(entry.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              );
            })}
          </div>
        </div>

        {nextStatus && order.status !== "cancelled" && order.status !== "refunded" && (
          <div className="flex gap-2">
            <button
              onClick={() => onStatusUpdate(order.id, nextStatus)}
              className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors min-h-[44px]"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
            >
              Mark as {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
            </button>
            {order.status !== "delivered" && (
              <button
                onClick={() => onStatusUpdate(order.id, "cancelled")}
                className="text-sm font-medium px-4 py-2.5 rounded-lg transition-colors min-h-[44px] border"
                style={{ borderColor: "hsl(var(--kf-error)/0.3)", color: "hsl(var(--kf-error))" }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {order.status === "delivered" && (
          <button
            onClick={() => onStatusUpdate(order.id, "refunded")}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg transition-colors min-h-[44px] border"
            style={{ borderColor: "hsl(var(--kf-warning)/0.3)", color: "hsl(var(--kf-warning))" }}
          >
            <RotateCcw className="w-3.5 h-3.5 inline mr-1.5" />Issue Refund
          </button>
        )}
      </div>
    </SideSheet>
  );
}

export function OrdersPanel() {
  const [orders, setOrders] = useState<Order[]>(DEMO_ORDERS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    let result = orders;
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);
    if (dateFrom) result = result.filter((o) => o.date >= dateFrom);
    if (dateTo) result = result.filter((o) => o.date <= dateTo + "T23:59:59Z");
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((o) => o.customerName.toLowerCase().includes(q) || o.ref.toLowerCase().includes(q) || o.customerEmail.toLowerCase().includes(q));
    }
    return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, search, statusFilter, dateFrom, dateTo]);

  const handleStatusUpdate = useCallback((orderId: string, newStatus: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          status: newStatus,
          statusHistory: [...o.statusHistory, { status: newStatus, date: new Date().toISOString() }],
        };
      })
    );
    setSelectedOrder((prev) => {
      if (!prev || prev.id !== orderId) return prev;
      return {
        ...prev,
        status: newStatus,
        statusHistory: [...prev.statusHistory, { status: newStatus, date: new Date().toISOString() }],
      };
    });
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search orders..."
            aria-label="Search orders"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs bg-transparent min-h-[44px]"
            style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium min-h-[44px] transition-colors"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
          {statusFilter !== "all" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} />}
        </button>
      </div>

      {showFilters && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[36px]"
                style={{
                  background: statusFilter === f.value ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted)/0.1)",
                  color: statusFilter === f.value ? "hsl(var(--kf-accent1-foreground, 0 0% 100%))" : "hsl(var(--kf-foreground)/0.7)",
                }}
              >
                {f.label} {counts[f.value] != null ? `(${counts[f.value]})` : ""}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label htmlFor="order-date-from" className="text-[10px] text-muted-foreground">From</label>
              <input id="order-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-1.5 rounded-lg text-[11px] min-h-[36px]" style={{ background: "hsl(var(--kf-muted)/0.1)", border: "1px solid hsl(var(--kf-border)/0.4)" }} />
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="order-date-to" className="text-[10px] text-muted-foreground">To</label>
              <input id="order-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-1.5 rounded-lg text-[11px] min-h-[36px]" style={{ background: "hsl(var(--kf-muted)/0.1)", border: "1px solid hsl(var(--kf-border)/0.4)" }} />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-[10px] font-medium px-2 py-1 rounded-md" style={{ color: "hsl(var(--kf-accent1))" }}>Clear dates</button>
            )}
          </div>
        </motion.div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <Package className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No orders found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Orders will appear here once customers start purchasing</p>
          </div>
        ) : (
          filtered.map((order, idx) => (
            <motion.button
              key={order.id}
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              onClick={() => setSelectedOrder(order)}
              className="w-full rounded-xl p-3.5 flex items-center gap-3 text-left transition-all hover:scale-[1.005] hover:border-[hsl(var(--kf-accent1)_/_0.3)]"
              style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1)/0.08)" }}>
                <Package className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold">{order.ref}</span>
                  <StatusBadge status={order.status} variant="filled" size="sm" />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{order.customerName}</span>
                  <span>·</span>
                  <span>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>{new Date(order.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold">${order.total.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">{order.paymentMethod}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/30 flex-shrink-0" />
            </motion.button>
          ))
        )}
      </div>

      {selectedOrder && (
        <OrderDetailSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} onStatusUpdate={handleStatusUpdate} />
      )}
    </motion.div>
  );
}
