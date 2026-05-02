"use client";

import { motion } from "framer-motion";
import { Truck, Pencil } from "lucide-react";
import { formatDate, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
export function ShipmentsTab({ shipments, onEdit }: { shipments: any[]; onEdit: (item: any) => void }) {
  const timeline = ["PREPARING", "PICKED_UP", "IN_TRANSIT", "CUSTOMS", "DELIVERED"];
  const { page, pageSize, setPage, setPageSize, totalPages, paginated } = usePagination(shipments);

  if (shipments.length === 0) {
    return <EmptyState icon={Truck} title="No Shipments Yet" description="Shipments will be tracked here once you start fulfilling orders." />;
  }
  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation */}
      {paginated.map((shipment: any) => {
        const currentIdx = timeline.indexOf(shipment.status || "PREPARING");
        return (
          <motion.div
            key={shipment.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl p-4 space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-cyan-400" />
                  <p className="text-sm font-semibold">{shipment.carrier || "Carrier"}</p>
                  <StatusBadge status={shipment.status || "PREPARING"} />
                </div>
                <p className="text-xs text-muted-foreground">Tracking: {shipment.trackingNumber || "—"}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {shipment.estimatedDelivery && (
                  <span className="text-xs text-muted-foreground">ETA: {formatDate(shipment.estimatedDelivery)}</span>
                )}
                <button onClick={() => onEdit(shipment)} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {timeline.map((step, idx) => (
                <div key={step} className="flex items-center flex-1">
                  <div className={`w-full h-1.5 rounded-full ${idx <= currentIdx ? "bg-cyan-500" : "bg-white/10"}`} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              {timeline.map((step) => (
                <span key={step}>{step.replace(/_/g, " ")}</span>
              ))}
            </div>
          </motion.div>
        );
      })}
      <PaginationBar page={page} pageSize={pageSize} totalPages={totalPages} setPage={setPage} setPageSize={setPageSize} />
    </div>
  );
}
