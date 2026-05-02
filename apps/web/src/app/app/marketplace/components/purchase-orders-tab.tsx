"use client";

import { motion } from "framer-motion";
import { ClipboardList, Mail, Calendar, Pencil } from "lucide-react";
import { formatCurrency, formatDate, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

import type { PurchaseOrderDto } from "@/lib/types/marketplace";

export function PurchaseOrdersTab({ purchaseOrders, onEdit }: { purchaseOrders: PurchaseOrderDto[]; onEdit: (item: PurchaseOrderDto) => void }) {
  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(purchaseOrders);
  if (purchaseOrders.length === 0) {
    return <EmptyState icon={ClipboardList} title="No Purchase Orders" description="Create purchase orders to track supplier orders, deliveries, and costs." />;
  }
  return (
    <div className="space-y-3">
      {paginated.map((po) => (
        <motion.div
          key={po.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{po.supplierName || "Supplier"}</p>
                <StatusBadge status={po.status || "DRAFT"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {po.supplierEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{po.supplierEmail}</span>}
                {po.expectedDelivery && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Delivery: {formatDate(po.expectedDelivery)}</span>}
                {po.quantity && <span>{po.quantity} units</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {po.unitCost && po.quantity && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-sm font-semibold">{formatCurrency((parseFloat(String(po.unitCost)) || 0) * (parseInt(String(po.quantity)) || 0))}</p>
                </div>
              )}
              <button onClick={() => onEdit(po)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
