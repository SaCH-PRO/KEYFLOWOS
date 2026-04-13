"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Truck,
  ClipboardList,
  AlertTriangle,
  Plus,
  Pencil,
  Calendar,
  Mail,
  MapPin,
  Package,
  ArrowRight,
} from "lucide-react";
import { formatCurrency, formatDate, StatusBadge, EmptyState, usePagination, PaginationBar } from "./marketplace-utils";

type FulfillmentSection = "routes" | "purchase-orders" | "shipments";

function ShipmentTracker({ shipment }: { shipment: any }) {
  const timeline = ["PREPARING", "PICKED_UP", "IN_TRANSIT", "CUSTOMS", "DELIVERED"];
  const currentIdx = timeline.indexOf(shipment.status || "PREPARING");
  const isDelayed = shipment.estimatedDelivery && new Date(shipment.estimatedDelivery) < new Date() && shipment.status !== "DELIVERED";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3"
    >
      {isDelayed && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Shipment may be delayed — estimated delivery passed</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-cyan-400" />
          <div>
            <p className="text-sm font-semibold">{shipment.carrier || "Carrier"}</p>
            <p className="text-[11px] text-muted-foreground">
              {shipment.trackingNumber ? `Tracking: ${shipment.trackingNumber}` : "No tracking number"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <StatusBadge status={shipment.status || "PREPARING"} />
          {shipment.estimatedDelivery && (
            <p className="text-[10px] text-muted-foreground mt-1">
              ETA {formatDate(shipment.estimatedDelivery)}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-0.5">
          {timeline.map((step, idx) => (
            <div key={step} className="flex items-center flex-1">
              <div className={`flex-1 h-1.5 rounded-full ${idx <= currentIdx ? "bg-cyan-500" : "bg-white/10"}`} />
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          {timeline.map((step) => (
            <span key={step} className="text-[8px] text-muted-foreground/50">{step.replace(/_/g, " ")}</span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function RouteCard({ route }: { route: any }) {
  const isRisky = route.risk === "high" || route.delayDays > 3;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white/5 border rounded-2xl p-4 ${isRisky ? "border-amber-500/20" : "border-white/10"}`}
    >
      {isRisky && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{route.delayDays ? `${route.delayDays}-day delay risk` : "High risk route"}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-orange-400" />
          <div>
            <p className="text-sm font-semibold">{route.name || route.origin || "Route"}</p>
            {route.destination && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                {route.origin} <ArrowRight className="w-3 h-3" /> {route.destination}
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={route.status || "ACTIVE"} />
      </div>
    </motion.div>
  );
}

export function CommerceFulfillmentTab({
  shipments,
  purchaseOrders,
  products,
  onEditShipment,
  onCreateShipment,
  onEditPO,
  onCreatePO,
}: {
  shipments: any[];
  purchaseOrders: any[];
  products: any[];
  onEditShipment: (item: any) => void;
  onCreateShipment: () => void;
  onEditPO: (item: any) => void;
  onCreatePO: () => void;
}) {
  const [section, setSection] = useState<FulfillmentSection>("shipments");

  const { page: shipPage, pageSize: shipPageSize, setPage: setShipPage, setPageSize: setShipPageSize, totalPages: shipTotal, paginated: paginatedShipments } = usePagination(shipments);
  const { page: poPage, pageSize: poPageSize, setPage: setPoPage, setPageSize: setPoPageSize, totalPages: poTotal, paginated: paginatedPOs } = usePagination(purchaseOrders);

  const routeGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const s of shipments) {
      const key = s.status || "PREPARING";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [shipments]);

  const delayedShipments = shipments.filter(
    (s) => s.estimatedDelivery && new Date(s.estimatedDelivery) < new Date() && s.status !== "DELIVERED"
  );

  const sectionTabs: { key: FulfillmentSection; label: string; icon: React.ElementType; count?: number }[] = [
    { key: "shipments", label: "Shipments", icon: Truck, count: shipments.length },
    { key: "purchase-orders", label: "Purchase Orders", icon: ClipboardList, count: purchaseOrders.length },
    { key: "routes", label: "Route Overview", icon: MapPin },
  ];

  return (
    <div className="space-y-4">
      {delayedShipments.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-medium">{delayedShipments.length} shipment{delayedShipments.length !== 1 ? "s" : ""} may be delayed</span>
        </div>
      )}

      <div className="flex items-center gap-1">
        {sectionTabs.map((t) => {
          const Icon = t.icon;
          const isActive = section === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                isActive
                  ? "bg-orange-500/15 text-orange-400 border border-orange-500/25"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="text-[9px] px-1.5 rounded-full bg-white/10">{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {section === "shipments" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={onCreateShipment}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Shipment
            </button>
          </div>
          {shipments.length === 0 ? (
            <EmptyState icon={Truck} title="No Shipments" description="Track shipments with carrier and tracking info here." />
          ) : (
            <>
              {paginatedShipments.map((s: any) => (
                <div key={s.id} className="relative">
                  <ShipmentTracker shipment={s} />
                  <button
                    onClick={() => onEditShipment(s)}
                    className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <PaginationBar page={shipPage} pageSize={shipPageSize} totalPages={shipTotal} setPage={setShipPage} setPageSize={setShipPageSize} />
            </>
          )}
        </div>
      )}

      {section === "purchase-orders" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={onCreatePO}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New PO
            </button>
          </div>
          {purchaseOrders.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No Purchase Orders" description="Create purchase orders to manage supplier orders and track deliveries." />
          ) : (
            <>
              <div className="space-y-2">
                {paginatedPOs.map((po: any) => (
                  <motion.div
                    key={po.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-orange-400" />
                          <p className="text-sm font-semibold">{po.supplierName || "Supplier"}</p>
                          <StatusBadge status={po.status || "DRAFT"} />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          {po.supplierEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{po.supplierEmail}</span>}
                          {po.expectedDelivery && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Delivery: {formatDate(po.expectedDelivery)}
                            </span>
                          )}
                          {po.quantity && <span>{po.quantity} units</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {po.unitCost && po.quantity && (
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="text-sm font-semibold">
                              {formatCurrency((parseFloat(po.unitCost) || 0) * (parseInt(po.quantity) || 0))}
                            </p>
                          </div>
                        )}
                        <button
                          onClick={() => onEditPO(po)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              <PaginationBar page={poPage} pageSize={poPageSize} totalPages={poTotal} setPage={setPoPage} setPageSize={setPoPageSize} />
            </>
          )}
        </div>
      )}

      {section === "routes" && (
        <div className="space-y-3">
          {Object.keys(routeGroups).length === 0 ? (
            <EmptyState icon={MapPin} title="No Route Data" description="Add shipments to see fulfillment routes grouped by status." />
          ) : (
            Object.entries(routeGroups).map(([status, group]) => (
              <div key={status}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{status.replace(/_/g, " ")} ({group.length})</p>
                <div className="space-y-2">
                  {group.map((route: any) => (
                    <RouteCard key={route.id} route={{ ...route, name: `${route.carrier || "Shipment"} — ${route.trackingNumber || route.id?.slice(0, 8)}` }} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
