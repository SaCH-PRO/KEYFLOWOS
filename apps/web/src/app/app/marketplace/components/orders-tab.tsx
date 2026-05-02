"use client";

import { motion } from "framer-motion";
import { ShoppingCart, Mail, Phone, Calendar, Navigation } from "lucide-react";
import { formatCurrency, formatDate, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
export function OrdersTab({ orders, onStatusUpdate }: { orders: any[]; onStatusUpdate: (id: string, status: string) => void }) {
  const statuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(orders);

  if (orders.length === 0) {
    return <EmptyState icon={ShoppingCart} title="No Orders Yet" description="Orders will appear here when customers purchase from your marketplace listings." />;
  }
  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation */}
      {paginated.map((order: any) => (
        <motion.div
          key={order.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{order.customerName || "Customer"}</p>
                <StatusBadge status={order.status || "PENDING"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {order.customerEmail && (
                  <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{order.customerEmail}</span>
                )}
                {order.customerPhone && (
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{order.customerPhone}</span>
                )}
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(order.createdAt)}</span>
              </div>
              {order.shippingAddress && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Navigation className="w-3 h-3" />{order.shippingAddress}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <p className="text-lg font-bold">{formatCurrency(order.total ?? 0)}</p>
              <select
                value={order.status || "PENDING"}
                onChange={(e) => onStatusUpdate(order.id, e.target.value)}
                className="text-[10px] bg-white/5 border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-orange-500/50"
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>
      ))}
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
