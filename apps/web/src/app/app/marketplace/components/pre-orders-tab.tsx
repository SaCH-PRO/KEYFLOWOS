"use client";

import { motion } from "framer-motion";
import { Clock, User, Mail, Calendar, Pencil } from "lucide-react";
import { formatCurrency, formatDate, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";
import type { PreOrder, Product } from "@/lib/marketplace-types";

type PreOrderRow = PreOrder & {
  product?: Product | null;
  productName?: string;
};

export function PreOrdersTab({
  preOrders,
  onEdit,
}: {
  preOrders: PreOrderRow[];
  onEdit: (item: PreOrderRow) => void;
}) {
  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(preOrders);
  if (preOrders.length === 0) {
    return <EmptyState icon={Clock} title="No Pre-Orders" description="Manage pre-orders with deposit tracking and expected delivery dates." />;
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
                <p className="text-sm font-semibold">{po.product?.name || po.productName || "Product"}</p>
                <StatusBadge status={po.status || "PENDING"} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {po.customerName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{po.customerName}</span>}
                {po.customerEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{po.customerEmail}</span>}
                {po.expectedDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Expected: {formatDate(po.expectedDate)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {po.depositAmount != null && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Deposit</p>
                  <p className="text-sm font-semibold">{formatCurrency(parseFloat(String(po.depositAmount)) || 0)}</p>
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
