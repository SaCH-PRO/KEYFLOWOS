"use client";

import { useState, useEffect, useCallback } from "react";
import { Truck, Package, ChevronDown, ChevronUp, RefreshCw, Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api";
import { DeliveryConfigPanel } from "./delivery-config-panel";
import { ShippingZonesPanel } from "./shipping-zones-panel";
import { FulfillmentPanel } from "./fulfillment-panel";

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  customerName?: string;
  customerEmail?: string;
  total: number;
  currency: string;
  createdAt: string;
  items: { id: string; name: string; quantity: number; unitPrice: number; total: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  shipments: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  statusTimeline: any[];
};

export function FulfillmentTab({ businessId }: { businessId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string | null>("orders");

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    const { data } = await apiGet<{ data: Order[]; total: number }>(
      `/marketplace/businesses/${businessId}/orders?pageSize=100`,
    );
    if (data?.data) {
      setOrders(data.data);
    } else if (Array.isArray(data)) {
      setOrders(data as unknown as Order[]);
    }
    setLoadingOrders(false);
  }, [businessId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleOrderUpdate = useCallback((updated: Order) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const pendingOrders = orders.filter((o) =>
    ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED"].includes(o.status)
  );
  const completedOrders = orders.filter((o) =>
    ["DELIVERED", "CANCELLED", "REFUNDED"].includes(o.status)
  );

  return (
    <div className="space-y-6">
      <Section
        title="Order Fulfillment"
        subtitle={`${pendingOrders.length} active order${pendingOrders.length !== 1 ? "s" : ""}`}
        icon={Package}
        expanded={expandedSection === "orders"}
        onToggle={() => toggleSection("orders")}
        extra={
          <button
            onClick={(e) => {
              e.stopPropagation();
              loadOrders();
            }}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#71717a" }}
          >
            <RefreshCw className={`w-4 h-4 ${loadingOrders ? "animate-spin" : ""}`} />
          </button>
        }
      >
        {loadingOrders ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#71717a" }} />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-10 h-10 mx-auto mb-3" style={{ color: "#3f3f46" }} />
            <p className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
              No orders yet
            </p>
            <p className="text-xs mt-1" style={{ color: "#52525b" }}>
              Orders from your storefront will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingOrders.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#71717a" }}>
                  Active Orders
                </p>
                {pendingOrders.map((order) => (
                  <FulfillmentPanel
                    key={order.id}
                    businessId={businessId}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
                    order={order as any}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
                    onUpdate={handleOrderUpdate as any}
                  />
                ))}
              </div>
            )}
            {completedOrders.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#71717a" }}>
                  Completed
                </p>
                {completedOrders.map((order) => (
                  <FulfillmentPanel
                    key={order.id}
                    businessId={businessId}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
                    order={order as any}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
                    onUpdate={handleOrderUpdate as any}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Delivery Methods"
        subtitle="Configure how customers receive orders"
        icon={Truck}
        expanded={expandedSection === "delivery"}
        onToggle={() => toggleSection("delivery")}
      >
        <DeliveryConfigPanel businessId={businessId} />
      </Section>

      <Section
        title="Shipping Zones"
        subtitle="Set shipping rates by region"
        icon={Truck}
        expanded={expandedSection === "shipping"}
        onToggle={() => toggleSection("shipping")}
      >
        <ShippingZonesPanel businessId={businessId} />
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon: Icon,
  expanded,
  onToggle,
  children,
  extra,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#18181b", border: "1px solid #27272a" }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
        style={{ background: expanded ? "#1f1f23" : "transparent" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#27272a" }}>
            <Icon className="w-4.5 h-4.5" style={{ color: "#a1a1aa" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#fafafa" }}>
              {title}
            </p>
            <p className="text-xs" style={{ color: "#71717a" }}>
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {extra}
          {expanded ? (
            <ChevronUp className="w-4 h-4" style={{ color: "#71717a" }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: "#71717a" }} />
          )}
        </div>
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
