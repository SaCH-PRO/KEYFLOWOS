"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Package, Truck, CheckCircle2, Clock, XCircle, ExternalLink, Phone, Mail, MessageCircle } from "lucide-react";
import { PublicPageState } from "@/components/ui/public-page-state";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { initPresence, trackPageView, pickBusinessId } from "@/app/_lib/presence-sdk";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

type OrderData = {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  total: number;
  currency: string;
  createdAt: string;
  items: { id: string; name: string; quantity: number; unitPrice: number; total: number }[];
  shipments: {
    id: string;
    carrier?: string;
    trackingNumber?: string;
    status: string;
    estimatedDelivery?: string;
    shippedAt?: string;
    deliveredAt?: string;
  }[];
  business: {
    name: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    slug?: string;
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  statusTimeline: {
    status: string;
    timestamp: string;
    note?: string;
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    reason?: string;
  }[];
};

const STATUS_STEPS = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"];
const STATUS_ICONS: Record<string, typeof Package> = {
  PENDING: Clock,
  CONFIRMED: CheckCircle2,
  PROCESSING: Package,
  SHIPPED: Truck,
  DELIVERED: CheckCircle2,
  CANCELLED: XCircle,
  REFUNDED: XCircle,
};

export default function OrderStatusPage() {
  const params = useParams();
  const token = params.token as string;
  const [order, setOrder] = useState<OrderData | null>(null);

  useEffect(() => {
    initPresence({ apiBase: API_BASE });
    const bizId = pickBusinessId(order);
    if (bizId) trackPageView(bizId);
  }, [order]);
  const [errorBusiness, setErrorBusiness] = useState<OrderData["business"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/marketplace/order-status/${token}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          if (json?.business && !cancelled) setErrorBusiness(json.business);
          throw new Error(json?.message || "Order not found");
        }
        return json;
      })
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("We couldn't find this order. Please check the link and try again.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryNonce]);

  const handleRetry = () => {
    setOrder(null);
    setError(null);
    setLoading(true);
    setRetryNonce((n) => n + 1);
  };

  if (loading) {
    return <PublicPageState variant="loading" message="Loading order details..." />;
  }

  if (error || !order) {
    return (
      <PublicPageState
        variant="error"
        title="Order Not Found"
        message={error ?? "We couldn't find this order. Please check the link and try again."}
        business={errorBusiness}
        retry={handleRetry}
        homeHref={errorBusiness?.slug ? `/book/${errorBusiness.slug}` : "/"}
        homeLabel={errorBusiness?.slug ? "Back to store" : "Back to home"}
      />
    );
  }

  const primary = order.business.primaryColor || "#F97316";
  const currentStepIndex = STATUS_STEPS.indexOf(order.status);
  const isFinal = ["CANCELLED", "REFUNDED"].includes(order.status);
  const latestShipment = order.shipments?.[0];
  const trackingEntry = order.statusTimeline?.find((e) => e.trackingUrl || e.trackingNumber);

  return (
    <div className="min-h-screen" style={{ background: "#111113" }}>
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "#1a1a1e", border: "1px solid #27272a" }}
        >
          <div
            className="px-6 py-5"
            style={{ background: `linear-gradient(135deg, ${primary}, ${order.business.secondaryColor || "#14B8A6"})` }}
          >
            <div className="flex items-center gap-3">
              {order.business.logoUrl && (
                <Image
                  src={order.business.logoUrl}
                  alt={order.business.name}
                  className="w-10 h-10 rounded-full object-cover"
                  style={{ border: "2px solid rgba(255,255,255,0.3)" }}
                 width={40} height={40} unoptimized />
              )}
              <div>
                <h1 className="text-lg font-semibold text-white">{order.business.name}</h1>
                <p className="text-sm text-white/70">Order #{order.orderNumber}</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <p className="text-xs font-medium mb-4" style={{ color: "#71717a" }}>
                Order Status
              </p>
              {!isFinal ? (
                <div className="flex items-center gap-1">
                  {STATUS_STEPS.map((step, i) => {
                    const isComplete = i <= currentStepIndex;
                    const Icon = STATUS_ICONS[step] || Package;
                    return (
                      <div key={step} className="flex items-center gap-1 flex-1">
                        <div className="flex flex-col items-center flex-1">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                            style={{
                              background: isComplete ? primary : "#27272a",
                              color: isComplete ? "#fff" : "#71717a",
                            }}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <span
                            className="text-[9px] mt-1.5 text-center font-medium"
                            style={{ color: isComplete ? "#fafafa" : "#52525b" }}
                          >
                            {step}
                          </span>
                        </div>
                        {i < STATUS_STEPS.length - 1 && (
                          <div
                            className="h-0.5 flex-1 rounded-full"
                            style={{ background: i < currentStepIndex ? primary : "#27272a" }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="px-4 py-3 rounded-xl text-sm font-medium text-center"
                  style={{
                    background: order.status === "CANCELLED" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                    color: order.status === "CANCELLED" ? "#ef4444" : "#f59e0b",
                    border: `1px solid ${order.status === "CANCELLED" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`,
                  }}
                >
                  Order {order.status.toLowerCase()}
                </div>
              )}
            </div>

            {latestShipment && (latestShipment.carrier || latestShipment.trackingNumber) && (
              <div className="rounded-xl p-4" style={{ background: "#27272a", border: "1px solid #3f3f46" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="w-4 h-4" style={{ color: primary }} />
                  <p className="text-sm font-medium" style={{ color: "#fafafa" }}>
                    Tracking Information
                  </p>
                </div>
                <div className="space-y-1.5 text-sm">
                  {latestShipment.carrier && (
                    <p style={{ color: "#d4d4d8" }}>
                      <span style={{ color: "#71717a" }}>Carrier:</span> {latestShipment.carrier}
                    </p>
                  )}
                  {latestShipment.trackingNumber && (
                    <p style={{ color: "#d4d4d8" }}>
                      <span style={{ color: "#71717a" }}>Tracking #:</span> {latestShipment.trackingNumber}
                    </p>
                  )}
                  {latestShipment.estimatedDelivery && (
                    <p style={{ color: "#d4d4d8" }}>
                      <span style={{ color: "#71717a" }}>Est. Delivery:</span>{" "}
                      {new Date(latestShipment.estimatedDelivery).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {trackingEntry?.trackingUrl && (
                  <a
                    href={trackingEntry.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium"
                    style={{ color: primary }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Track Shipment
                  </a>
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-medium mb-3" style={{ color: "#71717a" }}>
                Order Items
              </p>
              <div className="space-y-2">
                {order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg"
                    style={{ background: "#27272a" }}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: "#fafafa" }}>
                        {item.name}
                      </p>
                      <p className="text-xs" style={{ color: "#71717a" }}>
                        Qty: {item.quantity} × {order.currency} {item.unitPrice.toFixed(2)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: "#fafafa" }}>
                      {order.currency} {item.total.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
              <div
                className="flex items-center justify-between mt-3 pt-3"
                style={{ borderTop: "1px solid #27272a" }}
              >
                <p className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
                  Total
                </p>
                <p className="text-lg font-bold" style={{ color: "#fafafa" }}>
                  {order.currency} {order.total.toFixed(2)}
                </p>
              </div>
            </div>

            {order.statusTimeline?.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-3" style={{ color: "#71717a" }}>
                  Order Timeline
                </p>
                <div className="space-y-3">
                  {order.statusTimeline.map((entry, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className="w-2.5 h-2.5 rounded-full mt-1"
                          style={{ background: primary }}
                        />
                        {i < order.statusTimeline.length - 1 && (
                          <div className="w-px h-8" style={{ background: "#27272a" }} />
                        )}
                      </div>
                      <div className="pb-1">
                        <p className="text-sm font-medium" style={{ color: "#fafafa" }}>
                          {entry.status.replace(/_/g, " ")}
                        </p>
                        <p className="text-xs" style={{ color: "#71717a" }}>
                          {new Date(entry.timestamp).toLocaleString()}
                        </p>
                        {entry.note && (
                          <p className="text-xs mt-0.5" style={{ color: "#a1a1aa" }}>
                            {entry.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2" style={{ borderTop: "1px solid #27272a" }}>
              <p className="text-xs font-medium mb-2" style={{ color: "#71717a" }}>
                Contact {order.business.name}
              </p>
              <div className="flex flex-col gap-2 text-sm">
                {order.business.whatsapp && (
                  <a
                    href={buildWhatsAppLink(
                      order.business.whatsapp,
                      `Hi ${order.business.name}, I have a question about order #${order.orderNumber}.`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Message on WhatsApp
                  </a>
                )}
                <div className="flex flex-wrap gap-3">
                  {order.business.email && (
                    <a
                      href={`mailto:${order.business.email}`}
                      className="flex items-center gap-1.5 min-h-[44px]"
                      style={{ color: "#a1a1aa" }}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      {order.business.email}
                    </a>
                  )}
                  {order.business.phone && (
                    <a
                      href={`tel:${order.business.phone}`}
                      className="flex items-center gap-1.5 min-h-[44px]"
                      style={{ color: "#a1a1aa" }}
                    >
                      <Phone className="w-3.5 h-3.5" />
                      {order.business.phone}
                    </a>
                  )}
                </div>
              </div>
            </div>

            <p className="text-center text-[10px] pt-2" style={{ color: "#52525b" }}>
              Order placed {new Date(order.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
