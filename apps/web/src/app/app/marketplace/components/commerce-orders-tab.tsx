// @keyflow:dormant
"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  Calendar,
  Navigation,
  Package,
  Truck,
  CreditCard,
  Search,
} from "lucide-react";
import { formatCurrency, formatDate, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";
import type { OrderDto, ShipmentDto } from "@/lib/types/marketplace";

interface OrderItemLike {
  productName?: string;
  name?: string;
  quantity?: number;
  total?: number | string;
  price?: number | string;
}

type OrderExt = OrderDto & {
  paymentStatus?: string;
  paymentState?: string;
  fulfillmentRoute?: string;
  shipments?: ShipmentDto[];
  items?: OrderItemLike[];
};

const ORDER_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];

const PAYMENT_STATE_COLORS: Record<string, string> = {
  PAID: "text-emerald-400",
  PENDING: "text-amber-400",
  FAILED: "text-red-400",
  REFUNDED: "text-purple-400",
};

function OrderPipeline({ status }: { status: string }) {
  const steps = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"];
  const currentIdx = steps.indexOf(status);
  const isCancelled = status === "CANCELLED";

  if (isCancelled) {
    return (
      <div className="flex items-center gap-1 mt-2">
        <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
          Order Cancelled
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center">
        {steps.map((step, idx) => (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="relative flex flex-col items-center">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  idx <= currentIdx ? "bg-orange-500" : "bg-white/15"
                }`}
              />
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${idx < currentIdx ? "bg-orange-500/60" : "bg-white/10"}`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {steps.map((step) => (
          <span key={step} className="text-[8px] text-muted-foreground/50 truncate" style={{ maxWidth: "60px" }}>
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CommerceOrdersTab({
  orders,
  onStatusUpdate,
}: {
  orders: OrderExt[];
  onStatusUpdate: (id: string, status: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = orders;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.customerName?.toLowerCase().includes(q) ||
          o.customerEmail?.toLowerCase().includes(q) ||
          o.id?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") {
      result = result.filter((o) => o.status === filterStatus);
    }
    return result;
  }, [orders, search, filterStatus]);

  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(filtered);

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="No Orders Yet"
        description="Orders will appear here when customers purchase from your listings."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
            placeholder="Search orders..."
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-500/50 appearance-none"
        >
          <option value="all">All Statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {paginated.map((order) => {
          const isExpanded = expanded === order.id;
          const shipments: ShipmentDto[] = order.shipments ?? [];
          const paymentState = order.paymentStatus || order.paymentState || "PENDING";

          return (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
            >
              <div className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <ShoppingCart className="w-4 h-4 text-white/40" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{order.customerName || "Customer"}</p>
                        <StatusBadge status={order.status || "PENDING"} />
                        <span className={`text-[10px] font-medium ${PAYMENT_STATE_COLORS[paymentState] || "text-muted-foreground"}`}>
                          <CreditCard className="w-3 h-3 inline mr-0.5" />
                          {paymentState}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap mt-1">
                        {order.customerEmail && (
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{order.customerEmail}</span>
                        )}
                        {order.customerPhone && (
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{order.customerPhone}</span>
                        )}
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(order.createdAt ?? "")}</span>
                      </div>
                      <OrderPipeline status={order.status || "PENDING"} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <p className="text-base font-bold">{formatCurrency(Number(order.total ?? 0))}</p>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={order.status || "PENDING"}
                        onChange={(e) => onStatusUpdate(order.id, e.target.value)}
                        className="text-[10px] bg-white/5 border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-orange-500/50"
                      >
                        {ORDER_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setExpanded(isExpanded ? null : order.id)}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/5 overflow-hidden"
                  >
                    <div className="px-4 py-3 space-y-3">
                      {order.shippingAddress && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 flex items-center gap-1">
                            <Navigation className="w-3 h-3" /> Shipping Address
                          </p>
                          <p className="text-xs text-muted-foreground">{order.shippingAddress}</p>
                        </div>
                      )}

                      {order.fulfillmentRoute && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1 flex items-center gap-1">
                            <Package className="w-3 h-3" /> Fulfillment Route
                          </p>
                          <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                            {order.fulfillmentRoute}
                          </span>
                        </div>
                      )}

                      {shipments.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1">
                            <Truck className="w-3 h-3" /> Linked Shipments ({shipments.length})
                          </p>
                          <div className="space-y-1.5">
                            {shipments.map((s) => (
                              <div key={s.id} className="flex items-center justify-between text-xs bg-white/3 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                                <span className="text-muted-foreground">{s.carrier || "Carrier"} — {s.trackingNumber || "No tracking"}</span>
                                <StatusBadge status={s.status || "PREPARING"} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {order.items && order.items.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Order Items</p>
                          <div className="space-y-1">
                            {order.items.map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span>{item.productName || item.name || "Item"} × {item.quantity || 1}</span>
                                <span className="font-medium">{formatCurrency(Number(item.total ?? item.price ?? 0))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}