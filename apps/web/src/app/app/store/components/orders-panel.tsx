"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchStoreOrders,
  updateStoreOrderStatus,
  refundStoreOrder,
  type StoreOrder,
} from "@/lib/api/store";
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
  /**
   * MarketplaceOrder keeps no status history — there is no audit table and no
   * status-change log. The panel used to render a full invented timeline
   * ("pending 10:30 → confirmed 10:35 → shipped …"). These are the two
   * timestamps the row actually carries.
   */
  placedAt: string;
  lastUpdatedAt: string;
}

/** The server stores uppercase; this panel renders lowercase. */
const STATUS_TO_API: Record<OrderStatus, string> = {
  pending: "PENDING",
  confirmed: "CONFIRMED",
  processing: "PROCESSING",
  shipped: "SHIPPED",
  delivered: "DELIVERED",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
};

const KNOWN_STATUSES = new Set<string>(Object.keys(STATUS_TO_API));

/**
 * Anything unrecognised becomes "pending" rather than crashing a lookup —
 * MarketplaceOrder.status defaults to "placed" and is a free string column, so
 * values outside this union genuinely occur.
 */
function statusFromApi(raw: string): OrderStatus {
  const lower = (raw ?? "").toLowerCase();
  if (KNOWN_STATUSES.has(lower)) return lower as OrderStatus;
  if (lower === "placed") return "pending";
  if (lower === "completed") return "delivered";
  return "pending";
}

function fromApi(o: StoreOrder): Order {
  return {
    id: o.id,
    ref: o.orderNumber,
    customerName: o.customerName,
    customerEmail: o.customerEmail ?? "",
    date: o.createdAt,
    items: (o.items ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.total,
    })),
    total: o.total,
    status: statusFromApi(o.status),
    paymentMethod: o.paymentMethod ?? "—",
    placedAt: o.createdAt,
    lastUpdatedAt: o.updatedAt,
  };
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
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeline</h4>
          <div className="space-y-2">
            {/*
              A per-status timeline needs a status-change log, and there is no
              such table. Showing placed/last-updated is what the order row can
              actually support; the invented five-step history it replaced was
              indistinguishable from a real one.
            */}
            {[
              { icon: Clock, label: "Placed", at: order.placedAt },
              { icon: STATUS_ICON[order.status], label: order.status, at: order.lastUpdatedAt },
            ].map((entry, idx) => {
              const Icon = entry.icon;
              return (
                <div key={idx} className="flex items-center gap-3">
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <div className="flex-1">
                    <span className="text-xs font-medium capitalize">{entry.label.replace("_", " ")}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{new Date(entry.at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const businessId = getStoredBusinessId() ?? "";

  /**
   * Filtering stays client-side even though the endpoint supports it: the panel
   * already had working filter UI over an in-memory list, and a page of 100 is
   * enough for a storefront's recent orders. Server-side paging is the change to
   * make when a business outgrows that, not before.
   */
  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    const { data, error } = await fetchStoreOrders(businessId, { pageSize: 100 });
    if (error) toast.error(error);
    setOrders((data?.data ?? []).map(fromApi));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const handleStatusUpdate = useCallback(async (orderId: string, newStatus: OrderStatus) => {
    if (!businessId) return;

    // Refund is its own endpoint, not a status write — it also flips
    // paymentStatus and emits store_order.refunded (store-order.service.ts:763).
    // Routing it through the status update would move the label and refund
    // nobody.
    const { data, error } = newStatus === "refunded"
      ? await refundStoreOrder(businessId, orderId)
      : await updateStoreOrderStatus(businessId, orderId, STATUS_TO_API[newStatus]);

    if (error) {
      toast.error(error);
      return;
    }

    const updated = data ? fromApi(data) : null;
    if (!updated) {
      await load();
      return;
    }

    // Render what came back, not what was requested. The server decides the
    // resulting status; assuming it matched the request is how a screen ends up
    // showing a state the database never reached.
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    setSelectedOrder((prev) => (prev && prev.id === orderId ? updated : prev));
    toast.success(`Order ${updated.ref} is now ${updated.status}`);
  }, [businessId, load]);

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
        {loading ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <p className="text-sm text-muted-foreground">Loading orders…</p>
          </div>
        ) : filtered.length === 0 ? (
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
